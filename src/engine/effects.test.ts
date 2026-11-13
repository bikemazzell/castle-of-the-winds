import { describe, expect, it } from 'vitest';

import { createCharacter } from './character';
import type { Player, WorldData } from './types';
import {
  applySpellEffect,
  applyStatus,
  hasStatus,
  removeStatus,
  spellEffectSystem,
  statusArmorBonus,
  tickStatuses,
} from './effects';
import { createWorld, dispatch, type World } from './world';
import { monsterCombatStats, spawnMonsterState } from './combat';
import { SLEEP_SPELL_TURNS } from './monsters';
import type { MonsterState } from './types';
import { TILE_FLOOR, TILE_WALL, FLAG_DOOR } from './dungeon';
import { idx, type Entity } from './map';

/** Synthetic world data: town (32×32) + two dungeon levels, spell registry. */
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
      'i-potion-heal': {
        id: 'i-potion-heal',
        name: 'Potion of Heal Minor Wounds',
        kind: 'misc',
        weightGrams: 200,
        slot: null,
        stackable: true,
        consumable: true,
      },
      'i-scroll-light': {
        id: 'i-scroll-light',
        name: 'Scroll of Light',
        kind: 'misc',
        weightGrams: 150,
        slot: null,
        stackable: true,
        consumable: true,
      },
      'i-potion-plain': {
        id: 'i-potion-plain',
        name: 'Potion',
        kind: 'misc',
        weightGrams: 200,
        slot: null,
        stackable: true,
        consumable: true,
      },
      'i-potion-fireball': {
        id: 'i-potion-fireball',
        name: 'Potion of Fireball',
        kind: 'misc',
        weightGrams: 200,
        slot: null,
        stackable: true,
        consumable: true,
      },
    },
    spells: {
      's-light': { id: 's-light', name: 'LIGHT', tier: 1, baseMana: 1, target: 'self', effect: 'light_radius' },
      's-lev': { id: 's-lev', name: 'LEVITATION', tier: 2, baseMana: 2, target: 'self', effect: 'levitation' },
      's-shield': { id: 's-shield', name: 'SHIELD', tier: 1, baseMana: 1, target: 'self', effect: 'shield' },
      's-rf': { id: 's-rf', name: 'RESIST FIRE', tier: 3, baseMana: 3, target: 'self', effect: 'resist', element: 'fire' },
      's-heal1': { id: 's-heal1', name: 'HEAL MINOR WOUNDS', tier: 1, baseMana: 1, target: 'self', effect: 'heal' },
      's-heal3': { id: 's-heal3', name: 'HEAL MEDIUM WOUNDS', tier: 3, baseMana: 3, target: 'self', effect: 'heal' },
      's-np': { id: 's-np', name: 'NEUTRALIZE POISON', tier: 2, baseMana: 3, target: 'self', effect: 'neutralize_poison' },
      's-fireball': { id: 's-fireball', name: 'FIREBALL', tier: 4, baseMana: 5, target: 'enemy', effect: 'ball', element: 'fire' },
      's-tp': { id: 's-tp', name: 'TELEPORT', tier: 3, baseMana: 3, target: 'self', effect: 'teleport_self' },
      's-cv': { id: 's-cv', name: 'CLAIRVOYANCE', tier: 2, baseMana: 3, target: 'self', effect: 'clairvoyance' },
      's-rune': { id: 's-rune', name: 'RUNE OF RETURN', tier: 3, baseMana: 3, target: 'self', effect: 'rune_of_return' },
      's-pd': { id: 's-pd', name: 'PHASE DOOR', tier: 1, baseMana: 1, target: 'self', effect: 'phase_door' },
      's-sleep': { id: 's-sleep', name: 'SLEEP MONSTER', tier: 3, baseMana: 4, target: 'enemy', effect: 'debuff_sleep' },
      's-slow': { id: 's-slow', name: 'SLOW MONSTER', tier: 3, baseMana: 4, target: 'enemy', effect: 'debuff_slow' },
      's-tgm': { id: 's-tgm', name: 'TRANSMOGRIFY MONSTER', tier: 5, baseMana: 6, target: 'enemy', effect: 'transmogrify' },
    },
    monsters: [
      { id: 'm-kobold', name: 'Kobold' },
      { id: 'm-giant', name: 'Hill Giant' },
      { id: 'm-rat', name: 'Giant Rat' },
    ],
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

