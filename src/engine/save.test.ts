import { describe, expect, it } from 'vitest';

import { createCharacter } from './character';
import { TILE_FLOOR } from './dungeon';
import type { Player, TrapState } from './types';
import { idx } from './map';
import {
  b64ToBytes,
  bytesToB64,
  deserializeGame,
  serializeGame,
  type SaveFile,
} from './save';
import { createWorld, dispatch, type Action, type WorldData, type World } from './world';
import { applyStatus } from './effects';

function syntheticData(): WorldData {
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
    spells: {},
    quests: [
      {
        id: 'q',
        title: 'Fixture Quest',
        boss: { level: 2, monster: 'Huge Ogre', guards: [] },
        victoryStoryText: 9,
        stages: [
          { id: 'intro', trigger: { kind: 'game-start' }, journalText: 'Begin.', storyTexts: [1] },
          { id: 'win', trigger: { kind: 'monster-killed', name: 'Huge Ogre' }, journalText: 'Won.', storyTexts: [2] },
        ],
      },
    ],
    story: { '1': 'one', '2': 'two', '9': 'end' },
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

function newWorld(seed = 42) {
  return createWorld({
    worldSeed: seed,
    data: syntheticData(),
    player: testPlayer({ hp: 20, maxHp: 20, mana: 3, maxMana: 10 }),
  });
}

const FIXED_TIME = '2026-11-11T00:00:00.000Z';

describe('base64 codec (pure, isomorphic)', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array(4096);
    let s = 7;
    for (let i = 0; i < bytes.length; i++) {
      s = (s * 48271) % 2147483647;
      bytes[i] = s & 0xff;
    }
    const b64 = bytesToB64(bytes);
    expect(b64.length).toBe(Math.ceil(4096 / 3) * 4);
    expect(Array.from(b64ToBytes(b64))).toEqual(Array.from(bytes));
  });

  it('round-trips empty and tiny inputs', () => {
    expect(bytesToB64(new Uint8Array(0))).toBe('');
    expect(b64ToBytes('').length).toBe(0);
    expect(Array.from(b64ToBytes(bytesToB64(new Uint8Array([1, 2, 3]))))).toEqual([1, 2, 3]);
  });

  it('rejects invalid characters and bad padding', () => {
    expect(() => b64ToBytes('!!!!')).toThrow();
    expect(() => b64ToBytes('A')).toThrow();
  });

  it('rejects interior or misplaced padding (F26)', () => {
    for (const bad of ['=AAA', 'A=AA', 'AB=A', 'A===']) {
      expect(() => b64ToBytes(bad), `case ${bad}`).toThrow(/padding/i);
    }
    // Valid padded forms still decode.
    expect(Array.from(b64ToBytes('AB=='))).toHaveLength(1);
    expect(Array.from(b64ToBytes('ABC='))).toHaveLength(2);
  });
});

