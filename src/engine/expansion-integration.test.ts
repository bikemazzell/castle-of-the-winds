import { expect, it } from 'vitest';
import { newWorld, loadWorldData } from './game';
import { dispatch } from './world';
import { pickup, equip } from './inventory';
import { idx } from './map';
import { spawnMonsterState } from './combat';
const init = { name: 'Tester', gender: 'male' as const, strength: 50, intelligence: 50, constitution: 50, dexterity: 50, difficulty: 'intermediate' as const };
it.each([1, 2] as const)('ships new equipment and spell scrolls in part %s', part => {
  const data = loadWorldData(part);
  expect(data.items['x-bow']).toBeDefined();
  expect(data.items['x-mead']).toBeDefined();
  expect(Object.values(data.spells).some(s => s.id.startsWith('x-'))).toBe(true);
});
it('fires an equipped bow through the world action and spends exactly one turn', () => {
  const world = newWorld({ worldSeed: 42, player: init });
  const bow = pickup(world.inventory, world.player, 'x-bow', world.data.items);
  equip(world.inventory, world.player, bow.uid, world.data.items);
  pickup(world.inventory, world.player, 'x-arrow', world.data.items, 2);
  const level = world.levels.get(0)!;
  const x = world.player.x + 2, y = world.player.y;
  const monster = spawnMonsterState('Giant Rat');
  level.entities.set(230, { id: 230, kind: 'monster', name: 'Giant Rat', x, y, monster });
  level.occupancy[idx(x, y)] = 230; world.visible[idx(x, y)] = 1;
  dispatch(world, { type: 'FIRE', target: { x, y } });
  expect(world.turn).toBe(1);
  expect(world.inventory.pack.find(i => i.defId === 'x-arrow')?.count).toBe(1);
});

import { ensureLevel } from './world';
import { serializeGame, deserializeGame } from './save';
import { playerAttack, resolveSpellAttack } from './combat';

it.each([1, 2] as const)('populates both town and dungeon encounters once in part %s', part => {
  const world = newWorld({ worldSeed: 42, player: init, part });
  const town = world.levels.get(0)!;
  expect(town.encountersPopulated).toBe(true);
  expect([...town.entities.values()].some(e => e.npc?.role === 'traveler')).toBe(true);
  const level = ensureLevel(world, 1);
  expect(level.encountersPopulated).toBe(true);
  expect(level.props?.length).toBeGreaterThan(0);
  const before = JSON.stringify([...level.entities.values()]);
  ensureLevel(world, 1);
  expect(JSON.stringify([...level.entities.values()])).toBe(before);
});

it('interaction spends one turn and a traveler gift stays claimed after reload', () => {
  const world = newWorld({ worldSeed: 42, player: init });
  const level = world.levels.get(0)!;
  const x = world.player.x + 1, y = world.player.y;
  level.entities.set(230, { id: 230, kind: 'npc', name: 'Traveler', x, y, npc: { role: 'traveler', giftClaimed: false, stock: [] } });
  level.occupancy[idx(x, y)] = 230;
  const gold = world.inventory.gold;
  dispatch(world, { type: 'INTERACT', target: 230 });
  expect(world.turn).toBe(1);
  expect(world.inventory.gold).toBe(gold + 3);
  expect(world.log.some(e => e.text.includes('gives you 3'))).toBe(true);
  const loaded = deserializeGame(serializeGame(world), world.data);
  dispatch(loaded, { type: 'INTERACT', target: 230 });
  expect(loaded.turn).toBe(2);
  expect(loaded.inventory.gold).toBe(gold + 3);
  dispatch(loaded, { type: 'INTERACT', target: 231 });
  expect(loaded.turn).toBe(2);
});

it('SEARCH salvages one nearby prop and keeps it exhausted after reload', () => {
  const world = newWorld({ worldSeed: 42, player: init });
  world.levels.get(0)!.props = [{ id: 'test-bones', x: world.player.x, y: world.player.y, kind: 'bones', exhausted: false }];
  dispatch(world, { type: 'SEARCH' });
  expect(world.inventory.pack.find(i => i.defId === 'x-bone')?.count).toBe(1);
  const loaded = deserializeGame(serializeGame(world), world.data);
  dispatch(loaded, { type: 'SEARCH' });
  expect(loaded.inventory.pack.find(i => i.defId === 'x-bone')?.count).toBe(1);
  expect(loaded.turn).toBe(2);
});

it('ordinary turns let remote NPCs wander without changing combat RNG', () => {
  const world = newWorld({ worldSeed: 42, player: init });
  const level = world.levels.get(0)!;
  level.tiles.fill(1);
  level.entities.clear(); level.occupancy.fill(0);
  const npc = { id: 230, kind: 'npc' as const, name: 'Walker', x: 20, y: 20, npc: { role: 'traveler' as const, giftClaimed: true, stock: [] } };
  level.entities.set(230, npc); level.occupancy[idx(20, 20)] = 230;
  world.turn = 7;
  const state = world.rng.getState();
  dispatch(world, { type: 'WAIT' });
  expect([npc.x, npc.y]).not.toEqual([20, 20]);
  expect(world.rng.getState()).toBe(state);
});

it.each(['melee', 'spell'])('%s kills leave a bounded salvage prop', method => {
  const world = newWorld({ worldSeed: 42, player: init });
  const level = world.levels.get(0)!;
  level.entities.clear(); level.occupancy.fill(0); level.tiles.fill(1); level.props = [];
  for (let n = 0; n < 40; n++) {
    const monster = spawnMonsterState('Giant Rat');
    monster.hp = 1; monster.stats.ac = -100;
    const target = { id: 230, kind: 'monster' as const, name: 'Giant Rat', x: world.player.x + 1, y: world.player.y, monster };
    level.entities.set(230, target); level.occupancy[idx(target.x, target.y)] = 230;
    if (method === 'melee') playerAttack(world, 230, { name: 'You', toHit: 100, damage: { count: 1, sides: 1, bonus: 1 }, ac: 0 });
    else resolveSpellAttack(world, { id: 'test', name: 'Test', tier: 1, baseMana: 1, target: 'enemy', effect: 'missile' }, target);
  }
  expect(level.props.length).toBeGreaterThan(0);
  expect(level.props.length).toBeLessThanOrEqual(32);
  expect(level.props.every(p => p.kind === 'bones')).toBe(true);
  expect(new Set(level.props.map(p => p.id)).size).toBe(level.props.length);
});

it('exhausted corpse props keep the salvage budget full after reload', () => {
  const world = newWorld({ worldSeed: 42, player: init });
  const level = world.levels.get(0)!;
  level.props = Array.from({ length: 32 }, (_, n) => ({ id: `remains-0-${n}`, x: world.player.x, y: world.player.y, kind: 'bones', exhausted: true }));
  const loaded = deserializeGame(serializeGame(world), world.data);
  const current = loaded.levels.get(0)!;
  const monster = spawnMonsterState('Giant Rat'); monster.hp = 1; monster.stats.ac = -100;
  const x = loaded.player.x + 1, y = loaded.player.y;
  current.entities.set(230, { id: 230, kind: 'monster', name: 'Giant Rat', x, y, monster });
  current.occupancy[idx(x, y)] = 230;
  playerAttack(loaded, 230, { name: 'You', toHit: 100, damage: { count: 1, sides: 1, bonus: 1 }, ac: 0 });
  dispatch(loaded, { type: 'SEARCH' });
  expect(current.props).toHaveLength(32);
  expect(current.props!.every(prop => prop.exhausted)).toBe(true);
  expect(loaded.inventory.pack.find(item => item.defId === 'x-bone')).toBeUndefined();
});