function newWorld(overrides: Partial<Player> = {}): World {
  return createWorld({
    worldSeed: 42,
    data: syntheticData(),
    player: testPlayer({ hp: 12, maxHp: 24, mana: 20, maxMana: 20, ...overrides }),
  });
}

describe('status model', () => {
  const fullPlayer = (): Player => ({ ...testPlayer(), x: 3, y: 3 });

  it('applies a status and reports it; longer re-application wins', () => {
    const p = fullPlayer();
    applyStatus(p, 'levitation', 100);
    expect(hasStatus(p, 'levitation')).toBe(true);
    applyStatus(p, 'levitation', 50); // shorter: ignored
    expect(p.statuses.find((s) => s.kind === 'levitation')?.remainingTurns).toBe(100);
    applyStatus(p, 'levitation', 200); // longer: replaces
    expect(p.statuses.find((s) => s.kind === 'levitation')?.remainingTurns).toBe(200);
  });

  it('ticks statuses down and removes expired ones', () => {
    const p = fullPlayer();
    applyStatus(p, 'levitation', 5);
    tickStatuses(p, 3);
    expect(hasStatus(p, 'levitation')).toBe(true);
    tickStatuses(p, 2);
    expect(hasStatus(p, 'levitation')).toBe(false);
    expect(p.statuses).toHaveLength(0);
  });

  it('poison deals 1 hp per 10 turns and neutralize removes it', () => {
    const p = fullPlayer();
    p.hp = 20;
    p.maxHp = 20;
    applyStatus(p, 'poison', 30);
    tickStatuses(p, 9);
    expect(p.hp).toBe(20);
    tickStatuses(p, 1);
    expect(p.hp).toBe(19);
    tickStatuses(p, 10);
    expect(p.hp).toBe(18);
    applyStatus(p, 'poison', 30); // refresh
    removeStatus(p, 'poison');
    tickStatuses(p, 50);
    expect(p.hp).toBe(18);
  });

  it('shield statuses contribute their magnitude to armor', () => {
    const p = fullPlayer();
    expect(statusArmorBonus(p)).toBe(0);
    applyStatus(p, 'shield', 400, 4);
    expect(statusArmorBonus(p)).toBe(4);
  });
});

