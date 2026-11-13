// Spell registry + targeting geometry (Task 3.3).
// Effect kinds are curated from the manual (topics 48 Magic / 49 Spells and
// per-spell topics); numeric damage dice are APPROX (EXTRACTION-GAPS.md #1).
// Actual effect application lands in Task 3.4 (effects.ts).
import type { Level } from './map';
import type { Player, SpellsFile } from './types';
import { TILE_STAIRS_UP, TILE_WALL } from './dungeon';
import { LEVEL_SIZE, findStair, idx } from './map';
import { spellManaCost } from './formulas';
import type { MSLCG } from './rng';

export type SpellEffectKind =
  | 'missile'
  | 'bolt'
  | 'ball'
  | 'heal'
  | 'shield'
  | 'resist'
  | 'light_radius'
  | 'detect_traps'
  | 'detect_objects'
  | 'detect_monsters'
  | 'clairvoyance'
  | 'levitation'
  | 'teleport_self'
  | 'rune_of_return'
  | 'phase_door'
  | 'identify'
  | 'remove_curse'
  | 'neutralize_poison'
  | 'debuff_sleep'
  | 'debuff_slow'
  | 'transmogrify'
  | 'monster_ai'; // non-character spells (manual: cast by monsters only)

export interface SpellDefRuntime {
  id: string;
  name: string;
  tier: number | null;
  baseMana: number | null;
  target: 'self' | 'enemy' | null;
  effect: SpellEffectKind;
  element?: 'fire' | 'cold' | 'lightning';
}

/** Curated effect mapping keyed by the in-game (uppercase) names. */
const EFFECT_BY_NAME: Record<string, { effect: SpellEffectKind; element?: SpellDefRuntime['element'] }> = {
  'MAGIC ARROW': { effect: 'missile' },
  'COLD BOLT': { effect: 'bolt', element: 'cold' },
  'LIGHTNING BOLT': { effect: 'bolt', element: 'lightning' },
  'FIRE BOLT': { effect: 'bolt', element: 'fire' },
  'COLD BALL': { effect: 'ball', element: 'cold' },
  'BALL LIGHTNING': { effect: 'ball', element: 'lightning' },
  FIREBALL: { effect: 'ball', element: 'fire' },
  'SLEEP MONSTER': { effect: 'debuff_sleep' },
  'SLOW MONSTER': { effect: 'debuff_slow' },
  'TRANSMOGRIFY MONSTER': { effect: 'transmogrify' },
  SHIELD: { effect: 'shield' },
  'RESIST FIRE': { effect: 'resist', element: 'fire' },
  'RESIST COLD': { effect: 'resist', element: 'cold' },
  'RESIST LIGHTNING': { effect: 'resist', element: 'lightning' },
  'HEAL MINOR WOUNDS': { effect: 'heal' },
  'HEAL MEDIUM WOUNDS': { effect: 'heal' },
  'HEAL MAJOR WOUNDS': { effect: 'heal' },
  HEALING: { effect: 'heal' },
  'NEUTRALIZE POISON': { effect: 'neutralize_poison' },
  'PHASE DOOR': { effect: 'phase_door' },
  LEVITATION: { effect: 'levitation' },
  'RUNE OF RETURN': { effect: 'rune_of_return' },
  TELEPORT: { effect: 'teleport_self' },
  'DETECT OBJECTS': { effect: 'detect_objects' },
  'DETECT MONSTERS': { effect: 'detect_monsters' },
  'DETECT TRAPS': { effect: 'detect_traps' },
  IDENTIFY: { effect: 'identify' },
  CLAIRVOYANCE: { effect: 'clairvoyance' },
  LIGHT: { effect: 'light_radius' },
  'REMOVE CURSE': { effect: 'remove_curse' },
  'HASTE MONSTER': { effect: 'monster_ai' },
  'CLONE MONSTER': { effect: 'monster_ai' },
  'TELEPORT AWAY': { effect: 'monster_ai' },
  'CREATE TRAPS': { effect: 'monster_ai' },
};

export function loadSpellDefs(file: SpellsFile): Record<string, SpellDefRuntime> {
  const defs: Record<string, SpellDefRuntime> = {};
  for (const record of file.records) {
    const mapping = EFFECT_BY_NAME[record.name];
    if (!mapping) {
      throw new Error(`no effect mapping for spell '${record.name}' (${record.id})`);
    }
    defs[record.id] = {
      id: record.id,
      name: record.name,
      tier: record.tier ?? null,
      baseMana: record.manaCost ?? null,
      target: (record.target as 'self' | 'enemy' | null | undefined) ?? null,
      effect: mapping.effect,
      element: mapping.element,
    };
  }
  return defs;
}

// ─── Castability ────────────────────────────────────────────────────────────

export interface CastCheck {
  ok: boolean;
  reason?: string;
  cost?: number;
}

