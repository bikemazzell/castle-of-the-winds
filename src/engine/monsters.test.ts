import { describe, expect, it } from 'vitest';

import monstersJson from '../data/part1/monsters.json';
import questsJson from '../data/part1/quests.json';
import { createCharacter } from './character';
import { playerAttack, spawnMonsterState } from './combat';
import {
  FLAG_ROOM,
  TILE_FLOOR,
  TILE_STAIRS_DOWN,
  TILE_STAIRS_UP,
} from './dungeon';
import {
  createEmptyLevel,
  idx,
  validateOccupancy,
  type Entity,
  type Level,
} from './map';
import {
  eligibleFor,
  loadSpawnRoster,
  MAX_DRAGONS_PER_LEVEL,
  monsterInSight,
  populateLevel,
  SIGHT_RANGE,
  SLEEP_SPELL_TURNS,
  spawnBudget,
  takeMonsterTurns,
  WANDER_BONUS_CAP,
  WANDER_CHANCE,
} from './monsters';
import { MSLCG } from './rng';
import type { MonsterState, Player, WorldData } from './types';
import { createWorld, dispatch, ensureLevel, type World } from './world';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ROSTER = [
  { id: 'm-kobold', name: 'Kobold' },
  { id: 'm-rat', name: 'Giant Rat' },
  { id: 'm-giant', name: 'Hill Giant' },
  { id: 'm-dragon', name: 'Ancient Red Dragon' },
  { id: 'm-boss', name: 'Hrungnir' },
];

function dungeonData(): WorldData {
  const rows: string[] = [];
  for (let y = 0; y < 32; y++) rows.push('00'.repeat(32));
  for (let y = 2; y <= 6; y++) {
    rows[y] = `${'00'.repeat(3)}${'01'.repeat(5)}${'00'.repeat(24)}`;
  }
  rows[5] = `${'00'.repeat(3)}${'01'.repeat(2)}12${'01'.repeat(2)}${'00'.repeat(24)}`;
  return {
    part: 1,
    levels: [
      {
        index: 0,
        name: 'Town',
        kind: 'town',
        links: { down: null, up: null, special: { kind: 'town-entrance', to: 1 } },
      },
      { index: 1, name: 'Dungeon 1', kind: 'mine', links: { down: 2, up: null } },
      { index: 2, name: 'Dungeon 2', kind: 'mine', links: { down: null, up: 1 } },
    ],
    town: { rows, spawn: { x: 3, y: 3 }, mineEntrance: { x: 5, y: 5 } },
    tiles: {
      0: { walkable: false },
      1: { walkable: true },
      18: { walkable: true },
      19: { walkable: true },
    },
    items: {},
    spells: {},
    monsters: ROSTER,
  };
}

function testPlayer(overrides: Partial<Player> = {}): Omit<Player, 'x' | 'y'> {
  const base = createCharacter({
    name: 'Test',
    gender: 'female',
    strength: 50,
    intelligence: 50,
    constitution: 50,
    dexterity: 50,
    difficulty: 'intermediate',
  });
  return { ...base, ...overrides };
}

function newWorld(opts: { seed?: number; current?: number } = {}): World {
  const world = createWorld({
    worldSeed: 42,
    rngSeed: opts.seed,
    data: dungeonData(),
    player: testPlayer({ hp: 90, maxHp: 90, mana: 20, maxMana: 20 }),
  });
  if (opts.current !== undefined && opts.current !== 0) {
    const level = createEmptyLevel(opts.current);
    world.levels.set(opts.current, level);
    world.seen.set(opts.current, new Uint8Array(64 * 64));
    world.current = opts.current;
  }
  return world;
}

/** Straight corridor along y at x0..x1 (rest walls). */
function corridorLevel(index = 1, x0 = 2, x1 = 30, y = 3): Level {
  const level = createEmptyLevel(index);
  for (let x = x0; x <= x1; x++) level.tiles[idx(x, y)] = TILE_FLOOR;
  return level;
}