describe('serializeGame / deserializeGame', () => {
  it('round-trip is stable (serialize → deserialize → serialize identical)', () => {
    const w = newWorld();
    dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });
    dispatch(w, { type: 'WAIT' });
    const s1 = serializeGame(w, { savedAt: FIXED_TIME });
    const restored = deserializeGame(JSON.parse(JSON.stringify(s1)) as SaveFile, syntheticData());
    const s2 = serializeGame(restored, { savedAt: FIXED_TIME });
    expect(JSON.stringify(s2)).toBe(JSON.stringify(s1));
  });

  it('persists every visited level in full; unvisited levels absent', () => {
    const w = newWorld();
    w.player.x = 5;
    w.player.y = 5;
    dispatch(w, { type: 'DESCEND' }); // → 1
    dispatch(w, { type: 'DESCEND' }); // → 2
    const save = serializeGame(w, { savedAt: FIXED_TIME });
    expect(Object.keys(save.levels).sort()).toEqual(['0', '1', '2']);
    for (const key of ['0', '1', '2']) {
      const lv = save.levels[key]!;
      expect(b64ToBytes(lv.tilesB64).length).toBe(4096);
      expect(b64ToBytes(lv.flagsB64).length).toBe(4096);
      expect(b64ToBytes(lv.occupancyB64).length).toBe(4096);
      expect(b64ToBytes(lv.seenB64).length).toBe(4096);
    }
  });

  it('carries RNG state, turn, current level, rested hours and player', () => {
    const w = newWorld();
    dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });
    dispatch(w, { type: 'REST', hours: 2 });
    const save = serializeGame(w, { savedAt: FIXED_TIME });
    expect(save.world.gameplayRngState).toBe(w.rng.getState());
    expect(save.world.turn).toBe(w.turn);
    expect(save.world.current).toBe(0);
    expect(save.world.restedHours).toBe(2);
    expect(save.player.mana).toBe(w.player.mana);

    const restored = deserializeGame(save, syntheticData());
    expect(restored.rng.getState()).toBe(w.rng.getState());
    expect(restored.turn).toBe(w.turn);
    expect(restored.current).toBe(0);
    expect(restored.player.x).toBe(w.player.x);
    expect(restored.player.y).toBe(w.player.y);
  });

  it('traps and secret doors persist through a round trip', () => {
    const w = newWorld();
    w.player.x = 5;
    w.player.y = 5;
    dispatch(w, { type: 'DESCEND' }); // level 1: traps (+ doors) placed
    const level = w.levels.get(1)!;
    expect((level.traps ?? []).length).toBeGreaterThan(0);
    if ((level.doors ?? []).length === 0) {
      // Hermetic fallback when this seed's layout has no qualifying wall.
      level.doors = [{ x: 4, y: 4, secret: true, found: false }];
    }
    // Reveal one trap + open one door before saving.
    const trap = level.traps![0]!;
    trap.known = true;
    const door = level.doors![0]!;
    door.found = true;
    level.tiles[idx(door.x, door.y)] = TILE_FLOOR; // mimic revealSecretDoor
    const restored = deserializeGame(
      JSON.parse(JSON.stringify(serializeGame(w, { savedAt: FIXED_TIME }))) as SaveFile,
      syntheticData(),
    );
    const lv = restored.levels.get(1)!;
    expect(JSON.stringify(lv.traps)).toBe(JSON.stringify(level.traps));
    expect(lv.doors![0]!.found).toBe(true);
    expect(lv.tiles[idx(door.x, door.y)]).toBe(TILE_FLOOR);
  });

  it('seen memory persists per level', () => {
    const w = newWorld();
    dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });
    const seenBefore = w.seen.get(0)!.filter((v) => v === 1).length;
    const restored = deserializeGame(serializeGame(w, { savedAt: FIXED_TIME }), syntheticData());
    expect(restored.seen.get(0)!.filter((v) => v === 1).length).toBe(seenBefore);
  });

  it('quest state persists through a round trip', () => {
    const w = newWorld();
    const q = w.questState!;
    expect(q).toBeDefined();
    q.completed['win'] = 9;
    q.journal.push({ turn: 9, questId: 'q', text: 'Won.' });
    q.pending.push(2);
    q.done = true;
    q.victory = true;
    q.endingShown = true;
    const restored = deserializeGame(
      JSON.parse(JSON.stringify(serializeGame(w, { savedAt: FIXED_TIME }))) as SaveFile,
      syntheticData(),
    );
    expect(restored.questState).toEqual(q);
    // game-start does not re-fire on load (intro stays completed pre-save).
    expect(restored.questState?.completed['intro']).toBe(0);
  });

  it('inventory, equipment and gold persist through a round trip', () => {
    const w = newWorld();
    dispatch(w, { type: 'PICKUP', defId: 'i-long-sword' });
    dispatch(w, { type: 'PICKUP', defId: 'i-potion', count: 3 });
    dispatch(w, { type: 'EQUIP', uid: w.inventory.pack[0]!.uid });
    w.inventory.gold = 1234;
    const restored = deserializeGame(
      JSON.parse(JSON.stringify(serializeGame(w, { savedAt: FIXED_TIME }))) as SaveFile,
      syntheticData(),
    );
    expect(restored.inventory.gold).toBe(1234);
    expect(restored.inventory.equipment.weapon?.defId).toBe('i-long-sword');
    expect(restored.inventory.pack[0]!.defId).toBe('i-potion');
    expect(restored.inventory.pack[0]!.count).toBe(3);
    expect(restored.inventory.seq).toBe(w.inventory.seq);
    // Post-load pickups keep unique uids (sequence is serialized).
    dispatch(restored, { type: 'PICKUP', defId: 'i-potion' });
    const uids = restored.inventory.pack.map((i) => i.uid);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it('monster state and populated flag persist through a round trip', () => {
    const w = newWorld();
    const level = w.levels.get(0)!;
    level.entities.set(7, {
      id: 7,
      kind: 'monster',
      name: 'Kobold',
      x: 4,
      y: 3,
      monster: {
        hp: 3,
        maxHp: 9,
        stats: {
          maxHp: 9, ac: 4, toHit: 2,
          damage: { count: 1, sides: 4, bonus: 0 },
          speed: 1, xp: 20,
        },
        alert: true,
        sleepTurns: 0,
        slowDenominator: 2,
        timer: 1,
      },
    });
    level.occupancy[idx(4, 3)] = 7;
    level.populated = true;
    const restored = deserializeGame(
      JSON.parse(JSON.stringify(serializeGame(w, { savedAt: FIXED_TIME }))) as SaveFile,
      syntheticData(),
    );
    const lv = restored.levels.get(0)!;
    expect(lv.populated).toBe(true);
    const m = lv.entities.get(7)!.monster!;
    expect(m.alert).toBe(true);
    expect(m.slowDenominator).toBe(2);
    expect(m.timer).toBe(1);
    expect(lv.occupancy[idx(4, 3)]).toBe(7);
  });

  it('rejects saves with duplicate item uids', () => {
    const w = newWorld();
    dispatch(w, { type: 'PICKUP', defId: 'i-potion' });
    const save = JSON.parse(JSON.stringify(serializeGame(w, { savedAt: FIXED_TIME }))) as SaveFile;
    save.inventory.pack.push({ ...save.inventory.pack[0]! });
    expect(() => deserializeGame(save, syntheticData())).toThrow(/duplicate uid/);
  });

  it('statuses persist through a round trip', () => {
    const w = newWorld();
    applyStatus(w.player, 'levitation', 37);
    applyStatus(w.player, 'shield', 400, 2);
    const restored = deserializeGame(
      JSON.parse(JSON.stringify(serializeGame(w, { savedAt: FIXED_TIME }))) as SaveFile,
      syntheticData(),
    );
    const lev = restored.player.statuses.find((s) => s.kind === 'levitation');
    expect(lev?.remainingTurns).toBe(37);
    expect(restored.player.statuses.find((s) => s.kind === 'shield')?.magnitude).toBe(2);
  });

  it('rejects saves with unknown status kinds', () => {
    const w = newWorld();
    const save = JSON.parse(JSON.stringify(serializeGame(w, { savedAt: FIXED_TIME }))) as SaveFile;
    (save.player.statuses as { kind: string; remainingTurns: number }[]).push({ kind: 'glowing', remainingTurns: 10 });
    expect(() => deserializeGame(save, syntheticData())).toThrow(/unknown status kind/);
  });
});

