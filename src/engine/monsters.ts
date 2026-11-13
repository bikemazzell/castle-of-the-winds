import { monsterBreath, monsterAttack, spawnMonsterState } from './combat';
import type { MonsterCombatStats, WorldData } from './types';
import { TILE_STAIRS_DOWN, TILE_STAIRS_UP } from './dungeon';
import { hasLos } from './fov';
import { allocateEntityId, idx, LEVEL_SIZE, type Entity, type Level } from './map';
import { MSLCG, levelGenSeed } from './rng';
import { questBosses } from './quests';
import type { World } from './world';

/**
 * Monster spawning + AI. Stats come from the APPROX tier adapter in combat.ts
 * (monsters.json carries the original's 5 stat gaps — see APPROXIMATIONS.md).
 */

export const SIGHT_RANGE = 12;

/** Campaign 7.3 balancing: breath-capable apex monsters never spawn in packs. */
export const MAX_DRAGONS_PER_LEVEL = 1;

function isDragonName(name: string): boolean {
  return /dragon/i.test(name);
}
export const WANDER_CHANCE = 150; // 1-in-N per turn for a wander spawn
export const WANDER_BONUS_CAP = 3; // extra monsters above the initial budget
export const SLEEP_SPELL_TURNS = 60; // Sleep Monster: 10 minutes × 6 turns/min

export interface SpawnEntry {
  id: string;
  name: string;
  stats: MonsterCombatStats;
  depth: number; // 0 (shallow) .. 7 (boss tier)
}

const MAX_DEPTH = 7;

/** APPROX depth band from xp (log2 ladder: rat 0 → dragon 6-7). */
function depthForXp(xp: number): number {
  return Math.min(MAX_DEPTH, Math.max(0, Math.floor(Math.log2(xp / 10))));
}

export function loadSpawnRoster(records: { id: string; name: string }[]): SpawnEntry[] {
  return records.map((record) => {
    const stats = spawnMonsterState(record.name).stats;
    return { id: record.id, name: record.name, stats, depth: depthForXp(stats.xp) };
  });
}

/** Deepest monster band allowed on the given dungeon level. */
export function maxDepthFor(levelIndex: number): number {
  return Math.min(MAX_DEPTH, Math.max(1, 1 + Math.floor(levelIndex / 2)));
}

/** Exact names excluded from random spawns — from quest data, never derived
 *  by substring (a substring rule would over-exclude ordinary giants whose
 *  names occur inside king titles). PART2-PLAN Task P2. */
export function bossExclusions(world: World): ReadonlySet<string> {
  return new Set((world.data.quests ?? []).flatMap((q) => q.bossRosterExclusions ?? []));
}

export function eligibleFor(
  levelIndex: number,
  roster: SpawnEntry[],
  exclusions?: ReadonlySet<string>,
): SpawnEntry[] {
  const maxDepth = maxDepthFor(levelIndex);
  return roster.filter(
    (entry) => !exclusions?.has(entry.name) && entry.depth <= maxDepth,
  );
}

/** Initial monster count for a dungeon level (APPROX density curve). */
export function spawnBudget(levelIndex: number): number {
  return Math.min(14, Math.max(4, 4 + Math.floor((2 * levelIndex) / 3)));
}

// ─── Initial population ──────────────────────────────────────────────────────

