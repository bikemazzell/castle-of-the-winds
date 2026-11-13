// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { loadTownShops, shopDoorAt } from './town';

describe('loadTownShops (real extracted data)', () => {
  it('loads 8 buildings each resolvable to a shop definition', () => {
    const town = loadTownShops();
    expect(town.buildings).toHaveLength(8);
    for (const b of town.buildings) {
      const shop = town.shops[b.shopId]!;
      expect(shop, `shop for ${b.shopId}`).toBeDefined();
      expect(shop.name).toBe(b.name);
    }
  });

  it('covers every shop kind the merchant dialog supports', () => {
    const town = loadTownShops();
    const kinds = new Set(town.buildings.map((b) => town.shops[b.shopId]!.kind));
    expect(kinds).toContain('identify');
    expect(kinds).toContain('junk');
    expect(kinds).toContain('bank');
    expect(kinds).toContain('temple');
    expect(kinds.size).toBeGreaterThanOrEqual(6);
  });
});

describe('shopDoorAt', () => {
  const town = loadTownShops();

  it('resolves known door tiles to their shops', () => {
    expect(shopDoorAt(town, 6, 7)?.id).toBe('snorri');
    expect(shopDoorAt(town, 16, 16)?.id).toBe('gunnhild');
    expect(shopDoorAt(town, 16, 23)?.id).toBe('church');
    expect(shopDoorAt(town, 25, 23)?.id).toBe('olaf');
  });

  it('returns null for non-door tiles', () => {
    expect(shopDoorAt(town, 16, 20)).toBeNull(); // road
    expect(shopDoorAt(town, 5, 5)).toBeNull(); // inside a building, not the door
    expect(shopDoorAt(town, 0, 0)).toBeNull(); // hedge border
  });
});

describe('part-2 town (PART2-PLAN Task P6)', () => {
  it('loads the part-2 buildings and shops under its own cache', () => {
    const t2 = loadTownShops(2);
    expect(t2.buildings.length).toBe(9);
    const ingrid = t2.buildings.find((b) => b.shopId === 'ingrid');
    expect(ingrid).toBeDefined();
    expect(t2.shops['ingrid']!.name).toBe("Ingrid's Alchemy Shop");
    // C1 shopkeepers are gone in part 2; the caches are distinct bundles.
    const t1 = loadTownShops(1);
    expect(t1).not.toBe(t2);
    expect(t1.buildings.find((b) => b.shopId === 'snorri')).toBeDefined();
    expect(t2.buildings.find((b) => b.shopId === 'snorri')).toBeUndefined();
    // Cache identity per part.
    expect(loadTownShops(2)).toBe(t2);
    expect(loadTownShops()).toBe(t1);
  });

  it('pairs part-2 doors with part-2 shop definitions', () => {
    const t2 = loadTownShops(2);
    const gunnar = t2.buildings.find((b) => b.shopId === 'gunnar')!;
    const shop = shopDoorAt(t2, gunnar.door.x, gunnar.door.y);
    expect(shop?.name).toBe("Gunnar's Weapon Shop");
    expect(shop?.kind).toBe('weapons');
  });
});
it.each([1,2] as const)('sells usable named spell scrolls in campaign %s',async part=>{
 const {loadWorldData,newWorld}=await import('../../engine/game');
 const {buyItem}=await import('../../engine/commerce');
 const {dispatch}=await import('../../engine/world');
 const data=loadWorldData(part), town=loadTownShops(part);
 const shop=Object.values(town.shops).find(s=>s.kind==='magic')!;
 const rune=shop.stock.find(id=>data.items[id]?.name==='Scroll of RUNE OF RETURN');
 expect(rune).toBeDefined();
 const w=newWorld({worldSeed:7,part,player:{name:'Reader',gender:'female',strength:50,intelligence:50,constitution:50,dexterity:50,difficulty:'intermediate'}});
 w.inventory.gold=300;
 expect(buyItem(w,rune!).ok).toBe(true);
 const item=w.inventory.pack.find(i=>i.defId===rune)!;
 dispatch(w,{type:'USE',uid:item.uid});
 expect(w.player.knownSpells.map(id=>data.spells[id]!.name)).toContain('RUNE OF RETURN');
 expect(w.inventory.pack.some(i=>i.uid===item.uid)).toBe(false);
});
it.each([1,2] as const)('never sells monster-only spell scrolls in campaign %s',async part=>{
 const {loadWorldData}=await import('../../engine/game');const data=loadWorldData(part);
 const shop=Object.values(loadTownShops(part).shops).find(s=>s.kind==='magic')!;
 for(const id of shop.stock.filter(id=>id.startsWith('i-scroll-of-'))){
  const name=data.items[id]!.name.replace('Scroll of ','');
  const spell=Object.values(data.spells).find(s=>s.name===name)!;
  expect(spell.effect,name).not.toBe('monster_ai');
 }
});