describe('save part field (PART2-PLAN Task P5)', () => {
  it('serializes the world part and preserves it through a round trip', () => {
    const w = newWorld();
    const save = serializeGame(w, { savedAt: FIXED_TIME });
    expect(save.meta.part).toBe(1);
    const restored = deserializeGame(JSON.parse(JSON.stringify(save)) as SaveFile, syntheticData());
    expect(restored.data.part).toBe(1);
    expect(serializeGame(restored, { savedAt: FIXED_TIME }).meta.part).toBe(1);
  });

  it('records part 2 worlds and reloads them against the part 2 bundle', () => {
    const data2 = { ...syntheticData(), part: 2 as const };
    const w = createWorld({ worldSeed: 7, data: data2, player: testPlayer() });
    const save = serializeGame(w, { savedAt: FIXED_TIME });
    expect(save.meta.part).toBe(2);
    const restored = deserializeGame(JSON.parse(JSON.stringify(save)) as SaveFile, data2);
    expect(restored.data.part).toBe(2);
  });

  it('a part-2 save rejects the wrong campaign before inspecting quests', () => {
    const data2 = { ...syntheticData(), part: 2 as const };
    const w = createWorld({ worldSeed: 7, data: data2, player: testPlayer() });
    w.questState = undefined; // createWorld seeded a part-1 quest state; clear for a clean mismatch
    const save = serializeGame(w, { savedAt: FIXED_TIME }) as unknown as Record<string, unknown>;
    // Force a part-2-only marker the part-1 registry must reject: quests id.
    const world = save.world as Record<string, unknown>;
    world.quests = {
      questId: 'lifthransirs-bane',
      completed: {},
      done: false,
      victory: false,
      journal: [],
      pending: [],
    };
    expect(() =>
      deserializeGame(save as unknown as SaveFile, syntheticData()),
    ).toThrow(/meta.part.*campaign/);
  });

  it('accepts saves without a part field (legacy = part 1) and rejects invalid parts', () => {
    const w = newWorld();
    const save = JSON.parse(JSON.stringify(serializeGame(w, { savedAt: FIXED_TIME }))) as SaveFile;
    expect(save.meta.part).toBe(1); // written since P5; strip to prove legacy tolerance
    delete (save.meta as { part?: 1 | 2 }).part;
    const restored = deserializeGame(save, syntheticData());
    expect(restored.data.part).toBe(1);

    const bad = JSON.parse(JSON.stringify(serializeGame(w, { savedAt: FIXED_TIME }))) as SaveFile;
    (bad.meta as { part?: number }).part = 3;
    expect(() => deserializeGame(bad, syntheticData())).toThrow(/meta\.part/);
  });
});

