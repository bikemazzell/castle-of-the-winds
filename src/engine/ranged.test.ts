import { describe, expect, it } from 'vitest';
import { createCharacter } from './character';
import { playerAttack, playerCombatant, spawnMonsterState } from './combat';
import { idx } from './map';
import { MSLCG } from './rng';
import { createWorld } from './world';
import { EXPANSION_WEAPONS, fireWeapon, rangedProfile } from './ranged';

function fixture(weapon = 'x-bow', ammo = 'x-arrow') {
  const world = createWorld({ worldSeed: 1, data: {
    part: 1, levels: [{ index: 0, name: 'Town', kind: 'town', links: { up: null, down: null } }],
    town: { rows: Array.from({ length: 32 }, () => '01'.repeat(32)), spawn: { x: 3, y: 3 }, mineEntrance: { x: 3, y: 3 } },
    tiles: { 0: { walkable: false }, 1: { walkable: true }, 2: { walkable: false } },
    items: EXPANSION_WEAPONS, spells: {},
    quests: [{ id: 'boss', title: 'Boss', stages: [{ id: 'kill', trigger: { kind: 'monster-killed', name: 'Hrungnir' }, journalText: 'Victory.' }] }],
  }, player: createCharacter({ name: 'Archer', gender: 'female', strength: 50, intelligence: 50, constitution: 50, dexterity: 50, difficulty: 'intermediate' }) });
  world.inventory.equipment.weapon = { uid: 'weapon', defId: weapon, count: 1 };
  world.inventory.pack = [{ uid: 'ammo', defId: ammo, count: 2 }];
  world.visible.fill(1);
  world.rng = new MSLCG(1);
  const level = world.levels.get(world.current)!;
  const enemy = { id: 7, kind: 'monster' as const, name: 'Hrungnir', x: 5, y: 3, monster: spawnMonsterState('Hrungnir') };
  enemy.monster.stats.ac = -10;
  enemy.monster.hp = 100;
  level.entities.set(7, enemy);
  level.occupancy[idx(5, 3)] = 7;
  return { world, level, enemy };
}

function snapshot(world: ReturnType<typeof fixture>['world']) {
  return JSON.stringify(world, (_key, value: unknown) => value instanceof Map ? [...value] : value);
}