/** Learned + enough mana + not a monster-only spell. */
export function canCast(def: SpellDefRuntime, player: Player): CastCheck {
  if (def.effect === 'monster_ai') {
    return { ok: false, reason: `${def.name} is not a character spell` };
  }
  if (!player.knownSpells.includes(def.id)) {
    return { ok: false, reason: `you have not learned ${def.name}` };
  }
  const cost = manaCostFor(def, player);
  if (player.mana < cost) {
    return { ok: false, reason: `not enough mana (${cost} required)`, cost };
  }
  return { ok: true, cost };
}

/** Level-adjusted mana cost (manual 296), gaps default to tier-based cost. */
export function manaCostFor(def: SpellDefRuntime, player: Player): number {
  const base = def.baseMana ?? def.tier ?? 1;
  const tier = def.tier ?? 1;
  return spellManaCost(base, tier, player.level);
}

// ─── Geometry ───────────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

/**
 * Bresenham path from `from` (exclusive) to `to` (inclusive), stopping at the
 * first wall (the wall tile is included as the impact point) or at an
 * occupied tile (monster impact).
 */
export function boltPath(level: Level, from: Point, to: Point): Point[] {
  const path: Point[] = [];
  let x0 = from.x;
  let y0 = from.y;
  const dx = Math.abs(to.x - x0);
  const dy = Math.abs(to.y - y0);
  const sx = x0 < to.x ? 1 : -1;
  const sy = y0 < to.y ? 1 : -1;
  let err = dx - dy;
  // Cap iterations to avoid infinite loops on degenerate input.
  for (let guard = 0; guard < 2 * (dx + dy) + 4; guard++) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
    if (x0 < 0 || y0 < 0 || x0 >= LEVEL_SIZE || y0 >= LEVEL_SIZE) break;
    const tile = level.tiles[idx(x0, y0)] ?? TILE_WALL;
    path.push({ x: x0, y: y0 });
    if (tile === TILE_WALL) break; // impact at the wall
    if (x0 === to.x && y0 === to.y) break;
  }
  return path;
}

export interface BallCell extends Point {
  /** 0 = center (full damage), 1 = edge (half damage) — manual 481. */
  centerDist: number;
}

/** 3×3 area around an impact, clipped to map bounds. */
export function ballImpactArea(_level: Level, center: Point): BallCell[] {
  const cells: BallCell[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (x < 0 || y < 0 || x >= LEVEL_SIZE || y >= LEVEL_SIZE) continue;
      cells.push({ x, y, centerDist: Math.abs(dx) + Math.abs(dy) === 0 ? 0 : 1 });
    }
  }
  return cells;
}

/**
 * APPROX damage dice (originals unrecoverable): missile tier d6, bolt tier d8,
 * ball tier d10 at the center and half (rounded down) on edges.
 */
export function rollDamage(
  kind: 'missile' | 'bolt' | 'ball',
  tier: number,
  rng: MSLCG,
  centerDist = 0,
): number {
  const sides = kind === 'missile' ? 6 : kind === 'bolt' ? 8 : 10;
  let total = 0;
  for (let i = 0; i < tier; i++) total += rng.rand(sides) + 1;
  return centerDist > 0 ? Math.max(1, Math.floor(total / 2)) : total;
}

/**
 * Teleport destination (manual: random location "in the general vicinity"):
 * a walkable, unoccupied tile within `radius` of `from`, bounded attempts.
 */
export function teleportDestination(rng: MSLCG, level: Level, from: Point, radius = 8, walkable: (tile: number) => boolean = tile => [1,18,19,128,129,133].includes(tile)): Point | null {
  for (let attempt = 0; attempt < 200; attempt++) {
    const x = from.x + rng.rand(2 * radius + 1) - radius;
    const y = from.y + rng.rand(2 * radius + 1) - radius;
    if (x < 0 || y < 0 || x >= LEVEL_SIZE || y >= LEVEL_SIZE) continue;
    const tile = level.tiles[idx(x, y)] ?? TILE_WALL;
    if (walkable(tile) && (level.occupancy[idx(x, y)] ?? 0) === 0) {
      return { x, y };
    }
  }
  if (walkable(level.tiles[idx(from.x, from.y)] ?? TILE_WALL) && !level.occupancy[idx(from.x, from.y)]) return { ...from };
  // A cross-level arrival cannot stay at source coordinates inside a wall.
  for (let y = 0; y < LEVEL_SIZE; y++) {
    for (let x = 0; x < LEVEL_SIZE; x++) {
      if (walkable(level.tiles[idx(x, y)] ?? TILE_WALL) && !level.occupancy[idx(x, y)]) return { x, y };
    }
  }
  return null;
}

/** Rune of Return: the up-stair coordinates (shrine: uses stair coords). */
export function runeOfReturnTarget(level: Level): Point | null {
  return findStair(level, TILE_STAIRS_UP);
}
