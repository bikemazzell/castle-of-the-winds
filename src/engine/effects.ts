/**
 * Effect application integration (Task 3.4): statuses, potion/scroll effects
 * and CAST wiring helpers.
 *
 * Numeric durations and heal amounts are APPROX — the originals live in the
 * unrecovered runtime-built stat tables (EXTRACTION-GAPS.md #1). Geometry and
 * semantics follow the manual (Light 3×3 in hallways, Clairvoyance 10×10,
 * Rune of Return uses stair coordinates per shrine RE).
 */
import type { EffectSystem, InventoryItem, ItemDefRuntime, Player, Status, StatusKind } from './types';
import type { World } from './world';
import type { SpellDefRuntime } from './spells';
import { clairvoyanceRegion, revealRect } from './fov';
import { TILE_FLOOR, TILE_WALL, FLAG_DOOR } from './dungeon';
import { resolveSpellAttack, spawnMonsterState } from './combat';
import { SLEEP_SPELL_TURNS } from './monsters';
import { questBosses } from './quests';
import { detectTrapsOnLevel, revealTrapsInRect } from './traps';
import { revealDoorsInRect } from './doors';
import type { Level, Entity } from './map';
import { idx } from './map';
import { runeOfReturnTarget, teleportDestination } from './spells';
import { questEvent } from './quests';
import type { MonsterState } from './types';

// ─── Statuses ───────────────────────────────────────────────────────────────

/** APPROX durations (turns). Poison duration is set by its source. */
export const STATUS_DURATIONS: Record<StatusKind, number> = {
  poison: 100,
  shield: 400,
  resist_fire: 500,
  resist_cold: 500,
  resist_lightning: 500,
  light: 1000,
  levitation: 500,
  detect_traps: 250,
  detect_objects: 250,
  detect_monsters: 200,
};

/** Poison ticks: 1 hp every 10 turns (APPROX). */
export const POISON_PERIOD = 10;

export function applyStatus(
  player: Player,
  kind: StatusKind,
  duration = STATUS_DURATIONS[kind],
  magnitude?: number,
): Status {
  const existing = player.statuses.find((s) => s.kind === kind);
  if (existing) {
    existing.remainingTurns = Math.max(existing.remainingTurns, duration);
    if (magnitude !== undefined) existing.magnitude = magnitude;
    return existing;
  }
  const status: Status = { kind, remainingTurns: duration };
  if (magnitude !== undefined) status.magnitude = magnitude;
  player.statuses.push(status);
  return status;
}

export function hasStatus(player: Player, kind: StatusKind): boolean {
  return player.statuses.some((s) => s.kind === kind);
}

export function removeStatus(player: Player, kind: StatusKind): boolean {
  const before = player.statuses.length;
  player.statuses = player.statuses.filter((s) => s.kind !== kind);
  return player.statuses.length < before;
}

/**
 * Advance statuses by `turns`. Poison accumulates `magnitude` and deals 1 hp
 * per POISON_PERIOD. Expired statuses are removed.
 */
export function tickStatuses(player: Player, turns: number): void {
  for (const status of player.statuses) {
    // Age by the elapsed turns, but a status that expires mid-interval only
    // stays ACTIVE for its remaining turns (Task 7: e.g. a poison with 15
    // turns left, aged a full 360-turn rest hour, deals 1 tick of damage —
    // not 36).
    const activeTurns = Math.max(0, Math.min(turns, status.remainingTurns));
    status.remainingTurns -= turns;
    if (status.kind === 'poison') {
      const acc = (status.magnitude ?? 0) + activeTurns;
      const full = Math.floor(acc / POISON_PERIOD);
      status.magnitude = acc % POISON_PERIOD;
      if (full > 0) player.hp = Math.max(0, player.hp - full);
    }
  }
  player.statuses = player.statuses.filter((s) => s.remainingTurns > 0);
}

/** Total AV bonus from shield statuses (equipmentStats folds this in). */
export function statusArmorBonus(player: Player): number {
  let bonus = 0;
  for (const s of player.statuses) {
    if (s.kind === 'shield') bonus += s.magnitude ?? 0;
  }
  return bonus;
}

// ─── Spell effect application ───────────────────────────────────────────────

export interface SpellEffectResult {
  ok: boolean;
  message: string;
}

/** APPROX: heal spells restore tier × 8 hp (originals unrecoverable). */
export function healAmountForTier(tier: number): number {
  return tier * 8;
}

function movePlayer(world: World, x: number, y: number): void {
  world.player.x = x;
  world.player.y = y;
}

/** Adjacent walls for Phase Door (4-directional, player position default). */
function adjacentWall(level: Level, x: number, y: number): { x: number; y: number } | null {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= 64 || ny >= 64) continue;
    if (level.tiles[idx(nx, ny)] === TILE_WALL) return { x: nx, y: ny };
  }
  return null;
}

