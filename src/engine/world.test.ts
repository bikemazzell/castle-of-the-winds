import { describe, expect, it } from 'vitest';

import { createCharacter } from './character';
import { applyStatus } from './effects';
import { equipmentStats } from './inventory';
import type { Player } from './types';
import {
  TILE_STAIRS_DOWN,
  TILE_STAIRS_UP,
  generateLevelForWorld,
} from './dungeon';
import { idx } from './map';
import { LOG_CAP } from './world';
import { levelGenSeed } from './rng';
import {
  createWorld,
  dispatch,
  findStair,
  type Systems,
  type WorldData,
} from './world';
import { loadWorldData } from './game';

/** Synthetic world data: town (32×32) + two dungeon levels. */
function syntheticData(): WorldData {
  const rows: string[] = [];
  for (let y = 0; y < 32; y++) rows.push('00'.repeat(32));
  // Open 5-wide floor (x=3..7, y=2..6); mine-entrance stair at (5,5).
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
    items: {
      'i-long-sword': {
        id: 'i-long-sword',
        name: 'Long Sword',
        kind: 'weapon',
        weightGrams: 1500,
        weaponClass: 8,
        slot: 'weapon',
        stackable: false,
        consumable: false,
      },
      'i-leather-armor': {
        id: 'i-leather-armor',
        name: 'Leather Armor',
        kind: 'armor',
        weightGrams: 5000,
        armorClass: 6,
        slot: 'armor',
        stackable: false,
        consumable: false,
      },
      'i-potion': {
        id: 'i-potion',
        name: 'Potion',
        kind: 'misc',
        weightGrams: 200,
        slot: null,
        stackable: true,
        consumable: true,
      },
    },
    spells: {
      's-light': { id: 's-light', name: 'LIGHT', tier: 1, baseMana: 1, target: 'self', effect: 'light_radius' },
    },
  };
}

/** Full-shape player literal built via createCharacter with overrides. */
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

function newWorld(seed = 42) {
  return createWorld({
    worldSeed: seed,
    data: syntheticData(),
    player: testPlayer({ hp: 20, maxHp: 20, mana: 0, maxMana: 10 }),
  });
}

describe('createWorld', () => {
  it('spawns the player in town at the spawn point, turn 0', () => {
    const w = newWorld();
    expect(w.current).toBe(0);
    expect(w.player.x).toBe(3);
    expect(w.player.y).toBe(3);
    expect(w.turn).toBe(0);
    expect(w.log.length).toBe(0);
    expect(w.levels.has(0)).toBe(true);
    expect(w.levels.has(1)).toBe(false); // lazy
  });
});

describe('MOVE', () => {
  it('walkable floor move updates position and consumes a turn', () => {
    const w = newWorld();
    dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });
    expect(w.player.x).toBe(4);
    expect(w.turn).toBe(1);
  });

  it('wall bump costs no turn and keeps position', () => {
    const w = newWorld();
    dispatch(w, { type: 'MOVE', dx: -1, dy: 0 }); // (2,3) is wall
    expect(w.player.x).toBe(3);
    expect(w.turn).toBe(0);
  });

  it('out-of-bounds move costs no turn', () => {
    const w = newWorld();
    w.player.x = 0;
    w.player.y = 0;
    dispatch(w, { type: 'MOVE', dx: -1, dy: -1 });
    expect(w.turn).toBe(0);
  });

  it('occupied tile blocks movement (occupancy plane)', () => {
    const w = newWorld();
    const town = w.levels.get(0)!;
    town.occupancy[idx(4, 3)] = 9;
    town.entities.set(9, { id: 9, kind: 'monster', name: 'Kobold', x: 4, y: 3 });
    dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });
    expect(w.player.x).toBe(3);
    expect(w.turn).toBe(0);
  });

  it('diagonal moves are not allowed (original is 4-directional)', () => {
    const w = newWorld();
    dispatch(w, { type: 'MOVE', dx: 1, dy: 1 });
    expect(w.player.x).toBe(3);
    expect(w.turn).toBe(0);
  });

  it('rejects multi-cell, fractional and non-finite deltas without side effects (F11, Task 7)', () => {
    const bad: [number, number][] = [
      [2, 0], [-2, 0], [0, 2], [0, -3], // strides
      [0.5, 0], [1, 0.25], // fractional
      [Number.NaN, 0], [0, Number.POSITIVE_INFINITY], // non-finite
      [1, 1], [-1, 1], // diagonals (4-directional world)
      [0, 0], // zero-length
    ];
    for (const [dx, dy] of bad) {
      const w = newWorld();
      const rngBefore = w.rng.getState();
      dispatch(w, { type: 'MOVE', dx, dy });
      expect(`${w.player.x},${w.player.y}`).toBe('3,3');
      expect(w.turn).toBe(0);
      expect(w.rng.getState()).toBe(rngBefore);
      expect(w.log).toHaveLength(0);
    }
  });
});