/** L-shaped corridor: horizontal (x0..cx, yTop) then vertical (cx, yTop..yBottom). */
function lCorridorLevel(index = 1, x0 = 2, cx = 10, yTop = 2, yBottom = 10): Level {
  const level = createEmptyLevel(index);
  for (let x = x0; x <= cx; x++) level.tiles[idx(x, yTop)] = TILE_FLOOR;
  for (let y = yTop; y <= yBottom; y++) level.tiles[idx(cx, y)] = TILE_FLOOR;
  return level;
}

/** Big open room for movement-freedom tests. */
function openLevel(index = 1): Level {
  const level = createEmptyLevel(index);
  for (let y = 5; y <= 58; y++) {
    for (let x = 5; x <= 58; x++) {
      level.tiles[idx(x, y)] = TILE_FLOOR;
      level.flags[idx(x, y)] = FLAG_ROOM;
    }
  }
  return level;
}

function addMonster(
  level: Level,
  id: number,
  name: string,
  x: number,
  y: number,
  monsterOverrides: Partial<MonsterState> = {},
): Entity {
  const monster = { ...spawnMonsterState(name), ...monsterOverrides };
  const entity: Entity = { id, kind: 'monster', name, x, y, monster };
  level.entities.set(id, entity);
  level.occupancy[idx(x, y)] = id;
  return entity;
}

