// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createCharacter } from './character';
import { validateSave } from './save-validation';
import { bytesToB64, serializeGame } from './save';
import { createWorld, type WorldData } from './world';
import type { Player } from './types';
import type { SaveFile } from './save';

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
    spells: {
      's-heal': {
        id: 's-heal',
        name: 'HEAL MINOR WOUNDS',
        tier: 1,
        baseMana: 1,
        target: 'self',
        effect: 'heal',
      },
    },
    quests: [
      {
        id: 'q',
        title: 'Fixture Quest',
        boss: { level: 2, monster: 'Huge Ogre', guards: [] },
        victoryStoryText: 9,
        stages: [
          { id: 'intro', trigger: { kind: 'game-start' }, journalText: 'Begin.', storyTexts: [1] },
          {
            id: 'win',
            trigger: { kind: 'monster-killed', name: 'Huge Ogre' },
            journalText: 'Won.',
            storyTexts: [2],
          },
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

function makeSave(data: WorldData): SaveFile {
  const world = createWorld({
    worldSeed: 7,
    data,
    player: testPlayer(),
  });
  return serializeGame(world, { savedAt: '2026-01-01T00:00:00.000Z' });
}

function mutate(save: SaveFile, fn: (draft: SaveFile) => void): SaveFile {
  const draft = structuredClone<SaveFile>(save);
  fn(draft);
  return draft;
}

describe('save boundary validation (Task 2)', () => {
  it('accepts a freshly serialized fixture save', () => {
    const data = syntheticData();
    expect(() => validateSave(makeSave(data), data)).not.toThrow();
  });

  it('rejects non-object input and structural garbage', () => {
    const data = syntheticData();
    expect(() => validateSave(null, data)).toThrow(/save must be an object/i);
    expect(() => validateSave('nope', data)).toThrow(/save must be an object/i);
    expect(() => validateSave({}, data)).toThrow(/format/i);
    const bad = mutate(makeSave(data), (d) => {
      d.version = 2;
    });
    expect(() => validateSave(bad, data)).toThrow(/version/i);
  });

  it('rejects malformed meta', () => {
    const data = syntheticData();
    const bad = mutate(makeSave(data), (d) => {
      (d.meta as { savedAt: unknown }).savedAt = 42;
    });
    expect(() => validateSave(bad, data)).toThrow(/meta\.savedAt/i);
    const badTurn = mutate(makeSave(data), (d) => {
      d.meta.turn = -1;
    });
    expect(() => validateSave(badTurn, data)).toThrow(/meta\.turn/i);
  });

  it('validates player fields with specific errors', () => {
    const data = syntheticData();
    const noRegen = mutate(makeSave(data), (d) => {
      (d.player as { regen?: unknown }).regen = undefined;
    });
    expect(() => validateSave(noRegen, data)).toThrow(/regen/i);
    const overHeal = mutate(makeSave(data), (d) => {
      d.player.hp = d.player.maxHp + 1;
    });
    expect(() => validateSave(overHeal, data)).toThrow(/hp/i);
    const stat = mutate(makeSave(data), (d) => {
      d.player.strength = 0;
    });
    expect(() => validateSave(stat, data)).toThrow(/strength/i);
    const statHigh = mutate(makeSave(data), (d) => {
      d.player.maxDexterity = 101;
    });
    expect(() => validateSave(statHigh, data)).toThrow(/dexterity/i);
    const spells = mutate(makeSave(data), (d) => {
      (d.player.knownSpells as unknown[]).push(7);
    });
    expect(() => validateSave(spells, data)).toThrow(/knownSpells/i);
    const unknownSpell = mutate(makeSave(data), (d) => {
      d.player.knownSpells = ['s-nope'];
    });
    expect(() => validateSave(unknownSpell, data)).toThrow(/knownSpells.*s-nope|s-nope/i);
    const coords = mutate(makeSave(data), (d) => {
      d.player.x = 64;
    });
    expect(() => validateSave(coords, data)).toThrow(/player\.x/i);
    const badName = mutate(makeSave(data), (d) => {
      (d.player as { name?: unknown }).name = '';
    });
    expect(() => validateSave(badName, data)).toThrow(/name/i);
  });

  it('permits zero hit points (death saves are loadable)', () => {
    const data = syntheticData();
    const dead = mutate(makeSave(data), (d) => {
      d.player.hp = 0;
    });
    expect(() => validateSave(dead, data)).not.toThrow();
  });

  it('validates world scalars as uint32 / nonnegative / known level', () => {
    const data = syntheticData();
    const seed = mutate(makeSave(data), (d) => {
      d.world.worldSeed = -1;
    });
    expect(() => validateSave(seed, data)).toThrow(/worldSeed/i);
    const seedHigh = mutate(makeSave(data), (d) => {
      d.world.worldSeed = 2 ** 32;
    });
    expect(() => validateSave(seedHigh, data)).toThrow(/worldSeed/i);
    const rng = mutate(makeSave(data), (d) => {
      d.world.gameplayRngState = 1.5;
    });
    expect(() => validateSave(rng, data)).toThrow(/gameplayRngState/i);
    const turn = mutate(makeSave(data), (d) => {
      d.world.turn = -1;
    });
    expect(() => validateSave(turn, data)).toThrow(/turn/i);
    const rested = mutate(makeSave(data), (d) => {
      d.world.restedHours = -0.5;
    });
    expect(() => validateSave(rested, data)).toThrow(/restedHours/i);
    const current = mutate(makeSave(data), (d) => {
      d.world.current = 99;
    });
    expect(() => validateSave(current, data)).toThrow(/current/i);
  });

  it('requires level keys to match indexes and stay within the graph', () => {
    const data = syntheticData();
    const mismatch = mutate(makeSave(data), (d) => {
      const lv = d.levels['0']!;
      delete d.levels['0'];
      d.levels['0'] = { ...lv, index: 1 };
    });
    expect(() => validateSave(mismatch, data)).toThrow(/key must match index/i);
    const beyondGraph = mutate(makeSave(data), (d) => {
      const lv = structuredClone(d.levels['0']!);
      d.levels['99'] = { ...lv, index: 99 };
    });
    expect(() => validateSave(beyondGraph, data)).toThrow(/99|graph|level index/i);
  });

  it('validates entities: bounds, kinds, duplicates, id byte range', () => {
    const data = syntheticData();
    const world = createWorld({
      worldSeed: 7,
      data,
      player: testPlayer(),
    });
    const save = serializeGame(world, { savedAt: '2026-01-01T00:00:00.000Z' });
    const town = save.levels['0']!;
    town.entities = [
      {
        id: 1,
        kind: 'monster',
        name: 'Kobold',
        x: 4,
        y: 3,
        monster: { hp: 9, maxHp: 9, stats: { maxHp: 9, ac: 1, toHit: 1, damage: { count: 1, sides: 4, bonus: 0 }, speed: 1, xp: 5 } },
      },
    ];
    const occupancy = new Uint8Array(4096);
    occupancy[4 + 3 * 64] = 1;
    town.occupancyB64 = bytesToB64(occupancy);

    expect(() => validateSave(save, data)).not.toThrow();

    for (const invalid of [undefined, {}, {maxHp:9,ac:1,toHit:1,speed:1,xp:5}, {maxHp:9,ac:1,toHit:1,speed:0,xp:5,damage:{count:1,sides:4,bonus:0}}]) {
      const malformed=structuredClone(save);
      (malformed.levels['0']!.entities[0]!.monster! as unknown as {stats:unknown}).stats=invalid;
      expect(()=>validateSave(malformed,data)).toThrow(/stats/);
    }

    const dup = structuredClone<SaveFile>(save);
    dup.levels['0']!.entities.push({ ...dup.levels['0']!.entities[0]! });
    expect(() => validateSave(dup, data)).toThrow(/duplicate entity/i);

    const bigId = structuredClone<SaveFile>(save);
    bigId.levels['0']!.entities[0]!.id = 256;
    const occ256 = new Uint8Array(4096);
    occ256[4 + 3 * 64] = 255;
    bigId.levels['0']!.occupancyB64 = bytesToB64(occ256);
    expect(() => validateSave(bigId, data)).toThrow(/entity id/i);

    const badKind = structuredClone<SaveFile>(save);
    (badKind.levels['0']!.entities[0]! as { kind: string }).kind = 'alien';
    expect(() => validateSave(badKind, data)).toThrow(/kind/i);

    const badName = structuredClone<SaveFile>(save);
    (badName.levels['0']!.entities[0]! as { name: unknown }).name = 3;
    expect(() => validateSave(badName, data)).toThrow(/name/i);

    const badMonster = structuredClone<SaveFile>(save);
    badMonster.levels['0']!.entities[0]!.monster!.maxHp = 0;
    expect(() => validateSave(badMonster, data)).toThrow(/maxHp/i);
  });

  it('rejects saves where an entity occupies the player cell on the current level', () => {
    const data = syntheticData();
    const world = createWorld({
      worldSeed: 7,
      data,
      player: testPlayer(),
    });
    const save = serializeGame(world, { savedAt: '2026-01-01T00:00:00.000Z' });
    save.levels['0']!.entities = [
      { id: 1, kind: 'npc', name: 'Snorri', x: 3, y: 3 },
    ];
    const occupancy = new Uint8Array(4096);
    occupancy[3 + 3 * 64] = 1;
    save.levels['0']!.occupancyB64 = bytesToB64(occupancy);
    expect(() => validateSave(save, data)).toThrow(/player.*occup/i);
  });

  it('validates inventory against the item registry', () => {
    const data = syntheticData();
    const unknown = mutate(makeSave(data), (d) => {
      d.inventory.pack.push({ uid: 'i-nope#1', defId: 'i-nope', count: 1 });
    });
    expect(() => validateSave(unknown, data)).toThrow(/i-nope/i);
    const slot = mutate(makeSave(data), (d) => {
      (d.inventory.equipment as Record<string, unknown>).ring3 =
        d.inventory.pack[0] ?? { uid: 'i-long-sword#1', defId: 'i-long-sword', count: 1 };
    });
    expect(() => validateSave(slot, data)).toThrow(/slot|ring3/i);
    const seq = mutate(makeSave(data), (d) => {
      d.inventory.seq = 1;
      d.inventory.pack.push({ uid: 'i-potion#zz', defId: 'i-potion', count: 1 });
    });
    expect(() => validateSave(seq, data)).toThrow(/seq|uid/i);
    const count = mutate(makeSave(data), (d) => {
      d.inventory.pack.push({ uid: 'i-potion#4', defId: 'i-potion', count: 0 });
    });
    expect(() => validateSave(count, data)).toThrow(/count/i);
  });

  it('validates quest state against the quest definitions', () => {
    const data = syntheticData();
    const badQuest = mutate(makeSave(data), (d) => {
      d.world.quests!.questId = 'nope';
    });
    expect(() => validateSave(badQuest, data)).toThrow(/quest.*nope|nope/i);
    const badStage = mutate(makeSave(data), (d) => {
      d.world.quests!.completed['bogus'] = 3;
    });
    expect(() => validateSave(badStage, data)).toThrow(/stage.*bogus|bogus/i);
    const badPending = mutate(makeSave(data), (d) => {
      d.world.quests!.pending.push(42);
    });
    expect(() => validateSave(badPending, data)).toThrow(/pending|story.*42|42/i);
  });

  it('rejects malformed base64 padding before allocation', () => {
    const data = syntheticData();
    for (const bad of ['=AAA', 'A=AA', 'AB=A', 'A===']) {
      const mutated = mutate(makeSave(data), (d) => {
        d.levels['0']!.tilesB64 = bad.repeat(1024);
      });
      expect(() => validateSave(mutated, data), `padding case ${bad}`).toThrow(/padding/i);
    }
  });

  it('rejects planes with the wrong decoded length', () => {
    const data = syntheticData();
    const short = mutate(makeSave(data), (d) => {
      d.levels['0']!.seenB64 = bytesToB64(new Uint8Array(100));
    });
    expect(() => validateSave(short, data)).toThrow(/4096|seen/i);
  });

  it('enforces documented collection limits', () => {
    const data = syntheticData();
    const packOverflow = mutate(makeSave(data), (d) => {
      for (let i = 0; i < 300; i++) {
        d.inventory.pack.push({ uid: `i-potion#${1000 + i}`, defId: 'i-potion', count: 1 });
      }
    });
    expect(() => validateSave(packOverflow, data)).toThrow(/pack.*large|collection limit/i);
    const journalOverflow = mutate(makeSave(data), (d) => {
      for (let i = 0; i < 600; i++) {
        d.world.quests!.journal.push({ turn: 1, questId: 'q', text: `t${i}` });
      }
    });
    expect(() => validateSave(journalOverflow, data)).toThrow(/journal.*large|collection limit/i);
  });
});