function walkable(data: WorldData, tile: number): boolean {
  return data.tiles[String(tile)]?.walkable ?? false;
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * Populate a freshly generated dungeon level. Deterministic: uses a dedicated
 * RNG seeded from the level gen seed, so a level always populates identically.
 */
export function populateLevel(world: World, level: Level, levelIndex: number): number {
  const roster = world.data.monsters;
  if (!roster || roster.length === 0 || level.populated) return 0;

  let eligible = eligibleFor(levelIndex, loadSpawnRoster(roster), bossExclusions(world));
  if (eligible.length === 0) return 0;
  // The quest-boss level has its own apex fight; random dragons there just
  // breath-kill the player from across the map mid-approach (campaign 7.3
  // telemetry). Throne rooms belong to the boss (APPROXIMATIONS.md #40).
  const isBossLevel = questBosses(world.data.quests ?? []).some((b) => b.level === levelIndex);
  if (isBossLevel) {
    const nonDragons = eligible.filter((e) => !isDragonName(e.name));
    if (nonDragons.length === 0) return 0;
    eligible = nonDragons;
  }

  const rng = new MSLCG((levelGenSeed(world.worldSeed, levelIndex) ^ 0x1d2c3d4e) >>> 0);
  const budget = spawnBudget(levelIndex);
  const stairsDown = findStairCell(level, TILE_STAIRS_DOWN);
  const stairsUp = findStairCell(level, TILE_STAIRS_UP);

  let placed = 0;
  let attempts = 0;
  let dragonsPlaced = 0;
  const maxAttempts = budget * 80;
  while (placed < budget && attempts < maxAttempts) {
    attempts++;
    const x = rng.rand(64);
    const y = rng.rand(64);
    const i = idx(x, y);
    const tile = level.tiles[i] ?? 0;
    if (!walkable(world.data, tile)) continue;
    if (tile === TILE_STAIRS_DOWN || tile === TILE_STAIRS_UP) continue;
    if ((level.occupancy[i] ?? 0) !== 0) continue;
    if (stairsDown && chebyshev(x, y, stairsDown.x, stairsDown.y) < 6) continue;
    if (stairsUp && chebyshev(x, y, stairsUp.x, stairsUp.y) < 6) continue;

    let entry = eligible[rng.rand(eligible.length)]!;
    if (isDragonName(entry.name) && dragonsPlaced >= MAX_DRAGONS_PER_LEVEL) {
      // Campaign 7.3 telemetry: uniform picks produced dragon PACKS on deep
      // levels — two breath weapons focus-fired the corridor and a level-8
      // champion could not survive. One dragon per level keeps the apex
      // monsters scary but beatable (original spawn tables were weighted,
      // never uniform; see APPROXIMATIONS.md #40).
      const others = eligible.filter((e) => !isDragonName(e.name));
      if (others.length === 0) break;
      entry = others[rng.rand(others.length)]!;
    }
    if (isDragonName(entry.name)) dragonsPlaced++;
    const id = allocateEntityId(level);
    if (id === 0) break; // all 255 ids occupied — refuse further spawns
    const entity: Entity = {
      id,
      kind: 'monster',
      name: entry.name,
      x,
      y,
      monster: { ...spawnMonsterState(entry.name) },
    };
    level.entities.set(id, entity);
    level.occupancy[i] = id;
    placed++;
  }

  level.populated = true;
  return placed;
}

/**
 * Place the quest boss (plus guards) on its level. Deterministic: the boss
 * takes the walkable unoccupied cell farthest from the stairs (ties resolve
 * to the first in row-major order); guards fill adjacent free cells.
 * Independent of the spawn roster so boss-less data still populates.
 */
export function placeQuestBoss(world: World, level: Level, levelIndex: number): boolean {
  const boss = questBosses(world.data.quests ?? []).find((b) => b.level === levelIndex);
  if (!boss || level.bossPlaced) return false;

  const anchor = findStairCell(level, TILE_STAIRS_UP) ?? findStairCell(level, TILE_STAIRS_DOWN);
  let best: { x: number; y: number } | null = null;
  let bestDist = -1;
  for (let y = 0; y < LEVEL_SIZE; y++) {
    for (let x = 0; x < LEVEL_SIZE; x++) {
      const i = idx(x, y);
      if (!walkable(world.data, level.tiles[i] ?? 0)) continue;
      if ((level.occupancy[i] ?? 0) !== 0) continue;
      const d = anchor ? chebyshev(x, y, anchor.x, anchor.y) : 0;
      if (d > bestDist) {
        bestDist = d;
        best = { x, y };
      }
    }
  }
  if (!best) return false;

  const bossId = allocateEntityId(level);
  if (bossId === 0) return false; // no free id — the boss simply does not place
  const bossEntity: Entity = {
    id: bossId,
    kind: 'monster',
    name: boss.monster,
    x: best.x,
    y: best.y,
    monster: { ...spawnMonsterState(boss.monster), alert: true },
  };
  level.entities.set(bossEntity.id, bossEntity);
  level.occupancy[idx(best.x, best.y)] = bossEntity.id;

  let guardsLeft = 0;
  for (const g of boss.guards) guardsLeft += g.count;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (guardsLeft <= 0) break;
    const gx = best.x + dx;
    const gy = best.y + dy;
    if (gx < 0 || gy < 0 || gx >= LEVEL_SIZE || gy >= LEVEL_SIZE) continue;
    const i = idx(gx, gy);
    if (!walkable(world.data, level.tiles[i] ?? 0)) continue;
    if ((level.occupancy[i] ?? 0) !== 0) continue;
    const guardName = boss.guards[0]?.name ?? 'Huge Ogre';
    const guardId = allocateEntityId(level);
    if (guardId === 0) break;
    const guard: Entity = {
      id: guardId,
      kind: 'monster',
      name: guardName,
      x: gx,
      y: gy,
      monster: { ...spawnMonsterState(guardName), alert: true },
    };
    level.entities.set(guard.id, guard);
    level.occupancy[i] = guard.id;
    guardsLeft--;
  }

  level.bossPlaced = true;
  return true;
}

