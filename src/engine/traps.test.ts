import { describe, expect, it } from 'vitest';

import { newWorld } from './game';
import { createCharacter } from './character';
import { TILE_FLOOR, TILE_STAIRS_DOWN, TILE_STAIRS_UP } from './dungeon';
import { applyStatus } from './effects';
import { createEmptyLevel, idx, type Level } from './map';
import {
  DISARM_XP,
  KNOWN_TRIGGER_CHANCE,
  detectTrapsOnLevel,
  disarmTrapAt,
  findDisarmTarget,
  kindsForLevel,
  placeTraps,
  revealTrapsInRect,
  trapAt,
  trapCountFor,
  triggerTrapAt,
} from './traps';
import { MSLCG } from './rng';
import type { Difficulty, Player, TrapState, WorldData } from './types';
import { createWorld, dispatch, ensureLevel, type World } from './world';

// ─── Fixtures ────────────────────────────────────────────────────────────────

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
    spells: {
      's-dt': {
        id: 's-dt',
        name: 'DETECT TRAPS',
        tier: 2,
        baseMana: 2,
        target: 'self',
        effect: 'detect_traps',
      },
    },
    monsters: [{ id: 'm-kobold', name: 'Kobold' }],
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

/** World on a crafted dungeon level 1 (5×11 floor slab) — no generation. */
function dungeonWorld(opts: { rngSeed?: number; difficulty?: Difficulty; level?: number } = {}): World {
  const world = createWorld({
    worldSeed: 42,
    data: dungeonData(),
    player: testPlayer({ difficulty: opts.difficulty ?? 'intermediate' }),
    rngSeed: opts.rngSeed ?? 1,
  });
  const levelIndex = opts.level ?? 1;
  const level: Level = createEmptyLevel(levelIndex);
  for (let y = 2; y <= 8; y++) {
    for (let x = 3; x <= 20; x++) level.tiles[idx(x, y)] = TILE_FLOOR;
  }
  world.levels.set(levelIndex, level);
  world.seen.set(levelIndex, new Uint8Array(64 * 64));
  world.current = levelIndex;
  world.player.x = 5;
  world.player.y = 4;
  return world;
}

function putTrap(world: World, x: number, y: number, kind: TrapState['kind'], known = false): TrapState {
  const level = world.levels.get(world.current)!;
  const trap: TrapState = { id: `t${(level.traps?.length ?? 0) + 1}`, kind, x, y, known };
  level.traps = [...(level.traps ?? []), trap];
  return trap;
}

/** Find a gameplay seed whose first rolls match `pattern`. */
function seedWhere(...rolls: Array<(rng: MSLCG) => boolean>): number {
  for (let s = 1; s < 200_000; s++) {
    const rng = new MSLCG(s);
    if (rolls.every((check) => check(rng))) return s;
  }
  throw new Error('no seed found');
}

// ─── Placement ───────────────────────────────────────────────────────────────