describe('WAIT', () => {
  it('consumes a turn', () => {
    const w = newWorld();
    dispatch(w, { type: 'WAIT' });
    expect(w.turn).toBe(1);
  });
});

describe('stairs transitions (levels.json links)', () => {
  it('DESCEND in town on the entrance stair enters level 1 on its down stair', () => {
    const w = newWorld();
    w.player.x = 5;
    w.player.y = 5; // mine entrance tile 0x0c
    dispatch(w, { type: 'DESCEND' });
    expect(w.current).toBe(1);
    const lv1 = w.levels.get(1)!;
    expect(lv1.tiles[idx(w.player.x, w.player.y)]).toBe(TILE_STAIRS_DOWN);
    expect(w.turn).toBe(1);
    expect(w.log.at(-1)?.text).toMatch(/descend/i);
  });

  it('DESCEND elsewhere in town is invalid (no turn)', () => {
    const w = newWorld();
    dispatch(w, { type: 'DESCEND' });
    expect(w.current).toBe(0);
    expect(w.turn).toBe(0);
  });

  it('level 1 down stair leads to level 2; level 2 has an up stair to arrive on', () => {
    const w = newWorld();
    w.player.x = 5;
    w.player.y = 5;
    dispatch(w, { type: 'DESCEND' });
    const lv1 = w.levels.get(1)!;
    // Stand on level 1's down stair (where we arrived) and descend again.
    expect(lv1.tiles[idx(w.player.x, w.player.y)]).toBe(TILE_STAIRS_DOWN);
    dispatch(w, { type: 'DESCEND' });
    expect(w.current).toBe(2);
    const lv2 = w.levels.get(2)!;
    expect(lv2.tiles[idx(w.player.x, w.player.y)]).toBe(TILE_STAIRS_UP);
  });

  it('ASCEND on an up stair follows the up link and lands on the down stair', () => {
    const w = newWorld();
    w.player.x = 5;
    w.player.y = 5;
    dispatch(w, { type: 'DESCEND' });
    dispatch(w, { type: 'DESCEND' });
    expect(w.current).toBe(2);
    // We are standing on level 2's up stair.
    dispatch(w, { type: 'ASCEND' });
    expect(w.current).toBe(1);
    const lv1 = w.levels.get(1)!;
    expect(lv1.tiles[idx(w.player.x, w.player.y)]).toBe(TILE_STAIRS_DOWN);
  });

  it('ASCEND without an up link (level 1 gating) is invalid', () => {
    const w = newWorld();
    w.player.x = 5;
    w.player.y = 5;
    dispatch(w, { type: 'DESCEND' });
    expect(w.current).toBe(1);
    const before = w.turn;
    dispatch(w, { type: 'ASCEND' });
    expect(w.current).toBe(1);
    expect(w.turn).toBe(before);
  });

  it('generated levels are deterministic via the dedicated gen seed', () => {
    const w = newWorld(777);
    const lv = w.levels.get(1) ?? undefined;
    expect(lv).toBeUndefined();
    w.player.x = 5;
    w.player.y = 5;
    dispatch(w, { type: 'DESCEND' });
    const generated = w.levels.get(1)!;
    const reference = generateLevelForWorld(777, 1, { hasUpStair: false, placeDoors: true });
    expect(Buffer.from(generated.tiles).toString('base64')).toBe(
      Buffer.from(reference.level.tiles).toString('base64'),
    );
  });

  it('findStair locates down and up stair tiles on any level', () => {
    const w = newWorld();
    const down = findStair(w.levels.get(0)!, TILE_STAIRS_DOWN);
    expect(down).toEqual({ x: 5, y: 5 });
    expect(findStair(w.levels.get(0)!, TILE_STAIRS_UP)).toBeNull();
  });
});

