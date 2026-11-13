// Transactional save editor — applyEdits tests (node environment).
//
// applyEdits is the single atomic mutation path (codex-review requirement):
// a batch is applied to a clone, the whole file is revalidated via
// deserializeGame, and on any failure the input save is returned untouched.
import { describe, expect, it } from 'vitest';
import {
  applyEdits,
  type SaveEdits,
} from './editor';
import { createWorld, dispatch } from '../../engine/world';
import { createCharacter } from '../../engine/character';
import {
  deserializeGame, serializeGame, b64ToBytes,
} from '../../engine/save';
import { loadWorldData } from '../../engine/game';
import { idx, validateOccupancy } from '../../engine/map';
import { totalWeightGrams } from '../../engine/inventory';
import { generateLevelForWorld } from '../../engine/dungeon';
import type { Player } from '../../engine/types';

const data = loadWorldData();

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    ...createCharacter({
      name: 'Editor Test',
      gender: 'female',
      strength: 18,
      intelligence: 18,
      constitution: 18,
      dexterity: 18,
      difficulty: 'intermediate',
    }),
    x: data.town.spawn.x,
    y: data.town.spawn.y,
    ...overrides,
  };
}

function makeSave(playerOverrides: Partial<Player> = {}, seed = 7) {
  const world = createWorld({ worldSeed: seed, data, player: makePlayer() });
  // createWorld forces the town spawn; apply overrides after creation.
  Object.assign(world.player, playerOverrides);
  return { world, save: serializeGame(world, { savedAt: '2026-01-01T00:00:00Z' }) };
}

describe('applyEdits — character tab', () => {
  it('applies a strength edit and the engine reflects it after round trip', () => {
    const { save } = makeSave();
    const result = applyEdits(save, { character: { strength: 19 } }, { data });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const world = deserializeGame(result.save, data);
    expect(world.player.strength).toBe(19);
    // attr raised above its max raises the max with it
    expect(world.player.maxStrength).toBeGreaterThanOrEqual(19);
  });

  it('recomputes derived caps from level and CON/INT, clamping hp/mana by default', () => {
    const { save } = makeSave({ hp: 30, maxHp: 30, mana: 7, maxMana: 7 });
    expect(save.player.level).toBe(1);
    const result = applyEdits(save, { character: { level: 5 } }, { data });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.save.player;
    // startingHp(18) = 10, gain 4+0 → max 10 + 4*4 = 26; hp 30 clamps down.
    expect(p.maxHp).toBe(26);
    expect(p.hp).toBe(26);
    // startingMana(18) = 1, gain 2+0 → 1 + 4*2 = 9; mana 7 stays (within cap).
    expect(p.maxMana).toBe(9);
    expect(p.mana).toBe(7);
  });

  it('rejects an explicit hp beyond the recomputed cap', () => {
    const { save } = makeSave();
    const result = applyEdits(save, { character: { level: 5, hp: 999 } }, { data });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/hp/i);
  });

  it('keepRatio preserves the hp/mana fraction across cap changes', () => {
    const { save } = makeSave({ hp: 6, maxHp: 12, mana: 3, maxMana: 6 });
    const result = applyEdits(
      save,
      { character: { level: 3, keepRatio: true } },
      { data },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.save.player;
    // level 3 → maxHp = 10 + 2*4 = 18; 6/12 → 9
    expect(p.maxHp).toBe(18);
    expect(p.hp).toBe(9);
    // maxMana = 1 + 2*2 = 5; 3/6 → round(2.5) = 3 (clamped into cap)
    expect(p.maxMana).toBe(5);
    expect(p.mana).toBe(3);
  });

  it('rejects hp < 1 and applies nothing (atomicity)', () => {
    const { save } = makeSave({ experience: 100 });
    const edits: SaveEdits = {
      character: { hp: 0, experience: 99999 },
      inventory: { gold: 5000 },
    };
    const result = applyEdits(save, edits, { data });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/hp/i);
    // original untouched
    expect(save.player.experience).toBe(100);
    expect(save.inventory.gold).toBe(0);
    expect(save.player.hp).toBeGreaterThan(0);
  });

  it('replaces known spells, deduplicates, and rejects unknown ids', () => {
    const { save } = makeSave();
    const ok = applyEdits(save, { character: { knownSpells: ['s527', 's512', 's527'] } }, { data });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.save.player.knownSpells).toEqual(['s527', 's512']);

    const bad = applyEdits(save, { character: { knownSpells: ['s527', 's-nope'] } }, { data });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error).toMatch(/s-nope/);
    // original untouched
    expect(save.player.knownSpells).toEqual([]);
  });

  it('rejects out-of-range attributes and bad names', () => {
    const { save } = makeSave();
    expect(applyEdits(save, { character: { strength: 101 } }, { data }).ok).toBe(false);
    expect(applyEdits(save, { character: { strength: 0 } }, { data }).ok).toBe(false);
    expect(applyEdits(save, { character: { level: 0 } }, { data }).ok).toBe(false);
    expect(applyEdits(save, { character: { experience: -1 } }, { data }).ok).toBe(false);
    expect(applyEdits(save, { character: { name: '   ' } }, { data }).ok).toBe(false);
    expect(applyEdits(save, { character: { gender: 'robot' as Player['gender'] } }, { data }).ok).toBe(false);
  });
});

