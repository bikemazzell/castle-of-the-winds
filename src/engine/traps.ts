/**
 * Dungeon traps (Task 4.3). Trap kinds and messages follow the original
 * strings ("A pit", "A blade trap", "You set off the trap!"…). Detection
 * rules per the manual: Detect Traps finds traps within 10 squares with
 * certainty, with falling probability beyond; a known trap is less likely
 * to go off; disarming risks springing the trap and earns XP; Levitation
 * avoids the gravity-activated traps (pit, trap door).
 *
 * Numeric constants that the originals computed at runtime are APPROX —
 * see docs/APPROXIMATIONS.md #27–#33.
 */

import { gainExperience } from './character';
import { TILE_STAIRS_DOWN, TILE_STAIRS_UP } from './dungeon';
import { applyStatus, hasStatus } from './effects';
import { findStair, idx, type Level } from './map';
import { MSLCG, levelGenSeed } from './rng';
import { teleportDestination } from './spells';
import { questEvent } from './quests';
import type { Difficulty, TrapKind, TrapState, WorldData } from './types';
import { ensureLevel, type World } from './world';

/** Manual: a known trap is "less likely to go off" — APPROX 1-in-4. */
export const KNOWN_TRIGGER_CHANCE = 4;

/** Every trap kind (validation + save round-trips). */
export const ALL_TRAP_KINDS: readonly TrapKind[] = [
  'pit',
  'trap_door',
  'dart',
  'blade',
  'fire',
  'acid',
  'gas',
  'poison',
  'teleport',
];

/** Manual ('c'): searching may need several attempts — APPROX 1-in-3 per try. */
export const SEARCH_CHANCE = 3;
/** Failed disarm risks setting the trap off — APPROX 1-in-3. */
export const SPRING_CHANCE = 3;

const DIFFICULTY_TRAP_MULTIPLIER: Record<Difficulty, number> = {
  easy: 0.75,
  intermediate: 1,
  difficult: 1.25,
  expert: 1.5,
};

/** APPROX: base 3 + one per two levels, scaled by difficulty (manual: harder
 * games have more traps), clamped 2..12. */
export function trapCountFor(levelIndex: number, difficulty: Difficulty): number {
  const base = 3 + Math.floor(levelIndex / 2);
  return Math.max(2, Math.min(12, Math.round(base * DIFFICULTY_TRAP_MULTIPLIER[difficulty])));
}

/** APPROX depth bands for trap kinds (early: pit/dart/gas per intro dungeon). */
export function kindsForLevel(levelIndex: number): TrapKind[] {
  const kinds: TrapKind[] = ['pit', 'dart', 'gas'];
  if (levelIndex >= 2) kinds.push('poison');
  if (levelIndex >= 3) kinds.push('blade');
  if (levelIndex >= 4) kinds.push('fire');
  if (levelIndex >= 5) kinds.push('acid');
  if (levelIndex >= 6) kinds.push('trap_door');
  if (levelIndex >= 7) kinds.push('teleport');
  return kinds;
}

/** APPROX: XP for a successful disarm (manual: disarming grants experience). */
export function DISARM_XP(levelIndex: number): number {
  return 10 * (1 + Math.floor(levelIndex / 2));
}