describe('trap placement', () => {
  it('kinds deepen with level index', () => {
    expect(kindsForLevel(1)).toEqual(['pit', 'dart', 'gas']);
    expect(kindsForLevel(2)).toContain('poison');
    expect(kindsForLevel(4)).toContain('fire');
    expect(kindsForLevel(6)).toContain('trap_door');
    expect(kindsForLevel(7)).toContain('teleport');
    expect(kindsForLevel(11)).toHaveLength(9);
  });

  it('count grows with depth and difficulty', () => {
    expect(trapCountFor(1, 'intermediate')).toBe(3);
    expect(trapCountFor(11, 'intermediate')).toBeGreaterThan(trapCountFor(1, 'intermediate'));
    expect(trapCountFor(1, 'expert')).toBeGreaterThan(trapCountFor(1, 'easy'));
  });

  it('populates deterministically with stairs clearance', () => {
    const make = (): World => {
      const w = dungeonWorld();
      const level = w.levels.get(1)!;
      // Real generation shape: place stairs inside the slab.
      level.tiles[idx(4, 3)] = TILE_STAIRS_UP;
      level.tiles[idx(18, 3)] = TILE_STAIRS_DOWN;
      return w;
    };
    const a = make();
    const b = make();
    const placedA = placeTraps(a, a.levels.get(1)!, 1);
    const placedB = placeTraps(b, b.levels.get(1)!, 1);
    expect(placedA).toBe(placedB);
    expect(placedA).toBe(trapCountFor(1, 'intermediate'));
    const la = a.levels.get(1)!;
    const lb = b.levels.get(1)!;
    expect(JSON.stringify(la.traps)).toBe(JSON.stringify(lb.traps));

    for (const trap of la.traps ?? []) {
      expect(la.tiles[idx(trap.x, trap.y)]).toBe(TILE_FLOOR);
      expect(kindsForLevel(1)).toContain(trap.kind);
      expect(Math.max(Math.abs(trap.x - 4), Math.abs(trap.y - 3))).toBeGreaterThanOrEqual(3);
      expect(Math.max(Math.abs(trap.x - 18), Math.abs(trap.y - 3))).toBeGreaterThanOrEqual(3);
    }
    // No two traps on the same cell.
    const cells = new Set((la.traps ?? []).map((t) => `${t.x},${t.y}`));
    expect(cells.size).toBe((la.traps ?? []).length);
  });

  it('does not double-place', () => {
    const w = dungeonWorld();
    const level = w.levels.get(1)!;
    expect(placeTraps(w, level, 1)).toBeGreaterThan(0);
    const first = JSON.stringify(level.traps);
    expect(placeTraps(w, level, 1)).toBe(0);
    expect(JSON.stringify(level.traps)).toBe(first);
  });

  it('real-data ensureLevel places traps and secret doors on level 1', async () => {
    const { loadWorldData } = await import('./game');
    const w = createWorld({ worldSeed: 7, data: loadWorldData(), player: testPlayer() });
    const level = ensureLevel(w, 1);
    expect((level.traps ?? []).length).toBeGreaterThan(0);
    expect((level.doors ?? []).length).toBeGreaterThan(0);
  });
});

// ─── Triggering ──────────────────────────────────────────────────────────────

describe('triggerTrapAt', () => {
  it('unknown pit always springs, damages 1d6, becomes known', () => {
    const w = dungeonWorld();
    const trap = putTrap(w, 5, 4, 'pit');
    const hpBefore = w.player.hp;
    const expected = new MSLCG(1); // dungeonWorld rngSeed defaults to 1
    const dmg = expected.rand(6) + 1;
    const msg = triggerTrapAt(w, 5, 4);
    expect(msg).toBe('You set off the trap!');
    expect(trap.known).toBe(true);
    expect(w.player.hp).toBe(hpBefore - dmg);
  });

  it('levitation skips gravity traps', () => {
    const w = dungeonWorld();
    applyStatus(w.player, 'levitation');
    putTrap(w, 5, 4, 'pit');
    putTrap(w, 6, 4, 'trap_door');
    const hp = w.player.hp;
    expect(triggerTrapAt(w, 5, 4)).toBeNull();
    expect(triggerTrapAt(w, 6, 4)).toBeNull();
    expect(w.player.hp).toBe(hp);
    // Unrevealed — floating over does not give the trap away.
    expect(trapAt(w.levels.get(1)!, 5, 4)!.known).toBe(false);
  });

  it(`known traps trigger only 1-in-${KNOWN_TRIGGER_CHANCE}`, () => {
    const quiet = seedWhere((rng) => rng.rand(KNOWN_TRIGGER_CHANCE) !== 0);
    const w = dungeonWorld({ rngSeed: quiet });
    putTrap(w, 5, 4, 'pit', true);
    const hp = w.player.hp;
    expect(triggerTrapAt(w, 5, 4)).toBeNull();
    expect(w.player.hp).toBe(hp);

    const loud = seedWhere((rng) => rng.rand(KNOWN_TRIGGER_CHANCE) === 0);
    const w2 = dungeonWorld({ rngSeed: loud });
    putTrap(w2, 5, 4, 'pit', true);
    expect(triggerTrapAt(w2, 5, 4)).toBe('You set off the trap!');
  });

  it('gas poisons with the original message', () => {
    const w = dungeonWorld({ rngSeed: seedWhere((rng) => rng.rand(KNOWN_TRIGGER_CHANCE) === 0) });
    putTrap(w, 5, 4, 'gas', true);
    expect(triggerTrapAt(w, 5, 4)).toBe('A cloud of gas surrounds you!');
    expect(w.player.statuses.some((s) => s.kind === 'poison')).toBe(true);
  });

  it('teleport trap relocates the player', () => {
    const w = dungeonWorld();
    putTrap(w, 5, 4, 'teleport');
    const msg = triggerTrapAt(w, 5, 4);
    expect(msg).toBe('You trigger a teleport trap!');
    const tile = w.levels.get(1)!.tiles[idx(w.player.x, w.player.y)];
    expect(tile).toBe(TILE_FLOOR);
    expect(`${w.player.x},${w.player.y}`).not.toBe('5,4');
  });

  it('trap door falls to the linked level below', () => {
    const w = dungeonWorld();
    putTrap(w, 5, 4, 'trap_door');
    const hp = w.player.hp;
    const msg = triggerTrapAt(w, 5, 4);
    expect(msg).toBe('You fall through a trap door!');
    expect(w.current).toBe(2);
    expect(w.player.hp).toBeLessThan(hp);
    const level = w.levels.get(2)!;
    expect(level.tiles[idx(w.player.x, w.player.y)]).toBe(TILE_FLOOR);
  });

  it('trap door on a dead-end level only damages', () => {
    const w = dungeonWorld({ level: 2 }); // node 2 has links.down === null
    putTrap(w, 5, 4, 'trap_door');
    const hp = w.player.hp;
    expect(triggerTrapAt(w, 5, 4)).toBe('You fall through a trap door!');
    expect(w.current).toBe(2);
    expect(w.player.hp).toBeLessThan(hp);
  });

  it('no trap is a no-op', () => {
    const w = dungeonWorld();
    expect(triggerTrapAt(w, 5, 4)).toBeNull();
  });
});

