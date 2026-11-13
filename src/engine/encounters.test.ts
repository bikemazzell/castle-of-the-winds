import { describe, it, expect } from 'vitest';
import { createCharacter } from './character';
import { createEmptyLevel, idx, validateOccupancy } from './map';
import { createWorld } from './world';
import { serializeGame, deserializeGame } from './save';
import { populateEncounters, tickEncounters, interactEncounter, scavengeNearby, placeShopkeeper } from './encounters';
function fixture() {
    const world = createWorld({ worldSeed: 42, player: createCharacter({ name: 'Test', gender: 'female', difficulty: 'intermediate', strength: 10, intelligence: 10, constitution: 10, dexterity: 10 }), data: {
            part: 1, levels: [{ index: 0, name: 'Town', kind: 'town', links: { up: null, down: 1 } }, { index: 1, name: 'Mine', kind: 'mine', links: { up: 0, down: null } }],
            town: { rows: Array.from({ length: 32 }, () => '01'.repeat(32)), spawn: { x: 3, y: 3 }, mineEntrance: { x: 5, y: 5 } },
            tiles: { 0: { walkable: false }, 1: { walkable: true } }, items: { 'x-rock': { id: 'x-rock', name: 'Rock', kind: 'misc', weightGrams: 100, slot: null, stackable: true, consumable: false } }, spells: {},
        } });
    const level = createEmptyLevel(1);
    level.tiles.fill(1);
    world.levels.set(1, level);
    world.current = 1;
    world.visible.fill(1);
    return { world, level };
}
describe('encounters', () => {
    it('rejects unseen NPCs and props without spending their rewards', () => {
        const {world,level}=fixture(); populateEncounters(world,level);
        const npc=[...level.entities.values()].find(e=>e.npc?.role==='traveler')!;
        const prop=level.props!.find(p=>p.kind==='treasure')!;
        world.visible.fill(0);
        for(const target of [npc,prop]){
            world.player.x=target.x-1;world.player.y=target.y;
            const before=JSON.stringify(serializeGame(world,{savedAt:'fixed'}));
            expect(interactEncounter(world,target.id).ok).toBe(false);
            expect(JSON.stringify(serializeGame(world,{savedAt:'fixed'}))).toBe(before);
        }
    });
    it('rejects interactions around a closed corner and allows an open diagonal', () => {
        const {world,level}=fixture(); populateEncounters(world,level);
        const npc=[...level.entities.values()].find(e=>e.npc?.role==='traveler')!;
        const prop=level.props!.find(p=>p.kind==='treasure')!;
        for(const target of [npc,prop]){
            world.player.x=target.x-1;world.player.y=target.y-1;
            const flank=idx(target.x,world.player.y);
            level.tiles[flank]=0;
            const gold=world.inventory.gold;
            expect(interactEncounter(world,target.id).ok).toBe(false);
            expect(world.inventory.gold).toBe(gold);
            level.tiles[flank]=1;
            expect(interactEncounter(world,target.id).ok).toBe(true);
        }
    });
    it('stocks the wizard with the catalog bedtime scroll', () => {
        const {world}=fixture();const level=createEmptyLevel(4);level.tiles.fill(1);
        const id='i-scroll-of-mandatory-bedtime';
        world.data.items[id]={...world.data.items['x-rock']!,id,name:'Scroll of Mandatory Bedtime'};
        populateEncounters(world,level);
        expect([...level.entities.values()].find(e=>e.npc?.role==='wizard')!.npc!.stock).toContain(id);
    });

    it('gives town a traveler and peddler on safe open cells', () => {
        const { world } = fixture();
        world.current = 0;
        const town = world.levels.get(0)!;
        populateEncounters(world, town);
        expect([...town.entities.values()].map(e => e.npc?.role)).toEqual(['traveler', 'peddler']);
        expect(validateOccupancy(town).ok).toBe(true);
    });
    it('keeps exhausted discoveries exhausted after a roundtrip and does not alias the save', () => {
        const {world,level}=fixture(); populateEncounters(world,level);
        const prop=level.props!.find(p=>p.kind==='treasure')!;
        world.player.x=prop.x; world.player.y=prop.y;
        interactEncounter(world,prop.id);
        const saved=serializeGame(world), gold=world.inventory.gold;
        const loaded=deserializeGame(saved,world.data);
        interactEncounter(loaded,prop.id);
        expect(loaded.inventory.gold).toBe(gold);
        loaded.levels.get(1)!.props![0]!.exhausted=false;
        expect(saved.levels['1']!.props![0]!.exhausted).toBe(true);
    });
    it('does not consume a discovery when its item would exceed carry limits', () => {
        const {world,level}=fixture(); populateEncounters(world,level);
        const prop=level.props!.find(p=>p.kind==='junk')!;
        world.player.x=prop.x; world.player.y=prop.y;
        world.data.items['x-rock']!.weightGrams=999999;
        expect(interactEncounter(world,prop.id).ok).toBe(false);
        expect(prop.exhausted).toBe(false);
        expect(world.inventory.pack).toHaveLength(0);
    });
    it('places deterministic people and clutter without consuming gameplay randomness', () => {
        const a = fixture(), b = fixture(), state = a.world.rng.getState();
        populateEncounters(a.world, a.level);
        populateEncounters(b.world, b.level);
        expect([...a.level.entities.values()]).toEqual([...b.level.entities.values()]);
        expect(a.level.props).toEqual(b.level.props);
        expect(a.level.props!.length).toBeGreaterThan(12);
        expect(a.level.entities.size).toBeGreaterThanOrEqual(3);
        expect(a.world.rng.getState()).toBe(state);
        expect(validateOccupancy(a.level).ok).toBe(true);
        const snapshot = JSON.stringify(a.level.props);
        populateEncounters(a.world, a.level);
        expect(JSON.stringify(a.level.props)).toBe(snapshot);
    });
    it('avoids narrow paths, stairs, traps, player, and occupied cells even while wandering', () => {
        const { world, level } = fixture();
        level.tiles.fill(0);
        for (let y = 5; y < 18; y++)
            for (let x = 5; x < 18; x++)
                level.tiles[idx(x, y)] = 1;
        level.tiles[idx(10, 10)] = 18;
        level.traps = [{ id: 't', kind: 'pit', x: 11, y: 11, known: false }];
        populateEncounters(world, level);
        for (let turn = 0; turn < 100; turn++) {
            world.turn = turn;
            tickEncounters(world);
            expect(validateOccupancy(level).ok).toBe(true);
            for (const e of level.entities.values()) {
                expect(level.tiles[idx(e.x, e.y)]).toBe(1);
                expect([e.x, e.y]).not.toEqual([11, 11]);
            }
        }
    });
    it('persists one-time gifts and props through save/load', () => {
        const { world, level } = fixture();
        populateEncounters(world, level);
        const npc = [...level.entities.values()].find(e => e.npc?.role === 'traveler')!;
        world.player.x = npc.x - 1;
        world.player.y = npc.y;
        expect(interactEncounter(world, npc.id).ok).toBe(true);
        expect(world.inventory.gold).toBeGreaterThan(0);
        const gold = world.inventory.gold, loaded = deserializeGame(serializeGame(world), world.data);
        interactEncounter(loaded, npc.id);
        expect(loaded.inventory.gold).toBe(gold);
        expect(loaded.levels.get(1)!.props).toEqual(level.props);
        expect(loaded.levels.get(1)!.encountersPopulated).toBe(true);
    });
    it('bounds scavenging and refuses remote interactions', () => {
        const { world, level } = fixture();
        populateEncounters(world, level);
        const prop = level.props!.find(p => p.kind === 'treasure')!;
        world.player.x = 0;
        world.player.y = 0;
        expect(interactEncounter(world, prop.id).ok).toBe(false);
        world.player.x = prop.x;
        world.player.y = prop.y;
        scavengeNearby(world);
        const gold = world.inventory.gold;
        for (let i = 0; i < 100; i++)
            scavengeNearby(world);
        expect(world.inventory.gold).toBe(gold);
        expect(prop.exhausted).toBe(true);
    });
    it('places visible shop owners beside doors and does not duplicate them', () => {
        const { world, level } = fixture();
        const shop = { shopId: 'shop-1', name: 'Ada', x: 10, y: 10, stock: [] };
        placeShopkeeper(world, level, shop);
        placeShopkeeper(world, level, shop);
        const owners = [...level.entities.values()].filter(e => e.npc?.shopId === 'shop-1');
        expect(owners).toHaveLength(1);
        expect([owners[0]!.x, owners[0]!.y]).not.toEqual([10, 10]);
        expect(validateOccupancy(level).ok).toBe(true);
    });
});
