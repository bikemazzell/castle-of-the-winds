// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  compareEquipment,
  itemDetails,
  itemRow,
  SLOT_LABELS,
} from './item-view';
import type { InventoryItem, ItemDefRuntime } from '../../engine/types';

function armor(name: string, armorClass: number, weightGrams = 5000): ItemDefRuntime {
  return { id: `i-${name}`, name, kind: 'armor', slot: 'armor', stackable: false, consumable: false, armorClass, weightGrams };
}

function weapon(name: string, weaponClass: number): ItemDefRuntime {
  return { id: `i-${name}`, name, kind: 'weapon', slot: 'weapon', stackable: false, consumable: false, weaponClass, weightGrams: 1500 };
}

function potion(): ItemDefRuntime {
  return { id: 'i-potion', name: 'Potion', kind: 'misc', slot: null, stackable: true, consumable: true, weightGrams: 200 };
}

function invItem(def: ItemDefRuntime, count = 1): InventoryItem {
  return { uid: `${def.id}#1`, defId: def.id, count };
}

describe('item-view rows (UI plan Phase 5)', () => {
  it('shows icon, name, count, and equipped state', () => {
    const row = itemRow({ item: invItem(potion(), 3), def: potion() });
    expect(row.dataset.uid).toBe('i-potion#1');
    expect(row.textContent).toContain('Potion');
    expect(row.textContent).toContain('×3');
    expect(row.querySelector('.item-icon')).not.toBeNull();
    expect(row.querySelector('[data-field="equipped"]')).toBeNull();

    const equippedRow = itemRow({ item: invItem(weapon('Long Sword', 8)), def: weapon('Long Sword', 8), equipped: true });
    expect(equippedRow.querySelector('[data-field="equipped"]')?.textContent).toBe('Equipped');
  });

  it('labels the two ring slots separately', () => {
    expect(SLOT_LABELS.ring1).not.toBe(SLOT_LABELS.ring2);
    expect(SLOT_LABELS.ring1).toMatch(/ring/i);
    expect(SLOT_LABELS.ring2).toMatch(/ring/i);
  });
});

describe('item-view details (UI plan Phase 5)', () => {
  it('lists engine-derived stats without an invented power score', () => {
    const el = itemDetails({ def: armor('Leather Armor', 6, 5000) });
    expect(el.textContent).toContain('Leather Armor');
    expect(el.textContent).toContain('Armor'); // armor class row
    expect(el.textContent).toContain('kg'); // weight
    expect(el.textContent).not.toMatch(/power score/i);
  });

  it('compares a candidate against the currently equipped item with better-direction hints', () => {
    const el = itemDetails({
      def: armor('Chain Mail', 30, 10000),
      equipped: armor('Leather Armor', 6, 5000),
    });
    expect(el.textContent).toContain('Chain Mail');
    expect(el.textContent).toContain('Leather Armor');
    expect(el.textContent).toContain('higher is better');
    expect(el.textContent).toContain('lower is better'); // weight hint
  });

  it('comparison rows describe armor, weapon, and weight deltas', () => {
    const rows = compareEquipment(armor('Chain Mail', 30, 10000), armor('Leather Armor', 6, 5000));
    const armorRow = rows.find((r) => /armor/i.test(r.label));
    expect(armorRow?.candidate).toBe(30);
    expect(armorRow?.current).toBe(6);
    expect(armorRow?.better).toBe('higher');
    const weightRow = rows.find((r) => /weight/i.test(r.label));
    expect(weightRow?.better).toBe('lower');
    // weapon rows appear when either item is a weapon
    const weaponRows = compareEquipment(weapon('Long Sword', 8), undefined);
    expect(weaponRows.some((r) => /weapon/i.test(r.label))).toBe(true);
    expect(weaponRows.find((r) => /weapon/i.test(r.label))?.current).toBeNull();
  });
});