describe('continuation equivalence (codex blocker fix)', () => {
  /** Placeholder resolved against the live world at dispatch time. */
  type Step = Action | { type: 'EQUIP_SWORD' };

  function apply(w: World, step: Step): void {
    if (step.type === 'EQUIP_SWORD') {
      const sword = w.inventory.pack.find((i) => i.defId === 'i-long-sword');
      dispatch(w, { type: 'EQUIP', uid: sword?.uid ?? '' });
      return;
    }
    dispatch(w, step);
  }

  it('scripted actions with save+load mid-run == uninterrupted run, byte-identical', () => {
    const script: Step[] = [
      { type: 'MOVE', dx: 1, dy: 0 }, { type: 'MOVE', dx: 1, dy: 0 },
      { type: 'WAIT' }, { type: 'MOVE', dx: 0, dy: 1 }, { type: 'WAIT' },
      { type: 'PICKUP', defId: 'i-potion', count: 2 },
      { type: 'PICKUP', defId: 'i-long-sword' },
      { type: 'MOVE', dx: 1, dy: 0 }, { type: 'MOVE', dx: 0, dy: 1 },
      { type: 'WAIT' }, // ← save/load boundary after 10 steps
      { type: 'MOVE', dx: 0, dy: 1 }, { type: 'MOVE', dx: -1, dy: 0 },
      { type: 'EQUIP_SWORD' },
      { type: 'WAIT' }, { type: 'MOVE', dx: 1, dy: 0 }, { type: 'WAIT' },
      { type: 'MOVE', dx: 1, dy: 0 }, { type: 'MOVE', dx: 0, dy: -1 },
      { type: 'WAIT' }, { type: 'SEARCH' }, { type: 'MOVE', dx: 0, dy: 1 },
      { type: 'MOVE', dx: 1, dy: 0 }, { type: 'WAIT' }, { type: 'WAIT' },
      { type: 'MOVE', dx: 0, dy: -1 }, { type: 'MOVE', dx: -1, dy: 0 },
    ];

    const a = newWorld(42);
    for (const act of script) apply(a, act);

    const b = newWorld(42);
    for (let i = 0; i < 10; i++) apply(b, script[i]!);
    const midSave = serializeGame(b, { savedAt: FIXED_TIME });
    const bLoaded = deserializeGame(JSON.parse(JSON.stringify(midSave)) as SaveFile, syntheticData());
    for (let i = 10; i < script.length; i++) apply(bLoaded, script[i]!);

    const sa = serializeGame(a, { savedAt: FIXED_TIME });
    const sb = serializeGame(bLoaded, { savedAt: FIXED_TIME });
    expect(JSON.stringify(sb)).toBe(JSON.stringify(sa));
  });

  it('equivalence holds across a dungeon transition mid-script', () => {
    const wA = newWorld(7);
    wA.player.x = 5;
    wA.player.y = 5;
    dispatch(wA, { type: 'DESCEND' });
    dispatch(wA, { type: 'MOVE', dx: 0, dy: 1 });
    dispatch(wA, { type: 'WAIT' });

    const wB = newWorld(7);
    wB.player.x = 5;
    wB.player.y = 5;
    dispatch(wB, { type: 'DESCEND' });
    const save = serializeGame(wB, { savedAt: FIXED_TIME });
    const wB2 = deserializeGame(JSON.parse(JSON.stringify(save)) as SaveFile, syntheticData());
    dispatch(wB2, { type: 'MOVE', dx: 0, dy: 1 });
    dispatch(wB2, { type: 'WAIT' });

    const sa = serializeGame(wA, { savedAt: FIXED_TIME });
    const sb = serializeGame(wB2, { savedAt: FIXED_TIME });
    expect(JSON.stringify(sb)).toBe(JSON.stringify(sa));
  });
});