describe('applySpellEffect', () => {
  it('heal restores tier × 8 hp, capped at maxHp', () => {
    const w = newWorld({ hp: 5, maxHp: 60 });
    const r = applySpellEffect(w, syntheticData().spells['s-heal3']!);
    expect(r.ok).toBe(true);
    expect(w.player.hp).toBe(5 + 24); // tier 3 × 8
    const w2 = newWorld({ hp: 20, maxHp: 24 });
    applySpellEffect(w2, syntheticData().spells['s-heal1']!);
    expect(w2.player.hp).toBe(24); // capped
  });

  it('resist/shield/light/levitation apply statuses with magnitudes', () => {
    const w = newWorld();
    applySpellEffect(w, syntheticData().spells['s-rf']!);
    expect(hasStatus(w.player, 'resist_fire')).toBe(true);
    applySpellEffect(w, syntheticData().spells['s-shield']!);
    expect(statusArmorBonus(w.player)).toBe(2); // tier 1 × 2
    applySpellEffect(w, syntheticData().spells['s-light']!);
    expect(hasStatus(w.player, 'light')).toBe(true);
    applySpellEffect(w, syntheticData().spells['s-lev']!);
    expect(hasStatus(w.player, 'levitation')).toBe(true);
  });

  it('attack spells resolve against monsters (Task 4.1) and log original strings', () => {
    const w = newWorld();
    const level = w.levels.get(0)!;
    const stats = monsterCombatStats('Kobold');
    level.entities.set(7, {
      id: 7, kind: 'monster', name: 'Kobold', x: 4, y: 4,
      monster: { hp: 1000, maxHp: 1000, stats },
    });
    level.occupancy[idx(4, 4)] = 7;

    const r = applySpellEffect(w, syntheticData().spells['s-fireball']!, { x: 4, y: 4 });
    expect(r.ok).toBe(true);
    const entity = w.levels.get(0)!.entities.get(7)!;
    // Hit or miss, an original fireball string was logged naming the kobold.
    expect(w.log.some((e) => /fireball/i.test(e.text) && /kobold/i.test(e.text))).toBe(true);
    expect(entity.monster!.hp).toBeLessThanOrEqual(1000);
  });

  it('clairvoyance reveals a 10×10 region into memory', () => {
    const w = newWorld();
    const seen = w.seen.get(0)!;
    const before = seen.reduce((n, v) => n + v, 0);
    const r = applySpellEffect(w, syntheticData().spells['s-cv']!);
    expect(r.ok).toBe(true);
    const after = seen.reduce((n, v) => n + v, 0);
    expect(after).toBeGreaterThan(before);
    // Center of the reveal is the player; a cell 4 away horizontally is remembered.
    expect(seen[idx(w.player.x + 4, w.player.y)]).toBe(1);
  });

  it('teleport moves the player to a walkable tile in the general vicinity', () => {
    const w = newWorld();
    const from = { x: w.player.x, y: w.player.y };
    const r = applySpellEffect(w, syntheticData().spells['s-tp']!);
    expect(r.ok).toBe(true);
    const dist = Math.abs(w.player.x - from.x) + Math.abs(w.player.y - from.y);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThanOrEqual(16); // radius 8 manhattan-ish bound
    expect(w.levels.get(0)!.tiles[idx(w.player.x, w.player.y)]).not.toBe(TILE_WALL);
  });

  it('rune of return teleports to the up-stair; deeper levels without one go to town', () => {
    const w = newWorld();
    // Walk to the mine stair and descend to level 1 (no up stair there).
    for (let i = 0; i < 2; i++) dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });
    for (let i = 0; i < 2; i++) dispatch(w, { type: 'MOVE', dx: 0, dy: 1 });
    expect(w.player).toMatchObject({ x: 5, y: 5 });
    dispatch(w, { type: 'DESCEND' });
    expect(w.current).toBe(1);
    const r = applySpellEffect(w, syntheticData().spells['s-rune']!);
    expect(r.ok).toBe(true);
    expect(w.current).toBe(0); // no up stair on level 1 → town spawn
    expect(w.player).toMatchObject(syntheticData().town.spawn);

    // Level 2 has an up stair: the rune lands the player on it.
    const w2 = newWorld();
    w2.player.x = 5;
    w2.player.y = 5;
    dispatch(w2, { type: 'DESCEND' });
    dispatch(w2, { type: 'DESCEND' });
    expect(w2.current).toBe(2);
    const r2 = applySpellEffect(w2, syntheticData().spells['s-rune']!);
    expect(r2.ok).toBe(true);
    const tile = w2.levels.get(2)!.tiles[idx(w2.player.x, w2.player.y)];
    expect(tile).toBe(0x13); // TILE_STAIRS_UP
  });

  it('phase door converts an adjacent wall into a flagged, walkable door tile', () => {
    const w = newWorld();
    const level = w.levels.get(0)!;
    const wallX = w.player.x - 1; // player at (3,3): (2,3) is wall in the fixture
    const wallY = w.player.y;
    expect(level.tiles[idx(wallX, wallY)]).toBe(TILE_WALL);
    const r = applySpellEffect(w, syntheticData().spells['s-pd']!);
    expect(r.ok).toBe(true);
    expect(level.tiles[idx(wallX, wallY)]).toBe(TILE_FLOOR);
    expect(level.flags[idx(wallX, wallY)]! & FLAG_DOOR).toBeTruthy();
    expect(w.data.tiles[String(level.tiles[idx(wallX, wallY)])]?.walkable).toBe(true);
  });

  it('neutralize poison removes an active poison', () => {
    const w = newWorld();
    applyStatus(w.player, 'poison', 50);
    const r = applySpellEffect(w, syntheticData().spells['s-np']!);
    expect(r.ok).toBe(true);
    expect(hasStatus(w.player, 'poison')).toBe(false);
  });
});

