import { describe, expect, it } from 'vitest';
import itemsFile from '../data/items.json';
import { loadItemDefs } from './items';
import type { EquipSlot } from './types';

const defs = loadItemDefs(itemsFile);

describe('loadItemDefs (real items.json)', () => {
  it('adapts all 57 records', () => {
    expect(Object.keys(defs)).toHaveLength(57);
  });

  it('maps armor/helmet/shield pieces to their slots with armor class', () => {
    const armor = defs['i-leather-armor']!;
    expect(armor.slot).toBe<EquipSlot>('armor');
    expect(armor.armorClass).toBe(6);
    expect(armor.weightGrams).toBe(5000);
    expect(defs['i-iron-helmet']!.slot).toBe<EquipSlot>('helm');
    expect(defs['i-large-meteoric-steel-shield']!.slot).toBe<EquipSlot>('shield');
    expect(defs['i-large-meteoric-steel-shield']!.armorClass).toBe(21);
  });

  it('maps weapons with their weapon class', () => {
    const sword = defs['i-long-sword']!;
    expect(sword.slot).toBe<EquipSlot>('weapon');
    expect(sword.weaponClass).toBe(8);
    expect(sword.weightGrams).toBe(1500);
  });

  it('maps wearable misc objects to their slots', () => {
    expect(defs['i-boots']!.slot).toBe<EquipSlot>('boots');
    expect(defs['i-gauntlets']!.slot).toBe<EquipSlot>('gauntlets');
    expect(defs['i-bracers']!.slot).toBe<EquipSlot>('bracers');
    expect(defs['i-cloak']!.slot).toBe<EquipSlot>('cloak');
    expect(defs['i-amulet']!.slot).toBe<EquipSlot>('amulet');
    expect(defs['i-ring']!.slot).toBe<EquipSlot>('ring1'); // ring1 = primary ring slot
  });

  it('marks potions and scrolls stackable consumables without slots', () => {
    const potion = defs['i-potion']!;
    expect(potion.slot).toBeNull();
    expect(potion.stackable).toBe(true);
    expect(potion.consumable).toBe(true);
    const scroll = defs['i-scroll-or-book']!;
    expect(scroll.stackable).toBe(true);
    // Staves are usable but single objects.
    expect(defs['i-staff']!.stackable).toBe(false);
    expect(defs['i-staff']!.consumable).toBe(false);
  });
});