function walkable(data: WorldData, tile: number): boolean {
  return data.tiles[String(tile)]?.walkable ?? false;
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * Place a level's traps. Deterministic: dedicated RNG derived from the level
 * gen seed (never the gameplay RNG), mirroring populateLevel.
 */
export function placeTraps(world: World, level: Level, levelIndex: number): number {
  if ((level.traps?.length ?? 0) > 0) return 0;
  const count = trapCountFor(levelIndex, world.player.difficulty);
  const kinds = kindsForLevel(levelIndex);
  const rng = new MSLCG((levelGenSeed(world.worldSeed, levelIndex) ^ 0x7ea4da0) >>> 0);
  const stairsDown = findStair(level, TILE_STAIRS_DOWN);
  const stairsUp = findStair(level, TILE_STAIRS_UP);

  const traps: TrapState[] = [];
  let attempts = 0;
  while (traps.length < count && attempts < count * 100) {
    attempts++;
    const x = rng.rand(64);
    const y = rng.rand(64);
    const i = idx(x, y);
    const tile = level.tiles[i] ?? 0;
    if (!walkable(world.data, tile)) continue;
    if (tile === TILE_STAIRS_DOWN || tile === TILE_STAIRS_UP) continue;
    if ((level.occupancy[i] ?? 0) !== 0) continue;
    if (stairsDown && chebyshev(x, y, stairsDown.x, stairsDown.y) < 3) continue;
    if (stairsUp && chebyshev(x, y, stairsUp.x, stairsUp.y) < 3) continue;
    if (traps.some((t) => t.x === x && t.y === y)) continue;
    traps.push({ id: `t${traps.length + 1}`, kind: kinds[rng.rand(kinds.length)]!, x, y, known: false });
  }
  level.traps = traps;
  return traps.length;
}

export function trapAt(level: Level, x: number, y: number): TrapState | null {
  return level.traps?.find((t) => t.x === x && t.y === y) ?? null;
}

/** Apply a trap's effect; returns the player-facing message. */
function applyTrapEffect(world: World, trap: TrapState): string {
  const player = world.player;
  const levelIndex = world.current;
  // Depth-scaled bonus keeps early traps survivable (APPROX).
  const depthBonus = Math.floor(levelIndex / 3);
  const roll = (sides: number): number => world.rng.rand(sides) + 1 + depthBonus;

  switch (trap.kind) {
    case 'pit':
      player.hp -= roll(6);
      return 'You set off the trap!';
    case 'dart':
      player.hp -= roll(4);
      return 'You set off the trap!';
    case 'blade':
      player.hp -= roll(8);
      return 'You set off the trap!';
    case 'fire':
      player.hp -= roll(8);
      return 'You set off the trap!';
    case 'acid':
      player.hp -= roll(6);
      return 'You set off the trap!';
    case 'poison':
      applyStatus(player, 'poison');
      return 'You set off the trap!';
    case 'gas':
      applyStatus(player, 'poison');
      return 'A cloud of gas surrounds you!';
    case 'teleport': {
      const level = world.levels.get(levelIndex)!;
      const dest = teleportDestination(world.rng, level, { x: player.x, y: player.y });
      player.x = dest.x;
      player.y = dest.y;
      return 'You trigger a teleport trap!';
    }
    case 'trap_door': {
      player.hp -= roll(8);
      const node = world.data.levels.find((n) => n.index === levelIndex);
      const to = node?.links.down;
      if (to === null || to === undefined) return 'You fall through a trap door!';
      const below = ensureLevel(world, to);
      const dest = teleportDestination(world.rng, below, { x: player.x, y: player.y }, 64);
      world.current = to;
      player.x = dest.x;
      player.y = dest.y;
      questEvent(world, { kind: 'level-entered', level: to });
      return 'You fall through a trap door!';
    }
  }
}

/**
 * TrapSystem.onPlayerEnter implementation: the player just stepped on (x, y).
 * Returns the message to log, or null when nothing happens.
 */
export function triggerTrapAt(world: World, x: number, y: number): string | null {
  const level = world.levels.get(world.current);
  if (!level) return null;
  const trap = trapAt(level, x, y);
  if (!trap) return null;
  if (trap.known) {
    // Manual: a known trap is less likely to go off.
    if (world.rng.rand(KNOWN_TRIGGER_CHANCE) !== 0) return null;
  }
  // Levitation avoids "gravity activated traps" (manual: Levitation) —
  // silently: floating over a pit does not reveal it.
  if (
    hasStatus(world.player, 'levitation') &&
    (trap.kind === 'pit' || trap.kind === 'trap_door')
  ) {
    return null;
  }
  trap.known = true;
  return applyTrapEffect(world, trap);
}

export interface DisarmResult {
  ok: boolean;
  message: string;
  /** A failed disarm sprang the trap (its message follows). */
  sprung?: boolean;
  sprungMessage?: string;
}

/** Disarm a known adjacent trap (manual 'D': may fail; failure may spring it). */
export function disarmTrapAt(world: World, x: number, y: number): DisarmResult {
  const level = world.levels.get(world.current)!;
  const trap = trapAt(level, x, y);
  if (!trap || !trap.known) {
    return { ok: false, message: 'Nothing there to disarm!' };
  }
  if (world.rng.rand(100) < world.player.dexterity) {
    level.traps = (level.traps ?? []).filter((t) => t !== trap);
    gainExperience(world.player, DISARM_XP(world.current), world.data.xpThresholds ?? []);
    return { ok: true, message: 'You disarmed the trap.' };
  }
  const result: DisarmResult = { ok: false, message: 'You failed to disarm the trap.' };
  if (world.rng.rand(SPRING_CHANCE) === 0) {
    result.sprung = true;
    result.sprungMessage = applyTrapEffect(world, trap);
  }
  return result;
}

/** Resolve a DISARM action target: explicit (adjacent) or auto-adjacent. */
export function findDisarmTarget(world: World, x?: number, y?: number): { x: number; y: number } | null {
  const px = world.player.x;
  const py = world.player.y;
  if (x !== undefined && y !== undefined) {
    return chebyshev(px, py, x, y) <= 1 ? { x, y } : null;
  }
  const level = world.levels.get(world.current);
  if (!level) return null;
  const candidates = (level.traps ?? []).filter(
    (t) => t.known && chebyshev(px, py, t.x, t.y) <= 1,
  );
  if (candidates.length === 0) return null;
  return { x: candidates[0]!.x, y: candidates[0]!.y };
}

/** Detect Traps spell: ≤10 squares certain, decreasing chance beyond (manual). */
export function detectTrapsOnLevel(world: World): number {
  const level = world.levels.get(world.current);
  if (!level) return 0;
  let revealed = 0;
  for (const trap of level.traps ?? []) {
    if (trap.known) continue;
    const dist = chebyshev(world.player.x, world.player.y, trap.x, trap.y);
    if (dist <= 10) {
      trap.known = true;
      revealed++;
    } else if (world.rng.rand(100) < Math.max(0, 100 - (dist - 10) * 8)) {
      trap.known = true;
      revealed++;
    }
  }
  return revealed;
}

/** Mark all traps inside a rect as known (Clairvoyance, manual 77). */
export function revealTrapsInRect(level: Level, rect: { x: number; y: number; w: number; h: number }): number {
  let revealed = 0;
  for (const trap of level.traps ?? []) {
    if (trap.known) continue;
    if (trap.x >= rect.x && trap.x < rect.x + rect.w && trap.y >= rect.y && trap.y < rect.y + rect.h) {
      trap.known = true;
      revealed++;
    }
  }
  return revealed;
}