describe('spellEffectSystem (potions + scrolls)', () => {
  it('scrolls teach spells with the original learn message', () => {
    const w = newWorld();
    const sys = spellEffectSystem();
    expect(w.player.knownSpells).not.toContain('s-light');
    const effect = sys.onUse(w, { uid: 'x#0', defId: 'i-scroll-light', count: 1 }, w.data.items['i-scroll-light']!);
    expect(effect?.consumed).toBe(true);
    expect(effect?.message).toBe('You learn the spell of LIGHT.');
    expect(w.player.knownSpells).toContain('s-light');
  });

  it('already-known scrolls are consumed with a different message', () => {
    const w = newWorld();
    w.player.knownSpells.push('s-light');
    const sys = spellEffectSystem();
    const effect = sys.onUse(w, { uid: 'x#0', defId: 'i-scroll-light', count: 1 }, w.data.items['i-scroll-light']!);
    expect(effect?.consumed).toBe(true);
    expect(effect?.message).toMatch(/already know/i);
  });

  it('heal potions restore hp and are consumed', () => {
    const w = newWorld({ hp: 5, maxHp: 24 });
    const sys = spellEffectSystem();
    const effect = sys.onUse(w, { uid: 'x#0', defId: 'i-potion-heal', count: 1 }, w.data.items['i-potion-heal']!);
    expect(effect?.consumed).toBe(true);
    expect(w.player.hp).toBe(5 + 8); // tier 1 × 8
  });

  it('generic potions and attack potions do nothing', () => {
    const w = newWorld();
    const sys = spellEffectSystem();
    expect(sys.onUse(w, { uid: 'x#0', defId: 'i-potion-plain', count: 1 }, w.data.items['i-potion-plain']!)).toBeNull();
    expect(sys.onUse(w, { uid: 'x#1', defId: 'i-potion-fireball', count: 1 }, w.data.items['i-potion-fireball']!)).toBeNull();
  });
});