describe('ENTER_TOWN (Rune of Return APPROX)', () => {
  it('teleports to the town spawn from any dungeon level', () => {
    const w = newWorld();
    w.player.x = 5;
    w.player.y = 5;
    dispatch(w, { type: 'DESCEND' });
    dispatch(w, { type: 'DESCEND' });
    expect(w.current).toBe(2);
    dispatch(w, { type: 'ENTER_TOWN' });
    expect(w.current).toBe(0);
    expect(w.player.x).toBe(3);
    expect(w.player.y).toBe(3);
    expect(w.log.at(-1)?.text).toMatch(/town|rune/i);
  });
});

describe('REST', () => {
  it('regenerates mana at 2 points per hour until full', () => {
    const w = newWorld();
    expect(w.player.mana).toBe(0);
    dispatch(w, { type: 'REST' });
    expect(w.player.mana).toBe(10);
    // 5 hours (0→10 at 2/h), 360 turns per hour APPROX.
    expect(w.restedHours).toBe(5);
    expect(w.turn).toBe(5 * 360);
  });

  it('hour-capped rest regenerates partially', () => {
    const w = newWorld();
    dispatch(w, { type: 'REST', hours: 2 });
    expect(w.player.mana).toBe(4);
    expect(w.restedHours).toBe(2);
  });

  it('rest with full mana is a no-op', () => {
    const w = newWorld();
    w.player.mana = 10;
    dispatch(w, { type: 'REST' });
    expect(w.restedHours).toBe(0);
    expect(w.turn).toBe(0);
  });

  it('rest recovers hit points even when mana is already full (A22)', () => {
    const w = newWorld();
    w.player.mana = 10; // full
    w.player.hp = 5; // but wounded
    dispatch(w, { type: 'REST' });
    expect(w.player.hp).toBe(20); // healed to full
    expect(w.player.mana).toBe(10); // unchanged
    expect(w.restedHours).toBe(1);
    expect(w.turn).toBe(360);
  });

  it('rest continues until BOTH pools are recovered', () => {
    const w = newWorld();
    w.player.hp = 5;
    w.player.mana = 8; // 1 hour of mana left, hp needs its own hour
    // Hour 1 fills mana (and starts hp); hp is still < max after mana fills,
    // so rest must NOT stop at the mana boundary.
    dispatch(w, { type: 'REST' });
    expect(w.player.mana).toBe(10);
    expect(w.player.hp).toBe(20);
    expect(w.restedHours).toBeGreaterThanOrEqual(1);
    expect(w.log.some((e) => e.text.includes('You rest'))).toBe(true);
  });

  it('resting also regains hit points (manual 295)', () => {
    const w = newWorld();
    w.player.hp = 5;
    dispatch(w, { type: 'REST', hours: 1 });
    expect(w.player.hp).toBe(20); // capped at maxHp
    expect(w.player.mana).toBe(2);
  });

  it('rejects invalid requested hours as a silent no-op (Task 7)', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const w = newWorld();
      dispatch(w, { type: 'REST', hours: bad });
      expect(w.restedHours).toBe(0);
      expect(w.turn).toBe(0);
      expect(w.log).toHaveLength(0);
    }
  });

  it('full hit points with missing mana still rests (inverse of A22)', () => {
    const w = newWorld();
    w.player.hp = 20; // full
    w.player.mana = 6; // 2 hours missing
    dispatch(w, { type: 'REST' });
    expect(w.player.mana).toBe(10);
    expect(w.player.hp).toBe(20);
    expect(w.restedHours).toBe(2);
  });

  it('near-expiry poison ages only while active, then rest completes (Task 7)', () => {
    const w = newWorld();
    w.player.hp = 20;
    w.player.mana = 0;
    applyStatus(w.player, 'poison', 15); // 1 more damage tick, then gone
    dispatch(w, { type: 'REST' });
    expect(w.player.statuses.some((s) => s.kind === 'poison')).toBe(false);
    expect(w.player.mana).toBe(10); // rest ran to completion
    expect(w.player.hp).toBe(20); // poison's 1 hp was healed back
  });

  it('lethal poison stops rest immediately at death — no post-death healing (Task 7)', () => {
    const w = newWorld();
    w.player.hp = 4;
    w.player.maxHp = 20;
    w.player.mana = 0;
    applyStatus(w.player, 'poison', 360); // 36 ticks × 1 hp over the hour
    dispatch(w, { type: 'REST' });
    expect(w.player.hp).toBe(0); // dead mid-rest
    expect(w.player.mana).toBe(2); // the fatal hour still elapsed its regen
    expect(w.restedHours).toBe(1); // stopped at the FIRST hour, not 5
    expect(w.log.some((e) => e.text.includes('die in your sleep'))).toBe(true);
  });
});