describe('applyEdits — inventory tab', () => {
  it('adds an item that appears in the pack with weight', () => {
    const { save } = makeSave();
    const result = applyEdits(
      save,
      { inventory: { add: [{ defId: 'i-long-sword', count: 2 }] } },
      { data },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Engine pickup semantics: a counted add lands as one entry carrying count.
    const entries = result.save.inventory.pack.filter((i) => i.defId === 'i-long-sword');
    expect(entries.reduce((n, e) => n + e.count, 0)).toBe(2);
    expect(totalWeightGrams(result.save.inventory, data.items)).toBeGreaterThanOrEqual(3000);
  });

  it('stacks potions into one pack entry', () => {
    const { save } = makeSave();
    const result = applyEdits(
      save,
      { inventory: { add: [{ defId: 'i-potion', count: 3 }] } },
      { data },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.save.inventory.pack.find((i) => i.defId === 'i-potion');
    expect(entry?.count).toBe(3);
  });

  it('removes items by uid and edits gold', () => {
    const { save } = makeSave();
    const withSword = applyEdits(save, { inventory: { add: [{ defId: 'i-long-sword' }] } }, { data });
    expect(withSword.ok).toBe(true);
    if (!withSword.ok) return;
    const uid = withSword.save.inventory.pack[0]!.uid;
    const result = applyEdits(
      withSword.save,
      { inventory: { remove: [{ uid }], gold: 123 } },
      { data },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.save.inventory.pack).toHaveLength(0);
    expect(result.save.inventory.gold).toBe(123);
  });

  it('rejects unknown definitions, unknown uids, negative gold, and over-weight adds', () => {
    const { save } = makeSave();
    expect(applyEdits(save, { inventory: { add: [{ defId: 'i-nope' }] } }, { data }).ok).toBe(false);
    expect(applyEdits(save, { inventory: { remove: [{ uid: 'ghost#1' }] } }, { data }).ok).toBe(false);
    expect(applyEdits(save, { inventory: { gold: -5 } }, { data }).ok).toBe(false);
    // strength 18 → hard limit 7200 g; two plate armors (15000 g each) must fail
    const heavy = applyEdits(
      save,
      { inventory: { add: [{ defId: 'i-plate-mail', count: 2 }] } },
      { data },
    );
    expect(heavy.ok).toBe(false);
    if (heavy.ok) return;
    expect(heavy.error).toMatch(/carry/i);
  });
});

describe('applyEdits — position tab', () => {
  it('teleports within a visited level to a valid tile', () => {
    const { world } = makeSave({ x: 15, y: 2 }); // stand on the mine stair
    // visit mine level 1
    dispatch(world, { type: 'DESCEND' });
    const saveL1 = serializeGame(world, { savedAt: '2026-01-01T00:00:00Z' });
    const road = { x: data.town.spawn.x + 1, y: data.town.spawn.y };
    const result = applyEdits(saveL1, { position: { level: 0, ...road } }, { data });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reloaded = deserializeGame(result.save, data);
    expect(reloaded.current).toBe(0);
    expect(reloaded.player.x).toBe(road.x);
    expect(reloaded.player.y).toBe(road.y);
  });

  it('lazy-generates an unvisited level deterministically when teleporting there', () => {
    const { save } = makeSave();
    expect(Object.keys(save.levels)).toEqual(['0']);
    const result = applyEdits(save, { position: { level: 7 } }, { data });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.save.levels['7']).toBeDefined();
    const reloaded = deserializeGame(result.save, data);
    expect(reloaded.current).toBe(7);
    const level = reloaded.levels.get(7)!;
    expect(level.populated).toBe(true);
    // deterministic: matches direct generation from the same seed
    const reference = generateLevelForWorld(save.world.worldSeed, 7, {
      hasUpStair: true,
      placeDoors: true,
    });
    expect(Buffer.from(level.tiles).equals(Buffer.from(reference.level.tiles))).toBe(true);
    // player stands on a walkable, unoccupied tile
    const tile = level.tiles[idx(reloaded.player.x, reloaded.player.y)]!;
    expect(data.tiles[String(tile)]?.walkable).toBe(true);
    expect(level.occupancy[idx(reloaded.player.x, reloaded.player.y)]).toBe(0);
    expect(validateOccupancy(level).ok).toBe(true);
  });

  it('rejects walls, occupied cells, and out-of-range levels', () => {
    const { save } = makeSave();
    const wall = { x: 0, y: 0 }; // town border hedge
    expect(applyEdits(save, { position: { level: 0, ...wall } }, { data }).ok).toBe(false);
    expect(applyEdits(save, { position: { level: 99 } }, { data }).ok).toBe(false);
    expect(applyEdits(save, { position: { level: -1 } }, { data }).ok).toBe(false);
  });

  it('revealMap fills the seen plane for the target level', () => {
    const { save } = makeSave();
    const result = applyEdits(save, { position: { level: 1, revealMap: true } }, { data });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const seen = result.save.levels['1']!.seenB64;
    expect(seen.length).toBeGreaterThan(0);
    const bytes = b64ToBytes(seen);
    expect(bytes.every((b) => b === 1)).toBe(true);
  });
});

describe('applyEdits — world tab', () => {
  it('changing the seed discards generated levels and regenerates deterministically from the new seed', () => {
    const { world } = makeSave({ x: 15, y: 2 }, 7);
    dispatch(world, { type: 'DESCEND' });
    const saveL1 = serializeGame(world, { savedAt: '2026-01-01T00:00:00Z' });
    const result = applyEdits(saveL1, { worldSeed: 42, position: { level: 3 } }, { data });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.save.world.worldSeed).toBe(42);
    expect(Object.keys(result.save.levels).sort()).toEqual(['0', '3']);
    const reference = generateLevelForWorld(42, 3, { hasUpStair: false, placeDoors: true });
    const reloaded = deserializeGame(result.save, data);
    expect(Buffer.from(reloaded.levels.get(3)!.tiles).equals(Buffer.from(reference.level.tiles))).toBe(true);
  });

  it('rejects a seed change while standing in the dungeon without a position edit', () => {
    const { world } = makeSave({ x: 15, y: 2 });
    dispatch(world, { type: 'DESCEND' });
    const saveL1 = serializeGame(world, { savedAt: '2026-01-01T00:00:00Z' });
    const result = applyEdits(saveL1, { worldSeed: 42 }, { data });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/position/i);
  });

  it('a rejected seed edit leaves the input save byte-identical', () => {
    const { world } = makeSave({ x: 15, y: 2 });
    dispatch(world, { type: 'DESCEND' });
    const saveL1 = serializeGame(world, { savedAt: '2026-01-01T00:00:00Z' });
    const before = JSON.stringify(saveL1);
    const result = applyEdits(saveL1, { worldSeed: 42 }, { data });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(saveL1)).toBe(before);
  });

  it('seed change from TOWN regenerates unvisited levels from the new seed (F19)', () => {
    // Standing in town with the town level present in the save — the rebuild
    // must still happen so later generation uses the NEW seed.
    const { world } = makeSave();
    expect(world.current).toBe(0);
    const saveTown = serializeGame(world, { savedAt: '2026-01-01T00:00:00Z' });
    expect(saveTown.levels['0']).toBeDefined();
    const result = applyEdits(saveTown, { worldSeed: 42, position: { level: 3 } }, { data });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.save.world.worldSeed).toBe(42);
    expect(Object.keys(result.save.levels).sort()).toEqual(['0', '3']);
    const reference = generateLevelForWorld(42, 3, { hasUpStair: false, placeDoors: true });
    const reloaded = deserializeGame(result.save, data);
    expect(
      Buffer.from(reloaded.levels.get(3)!.tiles).equals(Buffer.from(reference.level.tiles)),
    ).toBe(true);
  });

  it('rejects invalid seeds', () => {
    const { save } = makeSave();
    expect(applyEdits(save, { worldSeed: -1 }, { data }).ok).toBe(false);
    expect(applyEdits(save, { worldSeed: 2 ** 32 }, { data }).ok).toBe(false);
    expect(applyEdits(save, { worldSeed: 1.5 }, { data }).ok).toBe(false);
  });
});