describe('world integration (CAST + USE with real effects)', () => {
  it('CAST LIGHT deducts mana, applies the status and consumes a turn', () => {
    const w = newWorld({ mana: 10, maxMana: 10 });
    w.player.knownSpells.push('s-light');
    dispatch(w, { type: 'CAST', spellId: 's-light' });
    expect(w.player.mana).toBe(9); // tier 1, caster level 1 → cost 1
    expect(w.turn).toBe(1);
    expect(hasStatus(w.player, 'light')).toBe(true);
  });

  it('CAST rejects unlearned spells and unknown ids without a turn', () => {
    const w = newWorld({ mana: 10, maxMana: 10 });
    dispatch(w, { type: 'CAST', spellId: 's-light' });
    expect(w.turn).toBe(0);
    expect(w.player.mana).toBe(10);
    expect(w.log.at(-1)?.text).toMatch(/learn/i);
    dispatch(w, { type: 'CAST', spellId: 's-nope' });
    expect(w.turn).toBe(0);
    expect(w.log.at(-1)?.text).toMatch(/unknown/i);
  });

  it('attack spells with no target fail without mana or turn', () => {
    const w = newWorld({ mana: 10, maxMana: 10 });
    w.player.knownSpells.push('s-fireball');
    dispatch(w, { type: 'CAST', spellId: 's-fireball' });
    expect(w.turn).toBe(0);
    expect(w.player.mana).toBe(10);
    expect(w.log.at(-1)?.text).toMatch(/needs a target/i);
  });

  it('CAST on FIREBALL with a target damages the monster and spends mana', () => {
    const w = newWorld({ mana: 10, maxMana: 10 });
    w.player.knownSpells.push('s-fireball');
    const level = w.levels.get(0)!;
    const stats = monsterCombatStats('Kobold');
    level.entities.set(7, {
      id: 7, kind: 'monster', name: 'Kobold', x: 4, y: 4,
      monster: { hp: 1000, maxHp: 1000, stats },
    });
    level.occupancy[idx(4, 4)] = 7;

    dispatch(w, { type: 'CAST', spellId: 's-fireball', target: { x: 4, y: 4 } });

    expect(w.turn).toBe(1);
    expect(w.player.mana).toBe(10 - 8); // spellManaCost(5, tier 4, level 1) = 8
    const entity = w.levels.get(0)!.entities.get(7)!;
    expect(entity.monster!.hp).toBeLessThan(1000);
    expect(w.log.some((e) => /fireball/i.test(e.text))).toBe(true);
  });

  it('USE on a heal potion heals, consumes the stack and takes a turn', () => {
    const w = newWorld({ hp: 6, maxHp: 24 });
    dispatch(w, { type: 'PICKUP', defId: 'i-potion-heal', count: 2 });
    const uid = w.inventory.pack[0]!.uid;
    dispatch(w, { type: 'USE', uid });
    expect(w.player.hp).toBe(6 + 8);
    expect(w.inventory.pack[0]!.count).toBe(1);
    expect(w.turn).toBe(2); // pickup turn + use turn
  });

  it('reading a scroll then casting works end to end', () => {
    const w = newWorld({ mana: 10, maxMana: 10 });
    dispatch(w, { type: 'PICKUP', defId: 'i-scroll-light' });
    const uid = w.inventory.pack[0]!.uid;
    dispatch(w, { type: 'USE', uid });
    expect(w.player.knownSpells).toContain('s-light');
    dispatch(w, { type: 'CAST', spellId: 's-light' });
    expect(w.player.mana).toBe(9);
    expect(hasStatus(w.player, 'light')).toBe(true);
  });

  it('levitation expires after its duration of turns', () => {
    const w = newWorld({ mana: 10, maxMana: 10 });
    w.player.knownSpells.push('s-lev');
    dispatch(w, { type: 'CAST', spellId: 's-lev' });
    expect(hasStatus(w.player, 'levitation')).toBe(true);
    const remaining = w.player.statuses.find((s) => s.kind === 'levitation')!.remainingTurns;
    for (let i = 0; i < remaining; i++) dispatch(w, { type: 'WAIT' });
    expect(hasStatus(w.player, 'levitation')).toBe(false);
  });
});

// ─── Debuff spells (Task 4.2) ────────────────────────────────────────────────