describe('natural regeneration (status.tick)', () => {
  it('regenerates 1 hp per 6 turns of ordinary play', () => {
    const w = newWorld();
    w.player.hp = 10;
    for (let i = 0; i < 6; i++) dispatch(w, { type: 'WAIT' });
    expect(w.player.hp).toBe(11);
  });

  it('mana regenerates after a full hour of turns', () => {
    const w = newWorld();
    w.player.mana = 0;
    for (let i = 0; i < 360; i++) dispatch(w, { type: 'WAIT' });
    expect(w.player.mana).toBe(1); // natural 1/hour on top of nothing else
  });
});

describe('inventory actions (Task 3.2)', () => {
  it('PICKUP adds to the pack and consumes a turn', () => {
    const w = newWorld();
    dispatch(w, { type: 'PICKUP', defId: 'i-long-sword' });
    expect(w.inventory.pack).toHaveLength(1);
    expect(w.turn).toBe(1);
    expect(w.log.at(-1)?.text).toContain('Long Sword');
  });

  it('rejected pickups log and consume no turn', () => {
    const w = newWorld();
    w.player.strength = 1; // hard limit 400 g
    dispatch(w, { type: 'PICKUP', defId: 'i-leather-armor' }); // 5000 g
    expect(w.inventory.pack).toHaveLength(0);
    expect(w.turn).toBe(0);
    expect(w.log.at(-1)?.text).toMatch(/too heavy/i);
  });

  it('EQUIP moves the item and updates derived stats', () => {
    const w = newWorld();
    dispatch(w, { type: 'PICKUP', defId: 'i-long-sword' });
    const uid = w.inventory.pack[0]!.uid;
    dispatch(w, { type: 'EQUIP', uid });
    expect(w.inventory.equipment.weapon?.defId).toBe('i-long-sword');
    // Recalc: equipping raises the aggregated damage via weapon class.
    const before = equipmentStats({ ...w.inventory, equipment: {} }, w.data.items, w.player);
    const after = equipmentStats(w.inventory, w.data.items, w.player);
    expect(after.damage).toBe(before.damage + 8);
    expect(after.armorValue).toBe(before.armorValue);
  });

  it('USE with the stub effect system logs "Nothing happens." and takes a turn', () => {
    const w = newWorld();
    dispatch(w, { type: 'PICKUP', defId: 'i-potion' });
    const uid = w.inventory.pack[0]!.uid;
    dispatch(w, { type: 'USE', uid });
    expect(w.log.at(-1)?.text).toBe('Nothing happens.');
    expect(w.turn).toBe(2); // pickup + use
    expect(w.inventory.pack).toHaveLength(1); // not consumed by stub
  });

  it('DISCARD destroys pack items permanently and says so (F21)', () => {
    const w = newWorld();
    dispatch(w, { type: 'PICKUP', defId: 'i-potion' });
    dispatch(w, { type: 'PICKUP', defId: 'i-potion' });
    const uid = w.inventory.pack[0]!.uid;
    dispatch(w, { type: 'DISCARD', uid, count: 1 });
    expect(w.log.at(-1)?.text).toBe('You discard Potion.'); // count suffix only when > 1
    expect(w.inventory.pack[0]!.count).toBe(1);
    expect(w.turn).toBe(3); // pickup + pickup + discard
    // Whole stack when count omitted.
    dispatch(w, { type: 'DISCARD', uid });
    expect(w.inventory.pack).toHaveLength(0);
    expect(w.log.at(-1)?.text).toBe('You discard Potion.');
  });

  it('light sources burn down one turn per action', () => {
    const w = newWorld();
    dispatch(w, { type: 'PICKUP', defId: 'i-potion' });
    const torch = w.inventory.pack[0]!;
    torch.fuelTurns = 3;
    dispatch(w, { type: 'WAIT' });
    expect(torch.fuelTurns).toBe(2);
    dispatch(w, { type: 'WAIT' });
    dispatch(w, { type: 'WAIT' });
    expect(w.inventory.pack).toHaveLength(0); // burned out
  });
});

