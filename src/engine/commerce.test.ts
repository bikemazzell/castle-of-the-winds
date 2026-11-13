import { describe, expect, it } from 'vitest';
import { createCharacter } from './character';
import { buyItem, healPlayer, identifyItem, sellItem } from './commerce';
import { pickup } from './inventory';
import type { ItemDefRuntime } from './types';
import { createWorld, type World } from './world';
import type { WorldData } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ITEMS: Record<string, ItemDefRuntime> = {
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
  'i-plate-mail': {
    id: 'i-plate-mail',
    name: 'Plate Mail',
    kind: 'armor',
    weightGrams: 15000,
    armorClass: 48,
    slot: 'armor',
    stackable: false,
    consumable: false,
  },
};

function data(): WorldData {
  const rows: string[] = [];
  for (let y = 0; y < 32; y++) rows.push('00'.repeat(32));
  return {
    part: 1,
    levels: [{ index: 0, name: 'Town', kind: 'town', links: { down: null, up: null } }],
    town: { rows, spawn: { x: 3, y: 3 }, mineEntrance: { x: 5, y: 5 } },
    tiles: { 0: { walkable: false }, 1: { walkable: true } },
    items: ITEMS,
    spells: {},
  };
}

function world(opts: { gold?: number; strength?: number; hp?: number } = {}): World {
  const player = createCharacter({
    name: 'Test',
    gender: 'female',
    strength: opts.strength ?? 50,
    intelligence: 50,
    constitution: 50,
    dexterity: 50,
    difficulty: 'intermediate',
  });
  if (opts.hp !== undefined) {
    player.maxHp = 90;
    player.hp = opts.hp;
  }
  const w = createWorld({ worldSeed: 7, data: data(), player });
  w.inventory.gold = opts.gold ?? 0;
  return w;
}

/** Seed a stack (or single) via the engine's own pickup so uids are real. */
function give(w: World, defId: string, count = 1): string {
  pickup(w.inventory, w.player, defId, w.data.items, count);
  const item = w.inventory.pack.find((i) => i.defId === defId);
  if (!item) throw new Error('fixture pickup failed');
  return item.uid;
}

// ─── buy ─────────────────────────────────────────────────────────────────────

describe('commerce buyItem (CODE-QUALITY Task 6)', () => {
  it('charges the quoted price exactly and adds the item', () => {
    const w = world({ gold: 2000 });
    const result = buyItem(w, 'i-long-sword');
    expect(result).toEqual({ ok: true, goldDelta: -1350 });
    expect(w.inventory.gold).toBe(650);
    expect(w.inventory.pack.some((i) => i.defId === 'i-long-sword')).toBe(true);
  });

  it('rejects unknown item definitions without mutation', () => {
    const w = world({ gold: 100 });
    const result = buyItem(w, 'i-nope');
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toMatch(/unknown/i);
    expect(w.inventory.gold).toBe(100);
    expect(w.inventory.pack).toHaveLength(0);
  });

  it('rejects insufficient gold before any mutation', () => {
    const w = world({ gold: 10 });
    const result = buyItem(w, 'i-long-sword');
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toMatch(/gold/i);
    expect(w.inventory.gold).toBe(10);
    expect(w.inventory.pack).toHaveLength(0);
  });

  it('rejects a purchase the player cannot carry and keeps the gold', () => {
    // STR 5 → rated carry 1000 g, hard limit 2000 g; plate mail weighs 15 kg.
    const w = world({ gold: 20000, strength: 5 });
    const result = buyItem(w, 'i-plate-mail');
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toMatch(/carry|heavy/i);
    expect(w.inventory.gold).toBe(20000);
    expect(w.inventory.pack).toHaveLength(0);
  });
});

// ─── sell ────────────────────────────────────────────────────────────────────