/**
 * Apply a non-attack spell effect to the world. Attack kinds (missile, bolt,
 * ball, debuffs, transmogrify) resolve against monsters and land with combat
 * in Milestone 4 — they return ok:false here.
 */
export function applySpellEffect(
  world: World,
  def: SpellDefRuntime,
  target?: { x: number; y: number },
): SpellEffectResult {
  const level = world.levels.get(world.current)!;
  const player = world.player;

  switch (def.effect) {
    case 'heal': {
      const amount = healAmountForTier(def.tier ?? 1);
      const healed = Math.min(amount, player.maxHp - player.hp);
      player.hp += healed;
      return { ok: true, message: `You feel better. (+${healed} hp)` };
    }

    case 'shield': {
      applyStatus(player, 'shield', STATUS_DURATIONS.shield, (def.tier ?? 1) * 2);
      return { ok: true, message: 'A shimmering shield surrounds you.' };
    }

    case 'resist': {
      const element = def.element ?? 'fire';
      applyStatus(player, `resist_${element}` as StatusKind);
      return { ok: true, message: `You feel resistant to ${element}.` };
    }

    case 'light_radius': {
      applyStatus(player, 'light');
      return { ok: true, message: 'Light blooms around you.' };
    }

    case 'levitation': {
      applyStatus(player, 'levitation');
      return { ok: true, message: 'You rise gently off the ground.' };
    }

    case 'detect_traps': {
      applyStatus(player, 'detect_traps');
      // Manual: attempts to detect all traps on the level (≤10 certain).
      detectTrapsOnLevel(world);
      return { ok: true, message: 'You sense traps.' };
    }

    case 'detect_objects': {
      applyStatus(player, 'detect_objects');
      return { ok: true, message: 'You sense the presence of objects.' };
    }

    case 'detect_monsters': {
      applyStatus(player, 'detect_monsters');
      return { ok: true, message: 'You sense the presence of monsters.' };
    }

    case 'clairvoyance': {
      const seen = world.seen.get(world.current);
      const region = clairvoyanceRegion({ x: player.x, y: player.y });
      if (seen) revealRect(seen, region);
      // Manual 77: "including showing all secret doors and traps".
      revealTrapsInRect(level, region);
      revealDoorsInRect(world, level, region);
      return { ok: true, message: 'Knowledge of your surroundings floods your mind.' };
    }

    case 'teleport_self': {
      const dest = teleportDestination(world.rng, level, { x: player.x, y: player.y }, 8, tile => world.data.tiles[String(tile)]?.walkable === true);
      if (!dest) return { ok: false, message: 'No safe teleport destination.' };
      movePlayer(world, dest.x, dest.y);
      return { ok: true, message: 'The world twists around you.' };
    }

    case 'rune_of_return': {
      const stair = runeOfReturnTarget(level);
      if (stair) {
        if (level.occupancy[idx(stair.x, stair.y)]) return {ok:false,message:'The return stair is occupied.'};
        movePlayer(world, stair.x, stair.y);
        return { ok: true, message: 'A rune of return whisks you to the stairs.' };
      }
      // No up stair on this level (levels 1–3): return to town (APPROX).
      if (world.current === 0) {
        return { ok: false, message: 'You are already in town.' };
      }
      world.current = 0;
      if (!world.seen.has(0)) world.seen.set(0, new Uint8Array(4096));
      movePlayer(world, world.data.town.spawn.x, world.data.town.spawn.y);
      questEvent(world, { kind: 'town-entered' });
      return { ok: true, message: 'A rune of return whisks you back to town.' };
    }

    case 'phase_door': {
      const origin = target ?? { x: player.x, y: player.y };
      const wall = adjacentWall(level, origin.x, origin.y);
      if (!wall) return { ok: false, message: 'There is no wall in reach.' };
      const i = idx(wall.x, wall.y);
      level.tiles[i] = TILE_FLOOR;
      level.flags[i] = (level.flags[i] ?? 0) | FLAG_DOOR;
      return { ok: true, message: 'A door phases into the wall.' };
    }

    case 'identify': {
      return { ok: true, message: 'You feel knowledge wash over your possessions.' };
    }

    case 'remove_curse': {
      return { ok: true, message: 'You feel a burden lift from your shoulders.' };
    }

    case 'neutralize_poison': {
      removeStatus(player, 'poison');
      return { ok: true, message: 'The poison fades from your veins.' };
    }

    case 'missile':
    case 'bolt':
    case 'ball': {
      // Task 4.1: attack spells resolve through combat against monsters.
      if (!target) return { ok: false, message: `${def.name} needs a target.` };
      resolveSpellAttack(world, def, target);
      return { ok: true, message: `You cast ${def.name}.` };
    }

    case 'debuff_sleep':
    case 'debuff_slow':
    case 'transmogrify': {
      // Debuffs target the monster occupying the target cell.
      const victim = targetMonster(world, target);
      if (!victim) return { ok: false, message: `${def.name} needs a target.` };
      if (def.effect === 'debuff_sleep') {
        victim.monster.sleepTurns = SLEEP_SPELL_TURNS;
        return { ok: true, message: `${victim.name} falls into an enchanted sleep.` };
      }
      if (def.effect === 'debuff_slow') {
        // Manual: successive slows are less effective (1/2, 1/3, 1/4, ...).
        victim.monster.slowDenominator = (victim.monster.slowDenominator ?? 1) + 1;
        return { ok: true, message: `${victim.name} slows down.` };
      }
      // Quest bosses are immune to transmogrify (PART2-PLAN P2 blocker fix):
      // the spell spends its mana and turn, but the boss resists.
      const bossImmune = new Set<string>([
        ...questBosses(world.data.quests ?? []).map((b) => b.monster),
        ...(world.data.quests ?? []).flatMap((q) => q.bossRosterExclusions ?? []),
      ]);
      if (bossImmune.has(victim.name)) {
        return { ok: true, message: `${victim.name} resists the spell!` };
      }
      const transformed = transmogrifyMonster(world, victim);
      if (!transformed) return { ok: false, message: 'The spell fizzles.' };
      return { ok: true, message: `${victim.name} transforms into ${transformed.name}!` };
    }

    case 'monster_ai':
      // Non-character spells (Haste/Clone/Teleport Away/Create Traps) are
      // monster-side; cursed-item effects land in M6.
      return { ok: false, message: `${def.name} is not a character spell.` };
  }
}

