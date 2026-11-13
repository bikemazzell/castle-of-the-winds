import { TILE_FLOOR, FLAG_DOOR } from './dungeon';
import { allocateEntityId, idx, PROP_KINDS, type DungeonProp, type Entity, type Level, type NpcRole } from './map';
import { MSLCG, levelGenSeed } from './rng';
import { InventoryError, pickup } from './inventory';
import { npcChatterLine } from './chatter';
import type { World } from './world';
export interface EncounterResult {
    ok: boolean;
    messages: string[];
    stock?: string[];
    shopId?: string;
}
const PEOPLE: {
    name: string;
    role: NpcRole;
    stock: string[];
}[] = [
    { name: 'Mara the Wayfarer', role: 'traveler', stock: [] },
    { name: 'Orrin Two-Boots', role: 'adventurer', stock: ['x-arrow', 'x-bolt'] },
    { name: 'Pella Pocketmarket', role: 'peddler', stock: ['x-arrow', 'x-bolt', 'x-mead'] },
    { name: 'Aunt Brindle', role: 'witch', stock: ['x-dreamcap', 'x-mellowroot'] },
    { name: 'Master Fenn', role: 'wizard', stock: ['x-sparkleaf', 'i-scroll-of-mandatory-bedtime'] },
    { name: 'Tavi Rustpicker', role: 'salvager', stock: ['x-rock', 'x-bone', 'x-bone-club'] },
];
const near = (a: {
    x: number;
    y: number;
}, b: {
    x: number;
    y: number;
}, radius = 1): boolean => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= radius;
/** A full walkable 3x3 neighborhood keeps a neutral occupant out of chokepoints. */
function safeCell(world: World, level: Level, x: number, y: number, town = false): boolean {
    if (x < 2 || y < 2 || x > 61 || y > 61)
        return false;
    if (level.occupancy[idx(x, y)] || (level.index === world.current && near(world.player, { x, y }, 1)))
        return false;
    for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
            const i = idx(x + dx, y + dy), tile = level.tiles[i]!;
            if (town ? !world.data.tiles[String(tile)]?.walkable : tile !== TILE_FLOOR)
                return false;
            if (level.flags[i]! & FLAG_DOOR)
                return false;
            if (level.traps?.some(t => t.x === x + dx && t.y === y + dy))
                return false;
            if (level.doors?.some(d => d.x === x + dx && d.y === y + dy))
                return false;
        }
    if (near({ x, y }, world.data.town.mineEntrance, 2) && town)
        return false;
    if (town && near({ x, y }, world.data.town.spawn, 2))
        return false;
    if ([...level.entities.values()].some(e => e.monster && near(e, { x, y }, 4)))
        return false;
    return true;
}
function addNpc(world: World, level: Level, x: number, y: number, name: string, role: NpcRole, stock: string[], shopId?: string): Entity | null {
    const id = allocateEntityId(level);
    if (!id)
        return null;
    const npc: Entity = { id, kind: 'npc', name, x, y, npc: { role, giftClaimed: false, stock: stock.filter(id => !!world.data.items[id]), ...(shopId ? { shopId } : {}) } };
    level.entities.set(id, npc);
    level.occupancy[idx(x, y)] = id;
    return npc;
}
/** Generation has its own RNG and leaves existing secret-door topology intact. */
export function populateEncounters(world: World, level: Level): void {
    if (level.encountersPopulated || !world.data.items['x-rock'])
        return;
    level.encountersPopulated = true;
    const town = world.data.levels.find(l => l.index === level.index)?.kind === 'town' || level.index === 0;
    const rng = new MSLCG(levelGenSeed(world.worldSeed, level.index) ^ 0x6e706373);
    const cells: {
        x: number;
        y: number;
    }[] = [];
    for (let y = 2; y < 62; y++)
        for (let x = 2; x < 62; x++)
            if (safeCell(world, level, x, y, town))
                cells.push({ x, y });
    function takeCell(): {
        x: number;
        y: number;
    } | undefined {
        while (cells.length) {
            const cell = cells.splice(rng.rand(cells.length), 1)[0]!;
            if (safeCell(world, level, cell.x, cell.y, town))
                return cell;
        }
        return undefined;
    }
    // A recurring traveler makes gifts easy to discover; the second role rotates by depth.
    const people = [PEOPLE[0]!, town ? PEOPLE[2]! : PEOPLE[1 + ((level.index - 1) % 5)]!];
    for (const person of people) {
        const cell = takeCell();
        if (cell)
            addNpc(world, level, cell.x, cell.y, person.name, person.role, person.stock);
    }
    if (town)
        return;
    for (const [name, role] of [['A Forgetful Ghost', 'ghost'], ['Cellar Mouse', 'critter']] as const) {
        const cell = takeCell();
        if (cell)
            addNpc(world, level, cell.x, cell.y, name, role, []);
    }
    level.props ??= [];
    for (let n = 0; n < 24; n++) {
        const cell = takeCell();
        if (!cell)
            break;
        level.props.push({ id: `oddity-${level.index}-${n}`, ...cell, kind: PROP_KINDS[n % PROP_KINDS.length]!, exhausted: false });
    }
}
export interface ShopkeeperSite {
    shopId: string;
    name: string;
    x: number;
    y: number;
    stock: string[];
}
export function placeShopkeeper(world: World, level: Level, shop: ShopkeeperSite): Entity | null {
    const existing = [...level.entities.values()].find(e => e.npc?.shopId === shop.shopId);
    if (existing)
        return existing;
    // Keep the door and its immediate approach clear.
    for (let radius = 2; radius <= 4; radius++)
        for (let dy = -radius; dy <= radius; dy++)
            for (let dx = -radius; dx <= radius; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius)
                    continue;
                const x = shop.x + dx, y = shop.y + dy;
                if (safeCell(world, level, x, y, true))
                    return addNpc(world, level, x, y, shop.name, 'shopkeeper', shop.stock, shop.shopId);
            }
    return null;
}
/** Wander once per eight turns, without gameplay RNG or unsafe destinations. */
export function tickEncounters(world: World): void {
    if (world.turn % 8 !== 0)
        return;
    const level = world.levels.get(world.current);
    if (!level)
        return;
    const rng = new MSLCG(levelGenSeed(world.worldSeed, level.index) ^ world.turn ^ 0x77616e64);
    const steps = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
    for (const entity of level.entities.values()) {
        if (!entity.npc || entity.npc.role === 'shopkeeper' || near(entity, world.player, 2))
            continue;
        const [dx, dy] = steps[rng.rand(steps.length)]!, x = entity.x + dx, y = entity.y + dy;
        if (!safeCell(world, level, x, y, world.data.levels.find(l => l.index === level.index)?.kind === 'town' || level.index === 0))
            continue;
        level.occupancy[idx(entity.x, entity.y)] = 0;
        entity.x = x;
        entity.y = y;
        level.occupancy[idx(x, y)] = entity.id;
    }
}
export const PROP_NAMES: Record<DungeonProp['kind'], string> = { treasure: 'Forgotten strongbox', junk: 'Discarded bundle', bones: 'Old bones', rune: 'Flickering rune', mushrooms: 'Pale mushrooms', rubble: 'Loose rubble' };
function inspectProp(world: World, prop: DungeonProp): EncounterResult {
    if (prop.exhausted)
        return { ok: true, messages: [`${PROP_NAMES[prop.kind]}: nothing more to take.`] };
    let text: string;
    const item = prop.kind === 'bones' ? 'x-bone' : prop.kind === 'junk' ? 'x-rock' : undefined;
    if (item && world.data.items[item]) {
        try {
            pickup(world.inventory, world.player, item, world.data.items, 1);
        }
        catch (error) {
            if (error instanceof InventoryError)
                return { ok: false, messages: [error.message] };
            throw error;
        }
        text = `You salvage ${world.data.items[item].name.toLowerCase()}.`;
    }
    else if (prop.kind === 'treasure') {
        const gold = 5 + (world.current % 7);
        world.inventory.gold += gold;
        text = `The strongbox holds ${gold} gold.`;
    }
    else if (prop.kind === 'rune') {
        const restored = Math.min(2, world.player.maxMana - world.player.mana);
        world.player.mana += restored;
        text = restored > 0 ? `The rune fades. You recover ${restored} mana.` : 'The rune hums a single note, then fades.';
    }
    else if (prop.kind === 'mushrooms')
        text = 'The mushrooms glow when you hum. They offer no opinion on your tune.';
    else if (prop.kind === 'rubble')
        text = 'You turn over the rubble. Underneath is older rubble.';
    else
        text = 'You find a bent spoon. It has retired from service.';
    prop.exhausted = true;
    return { ok: true, messages: [text] };
}
/** Match movement's corner rule; visibility alone can include diagonal cells behind walls. */
function reachable(world: World, level: Level, target: { x: number; y: number }): boolean {
    if (!near(target, world.player) || !world.visible[idx(target.x, target.y)]) return false;
    if (!world.data.tiles[String(level.tiles[idx(target.x, target.y)])]?.walkable) return false;
    if (target.x !== world.player.x && target.y !== world.player.y) {
        const flanks = [idx(target.x, world.player.y), idx(world.player.x, target.y)];
        if (flanks.some(i => !world.data.tiles[String(level.tiles[i])]?.walkable || level.occupancy[i])) return false;
    }
    return true;
}
/** Callers decide turn costs and logging; this function validates and applies finite rewards. */
export function interactEncounter(world: World, target: number | string): EncounterResult {
    const level = world.levels.get(world.current);
    if (!level)
        return { ok: false, messages: [] };
    if (typeof target === 'string') {
        const prop = level.props?.find(p => p.id === target);
        if (!prop || !reachable(world, level, prop))
            return { ok: false, messages: ['You cannot reach that discovery.'] };
        return inspectProp(world, prop);
    }
    const entity = level.entities.get(target);
    if (!entity?.npc || !reachable(world, level, entity))
        return { ok: false, messages: ['There is nobody close enough to talk to.'] };
    const npc = entity.npc;
    if (npc.role === 'ghost')
        return { ok: true, messages: [`${entity.name}: I came down for a moment. Has it been long?`] };
    if (npc.role === 'critter')
        return { ok: true, messages: [`${entity.name} sniffs your boots and goes about its business.`] };
    const messages = [npcChatterLine(world.worldSeed + entity.id, world.turn, npc.role, entity.name)];
    if (npc.role === 'traveler' && !npc.giftClaimed) {
        world.inventory.gold += 3;
        npc.giftClaimed = true;
        messages.push(`${entity.name} gives you 3 gold for the road.`);
    }
    return { ok: true, messages, ...(npc.stock.length ? { stock: [...npc.stock] } : {}), ...(npc.shopId ? { shopId: npc.shopId } : {}) };
}
/** SEARCH examines at most one nearby unspent prop; no free-floating reward rolls. */
export function scavengeNearby(world: World): EncounterResult {
    const level = world.levels.get(world.current);
    const prop = level?.props?.find(p => !p.exhausted && reachable(world, level, p));
    return prop ? interactEncounter(world, prop.id) : { ok: false, messages: [] };
}