describe('system interfaces', () => {
  function recordingSystems(): { systems: Systems; monsterTurns: number[] } {
    const monsterTurns: number[] = [];
    return {
      monsterTurns,
      systems: {
        monsters: { takeTurns: (w: unknown) => void monsterTurns.push((w as { turn: number }).turn) },
        traps: { onTurn: () => {}, onPlayerEnter: () => null },
        status: { tick: () => {}, restHour: () => {} },
        effects: { onUse: () => null },
      },
    };
  }

  it('monsters take a turn after each player action', () => {
    const { systems, monsterTurns } = recordingSystems();
    const w = createWorld({
      worldSeed: 1,
      data: syntheticData(),
      player: testPlayer({ name: 'T', hp: 10, maxHp: 10, mana: 5, maxMana: 5 }),
      systems,
    });
    dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });
    dispatch(w, { type: 'WAIT' });
    expect(monsterTurns).toEqual([1, 2]);
  });

  it('invalid actions do not run monster turns', () => {
    const { systems, monsterTurns } = recordingSystems();
    const w = createWorld({
      worldSeed: 1,
      data: syntheticData(),
      player: testPlayer({ name: 'T', hp: 10, maxHp: 10, mana: 5, maxMana: 5 }),
      systems,
    });
    dispatch(w, { type: 'MOVE', dx: -1, dy: 0 }); // wall
    expect(monsterTurns).toEqual([]);
  });
});

describe('FOV integration', () => {
  it('memory accumulates in seen as the player moves', () => {
    const w = newWorld();
    const seen0 = w.seen.get(0)!;
    const before = seen0.filter((v) => v === 1).length;
    expect(before).toBeGreaterThan(0); // spawn area visible immediately
    for (let i = 0; i < 3; i++) dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });
    const after = seen0.filter((v) => v === 1).length;
    expect(after).toBeGreaterThan(before);
  });

  it('visible plane reflects the current position', () => {
    const w = newWorld();
    dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });
    expect(w.visible[idx(4, 3)]).toBe(1);
  });
});