function placePlayer(world: World, x: number, y: number): void {
  world.player.x = x;
  world.player.y = y;
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

// ─── Roster / spawn tables ───────────────────────────────────────────────────

describe('spawn roster', () => {
  it('loads the real 85-record roster with sane stats', () => {
    const roster = loadSpawnRoster(monstersJson.records);
    expect(roster).toHaveLength(85);
    for (const entry of roster) {
      expect(entry.stats.maxHp).toBeGreaterThan(0);
      expect(entry.stats.xp).toBeGreaterThanOrEqual(5);
      expect(entry.depth).toBeGreaterThanOrEqual(0);
      expect(entry.depth).toBeLessThanOrEqual(7);
    }
  });

  it('derives depth from xp (Giant Rat shallow, Ancient Red Dragon deep)', () => {
    const roster = loadSpawnRoster(monstersJson.records);
    const rat = roster.find((e) => e.name === 'Giant Rat')!;
    const dragon = roster.find((e) => e.name === 'Ancient Red Dragon')!;
    expect(rat.depth).toBe(0);
    expect(dragon.depth).toBeGreaterThanOrEqual(6);
  });

  it('restricts early levels to shallow monsters', () => {
    const roster = loadSpawnRoster(monstersJson.records);
    const level1 = eligibleFor(1, roster);
    expect(level1.length).toBeGreaterThan(0);
    for (const entry of level1) {
      expect(entry.depth).toBeLessThanOrEqual(1);
      expect(entry.name).not.toMatch(/dragon/i);
    }
    expect(level1.some((e) => e.name === 'Kobold')).toBe(true);
    expect(level1.some((e) => e.name === 'Giant Rat')).toBe(true); // shallow despite the name
    expect(level1.some((e) => e.name === 'Hill Giant')).toBe(false);
    // Boss monsters never spawn randomly (placed by quests). Exclusions are
    // data-driven from quests.json bossRosterExclusions (PART2-PLAN P2).
    const exclusions = new Set(
      (questsJson.quests as { bossRosterExclusions?: string[] }[]).flatMap(
        (q) => q.bossRosterExclusions ?? [],
      ),
    );
    const all = eligibleFor(11, roster, exclusions);
    expect(all.some((e) => e.name === 'Hrungnir')).toBe(false);
    expect(all.some((e) => e.name === 'Hrungnir, The Hill Giant Lord')).toBe(false);
    // Exact-name filtering only — ordinary giants stay eligible.
    expect(all.some((e) => e.name === 'Hill Giant')).toBe(true);
  });

  it('keeps adult dragons out of the mid-mine (campaign 7.3 telemetry)', () => {
    // Regression: colored dragons hit the generic tier (xp 250 → depth 4) and
    // spawned on Mine level 7 with a full-strength breath weapon.
    const roster = loadSpawnRoster(monstersJson.records);
    const adult = roster.find((e) => e.name === 'Adult Red Dragon')!;
    expect(adult.depth).toBe(5);
    const level7 = eligibleFor(7, roster);
    expect(level7.some((e) => e.name === 'Adult Red Dragon')).toBe(false);
    for (const entry of level7) expect(entry.depth).toBeLessThanOrEqual(4);
  });

  it('keeps every dungeon level non-empty', () => {
    const roster = loadSpawnRoster(monstersJson.records);
    for (let i = 1; i <= 11; i++) {
      expect(eligibleFor(i, roster).length).toBeGreaterThan(0);
    }
  });

  it('spawn budget grows with depth within bounds', () => {
    expect(spawnBudget(1)).toBe(4);
    expect(spawnBudget(11)).toBeLessThanOrEqual(14);
    for (let i = 1; i < 11; i++) {
      expect(spawnBudget(i + 1)).toBeGreaterThanOrEqual(spawnBudget(i));
    }
  });
});

// ─── populateLevel ───────────────────────────────────────────────────────────

describe('populateLevel', () => {
  it('places the budget deterministically and flags the level populated', () => {
    const a = newWorld();
    const levelA = openLevel(1);
    const b = newWorld();
    const levelB = openLevel(1);
    const countA = populateLevel(a, levelA, 1);
    const countB = populateLevel(b, levelB, 1);
    expect(countA).toBe(spawnBudget(1));
    expect(countB).toBe(countA);
    expect(Buffer.compare(Buffer.from(levelA.occupancy), Buffer.from(levelB.occupancy))).toBe(0);
    expect(levelA.populated).toBe(true);
    expect(validateOccupancy(levelA).ok).toBe(true);
  });

  it('places on walkable, unoccupied, non-stair cells away from stairs', () => {
    const world = newWorld();
    const level = openLevel(1);
    level.tiles[idx(10, 10)] = TILE_STAIRS_DOWN;
    level.tiles[idx(50, 50)] = TILE_STAIRS_UP;
    populateLevel(world, level, 1);
    const stairs = [
      { x: 10, y: 10 },
      { x: 50, y: 50 },
    ];
    for (const entity of level.entities.values()) {
      const tile = level.tiles[idx(entity.x, entity.y)]!;
      expect(tile).toBe(TILE_FLOOR);
      expect(level.occupancy[idx(entity.x, entity.y)]).toBe(entity.id);
      for (const s of stairs) {
        expect(
          Math.max(Math.abs(entity.x - s.x), Math.abs(entity.y - s.y)),
        ).toBeGreaterThanOrEqual(6);
      }
    }
  });
});

// ─── AI ──────────────────────────────────────────────────────────────────────

describe('monster AI', () => {
  it('stays idle without line of sight (no attack)', () => {
    const world = newWorld({ current: 1 });
    const level = world.levels.get(1)!;
    // Two corridors separated by a wall row: no LOS between them.
    for (let x = 10; x <= 40; x++) level.tiles[idx(x, 10)] = TILE_FLOOR;
    for (let x = 10; x <= 40; x++) level.tiles[idx(x, 12)] = TILE_FLOOR;
    const monster = addMonster(level, 1, 'Kobold', 20, 10);
    placePlayer(world, 20, 12);
    takeMonsterTurns(world);
    expect(monster.monster?.alert).toBeUndefined();
    expect(world.log.filter((l) => l.text.includes('you'))).toHaveLength(0);
  });

  it('becomes alert on line of sight', () => {
    const world = newWorld({ current: 1 });
    const level = corridorLevel(1);
    world.levels.set(1, level);
    const monster = addMonster(level, 1, 'Kobold', 10, 3);
    placePlayer(world, 20, 3);
    takeMonsterTurns(world);
    expect(monster.monster?.alert).toBe(true);
  });

  it('chases down a straight corridor and attacks', () => {
    const world = newWorld({ current: 1 });
    const level = corridorLevel(1);
    world.levels.set(1, level);
    addMonster(level, 1, 'Kobold', 5, 3);
    placePlayer(world, 16, 3); // within sight range down the corridor
    for (let i = 0; i < 30 && manhattan(world.player.x, world.player.y, 5, 3) > 1; i++) {
      takeMonsterTurns(world);
    }
    const entity = level.entities.get(1)!;
    expect(manhattan(entity.x, entity.y, world.player.x, world.player.y)).toBe(1);
    takeMonsterTurns(world);
    expect(world.log.some((l) => /you[!.]$|missed you/.test(l.text))).toBe(true);
  });

  it('rounds a corner in an L-shaped corridor', () => {
    const world = newWorld({ current: 1 });
    const level = lCorridorLevel();
    world.levels.set(1, level);
    addMonster(level, 1, 'Kobold', 2, 2, { alert: true }); // alerted: hunts without re-seeing
    placePlayer(world, 10, 9);
    for (let i = 0; i < 20; i++) takeMonsterTurns(world);
    const entity = level.entities.get(1)!;
    expect(manhattan(entity.x, entity.y, world.player.x, world.player.y)).toBe(1);
  });

  it('slides along a wall when the primary axis is blocked', () => {
    const world = newWorld({ current: 1 });
    const level = createEmptyLevel(1);
    // Open row y=3 x=2..10 plus open column x=7 y=3..10 (an L/T shape).
    for (let x = 2; x <= 10; x++) level.tiles[idx(x, 3)] = TILE_FLOOR;
    for (let y = 3; y <= 10; y++) level.tiles[idx(7, y)] = TILE_FLOOR;
    world.levels.set(1, level);
    const monster = addMonster(level, 1, 'Kobold', 5, 3, { alert: true });
    placePlayer(world, 7, 8);
    takeMonsterTurns(world);
    // Primary step (5,4) is a wall; slide moves along +x instead.
    expect(monster.x).toBe(6);
    expect(monster.y).toBe(3);
  });

  it('slow monsters act every speed turns', () => {
    const world = newWorld({ current: 1 });
    const level = corridorLevel(1);
    world.levels.set(1, level);
    const monster = addMonster(level, 1, 'Kobold', 5, 3);
    monster.monster!.stats.speed = 2;
    placePlayer(world, 16, 3);
    takeMonsterTurns(world);
    const afterFirst = monster.x;
    takeMonsterTurns(world);
    const afterSecond = monster.x;
    takeMonsterTurns(world);
    const afterThird = monster.x;
    expect(afterFirst).toBe(6);
    expect(afterSecond).toBe(6);
    expect(afterThird).toBe(7);
  });

  it('sleeping monsters skip turns and wake on player attack', () => {
    const world = newWorld({ current: 1 });
    const level = corridorLevel(1);
    world.levels.set(1, level);
    const monster = addMonster(level, 1, 'Kobold', 5, 3, { sleepTurns: 2 });
    placePlayer(world, 6, 3); // adjacent
    takeMonsterTurns(world);
    expect(monster.x).toBe(5);
    expect(world.log.filter((l) => /you[!.]$|missed you/.test(l.text))).toHaveLength(0);
    expect(monster.monster!.sleepTurns).toBe(1);
    playerAttack(world, 1); // wake-on-attack even when asleep
    expect(monster.monster!.sleepTurns).toBe(0);
    expect(monster.monster!.alert).toBe(true);
  });

  it('slow-denominator monsters act every Nth turn', () => {
    const world = newWorld({ current: 1 });
    const level = corridorLevel(1);
    world.levels.set(1, level);
    const monster = addMonster(level, 1, 'Kobold', 5, 3, { slowDenominator: 2 });
    placePlayer(world, 16, 3);
    takeMonsterTurns(world);
    expect(monster.x).toBe(6);
    takeMonsterTurns(world);
    expect(monster.x).toBe(6);
    takeMonsterTurns(world);
    expect(monster.x).toBe(7);
  });

  it('flees at low hp', () => {
    const world = newWorld({ current: 1 });
    const level = openLevel(1);
    world.levels.set(1, level);
    const monster = addMonster(level, 1, 'Hill Giant', 20, 20, {
      hp: 2, // 2/50 = 4%: well below the 20% flee threshold
      alert: true,
    });
    placePlayer(world, 15, 20);
    takeMonsterTurns(world);
    expect(manhattan(monster.x, monster.y, 15, 20)).toBeGreaterThan(5);
  });

  it('breathes at range but melees when adjacent', () => {
    const world = newWorld({ current: 1 });
    const level = corridorLevel(1);
    world.levels.set(1, level);
    const dragon = addMonster(level, 1, 'Ancient Red Dragon', 10, 3);
    dragon.monster!.stats.breath = { element: 'fire', dieSides: 6, every: 1 };
    placePlayer(world, 20, 3);
    takeMonsterTurns(world);
    expect(world.log.some((l) => l.text.includes('breathes fire'))).toBe(true);
    // Now adjacent: melee instead of breath.
    world.log.length = 0;
    dragon.x = 19;
    level.occupancy[idx(10, 3)] = 0;
    level.occupancy[idx(19, 3)] = 1;
    takeMonsterTurns(world);
    expect(world.log.some((l) => l.text.includes('breathes'))).toBe(false);
    expect(world.log.some((l) => /you[!.]$|missed you/.test(l.text))).toBe(true);
  });

  it('monsterInSight reflects LOS and range', () => {
    const world = newWorld({ current: 1 });
    const level = corridorLevel(1, 2, 60);
    world.levels.set(1, level);
    addMonster(level, 1, 'Kobold', 10, 3);
    placePlayer(world, 12, 3);
    expect(monsterInSight(world)).toBe(true);
    placePlayer(world, 50, 3); // same corridor, far beyond SIGHT_RANGE
    expect(monsterInSight(world)).toBe(false);
  });

  it('respects SIGHT_RANGE as a finite cap', () => {
    expect(SIGHT_RANGE).toBeGreaterThan(0);
    expect(SIGHT_RANGE).toBeLessThanOrEqual(16);
  });
});

// ─── Wander spawning ─────────────────────────────────────────────────────────

describe('wander spawning', () => {
  it('spawns a wanderer on a lucky roll, far and unseen', () => {
    // Find a gameplay seed whose first rand(WANDER roll) hits.
    let seed = 1;
    while (new MSLCG(seed).rand(150) !== 0) seed++;
    const world = newWorld({ seed, current: 1 });
    const level = openLevel(1);
    world.levels.set(1, level);
    placePlayer(world, 32, 32);
    // Recompute visible at the new position so "unseen" is meaningful.
    world.visible = new Uint8Array(64 * 64);
    world.visible[idx(32, 32)] = 1;
    takeMonsterTurns(world);
    expect(level.entities.size).toBe(1);
    const entity = [...level.entities.values()][0]!;
    expect(manhattan(entity.x, entity.y, 32, 32)).toBeGreaterThanOrEqual(10);
    expect(world.visible[idx(entity.x, entity.y)] ?? 0).toBe(0);
    expect(level.tiles[idx(entity.x, entity.y)]).toBe(TILE_FLOOR);
  });

  it('never exceeds the budget plus wander cap', () => {
    const world = newWorld({ current: 1 });
    const level = openLevel(1);
    world.levels.set(1, level);
    const cap = spawnBudget(1) + WANDER_BONUS_CAP;
    for (let id = 1; id <= cap; id++) {
      addMonster(level, id, 'Kobold', 10 + id, 10, { sleepTurns: 10_000 });
    }
    placePlayer(world, 50, 50);
    for (let i = 0; i < 200; i++) takeMonsterTurns(world);
    expect(level.entities.size).toBe(cap);
  });
});

// ─── World integration ───────────────────────────────────────────────────────

describe('world integration', () => {
  it('WAIT advances monsters (chase across five turns)', () => {
    const world = newWorld({ current: 1 });
    const level = corridorLevel(1);
    world.levels.set(1, level);
    addMonster(level, 1, 'Kobold', 5, 3, { alert: true });
    placePlayer(world, 20, 3);
    const before = manhattan(5, 3, world.player.x, world.player.y);
    for (let i = 0; i < 5; i++) dispatch(world, { type: 'WAIT' });
    const entity = level.entities.get(1)!;
    const after = manhattan(entity.x, entity.y, world.player.x, world.player.y);
    expect(after).toBeLessThan(before);
  });

  it('populates lazily-generated dungeon levels (real data)', async () => {
    const { loadWorldData } = await import('./game');
    const world = createWorld({
      worldSeed: 7,
      data: loadWorldData(),
      player: testPlayer({ hp: 90, maxHp: 90 }),
    });
    const level = ensureLevel(world, 1);
    expect(level.populated).toBe(true);
    expect(level.entities.size).toBe(spawnBudget(1));
    expect(validateOccupancy(level).ok).toBe(true);
  });

  it('never spawns dragon packs (campaign 7.3 telemetry)', async () => {
    const { loadWorldData } = await import('./game');
    const data = loadWorldData();
    for (let seed = 1; seed <= 10; seed++) {
      const world = createWorld({
        worldSeed: seed,
        data,
        player: testPlayer({ hp: 90, maxHp: 90 }),
      });
      const level = ensureLevel(world, 10); // deepest dragon-eligible pack level
      const dragons = [...level.entities.values()].filter((e) => /dragon/i.test(e.name));
      expect(dragons.length).toBeLessThanOrEqual(MAX_DRAGONS_PER_LEVEL);
    }
  });

  it('keeps random dragons off the quest-boss level (campaign 7.3 telemetry)', async () => {
    const { loadWorldData } = await import('./game');
    const data = loadWorldData();
    for (let seed = 1; seed <= 5; seed++) {
      const world = createWorld({
        worldSeed: seed,
        data,
        player: testPlayer({ hp: 90, maxHp: 90 }),
      });
      const level = ensureLevel(world, 11); // Hrungnir's throne room
      const dragons = [...level.entities.values()].filter((e) => /dragon/i.test(e.name));
      expect(dragons.length).toBe(0);
      const boss = [...level.entities.values()].find((e) => /Hrungnir/i.test(e.name));
      expect(boss).toBeTruthy(); // the boss itself is still placed
    }
  });

  it('rest is interrupted by a monster in sight', () => {
    const world = newWorld({ current: 1 });
    const level = corridorLevel(1);
    world.levels.set(1, level);
    addMonster(level, 1, 'Kobold', 10, 3, { alert: true });
    placePlayer(world, 13, 3);
    world.player.mana = 0;
    dispatch(world, { type: 'REST' });
    expect(world.log.some((l) => l.text.includes('interrupted'))).toBe(true);
    expect(world.player.mana).toBe(0);
  });

  it('rest completes when no monsters are around', () => {
    const world = newWorld({ current: 1 });
    const level = corridorLevel(1);
    world.levels.set(1, level);
    placePlayer(world, 20, 3);
    world.player.mana = 0;
    dispatch(world, { type: 'REST' });
    expect(world.player.mana).toBe(world.player.maxMana);
    expect(world.log.some((l) => l.text.includes('interrupted'))).toBe(false);
  });

  it('sleep spell duration is the documented 10 minutes', () => {
    expect(SLEEP_SPELL_TURNS).toBe(60);
  });
});

describe('entity ids and wander rules (CODE-QUALITY Task 8)', () => {
  function seededLevel(index: number, ids: number[]): Level {
    const level = openLevel(index);
    let next = 0;
    for (const id of ids) {
      const entity: Entity = {
        id,
        kind: 'monster',
        name: `Seed${id}`,
        x: (next % 50) + 6,
        y: Math.floor(next / 50) + 6,
      };
      level.entities.set(id, entity);
      level.occupancy[idx(entity.x, entity.y)] = id;
      next++;
    }
    return level;
  }

  it('populate uses the lowest free ids and never exceeds 255', () => {
    const world = newWorld({ seed: 9, current: 5 });
    const pre: number[] = [];
    for (let id = 1; id <= 250; id++) pre.push(id);
    const level = seededLevel(5, pre);
    world.levels.set(5, level);
    populateLevel(world, level, 5);
    const ids = [...level.entities.keys()];
    expect(ids.every((id) => id >= 1 && id <= 255)).toBe(true);
    const added = ids.filter((id) => id > 250);
    expect(added.length).toBeGreaterThan(0);
    expect(validateOccupancy(level).errors).toEqual([]);
  });

  it('populate stops cleanly when all 255 ids are occupied', () => {
    const world = newWorld({ seed: 9, current: 5 });
    const pre: number[] = [];
    for (let id = 1; id <= 255; id++) pre.push(id);
    const level = seededLevel(5, pre);
    world.levels.set(5, level);
    const before = level.entities.size;
    populateLevel(world, level, 5);
    expect(level.entities.size).toBe(before);
    expect([...level.entities.keys()].every((id) => id <= 255)).toBe(true);
    expect(validateOccupancy(level).errors).toEqual([]);
  });

  it('a freed id is reused by the next wander spawn', () => {
    const world = newWorld({ seed: 9, current: 1 });
    const level = corridorLevel(1, 2, 40, 3);
    populateLevel(world, level, 1);
    const ids = [...level.entities.keys()].sort((a, b) => a - b);
    expect(ids.length).toBeGreaterThan(0);
    const victim = level.entities.get(3) ?? level.entities.get(ids[0]!)!;
    level.occupancy[idx(victim.x, victim.y)] = 0;
    level.entities.delete(victim.id);
    world.levels.set(1, level);
    // Seed whose FIRST roll hits the wander chance (all sleepers skip rng).
    let seed = 1;
    while (new MSLCG(seed).rand(WANDER_CHANCE) !== 0) seed++;
    world.rng.setState(seed);
    for (const e of level.entities.values()) if (e.monster) e.monster.sleepTurns = 1000;
    takeMonsterTurns(world);
    expect(level.entities.has(victim.id)).toBe(true);
    expect(validateOccupancy(level).errors).toEqual([]);
  });

  it('wander spawn never adds a second live dragon', () => {
    // Level 12 makes Ancient Red Dragon (depth 7) eligible alongside vermin.
    const world = newWorld({ seed: 9, current: 12 });
    const level = openLevel(12);
    const dragon: Entity = {
      id: 7,
      kind: 'monster',
      name: 'Old Red Dragon',
      x: 10,
      y: 10,
      monster: { ...spawnMonsterState('Old Red Dragon'), sleepTurns: 1000 },
    };
    level.entities.set(7, dragon);
    level.occupancy[idx(10, 10)] = 7;
    world.levels.set(12, level);
    world.seen.set(12, new Uint8Array(64 * 64));
    // Pick a seed where the OLD code would have picked the dragon, so this
    // pins the regression rather than passing by luck.
    const eligible = eligibleFor(12, loadSpawnRoster(ROSTER));
    const dragonIdx = eligible
      .map((e, i) => ({ name: e.name, i }))
      .filter((x) => /dragon/i.test(x.name))
      .map((x) => x.i);
    expect(dragonIdx.length).toBeGreaterThan(0);
    let seed = 1;
    for (;; seed++) {
      const probe = new MSLCG(seed);
      if (probe.rand(WANDER_CHANCE) !== 0) continue;
      if (dragonIdx.includes(probe.rand(eligible.length))) break;
    }
    world.rng.setState(seed);
    takeMonsterTurns(world);
    const dragons = [...level.entities.values()].filter((e) => /dragon/i.test(e.name));
    expect(dragons.length).toBe(1);
    expect(level.entities.size).toBe(2); // a non-dragon still spawned
    expect(validateOccupancy(level).errors).toEqual([]);
  });

  it('wander spawn keeps dragons off the quest-boss level', () => {
    const bossRoster = [
      { id: 'm-wight', name: 'Tunnel Wight' },
      { id: 'm-dragon', name: 'Ancient Red Dragon' },
    ];
    const data = dungeonData();
    data.monsters = bossRoster;
    data.quests = [
      {
        id: 'q',
        title: 'Q',
        boss: { level: 12, monster: 'Hrungnir, The Hill Giant Lord', guards: [] },
        stages: [],
      },
    ];
    const world = createWorld({
      worldSeed: 42,
      rngSeed: 9,
      data,
      player: testPlayer({ hp: 90, maxHp: 90, mana: 20, maxMana: 20 }),
    });
    const level = openLevel(12);
    world.levels.set(12, level);
    world.seen.set(12, new Uint8Array(64 * 64));
    world.current = 12;
    const eligible = eligibleFor(12, loadSpawnRoster(bossRoster));
    const dragonIdx = eligible
      .map((e, i) => ({ name: e.name, i }))
      .filter((x) => /dragon/i.test(x.name))
      .map((x) => x.i);
    expect(dragonIdx.length).toBeGreaterThan(0);
    let seed = 1;
    for (;; seed++) {
      const probe = new MSLCG(seed);
      if (probe.rand(WANDER_CHANCE) !== 0) continue;
      if (dragonIdx.includes(probe.rand(eligible.length))) break;
    }
    world.rng.setState(seed);
    takeMonsterTurns(world);
    const dragons = [...level.entities.values()].filter((e) => /dragon/i.test(e.name));
    expect(dragons.length).toBe(0);
    expect(level.entities.size).toBe(1); // the wight still spawned
  });
});

// ─── Multi-boss quests + shared boss helpers (PART2-PLAN Task P2) ────────────

describe('quest boss normalization (PART2-PLAN Task P2)', () => {
  it('eligibleFor applies exact-name exclusions and keeps similar names', () => {
    const roster = loadSpawnRoster(ROSTER);
    const exclusions = new Set(['Hrungnir']);
    // Level 12: every fixture depth is eligible (Hill Giant xp 250 → depth 4).
    const eligible = eligibleFor(12, roster, exclusions);
    expect(eligible.some((e) => e.name === 'Hrungnir')).toBe(false);
    expect(eligible.some((e) => e.name === 'Hill Giant')).toBe(true);
  });

  it('populateLevel excludes quest-listed boss names', () => {
    const data = dungeonData();
    data.quests = [
      {
        id: 'q',
        title: 'Q',
        stages: [],
        bossRosterExclusions: ['Hrungnir'],
      },
    ];
    const world = createWorld({ worldSeed: 9, data, player: testPlayer() });
    const level = ensureLevel(world, 1);
    expect([...level.entities.values()].some((e) => e.name === 'Hrungnir')).toBe(false);
    expect(level.entities.size).toBeGreaterThan(0);
    expect(level.populated).toBe(true);
  });

  it('dragon suppression applies to every level that hosts ANY quest boss', () => {
    const bossRoster = [
      { id: 'm-wight', name: 'Castle Wight' },
      { id: 'm-dragon2', name: 'Very Old Blue Dragon' },
      { id: 'm-king', name: 'Thrym, The Frost Giant King' },
    ];
    const data = dungeonData();
    data.monsters = bossRoster;
    data.quests = [
      {
        id: 'q',
        title: 'Q',
        stages: [],
        bosses: [{ level: 2, monster: 'Thrym, The Frost Giant King', guards: [] }],
      },
    ];
    const world = createWorld({ worldSeed: 21, data, player: testPlayer() });
    const level = ensureLevel(world, 2);
    expect(
      [...level.entities.values()].some((e) => /dragon/i.test(e.name)),
    ).toBe(false);
  });

  it('placeQuestBoss places from a bosses array — one per level', () => {
    const data = dungeonData();
    data.quests = [
      {
        id: 'q',
        title: 'Q',
        stages: [],
        bosses: [
          { level: 1, monster: 'Hrungnir', guards: [] },
          { level: 2, monster: 'Hill Giant', guards: [] },
        ],
      },
    ];
    const world = createWorld({ worldSeed: 11, data, player: testPlayer() });
    const level1 = ensureLevel(world, 1);
    const level2 = ensureLevel(world, 2);
    expect([...level1.entities.values()].some((e) => e.name === 'Hrungnir')).toBe(true);
    expect([...level2.entities.values()].some((e) => e.name === 'Hill Giant')).toBe(true);
    expect(level1.bossPlaced).toBe(true);
    expect(level2.bossPlaced).toBe(true);
  });
});