describe('ranged combat', () => {
  it('defines all ten weapons and ammo without turning the club into a ranged weapon', () => {
    expect(Object.keys(EXPANSION_WEAPONS)).toHaveLength(10);
    expect(rangedProfile('x-bone-club')).toBeUndefined();
    expect(rangedProfile('unknown')).toBeUndefined();
    expect(rangedProfile('x-bow')?.range).toBe(6);
    expect(rangedProfile('x-crossbow')?.range).toBe(7);
  });

  it.each([['x-bow', 'x-arrow'], ['x-crossbow', 'x-bolt'], ['x-hand-cannon', 'x-cannonball']])('fires %s with the matching ammo', (weapon, ammo) => {
    const { world, enemy } = fixture(weapon, ammo);
    expect(fireWeapon(world, enemy).ok).toBe(true);
    expect(world.inventory.pack[0]?.count).toBe(1);
    expect(enemy.monster.hp).toBeLessThan(100);
    expect(world.turn).toBe(0);
  });

  it.each(['invisible', 'wall', 'door', 'range', 'empty', 'npc', 'ammo', 'bad uid', 'fractional', 'self', 'intervening npc'])('rejects %s without changing any state', (reason) => {
    const { world, level, enemy } = fixture();
    let target = { x: enemy.x, y: enemy.y };
    if (reason === 'invisible') world.visible[idx(5, 3)] = 0;
    if (reason === 'wall') level.tiles[idx(4, 3)] = 0;
    if (reason === 'door') level.tiles[idx(4, 3)] = 2;
    if (reason === 'range') target = { x: 20, y: 3 };
    if (reason === 'empty') target = { x: 6, y: 3 };
    if (reason === 'npc') level.entities.set(7, { ...enemy, kind: 'npc' });
    if (reason === 'ammo') world.inventory.pack[0]!.defId = 'x-bolt';
    if (reason === 'fractional') target.x = 5.5;
    if (reason === 'self') target = { x: 3, y: 3 };
    if (reason === 'intervening npc') { level.entities.set(8, { id: 8, kind: 'npc', name: 'Friend', x: 4, y: 3 }); level.occupancy[idx(4, 3)] = 8; }
    const before = snapshot(world);
    expect(fireWeapon(world, target, reason === 'bad uid' ? 'missing' : undefined).ok).toBe(false);
    expect(snapshot(world)).toBe(before);
  });

  it.each(['x-rock', 'x-bone'])('throws the selected %s without using the equipped launcher', (defId) => {
    const { world, enemy } = fixture();
    world.inventory.pack = [{ uid: 'thrown', defId, count: 1 }];
    expect(fireWeapon(world, enemy, 'thrown').ok).toBe(true);
    expect(world.inventory.pack).toHaveLength(0);
    expect(world.inventory.equipment.weapon?.defId).toBe('x-bow');
  });

  it('whip reaches two cells without consuming equipment', () => {
    const { world, enemy } = fixture('x-whip');
    world.inventory.pack = [];
    expect(fireWeapon(world, enemy).ok).toBe(true);
    expect(world.inventory.equipment.weapon?.count).toBe(1);
  });

  it('uses projectile damage rather than the held weapon damage for throws', () => {
    const { world, enemy } = fixture('x-hand-cannon');
    world.inventory.pack = [{ uid: 'rock', defId: 'x-rock', count: 1 }];
    const rng = new MSLCG(1);
    rng.rand(20);
    const damage = rng.rand(4) + 1;
    fireWeapon(world, enemy, 'rock');
    expect(enemy.monster.hp).toBe(100 - damage);
  });

  it('shares death, XP, loot, and boss quest handling with ordinary combat', () => {
    const { world, enemy, level } = fixture();
    const other = fixture();
    enemy.monster.hp = other.enemy.monster.hp = 1;
    const attacker = playerCombatant(other.world);
    attacker.damage = { count: 1, sides: 6, bonus: attacker.damage.bonus };
    playerAttack(other.world, other.enemy.id, attacker);
    expect(fireWeapon(world, enemy).ok).toBe(true);
    expect(level.entities.has(enemy.id)).toBe(false);
    expect(level.occupancy[idx(5, 3)]).toBe(0);
    expect(world.player.experience).toBe(other.world.player.experience);
    expect(world.inventory.gold).toBe(other.world.inventory.gold);
    expect(world.questState?.completed.kill).toBe(0);
    expect(world.questState).toEqual(other.world.questState);
    expect(world.rng.getState()).toBe(other.world.rng.getState());
  });

  it('the cannon wakes nearby monsters even on a miss', () => {
    const { world, enemy, level } = fixture('x-hand-cannon', 'x-cannonball');
    enemy.monster.stats.ac = 100;
    const nearby = { id: 8, kind: 'monster' as const, name: 'Rat', x: 10, y: 3, monster: spawnMonsterState('Rat') };
    nearby.monster.sleepTurns = 10;
    level.entities.set(8, nearby);
    expect(fireWeapon(world, enemy).ok).toBe(true);
    expect(nearby.monster.alert).toBe(true);
    expect(nearby.monster.sleepTurns).toBe(0);
  });
});

it('stacked crash and sedation cannot heal a monster with a thrown bone', () => {
  const { world, enemy } = fixture();
  world.player.statuses = [
    { kind: 'crash', remainingTurns: 4 },
    { kind: 'sedated', remainingTurns: 4 },
  ];
  enemy.monster.stats.ac = -20;
  world.inventory.pack = [{ uid: 'bone', defId: 'x-bone', count: 1 }];
  expect(fireWeapon(world, enemy, 'bone').ok).toBe(true);
  expect(enemy.monster.hp).toBe(100);
  expect(world.inventory.pack).toHaveLength(0);
  expect(enemy.monster.alert).toBe(true);
});

it.each([['x-bow', 4], ['x-whip', 4], ['x-bow', 5], ['x-whip', 5]] as const)('%s cannot cross a closed corner at cell %i', (weapon, coordinate) => {
  const { world, level, enemy } = fixture(weapon);
  level.occupancy[idx(enemy.x, enemy.y)] = 0;
  enemy.x = coordinate;
  enemy.y = coordinate;
  level.occupancy[idx(coordinate, coordinate)] = enemy.id;
  level.tiles[idx(coordinate, coordinate - 1)] = 0;
  level.tiles[idx(coordinate - 1, coordinate)] = 2;
  const before = snapshot(world);
  expect(fireWeapon(world, enemy)).toEqual({ ok: false, message: 'Something blocks the shot.' });
  expect(snapshot(world)).toBe(before);
});

it('allows a diagonal shot past a single wall when the other side is clear', () => {
  const { world, level, enemy } = fixture();
  level.occupancy[idx(enemy.x, enemy.y)] = 0;
  enemy.x = 4;
  enemy.y = 4;
  level.occupancy[idx(4, 4)] = enemy.id;
  level.tiles[idx(4, 3)] = 0;
  expect(fireWeapon(world, enemy).ok).toBe(true);
});