// ─── Debuff helpers (Task 4.2) ───────────────────────────────────────────────

/** The monster occupying the target cell on the current level, if any. */
function targetMonster(
  world: World,
  target?: { x: number; y: number },
): (Entity & { monster: MonsterState }) | null {
  if (!target) return null;
  const level = world.levels.get(world.current);
  if (!level) return null;
  const id = level.occupancy[idx(target.x, target.y)] ?? 0;
  const entity = id !== 0 ? level.entities.get(id) : undefined;
  if (!entity || entity.kind !== 'monster' || !entity.monster) return null;
  return entity as Entity & { monster: MonsterState };
}

/**
 * Transmogrify Monster: the victim becomes another roster monster; the manual
 * says injuredness is preserved (hp fraction carries over). Sleep/slow do not
 * carry over — it is a fresh creature.
 */
function transmogrifyMonster(world: World, victim: Entity): Entity | null {
  const roster = world.data.monsters;
  if (!roster || roster.length < 2) return null;
  // Boss identities are never valid transformation results (PART2-PLAN P2):
  // exact names only — placed bosses plus the explicit exclusion list.
  const bossNames = new Set<string>([
    ...questBosses(world.data.quests ?? []).map((b) => b.monster),
    ...(world.data.quests ?? []).flatMap((q) => q.bossRosterExclusions ?? []),
  ]);
  const others = roster.filter(
    (entry) => entry.name !== victim.name && !bossNames.has(entry.name),
  );
  if (others.length === 0) return null;
  const pick = others[world.rng.rand(others.length)]!;
  const state = spawnMonsterState(pick.name);
  const fraction = victim.monster!.hp / victim.monster!.maxHp;
  state.hp = Math.max(1, Math.round(state.maxHp * fraction));
  victim.name = pick.name;
  victim.monster = state;
  return victim;
}

// ─── Potion / scroll item effects ───────────────────────────────────────────

const ITEM_SPELL_NAME = /^(?:Potion|Scroll) of (.+)$/i;

function spellByName(world: World, name: string): SpellDefRuntime | null {
  const upper = name.toUpperCase();
  for (const def of Object.values(world.data.spells)) {
    if (def.name === upper) return def;
  }
  return null;
}

const ATTACK_KINDS = new Set<SpellDefRuntime['effect']>([
  'missile',
  'bolt',
  'ball',
  'debuff_sleep',
  'debuff_slow',
  'transmogrify',
  'monster_ai',
]);

/**
 * Real EffectSystem (Task 3.4): "Scroll of X" teaches spell X (original
 * message 'You learn the spell of %i'); "Potion of X" applies spell X's
 * effect without mana. Anything else does nothing (null).
 */
export function spellEffectSystem(): EffectSystem {
  return {
    onUse(world: unknown, item: InventoryItem, def: ItemDefRuntime) {
      const w = world as World;
      const match = ITEM_SPELL_NAME.exec(def.name);
      if (!match) return null;
      const spell = spellByName(w, match[1]!);
      if (!spell) return null;

      if (/^scroll/i.test(def.name)) {
        if (!w.player.knownSpells.includes(spell.id)) {
          w.player.knownSpells.push(spell.id);
          return { consumed: true, message: `You learn the spell of ${spell.name}.` };
        }
        return { consumed: true, message: `You already know the spell of ${spell.name}.` };
      }

      // Potion: apply the spell effect directly (no mana, no learning).
      if (ATTACK_KINDS.has(spell.effect)) return null;
      const result = applySpellEffect(w, spell);
      if (!result.ok) return null;
      return { consumed: true, message: result.message };
    },
  };
}