// ─── Disarm ──────────────────────────────────────────────────────────────────

describe('disarmTrapAt', () => {
  it('DEX 100 always succeeds, removes the trap and grants XP', () => {
    const w = dungeonWorld();
    w.player.dexterity = 100;
    const trap = putTrap(w, 6, 4, 'blade', true);
    const xp = w.player.experience;
    const result = disarmTrapAt(w, 6, 4);
    expect(result.message).toBe('You disarmed the trap.');
    expect(result.ok).toBe(true);
    expect(w.player.experience).toBe(xp + DISARM_XP(1));
    expect(trapAt(w.levels.get(1)!, 6, 4)).toBeNull();
    expect(trap.known).toBe(true); // state object unchanged, just unlisted
  });

  it('low DEX can fail and keep the trap', () => {
    const failSeed = seedWhere((rng) => rng.rand(100) >= 50, (rng) => rng.rand(3) !== 0);
    const w = dungeonWorld({ rngSeed: failSeed });
    w.player.dexterity = 50;
    putTrap(w, 6, 4, 'blade', true);
    const result = disarmTrapAt(w, 6, 4);
    expect(result.message).toBe('You failed to disarm the trap.');
    expect(result.ok).toBe(false);
    expect(trapAt(w.levels.get(1)!, 6, 4)).not.toBeNull();
  });

  it('failed disarm can spring the trap', () => {
    const springSeed = seedWhere((rng) => rng.rand(100) >= 50, (rng) => rng.rand(3) === 0);
    const w = dungeonWorld({ rngSeed: springSeed });
    w.player.dexterity = 50;
    putTrap(w, 6, 4, 'gas', true);
    const hp = w.player.hp;
    const result = disarmTrapAt(w, 6, 4);
    expect(result.message).toBe('You failed to disarm the trap.');
    expect(result.sprung).toBe(true);
    expect(result.sprungMessage).toBe('A cloud of gas surrounds you!');
    void hp;
  });

  it('unknown traps and empty cells have nothing to disarm', () => {
    const w = dungeonWorld();
    putTrap(w, 6, 4, 'blade'); // unknown
    expect(disarmTrapAt(w, 6, 4).message).toBe('Nothing there to disarm!');
    expect(disarmTrapAt(w, 7, 4).message).toBe('Nothing there to disarm!');
  });

  it('findDisarmTarget auto-targets an adjacent known trap', () => {
    const w = dungeonWorld();
    w.player.x = 5;
    w.player.y = 4;
    putTrap(w, 6, 4, 'blade', true);
    putTrap(w, 5, 5, 'pit');
    const auto = findDisarmTarget(w);
    expect(auto).toEqual({ x: 6, y: 4 });
    expect(findDisarmTarget(w, 6, 4)).toEqual({ x: 6, y: 4 }); // explicit adjacent
    expect(findDisarmTarget(w, 5, 6)).toBeNull(); // non-adjacent rejected
  });
});