function findStairCell(level: Level, tile: number): { x: number; y: number } | null {
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      if (level.tiles[idx(x, y)] === tile) return { x, y };
    }
  }
  return null;
}

// ─── Perception ──────────────────────────────────────────────────────────────

/** Any alerting monster on the current level (LOS + range)? */
export function monsterInSight(world: World): boolean {
  if (world.current === 0) return false;
  const level = world.levels.get(world.current);
  if (!level) return false;
  for (const entity of level.entities.values()) {
    if (entity.kind !== 'monster') continue;
    const dist = manhattan(entity.x, entity.y, world.player.x, world.player.y);
    if (dist > SIGHT_RANGE) continue;
    if (
      hasLos(level, { x: entity.x, y: entity.y }, { x: world.player.x, y: world.player.y })
    ) {
      return true;
    }
  }
  return false;
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

// ─── AI ──────────────────────────────────────────────────────────────────────

/** Turns between actions: speed × slow denominator (Slow Monster stacks). */
function intervalOf(entity: Entity): number {
  const monster = entity.monster!;
  return Math.max(1, monster.stats.speed * (monster.slowDenominator ?? 1));
}

const WANDER_STEPS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
] as const;

function canStepTo(world: World, level: Level, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= 64 || y >= 64) return false;
  if (!walkable(world.data, level.tiles[idx(x, y)] ?? 0)) return false;
  if ((level.occupancy[idx(x, y)] ?? 0) !== 0) return false;
  // The player is not in the occupancy plane; block their cell explicitly.
  if (world.current === level.index && x === world.player.x && y === world.player.y) {
    return false;
  }
  return true;
}

function moveEntity(level: Level, entity: Entity, x: number, y: number): void {
  level.occupancy[idx(entity.x, entity.y)] = 0;
  entity.x = x;
  entity.y = y;
  level.occupancy[idx(x, y)] = entity.id;
}

/** One greedy chase step: primary axis first, then slide along the secondary. */
function chaseStep(world: World, level: Level, entity: Entity): void {
  const monster = entity.monster!;
  const dx = Math.sign(world.player.x - entity.x);
  const dy = Math.sign(world.player.y - entity.y);
  const options: { x: number; y: number }[] = [];
  if (Math.abs(world.player.x - entity.x) >= Math.abs(world.player.y - entity.y)) {
    if (dx !== 0) options.push({ x: entity.x + dx, y: entity.y });
    if (dy !== 0) options.push({ x: entity.x, y: entity.y + dy });
  } else {
    if (dy !== 0) options.push({ x: entity.x, y: entity.y + dy });
    if (dx !== 0) options.push({ x: entity.x + dx, y: entity.y });
  }
  for (const option of options) {
    if (canStepTo(world, level, option.x, option.y)) {
      moveEntity(level, entity, option.x, option.y);
      monster.alert = true;
      return;
    }
  }
  // Fully blocked: hold position this turn (no A* — see APPROXIMATIONS.md).
}

/** One fleeing step: greedily maximize distance from the player. */
function fleeStep(world: World, level: Level, entity: Entity): void {
  const options = WANDER_STEPS.map(({ dx, dy }) => ({
    x: entity.x + dx,
    y: entity.y + dy,
  })).filter((option) => canStepTo(world, level, option.x, option.y));
  if (options.length === 0) return;
  let best = options[0]!;
  let bestDist = manhattan(best.x, best.y, world.player.x, world.player.y);
  for (const option of options.slice(1)) {
    const dist = manhattan(option.x, option.y, world.player.x, world.player.y);
    if (dist > bestDist) {
      best = option;
      bestDist = dist;
    }
  }
  moveEntity(level, entity, best.x, best.y);
}