describe('commerce sellItem (CODE-QUALITY Task 6)', () => {
  it('sells one unit from a stack at the exact store quote', () => {
    const w = world({ gold: 0 });
    const uid = give(w, 'i-potion', 3);
    const result = sellItem(w, uid, 1, 'store');
    expect(result).toEqual({ ok: true, goldDelta: 50 }); // floor(150/3)
    expect(w.inventory.gold).toBe(50);
    const stack = w.inventory.pack.find((i) => i.uid === uid);
    expect(stack?.count).toBe(2);
  });

  it('sells a whole stack (count 3) at the exact store quote', () => {
    const w = world({ gold: 0 });
    const uid = give(w, 'i-potion', 3);
    const result = sellItem(w, uid, 3, 'store');
    expect(result).toEqual({ ok: true, goldDelta: 150 });
    expect(w.inventory.gold).toBe(150);
    expect(w.inventory.pack.find((i) => i.uid === uid)).toBeUndefined();
  });

  it('applies the junk rule per unit — 2 potions pay exactly 50', () => {
    const w = world({ gold: 0 });
    const uid = give(w, 'i-potion', 2);
    const result = sellItem(w, uid, undefined, 'junk');
    expect(result).toEqual({ ok: true, goldDelta: 50 });
    expect(w.inventory.gold).toBe(50);
  });

  it('junk-caps a valuable item at 25 per unit', () => {
    const w = world({ gold: 0 });
    const uid = give(w, 'i-long-sword', 1);
    const result = sellItem(w, uid, 1, 'junk');
    expect(result).toEqual({ ok: true, goldDelta: 25 });
    expect(w.inventory.gold).toBe(25);
  });

  it('defaults to the full stack when count is omitted', () => {
    const w = world({ gold: 0 });
    const uid = give(w, 'i-potion', 3);
    const result = sellItem(w, uid, undefined, 'store');
    expect(result).toEqual({ ok: true, goldDelta: 150 });
    expect(w.inventory.pack.find((i) => i.uid === uid)).toBeUndefined();
  });

  it('rejects an unknown uid without mutation', () => {
    const w = world({ gold: 7 });
    const result = sellItem(w, 'nope#1', 1, 'store');
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toMatch(/unknown/i);
    expect(w.inventory.gold).toBe(7);
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, 4])(
    'rejects invalid count %s without mutation',
    (count) => {
      const w = world({ gold: 0 });
      const uid = give(w, 'i-potion', 3);
      const result = sellItem(w, uid, count, 'store');
      expect(result).toMatchObject({ ok: false });
      if (!result.ok) expect(result.reason).toMatch(/count/i);
      expect(w.inventory.gold).toBe(0);
      expect(w.inventory.pack.find((i) => i.uid === uid)?.count).toBe(3);
    },
  );
});

// ─── heal ────────────────────────────────────────────────────────────────────

describe('commerce healPlayer (CODE-QUALITY Task 6)', () => {
  it('charges exactly 3 per missing hit point and fully heals', () => {
    const w = world({ gold: 100, hp: 80 }); // 10 missing × 3
    const result = healPlayer(w);
    expect(result).toEqual({ ok: true, goldDelta: -30, message: expect.any(String) as string });
    expect(w.inventory.gold).toBe(70);
    expect(w.player.hp).toBe(w.player.maxHp);
  });

  it('is a no-op at full health without charging', () => {
    const w = world({ gold: 100 });
    const result = healPlayer(w);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toMatch(/full/i);
    expect(w.inventory.gold).toBe(100);
  });

  it('rejects a healer the player cannot afford, healing nothing', () => {
    const w = world({ gold: 5, hp: 10 }); // 90 missing × 3 = 270
    const result = healPlayer(w);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toMatch(/gold/i);
    expect(w.inventory.gold).toBe(5);
    expect(w.player.hp).toBe(10);
  });
});

// ─── identify ────────────────────────────────────────────────────────────────

describe('commerce identifyItem (CODE-QUALITY Task 6)', () => {
  it('is honest and free while the engine has no unidentified state', () => {
    const w = world({ gold: 100 });
    const uid = give(w, 'i-long-sword', 1);
    const result = identifyItem(w, uid);
    expect(result).toEqual({ ok: true, goldDelta: 0, message: expect.any(String) as string });
    if (result.ok) expect(result.message).toMatch(/nothing hidden/i);
    expect(w.inventory.gold).toBe(100); // never charged
  });

  it('rejects an unknown uid', () => {
    const w = world({ gold: 100 });
    const result = identifyItem(w, 'nope#1');
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toMatch(/unknown/i);
  });
});

it('buys a stack in one transaction and merges it with existing stock', () => {
 const w=world({gold:2000});give(w,'i-potion',2);
 expect(buyItem(w,'i-potion',5)).toEqual({ok:true,goldDelta:-750});
 expect(w.inventory.gold).toBe(1250);expect(w.inventory.pack.find(i=>i.defId==='i-potion')?.count).toBe(7);
});
it('rejects invalid, unaffordable, and overweight quantities without partial purchases',()=>{
 for(const count of [0,-1,1.5,NaN,Infinity,1000]){
  const w=world({gold:100000});const before=JSON.stringify(w.inventory);
  expect(buyItem(w,'i-potion',count).ok).toBe(false);expect(JSON.stringify(w.inventory)).toBe(before);
 }
 for(const [gold,strength,count] of [[200,50,2],[1000000,1,999]]){
  const w=world({gold,strength});const before=JSON.stringify(w.inventory);
  expect(buyItem(w,'i-potion',count).ok).toBe(false);expect(JSON.stringify(w.inventory)).toBe(before);
 }
 const w=world({gold:100000});expect(buyItem(w,'i-long-sword',2).ok).toBe(false);expect(w.inventory.pack).toHaveLength(0);
});