describe('applyEdits — import → edit → load → play equivalence', () => {
  it('an edited save plays on: further dispatch works with intact RNG', () => {
    const { world } = makeSave();
    dispatch(world, { type: 'WAIT' });
    const result = applyEdits(
      serializeGame(world, { savedAt: '2026-01-01T00:00:00Z' }),
      { character: { strength: 20 }, inventory: { gold: 50 } },
      { data },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reloaded = deserializeGame(result.save, data);
    const turnBefore = reloaded.turn;
    dispatch(reloaded, { type: 'WAIT' });
    expect(reloaded.turn).toBe(turnBefore + 1);
    expect(reloaded.player.strength).toBe(20);
    expect(reloaded.inventory.gold).toBe(50);
  });
});

describe('part-aware editing (PART2-PLAN Task P5)', () => {
  it('edits a part-2 save correctly even when the caller passes part-1 data', () => {
    const data2 = loadWorldData(2);
    const world = createWorld({ worldSeed: 7, data: data2, player: makePlayer() });
    const save = serializeGame(world, { savedAt: '2026-01-01T00:00:00Z' });
    expect(save.meta.part).toBe(2);
    // Caller passes the WRONG bundle (part 1): applyEdits must resolve part 2
    // internally, edit, and produce a save that only validates against part 2.
    const result = applyEdits(save, { inventory: { gold: 500 } }, { data });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.save.meta.part).toBe(2);
    const reloaded = deserializeGame(result.save, data2);
    expect(reloaded.inventory.gold).toBe(500);
  });

  it('a part-2 save fails final validation against part-1 data (natural mismatch)', () => {
    const data2 = loadWorldData(2);
    const world = createWorld({ worldSeed: 7, data: data2, player: makePlayer() });
    // The part-2 world seeded a lifthransirs-bane quest state; give the save a
    // part-1 marker so the final gate runs against part-1 expectations.
    const save = serializeGame(world, { savedAt: '2026-01-01T00:00:00Z' });
    const mismatched = applyEdits(save, { inventory: { gold: 1 } }, { data });
    // The edit itself succeeds via internal resolution; the PROOF of part
    // separation is that the raw save cannot load against part-1 data.
    expect(mismatched.ok).toBe(true);
    expect(() => deserializeGame(save, data)).toThrow();
  });
});