describe('deserialization validation', () => {
  function baseSave(): SaveFile {
    const w = newWorld();
    dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });
    return serializeGame(w, { savedAt: FIXED_TIME });
  }

  it('rejects unknown format/version with an upgrade note', () => {
    const save = baseSave();
    (save as { version: number }).version = 99;
    expect(() => deserializeGame(save, syntheticData())).toThrow(/version/i);
    (save as { format: string }).format = 'something-else';
    expect(() => deserializeGame(save, syntheticData())).toThrow(/format/i);
  });

  it('rejects wrong plane lengths', () => {
    const save = baseSave();
    save.levels['0']!.tilesB64 = bytesToB64(new Uint8Array(10));
    expect(() => deserializeGame(save, syntheticData())).toThrow(/4096|length/i);
  });

  it('rejects occupancy referencing a missing entity', () => {
    const save = baseSave();
    save.levels['0']!.entities = [];
    const occ = b64ToBytes(save.levels['0']!.occupancyB64);
    occ[idx(3, 3)] = 77; // no entity 77
    save.levels['0']!.occupancyB64 = bytesToB64(occ);
    expect(() => deserializeGame(save, syntheticData())).toThrow(/entity|occupancy/i);
  });

  it('rejects out-of-bounds entity coordinates', () => {
    const save = baseSave();
    save.levels['0']!.entities = [
      { id: 5, kind: 'monster', name: 'X', x: 999, y: 0 },
    ];
    const occ = b64ToBytes(save.levels['0']!.occupancyB64);
    occ[idx(3, 3)] = 5;
    save.levels['0']!.occupancyB64 = bytesToB64(occ);
    expect(() => deserializeGame(save, syntheticData())).toThrow(/bounds|range|x|y/i);
  });

  it('rejects invalid monster state', () => {
    const save = baseSave();
    save.levels['0']!.entities = [
      { id: 5, kind: 'monster', name: 'Kobold', x: 3, y: 0, monster: {
        hp: 1,
        maxHp: 9,
        stats: {
          maxHp: 9, ac: 4, toHit: 2,
          damage: { count: 1, sides: 4, bonus: 0 },
          speed: 1, xp: 20,
        },
        sleepTurns: -3,
      } },
    ];
    const occ = b64ToBytes(save.levels['0']!.occupancyB64);
    occ[idx(3, 0)] = 5;
    save.levels['0']!.occupancyB64 = bytesToB64(occ);
    expect(() => deserializeGame(save, syntheticData())).toThrow(/sleepTurns|monster/i);
  });

  it('rejects a current level missing from the save', () => {
    const save = baseSave();
    save.world.current = 5;
    expect(() => deserializeGame(save, syntheticData())).toThrow(/level/i);
  });

  it('rejects unknown trap kinds', () => {
    const save = baseSave();
    save.levels['0']!.traps = [
      { id: 't1', kind: 'vortex', x: 3, y: 3, known: false } as unknown as TrapState,
    ];
    expect(() => deserializeGame(save, syntheticData())).toThrow(/trap kind/i);
  });
});