// ─── Detection ───────────────────────────────────────────────────────────────

describe('trap detection', () => {
  it('traps within 10 squares are found with certainty', () => {
    const w = dungeonWorld();
    putTrap(w, 5 + 7, 4, 'pit'); // chebyshev 7
    const revealed = detectTrapsOnLevel(w);
    expect(revealed).toBe(1);
    expect(trapAt(w.levels.get(1)!, 12, 4)!.known).toBe(true);
  });

  it('beyond 10 squares detection is probabilistic', () => {
    // Chance at chebyshev 15 = 100 - (15-10)*8 = 60%.
    const miss = seedWhere((rng) => rng.rand(100) >= 60);
    const w = dungeonWorld({ rngSeed: miss });
    putTrap(w, 5 + 15, 4, 'pit'); // chebyshev 15
    expect(detectTrapsOnLevel(w)).toBe(0);

    const hit = seedWhere((rng) => rng.rand(100) < 60);
    const w2 = dungeonWorld({ rngSeed: hit });
    putTrap(w2, 5 + 15, 4, 'pit');
    expect(detectTrapsOnLevel(w2)).toBe(1);
  });

  it('revealTrapsInRect marks only in-rect traps', () => {
    const w = dungeonWorld();
    const inside = putTrap(w, 6, 4, 'pit');
    const outside = putTrap(w, 6, 5, 'pit');
    const n = revealTrapsInRect(w.levels.get(1)!, { x: 5, y: 3, w: 3, h: 2 });
    expect(n).toBe(1);
    expect(inside.known).toBe(true);
    expect(outside.known).toBe(false);
  });

  it('CAST DETECT TRAPS reveals nearby traps through dispatch', () => {
    const w = dungeonWorld();
    w.player.knownSpells = ['s-dt'];
    const trap = putTrap(w, 8, 4, 'pit');
    const mana = w.player.mana;
    dispatch(w, { type: 'CAST', spellId: 's-dt' });
    expect(trap.known).toBe(true);
    expect(w.player.mana).toBeLessThan(mana);
    expect(w.turn).toBe(1);
  });

  it('MOVE onto an unknown trap springs it', () => {
    const w = dungeonWorld();
    putTrap(w, 6, 4, 'dart');
    const hp = w.player.hp;
    dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });
    expect(w.player.x).toBe(6);
    expect(w.player.hp).toBeLessThan(hp);
    expect(w.log.some((e) => e.text === 'You set off the trap!')).toBe(true);
  });

  it('DISARM removes an adjacent known trap via dispatch', () => {
    const w = dungeonWorld();
    w.player.dexterity = 100;
    putTrap(w, 6, 4, 'blade', true);
    dispatch(w, { type: 'DISARM' });
    expect(trapAt(w.levels.get(1)!, 6, 4)).toBeNull();
    expect(w.turn).toBe(1);
    expect(w.log.some((e) => e.text === 'You disarmed the trap.')).toBe(true);
  });

  it('DISARM with nothing there logs and wastes no turn', () => {
    const w = dungeonWorld();
    dispatch(w, { type: 'DISARM' });
    expect(w.turn).toBe(0);
    expect(w.log.some((e) => e.text === 'Nothing there to disarm!')).toBe(true);
  });
});

it('trap door finds safe ground when random placement exhausts its attempts', () => {
  const world = newWorld({ worldSeed: 42, part: 1, player: {
    name: 'Traveler', gender: 'female', strength: 50, intelligence: 50,
    constitution: 50, dexterity: 50, difficulty: 'intermediate',
  } });
  const level = ensureLevel(world, 7);
  const below = ensureLevel(world, 8);
  world.current = 7;
  world.player.x = 23;
  world.player.y = 35;
  expect(level.traps?.find(t => t.x === 23 && t.y === 35)?.kind).toBe('trap_door');
  world.rng.setState(956);
  triggerTrapAt(world, 23, 35);
  expect(world.current).toBe(8);
  const cell = idx(world.player.x, world.player.y);
  expect(world.data.tiles[String(below.tiles[cell])]?.walkable).toBe(true);
  expect(below.occupancy[cell]).toBe(0);
});
