import { describe, expect, it } from 'vitest';
import {
  buyCost,
  buyPrice,
  junkOffer,
  sellGain,
  sellPrice,
  type PriceQuote,
} from './pricing';
import type { ItemDefRuntime } from './types';

function armor(name: string, armorClass: number): ItemDefRuntime {
  return { id: `i-${name}`, name, kind: 'armor', slot: 'armor', stackable: false, consumable: false, armorClass };
}

function weapon(name: string, weaponClass: number): ItemDefRuntime {
  return { id: `i-${name}`, name, kind: 'weapon', slot: 'weapon', stackable: false, consumable: false, weaponClass };
}

function potion(name = 'Potion'): ItemDefRuntime {
  return { id: 'i-potion', name, kind: 'misc', slot: null, stackable: true, consumable: true };
}

describe('shared price quotes (UI plan Phase 5, A23)', () => {
  it('buyCost totals a quantity from one calculation', () => {
    const q: PriceQuote = buyCost(potion(), 3);
    expect(q.unit).toBe(150);
    expect(q.total).toBe(450);
    expect(buyCost(weapon('Long Sword', 8)).total).toBe(buyPrice(weapon('Long Sword', 8)));
  });

  it('sellGain at a regular store is unit sell price times count', () => {
    const sword = weapon('Long Sword', 8);
    const single = sellGain(sword, 'store');
    expect(single.unit).toBe(sellPrice(sword));
    expect(single.total).toBe(single.unit);
    const stack = sellGain(potion(), 'store', 4);
    expect(stack.total).toBe(stack.unit * 4);
  });

  it('sellGain at the junk store applies the junk rule per item', () => {
    const sword = weapon('Long Sword', 8); // market 450 -> junk cap 25
    const q = sellGain(sword, 'junk', 2);
    expect(q.unit).toBe(junkOffer(sword));
    expect(q.total).toBe(50);
  });

  it('quotes are always positive integers', () => {
    for (const def of [armor('Rusty Armor', 0), weapon('Club', 1), potion()]) {
      for (const kind of ['store', 'junk'] as const) {
        const q = sellGain(def, kind, 1);
        expect(Number.isInteger(q.total)).toBe(true);
        expect(q.total).toBeGreaterThan(0);
      }
      const b = buyCost(def, 1);
      expect(Number.isInteger(b.total)).toBe(true);
      expect(b.total).toBeGreaterThan(0);
    }
  });
});