describe('save isolation (F04, Task 2)', () => {
  it('serializing snapshots the world: later mutations leave the save unchanged', () => {
    const w = newWorld(11);
    dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });
    w.player.statuses.push({ kind: 'shield', remainingTurns: 10, magnitude: 2 });
    const save = serializeGame(w, { savedAt: FIXED_TIME });
    const snapshot = JSON.stringify(save);

    // Mutate the live world after the snapshot.
    w.player.statuses.push({ kind: 'light', remainingTurns: 5 });
    w.player.hp = 1;
    w.player.knownSpells.push('s-x');
    w.player.regen.hpTicks = 99;
    w.inventory.pack.push({ uid: 'i-potion#9', defId: 'i-potion', count: 1 });

    expect(JSON.stringify(save)).toBe(snapshot);
  });

  it('deserializing clones the save: mutating the loaded world leaves the save unchanged', () => {
    const save = serializeGame(newWorld(12), { savedAt: FIXED_TIME });
    save.player.statuses.push({ kind: 'shield', remainingTurns: 7, magnitude: 3 });
    const snapshot = JSON.stringify(save);

    const w = deserializeGame(JSON.parse(JSON.stringify(save)) as SaveFile, syntheticData());
    w.player.hp = 1;
    w.player.statuses.push({ kind: 'light', remainingTurns: 4 });
    const town = w.levels.get(0)!;
    const first = town.entities.values().next();
    if (!first.done) {
      const entity = first.value;
      entity.x = 0;
      entity.y = 0;
      if (entity.monster) entity.monster.hp = 0;
    }
    town.traps?.push({ id: 'tx', kind: 'pit', x: 1, y: 1, known: false });
    w.inventory.pack.push({ uid: 'i-potion#99', defId: 'i-potion', count: 1 });

    expect(JSON.stringify(save)).toBe(snapshot);
  });

  it('two worlds from one save are independent (advance one, the other is untouched)', () => {
    const save = serializeGame(newWorld(13), { savedAt: FIXED_TIME });
    const json = JSON.stringify(save);
    const w1 = deserializeGame(JSON.parse(json) as SaveFile, syntheticData());
    const w2 = deserializeGame(JSON.parse(json) as SaveFile, syntheticData());
    const turnBefore = w2.turn;
    const hpBefore = w2.player.hp;
    const rngBefore = w2.rng.getState();

    dispatch(w1, { type: 'WAIT' });
    dispatch(w1, { type: 'WAIT' });
    w1.player.hp -= 3;

    expect(w2.turn).toBe(turnBefore);
    expect(w2.player.hp).toBe(hpBefore);
    expect(w2.rng.getState()).toBe(rngBefore);
  });
});