describe('real-data integration (levels.json + overworld.json + tiles.json)', () => {
  it('town spawn → mine entrance → Mine Level 1 via the real level graph', () => {
    const data = loadWorldData();
    const w = createWorld({
      worldSeed: 2026,
      data,
      player: testPlayer({ name: 'Hero', hp: 30, maxHp: 30, mana: 5, maxMana: 5 }),
    });
    expect(w.current).toBe(0);
    expect(w.player.x).toBe(data.town.spawn.x);
    expect(w.player.y).toBe(data.town.spawn.y);

    // Walk to the mine entrance via BFS over walkable town tiles.
    const town = w.levels.get(0)!;
    const target = data.town.mineEntrance;
    const prev = new Map<number, number>();
    const visited = new Set<number>([idx(w.player.x, w.player.y)]);
    const queue = [idx(w.player.x, w.player.y)];
    while (queue.length > 0) {
      const at = queue.shift()!;
      if (at === idx(target.x, target.y)) break;
      const x = at % 64;
      const y = Math.floor(at / 64);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= 64 || ny >= 64) continue;
        const ni = idx(nx, ny);
        if (visited.has(ni)) continue;
        const tile = town.tiles[ni]!;
        if (!data.tiles[tile]?.walkable) continue;
        visited.add(ni);
        prev.set(ni, at);
        queue.push(ni);
      }
    }
    expect(visited.has(idx(target.x, target.y))).toBe(true);

    // Teleport along the path (each step as a MOVE keeps turn math simple).
    const path: number[] = [];
    for (let at = idx(target.x, target.y); at !== idx(w.player.x, w.player.y); ) {
      path.unshift(at);
      const p = prev.get(at);
      if (p === undefined) break;
      at = p;
    }
    for (const step of path) {
      const sx = step % 64;
      const sy = Math.floor(step / 64);
      dispatch(w, { type: 'MOVE', dx: sx - w.player.x, dy: sy - w.player.y });
    }
    expect(w.player.x).toBe(target.x);
    expect(w.player.y).toBe(target.y);

    dispatch(w, { type: 'DESCEND' });
    expect(w.current).toBe(1);
    const lv1 = w.levels.get(1)!;
    expect(lv1.tiles[idx(w.player.x, w.player.y)]).toBe(TILE_STAIRS_DOWN);

    // Levels 1-3 have no up link in levels.json — ascending from 1 is invalid.
    const turnsBefore = w.turn;
    dispatch(w, { type: 'ASCEND' });
    expect(w.current).toBe(1);
    expect(w.turn).toBe(turnsBefore);
  });
});

describe('SEARCH stub', () => {
  it('consumes a turn (real search logic lands with traps in M4)', () => {
    const w = newWorld();
    dispatch(w, { type: 'SEARCH' });
    expect(w.turn).toBe(1);
  });
});

describe('not-yet-implemented actions', () => {
  it('CAST with an unknown id is rejected without consuming a turn; bad uids log errors', () => {
    const w = newWorld();
    dispatch(w, { type: 'CAST', spellId: 's-nope' });
    expect(w.turn).toBe(0);
    expect(w.log.at(-1)?.text).toMatch(/unknown/i);
    dispatch(w, { type: 'DISCARD', uid: 'missing#1' });
    expect(w.turn).toBe(0);
    expect(w.log.at(-1)?.text).toMatch(/not in pack/);
  });
});

describe('MSLCG gameplay RNG is independent of generation', () => {
  it('gameplay rolls do not change level regeneration', () => {
    const w = newWorld(55);
    // Burn gameplay rolls.
    for (let i = 0; i < 10; i++) w.rng.next();
    const ref = generateLevelForWorld(55, 1, { hasUpStair: false, placeDoors: true });
    w.player.x = 5;
    w.player.y = 5;
    dispatch(w, { type: 'DESCEND' });
    const lv1 = w.levels.get(1)!;
    expect(Buffer.from(lv1.tiles).toString('base64')).toBe(
      Buffer.from(ref.level.tiles).toString('base64'),
    );
    expect(levelGenSeed(55, 1)).not.toBe(w.rng.getState());
  });
});

describe('log retention (Task 12)', () => {
  it('caps the world log at LOG_CAP entries, keeping the newest', () => {
    const w = newWorld(55);
    const cap = LOG_CAP;
    for (let i = 0; i < cap + 250; i++) {
      w.log.push({ turn: w.turn, text: `line ${i}` });
      dispatch(w, { type: 'WAIT' });
    }
    expect(w.log.length).toBe(cap);
    expect(w.log[0]!.text).toBe('line 250');
    expect(w.log[w.log.length - 1]!.text).toBe(`line ${cap + 249}`);
  });

  it('does not trim logs below the cap', () => {
    const w = newWorld(55);
    for (let i = 0; i < 10; i++) {
      w.log.push({ turn: w.turn, text: `entry ${i}` });
      dispatch(w, { type: 'WAIT' });
    }
    expect(w.log.length).toBe(10);
    expect(w.log.length).toBeLessThanOrEqual(LOG_CAP);
  });
});