function act(world: World, level: Level, entity: Entity): void {
  const monster = entity.monster!;
  const dist = manhattan(entity.x, entity.y, world.player.x, world.player.y);
  const los =
    dist <= SIGHT_RANGE &&
    hasLos(level, { x: entity.x, y: entity.y }, { x: world.player.x, y: world.player.y });
  if (los) monster.alert = true;

  if (!monster.alert) {
    // Idle: wander one cell in a random 4-direction.
    const step = WANDER_STEPS[world.rng.rand(4)]!;
    const x = entity.x + step.dx;
    const y = entity.y + step.dy;
    if (canStepTo(world, level, x, y)) moveEntity(level, entity, x, y);
    return;
  }

  // Fleeing at ≤20% hp overrides aggression.
  if (monster.hp * 5 <= monster.maxHp) {
    fleeStep(world, level, entity);
    return;
  }

  // Breath weapon at range (the attack itself rolls 1-in-N).
  const breath = monster.stats.breath;
  if (breath && dist >= 2 && dist <= SIGHT_RANGE && los) {
    if (monsterBreath(world, entity.id).breathed) return;
  }

  if (dist === 1) {
    monsterAttack(world, entity.id);
    return;
  }

  chaseStep(world, level, entity);
}

/** Monsters-on-the-current-level turn processing + wander spawning. */
export function takeMonsterTurns(world: World): void {
  if (world.current === 0) return;
  const level = world.levels.get(world.current);
  if (!level) return;

  for (const entity of [...level.entities.values()]) {
    if (entity.kind !== 'monster' || !entity.monster) continue;
    const monster = entity.monster;
    if (monster.sleepTurns !== undefined && monster.sleepTurns > 0) {
      monster.sleepTurns--;
      continue;
    }
    if (monster.timer !== undefined && monster.timer > 0) {
      monster.timer--;
      continue;
    }
    act(world, level, entity);
    monster.timer = intervalOf(entity) - 1;
  }

  maybeWanderSpawn(world, level);
}

function maybeWanderSpawn(world: World, level: Level): void {
  const roster = world.data.monsters;
  if (!roster || roster.length === 0) return;
  const budget = spawnBudget(level.index);
  if (level.entities.size >= budget + WANDER_BONUS_CAP) return;
  if (world.rng.rand(WANDER_CHANCE) !== 0) return;

  let candidates = eligibleFor(level.index, loadSpawnRoster(roster), bossExclusions(world));
  if (candidates.length === 0) return;
  // Share the populate dragon rules (APPROXIMATIONS.md #40): the quest-boss
  // level stays dragon-free, and one live dragon per level — wandering spawns
  // included. Without this a wander roll could stack a second breath weapon
  // onto a level the player is already fighting through (F20).
  const isBossLevel = questBosses(world.data.quests ?? []).some(
    (b) => b.level === level.index,
  );
  let liveDragons = 0;
  for (const e of level.entities.values()) {
    if (e.kind === 'monster' && isDragonName(e.name)) liveDragons++;
  }
  if (isBossLevel || liveDragons >= MAX_DRAGONS_PER_LEVEL) {
    candidates = candidates.filter((e) => !isDragonName(e.name));
    if (candidates.length === 0) return;
  }

  for (let attempt = 0; attempt < 100; attempt++) {
    const x = world.rng.rand(64);
    const y = world.rng.rand(64);
    const i = idx(x, y);
    if (!walkable(world.data, level.tiles[i] ?? 0)) continue;
    if ((level.occupancy[i] ?? 0) !== 0) continue;
    if (manhattan(x, y, world.player.x, world.player.y) < 10) continue;
    if ((world.visible[i] ?? 0) !== 0) continue; // spawn unseen

    const entry = candidates[world.rng.rand(candidates.length)]!;
    const id = allocateEntityId(level);
    if (id === 0) return; // ids exhausted — refuse the spawn
    const entity: Entity = {
      id,
      kind: 'monster',
      name: entry.name,
      x,
      y,
      monster: { ...spawnMonsterState(entry.name) },
    };
    level.entities.set(id, entity);
    level.occupancy[i] = id;
    return;
  }
}