describe('debuff spells', () => {
  function worldWithMonster(): { world: World; monster: Entity & { monster: MonsterState } } {
    const world = newWorld();
    const level = world.levels.get(0)!;
    level.entities.set(1, {
      id: 1,
      kind: 'monster',
      name: 'Kobold',
      x: 5,
      y: 4,
      monster: { ...spawnMonsterState('Kobold') },
    });
    level.occupancy[idx(5, 4)] = 1;
    return { world, monster: level.entities.get(1) as Entity & { monster: MonsterState } };
  }

  it('Sleep Monster enchants the target for the documented 10 minutes', () => {
    const { world, monster } = worldWithMonster();
    const def = world.data.spells['s-sleep']!;
    const result = applySpellEffect(world, def, { x: 5, y: 4 });
    expect(result.ok).toBe(true);
    expect(monster.monster.sleepTurns).toBe(SLEEP_SPELL_TURNS);
  });

  it('Sleep requires a monster on the target cell', () => {
    const world = newWorld();
    const def = world.data.spells['s-sleep']!;
    expect(applySpellEffect(world, def).ok).toBe(false);
    expect(applySpellEffect(world, def, { x: 4, y: 4 }).ok).toBe(false);
  });

  it('Slow Monster stacks denominators (1/2, then 1/3)', () => {
    const { world, monster } = worldWithMonster();
    const def = world.data.spells['s-slow']!;
    applySpellEffect(world, def, { x: 5, y: 4 });
    expect(monster.monster.slowDenominator).toBe(2);
    applySpellEffect(world, def, { x: 5, y: 4 });
    expect(monster.monster.slowDenominator).toBe(3);
  });

  it('Transmogrify changes the monster, preserving injury', () => {
    const { world, monster } = worldWithMonster();
    monster.monster.hp = 3; // one third of 9
    const def = world.data.spells['s-tgm']!;
    const result = applySpellEffect(world, def, { x: 5, y: 4 });
    expect(result.ok).toBe(true);
    expect(monster.name).not.toBe('Kobold');
    expect(monster.monster.hp).toBe(Math.max(1, Math.round(monster.monster.maxHp / 3)));
    expect(monster.monster.sleepTurns).toBeUndefined();
  });

  it('quest bosses resist transmogrify and stay unchanged (PART2 Task P2)', () => {
    const { world, monster } = worldWithMonster();
    monster.name = 'The Demon Lord Surtur';
    world.data.quests = [
      {
        id: 'q', title: 'Q', stages: [],
        bosses: [{ level: 25, monster: 'The Demon Lord Surtur', guards: [] }],
        bossRosterExclusions: ['Surtur', 'The Demon Lord Surtur'],
      },
    ];
    const nameBefore = monster.name;
    const hpBefore = monster.monster.hp;
    const def = world.data.spells['s-tgm']!;
    const result = applySpellEffect(world, def, { x: 5, y: 4 });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/resists the spell!/i);
    expect(monster.name).toBe(nameBefore);
    expect(monster.monster.hp).toBe(hpBefore);
  });

  it('transmogrify never produces a boss identity from the pool (PART2 Task P2)', () => {
    const { world, monster } = worldWithMonster();
    world.data.monsters = [
      ...(world.data.monsters ?? []),
      { id: 'm-surtur', name: 'Surtur' },
      { id: 'm-king', name: 'Utgardhalok, The Hill Giant King' },
    ];
    world.data.quests = [
      {
        id: 'q', title: 'Q', stages: [],
        bosses: [{ level: 25, monster: 'The Demon Lord Surtur', guards: [] }],
        bossRosterExclusions: ['Surtur', 'The Demon Lord Surtur', 'Utgardhalok, The Hill Giant King'],
      },
    ];
    const def = world.data.spells['s-tgm']!;
    // Keep casting while the monster is still Kobold — each cast re-rolls the
    // (boss-filtered) pool, so it must eventually transform to a non-boss.
    for (let i = 0; i < 60 && monster.name === 'Kobold'; i++) {
      const r = applySpellEffect(world, def, { x: 5, y: 4 });
      expect(r.ok).toBe(true);
      expect(monster.name).not.toBe('Surtur');
      expect(monster.name).not.toBe('Utgardhalok, The Hill Giant King');
    }
    expect(monster.name).not.toBe('Kobold'); // a transform DID happen (pool not empty)
  });

  it('CAST Sleep Monster spends mana and a turn', () => {
    const { world, monster } = worldWithMonster();
    world.player.knownSpells = ['s-sleep'];
    world.player.mana = 10;
    dispatch(world, { type: 'CAST', spellId: 's-sleep', target: { x: 5, y: 4 } });
    expect(monster.monster.sleepTurns).toBe(SLEEP_SPELL_TURNS);
    expect(world.player.mana).toBeLessThan(10);
    expect(world.turn).toBe(1);
  });
});
it('Rune of Return rejects an occupied stair without moving the hero',()=>{
 const w=newWorld();const level=w.levels.get(0)!;
 level.tiles[idx(6,6)]=0x13;level.occupancy[idx(6,6)]=1;
 const before={x:w.player.x,y:w.player.y};
 const result=applySpellEffect(w,syntheticData().spells['s-rune']!);
 expect(result.ok).toBe(false);expect(result.message).toMatch(/occupied/i);
 expect({x:w.player.x,y:w.player.y}).toEqual(before);
});
