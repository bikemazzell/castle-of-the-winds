/**
 * Town scene knowledge: pairs the curated overworld buildings with the shop
 * definitions from shops.json so walking onto a shop door can open the
 * matching merchant dialog. App-layer only — the engine never needs shops.
 */

import overworldJson from '../../data/part1/overworld.json';
import shopsJson from '../../data/part1/shops.json';
import overworld2Json from '../../data/part2/overworld.json';
import shops2Json from '../../data/part2/shops.json';
import { loadWorldData } from '../../engine/game';
import type { ShopDef } from '../ui/merchant';

export type Part = 1 | 2;

export interface TownBuilding {
  shopId: string;
  name: string;
  rect: { x: number; y: number; w: number; h: number };
  door: { x: number; y: number };
}

export interface TownShops {
  buildings: TownBuilding[];
  shops: Record<string, ShopDef>;
}

interface OverworldFile {
  buildings: TownBuilding[];
}

interface ShopsFile {
  shops: ShopDef[];
}

const caches = new Map<Part, TownShops>();

/** Load (and cache per part) the town buildings + shop definitions. Part 2
 * reads the part-2 overworld/shops (PART2-PLAN Task P6); the default stays
 * the part-1 files for every existing caller. */
export function loadTownShops(part: Part = 1): TownShops {
  const cached = caches.get(part);
  if (cached) return cached;
  const overworld = part === 2 ? overworld2Json : overworldJson;
  const shopsFile = part === 2 ? shops2Json : shopsJson;
  const buildings = (overworld as unknown as OverworldFile).buildings;
  const shops: Record<string, ShopDef> = {};
  for (const shop of (shopsFile as unknown as ShopsFile).shops) {
    const scrolls = shop.kind === 'magic' ? Object.values(loadWorldData(part).items).filter(d => d.id.startsWith('i-scroll-of-')).map(d => d.id) : [];
    shops[shop.id] = scrolls.length ? {...shop, stock:[...shop.stock.filter(id => id !== 'i-scroll-or-book'), ...scrolls]} : shop;
  }
  const town = { buildings, shops };
  caches.set(part, town);
  return town;
}

/** Shop whose door tile is exactly (x, y), or null. */
export function shopDoorAt(town: TownShops, x: number, y: number): ShopDef | null {
  for (const b of town.buildings) {
    if (b.door.x === x && b.door.y === y) return town.shops[b.shopId] ?? null;
  }
  return null;
}
