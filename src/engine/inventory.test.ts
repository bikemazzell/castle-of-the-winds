import { describe, expect, it } from 'vitest';
import type { ItemDefRuntime, Player } from './types';
import {
  autoArrange,
  createInventory,
  dropItem,
  equip,
  equipmentStats,
  pickup,
  tickInventory,
  totalWeightGrams,
  unequip,
  useItem,
} from './inventory';
import { createCharacter } from './character';
import { damageBonus, toHitBonus } from './formulas';

const defs: Record<string, ItemDefRuntime> = {
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
  'i-leather-armor': {
    id: 'i-leather-armor',
    name: 'Leather Armor',
    kind: 'armor',
    weightGrams: 5000,
    armorClass: 6,
    slot: 'armor',
    stackable: false,
    consumable: false,
  },
  'i-iron-helmet': {
    id: 'i-iron-helmet',
    name: 'Iron Helmet',
    kind: 'helmet',
    weightGrams: 2000,
    armorClass: 6,
    slot: 'helm',
    stackable: false,
    consumable: false,
  },
  'i-small-iron-shield': {
    id: 'i-small-iron-shield',
    name: 'Small Iron Shield',
    kind: 'shield',
    weightGrams: 4000,
    armorClass: 6,
    slot: 'shield',
    stackable: false,
    consumable: false,
  },
  'i-ring': {
    id: 'i-ring',
    name: 'Ring',
    kind: 'misc',
    weightGrams: 50,
    slot: 'ring1',
    stackable: false,
    consumable: false,
  },
  'i-charm': {
    id: 'i-charm',
    name: 'Charm',
    kind: 'misc',
    weightGrams: 100,
    slot: 'amulet',
    stackable: true,
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
  'i-scroll': {
    id: 'i-scroll',
    name: 'Scroll or Book',
    kind: 'misc',
    weightGrams: 150,
    slot: null,
    stackable: true,
    consumable: true,
  },
  'i-torch': {
    id: 'i-torch',
    name: 'Torch',
    kind: 'misc',
    weightGrams: 300,
    slot: null,
    stackable: false,
    consumable: false,
  },
};

function player(str = 50, dex = 50): Player {
  // Keep the creation pool balanced (200): vary str/dex, absorb the rest in INT.
  const intelligence = Math.min(100, Math.max(1, 100 - str - dex));
  return {
    ...createCharacter({
      name: 'T',
      gender: 'male',
      strength: str,
      intelligence,
      constitution: 50,
      dexterity: dex,
      difficulty: 'intermediate',
    }),
    x: 0,
    y: 0,
  };
}

describe('pickup', () => {
  it('adds an item to the pack', () => {
    const inv = createInventory();
    const item = pickup(inv, player(), 'i-long-sword', defs);
    expect(inv.pack).toHaveLength(1);
    expect(item.defId).toBe('i-long-sword');
    expect(item.count).toBe(1);
  });

  it('merges stacks of stackable items', () => {
    const inv = createInventory();
    pickup(inv, player(), 'i-potion', defs, 3);
    pickup(inv, player(), 'i-potion', defs, 2);
    expect(inv.pack).toHaveLength(1);
    expect(inv.pack[0]!.count).toBe(5);
    expect(totalWeightGrams(inv, defs)).toBe(5 * 200);
  });

  it('rejects invalid pickup counts without mutating the pack (F15, Task 7)', () => {
    for (const bad of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
      const inv = createInventory();
      expect(() => pickup(inv, player(), 'i-potion', defs, bad)).toThrow(/count/);
      expect(inv.pack).toHaveLength(0);
      expect(inv.seq).toBe(0);
    }
  });

  it('rejects unknown definitions', () => {
    const inv = createInventory();
    expect(() => pickup(inv, player(), 'i-nope', defs)).toThrow(/unknown item/);
  });

  it('rejects pickups past twice the rated maximum (manual 294)', () => {
    const inv = createInventory();
    const weak = player(1); // rated max 200 g, hard limit 400 g
    expect(() => pickup(inv, weak, 'i-leather-armor', defs)).toThrow(/too heavy/i);
    expect(inv.pack).toHaveLength(0);
    // Between rated and 2x rated is allowed (slow, but legal).
    const mid = player(2); // rated 400, hard 800
    pickup(inv, mid, 'i-potion', defs, 3); // 600 g
    expect(totalWeightGrams(inv, defs)).toBe(600);
    expect(() => pickup(inv, mid, 'i-potion', defs, 2)).toThrow(/too heavy/); // +400 → 1000
  });
});

describe('drop / equip / unequip', () => {
  it('drops items and reduces stacks', () => {
    const inv = createInventory();
    const p = pickup(inv, player(), 'i-potion', defs, 3);
    dropItem(inv, p.uid, 1);
    expect(inv.pack[0]!.count).toBe(2);
    dropItem(inv, p.uid); // default: the whole remaining stack
    expect(inv.pack).toHaveLength(0);
    expect(() => dropItem(inv, p.uid)).toThrow(/not in pack/);
  });

  it('rejects invalid drop counts without mutating the stack (F15, Task 7)', () => {
    const inv = createInventory();
    const p = pickup(inv, player(), 'i-potion', defs, 3);
    for (const bad of [0, -1, -2, 1.5, Number.POSITIVE_INFINITY, Number.NaN, 4]) {
      expect(() => dropItem(inv, p.uid, bad)).toThrow(/count/);
    }
    expect(inv.pack).toHaveLength(1);
    expect(inv.pack[0]!.count).toBe(3); // negative drop used to GROW the stack
  });

  it('equipping from a stack equips exactly one and leaves the rest (Task 7)', () => {
    const inv = createInventory();
    const p = player();
    const stack = pickup(inv, p, 'i-charm', defs, 3);
    const weightBefore = totalWeightGrams(inv, defs);
    const { slot, item } = equip(inv, p, stack.uid, defs);
    expect(slot).toBe('amulet');
    expect(item.count).toBe(1);
    expect(item.uid).not.toBe(stack.uid);
    expect(inv.equipment.amulet?.count).toBe(1);
    expect(inv.pack[0]!.uid).toBe(stack.uid);
    expect(inv.pack[0]!.count).toBe(2);
    expect(totalWeightGrams(inv, defs)).toBe(weightBefore); // nothing lost or duplicated
  });

  it('equips into the matching slot and removes from pack', () => {
    const inv = createInventory();
    const sword = pickup(inv, player(), 'i-long-sword', defs);
    equip(inv, player(), sword.uid, defs);
    expect(inv.pack).toHaveLength(0);
    expect(inv.equipment.weapon?.defId).toBe('i-long-sword');
  });

  it('rings fill ring1 then ring2', () => {
    const inv = createInventory();
    const r1 = pickup(inv, player(), 'i-ring', defs);
    const r2 = pickup(inv, player(), 'i-ring', defs);
    equip(inv, player(), r1.uid, defs);
    equip(inv, player(), r2.uid, defs);
    expect(inv.equipment.ring1).toBeDefined();
    expect(inv.equipment.ring2).toBeDefined();
  });

  it('equipping into an occupied slot swaps back to the pack', () => {
    const inv = createInventory();
    const sword = pickup(inv, player(), 'i-long-sword', defs);
    equip(inv, player(), sword.uid, defs);
    const sword2 = pickup(inv, player(), 'i-long-sword', defs);
    equip(inv, player(), sword2.uid, defs);
    expect(inv.pack).toHaveLength(1);
    expect(inv.pack[0]!.uid).toBe(sword.uid);
    expect(inv.equipment.weapon?.uid).toBe(sword2.uid);
  });

  it('unequip returns the item to the pack', () => {
    const inv = createInventory();
    const armor = pickup(inv, player(), 'i-leather-armor', defs);
    equip(inv, player(), armor.uid, defs);
    unequip(inv, 'armor');
    expect(inv.equipment.armor).toBeUndefined();
    expect(inv.pack).toHaveLength(1);
  });
});

describe('equipmentStats', () => {
  it('aggregates armor value and weapon damage from equipment + attributes', () => {
    const inv = createInventory();
    const p = player(60, 70); // damageBonus +1, toHitBonus +2, dexArmorBonus 3
    equip(inv, p, pickup(inv, p, 'i-leather-armor', defs).uid, defs); // AV 6
    equip(inv, p, pickup(inv, p, 'i-iron-helmet', defs).uid, defs); // AV 6
    equip(inv, p, pickup(inv, p, 'i-small-iron-shield', defs).uid, defs); // AV 6
    equip(inv, p, pickup(inv, p, 'i-long-sword', defs).uid, defs); // class 8
    const stats = equipmentStats(inv, defs, p);
    // Armor Values 6+6+6 convert to d20 AC via ⌊AV/4⌋ = 1+1+1, plus dex 3
    expect(stats.armorValue).toBe(3 + 3);
    expect(stats.weaponClass).toBe(8);
    expect(stats.toHit).toBe(toHitBonus(70));
    expect(stats.damage).toBe(damageBonus(60) + 8); // strength + weapon class
  });

  it('tracks weight, carry limits and movement speed', () => {
    const inv = createInventory();
    const p = player(50); // rated 10000
    pickup(inv, p, 'i-leather-armor', defs); // 5000 = half -> 200%
    expect(equipmentStats(inv, defs, p).movementSpeedPercent).toBe(200);
    pickup(inv, p, 'i-small-iron-shield', defs); // +4000 = 9000 -> 120%
    expect(equipmentStats(inv, defs, p).movementSpeedPercent).toBe(120);
    expect(equipmentStats(inv, defs, p).weightGrams).toBe(9000);
  });
});

describe('useItem', () => {
  it('passes through the effect system and consumes consumables', () => {
    const inv = createInventory();
    const p = player();
    const potion = pickup(inv, p, 'i-potion', defs, 2);
    const messages: string[] = [];
    const result = useItem(inv, potion.uid, defs, {
      onUse: (_w, item, def) => {
        messages.push(`used ${def.name}`);
        return { consumed: true, message: 'You feel better.' };
      },
    });
    expect(result?.message).toBe('You feel better.');
    expect(inv.pack[0]!.count).toBe(1);
    expect(messages).toEqual(['used Potion']);
  });

  it('stub system leaves items untouched', () => {
    const inv = createInventory();
    const p = player();
    const torch = pickup(inv, p, 'i-torch', defs);
    const result = useItem(inv, torch.uid, defs);
    expect(result).toBeNull();
    expect(inv.pack).toHaveLength(1);
  });
});

describe('light sources', () => {
  it('fuel burns down per turn and items expire', () => {
    const inv = createInventory();
    const p = player();
    const torch = pickup(inv, p, 'i-torch', defs);
    torch.fuelTurns = 100;
    tickInventory(inv, 60);
    expect(torch.fuelTurns).toBe(40);
    tickInventory(inv, 60);
    expect(torch.fuelTurns).toBe(0);
    expect(inv.pack).toHaveLength(0); // burned out and removed
  });
});

describe('autoArrange', () => {
  it('sorts the pack by kind then name', () => {
    const inv = createInventory();
    const p = player();
    pickup(inv, p, 'i-potion', defs);
    pickup(inv, p, 'i-long-sword', defs);
    pickup(inv, p, 'i-leather-armor', defs);
    pickup(inv, p, 'i-scroll', defs);
    autoArrange(inv, defs);
    expect(inv.pack.map((i) => i.defId)).toEqual([
      'i-leather-armor',
      'i-long-sword',
      'i-potion',
      'i-scroll',
    ]);
  });
});
