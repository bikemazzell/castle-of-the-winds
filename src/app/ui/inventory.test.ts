// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInventoryPanel, type InventoryDialogActions } from './inventory';
import { closeAllModals } from './dialogs';
import { createInventory, pickup } from '../../engine/inventory';
import { createCharacter } from '../../engine/character';
import type { ItemDefRuntime, Player } from '../../engine/types';

function defs(): Record<string, ItemDefRuntime> {
  return {
    'i-sword': { id: 'i-sword', name: 'Long Sword', kind: 'weapon', slot: 'weapon', stackable: false, consumable: false, weaponClass: 8, weightGrams: 1500 },
    'i-armor': { id: 'i-armor', name: 'Leather Armor', kind: 'armor', slot: 'armor', stackable: false, consumable: false, armorClass: 6, weightGrams: 5000 },
    'i-potion': { id: 'i-potion', name: 'Potion', kind: 'misc', slot: null, stackable: true, consumable: true, weightGrams: 200 },
  };
}

function player(): Player {
  return { ...createCharacter({ name: 'T', gender: 'female', strength: 50, intelligence: 50, constitution: 50, dexterity: 50, difficulty: 'intermediate' }), x: 1, y: 1 };
}

function inv(): ReturnType<typeof createInventory> {
  const i = createInventory();
  const p = player();
  pickup(i, p, 'i-sword', defs());
  pickup(i, p, 'i-armor', defs());
  pickup(i, p, 'i-potion', defs());
  pickup(i, p, 'i-potion', defs());
  return i;
}

function actions(): InventoryDialogActions {
  return {
    onEquip: () => {},
    onUnequip: () => {},
    onUse: () => {},
    onDiscard: () => {},
    onAutoArrange: () => {},
  };
}

afterEach(() => closeAllModals());

describe('inventory panel (UI plan Phase 5)', () => {
  it('opens on the Pack tab; the Equipment tab lists labeled slots including both rings', () => {
    const panel = createInventoryPanel({ inv: inv(), defs: defs(), player: player(), actions: actions() });
    document.body.appendChild(panel.el);
    expect(panel.el.querySelector('[data-tab="pack"]')?.classList.contains('active')).toBe(true);
    const rows = panel.el.querySelectorAll('.pack-list .item-row');
    expect(rows.length).toBe(3);

    (panel.el.querySelector('[data-tab="equipment"]') as HTMLButtonElement).click();
    const slotLabels = [...panel.el.querySelectorAll('.equip-list .slot-label')].map((n) => n.textContent);
    expect(slotLabels).toContain('Left Ring');
    expect(slotLabels).toContain('Right Ring');
  });

  it('filters All / Equipment / Consumables change presentation only', () => {
    const panel = createInventoryPanel({ inv: inv(), defs: defs(), player: player(), actions: actions() });
    document.body.appendChild(panel.el);
    expect(panel.el.querySelectorAll('.pack-list .item-row').length).toBe(3);
    (panel.el.querySelector('[data-filter="equipment"]') as HTMLButtonElement).click();
    const names = [...panel.el.querySelectorAll('.pack-list .item-name')].map((n) => n.textContent);
    expect(names).toContain('Long Sword');
    expect(names).not.toContain('Potion');
    (panel.el.querySelector('[data-filter="consumables"]') as HTMLButtonElement).click();
    expect([...panel.el.querySelectorAll('.pack-list .item-name')].map((n) => n.textContent)).toEqual(['Potion']);
  });

  it('sorts by name and weight', () => {
    const panel = createInventoryPanel({ inv: inv(), defs: defs(), player: player(), actions: actions() });
    document.body.appendChild(panel.el);
    (panel.el.querySelector('[data-sort="name"]') as HTMLButtonElement).click();
    let names = [...panel.el.querySelectorAll('.pack-list .item-name')].map((n) => n.textContent);
    expect(names).toEqual(['Leather Armor', 'Long Sword', 'Potion']);
    (panel.el.querySelector('[data-sort="weight"]') as HTMLButtonElement).click();
    names = [...panel.el.querySelectorAll('.pack-list .item-name')].map((n) => n.textContent);
    expect(names).toEqual(['Potion', 'Long Sword', 'Leather Armor']);
  });

  it('selecting a row shows details with exactly one primary action and a Discard that states its consequence', () => {
    const panel = createInventoryPanel({ inv: inv(), defs: defs(), player: player(), actions: actions() });
    document.body.appendChild(panel.el);
    (panel.el.querySelector('.pack-list .item-row[data-uid="i-sword#1"] button') as HTMLButtonElement).click();
    const details = panel.el.querySelector('[data-field="item-details"]') as HTMLElement;
    expect(details.textContent).toContain('Long Sword');
    const primary = panel.el.querySelector('[data-field="primary-action"]') as HTMLButtonElement;
    expect(primary.textContent).toBe('Equip'); // equippable → Equip primary
    expect(panel.el.querySelectorAll('[data-field="primary-action"]').length).toBe(1);

    const discard = panel.el.querySelector('[data-action="discard"]') as HTMLButtonElement;
    expect(discard).not.toBeNull();
    expect(discard.textContent).toMatch(/discard/i);
    // The consequence is explicit and final: no recovery exists.
    expect(panel.el.querySelector('[data-field="drop-note"]')?.textContent).toMatch(/cannot be recovered/i);

    (panel.el.querySelector('.pack-list .item-row[data-uid="i-potion#3"] button') as HTMLButtonElement).click();
    expect((panel.el.querySelector('[data-field="primary-action"]') as HTMLButtonElement).textContent).toBe('Use');
  });

  it('discarding requires an explicit confirmation that names the item; cancel restores untouched (F21)', () => {
    const calls: string[] = [];
    const panel = createInventoryPanel({
      inv: inv(),
      defs: defs(),
      player: player(),
      actions: { ...actions(), onDiscard: (uid) => calls.push(`discard:${uid}`) },
    });
    document.body.appendChild(panel.el);
    (panel.el.querySelector('.pack-list .item-row[data-uid="i-sword#1"] button') as HTMLButtonElement).click();

    // First click only arms the confirmation; nothing is destroyed yet.
    (panel.el.querySelector('[data-action="discard"]') as HTMLButtonElement).click();
    expect(calls).toEqual([]);
    const confirmBtn = panel.el.querySelector('[data-action="discard-confirm"]') as HTMLButtonElement;
    expect(confirmBtn.textContent).toMatch(/discard long sword/i);
    expect(panel.el.querySelector('[data-action="discard-cancel"]')).not.toBeNull();

    // Cancel restores the plain Discard state without destroying anything.
    (panel.el.querySelector('[data-action="discard-cancel"]') as HTMLButtonElement).click();
    expect(calls).toEqual([]);
    expect(panel.el.querySelector('[data-action="discard-confirm"]')).toBeNull();
    expect(panel.el.querySelector('[data-action="discard"]')?.textContent).toMatch(/discard/i);

    // Re-arm and confirm: exactly one callback with the selected uid.
    (panel.el.querySelector('[data-action="discard"]') as HTMLButtonElement).click();
    (panel.el.querySelector('[data-action="discard-confirm"]') as HTMLButtonElement).click();
    expect(calls).toEqual(['discard:i-sword#1']);
  });

  it('keeps filter, sort, and selection across refresh; a vanished item selects the next row and announces it (A13)', () => {
    const panel = createInventoryPanel({ inv: inv(), defs: defs(), player: player(), actions: actions() });
    document.body.appendChild(panel.el);
    (panel.el.querySelector('[data-filter="equipment"]') as HTMLButtonElement).click();
    (panel.el.querySelector('[data-sort="name"]') as HTMLButtonElement).click();
    (panel.el.querySelector('.pack-list .item-row[data-uid="i-sword#1"] button') as HTMLButtonElement).click();

    // The sword is gone after this refresh (equipped in the test scenario).
    const inv2 = inv();
    inv2.pack = inv2.pack.filter((i) => i.uid !== 'i-sword#1');
    panel.refresh(inv2);

    expect((panel.el.querySelector('[data-filter="equipment"]') as HTMLElement).classList.contains('active')).toBe(true);
    const names = [...panel.el.querySelectorAll('.pack-list .item-name')].map((n) => n.textContent);
    expect(names).toEqual(['Leather Armor']); // filter + sort preserved
    const selected = panel.el.querySelector('.item-row.selected');
    expect(selected?.getAttribute('data-uid')).toBe('i-armor#2'); // next valid row selected
    expect(panel.el.querySelector('[data-field="announce"]')?.textContent).toMatch(/long sword/i);
  });

  it('footer shows gold, carried weight, and the movement-speed consequence', () => {
    const panel = createInventoryPanel({
      inv: inv(),
      defs: defs(),
      player: player(),
      derived: { weightGrams: 6900, ratedMax: 10000, movementSpeedPercent: 100 },
      actions: actions(),
    });
    document.body.appendChild(panel.el);
    const footer = panel.el.querySelector('[data-field="inv-footer"]') as HTMLElement;
    expect(footer.textContent).toContain('Gold');
    expect(footer.textContent).toMatch(/6\.9 kg/);
    expect(footer.textContent).toContain('Movement speed: 100%');
  });

  it('equipment tab: selecting a filled slot shows details with Unequip primary', () => {
    const i = inv();
    const p = player();
    const sword = i.pack.find((it) => it.defId === 'i-sword')!;
    i.equipment.weapon = sword;
    i.pack = i.pack.filter((it) => it.uid !== sword.uid);
    const panel = createInventoryPanel({ inv: i, defs: defs(), player: p, actions: actions() });
    document.body.appendChild(panel.el);
    (panel.el.querySelector('[data-tab="equipment"]') as HTMLButtonElement).click();
    const weaponSlot = panel.el.querySelector('.equip-list [data-slot="weapon"]') as HTMLElement;
    expect(weaponSlot.textContent).toContain('Long Sword');
    (weaponSlot.querySelector('button') as HTMLButtonElement).click();
    expect((panel.el.querySelector('[data-field="primary-action"]') as HTMLButtonElement).textContent).toBe('Unequip');
  });

  it('primary actions invoke the controller callbacks', () => {
    const calls: string[] = [];
    const a: InventoryDialogActions = {
      onEquip: (uid) => calls.push(`equip:${uid}`),
      onUnequip: (slot) => calls.push(`unequip:${slot}`),
      onUse: (uid) => calls.push(`use:${uid}`),
      onDiscard: (uid) => calls.push(`discard:${uid}`),
      onAutoArrange: () => calls.push('arrange'),
    };
    const panel = createInventoryPanel({ inv: inv(), defs: defs(), player: player(), actions: a });
    document.body.appendChild(panel.el);
    (panel.el.querySelector('.pack-list .item-row[data-uid="i-sword#1"] button') as HTMLButtonElement).click();
    (panel.el.querySelector('[data-field="primary-action"]') as HTMLButtonElement).click();
    (panel.el.querySelector('[data-action="discard"]') as HTMLButtonElement).click();
    (panel.el.querySelector('[data-action="discard-confirm"]') as HTMLButtonElement).click();
    (panel.el.querySelector('[data-action="auto-arrange"]') as HTMLButtonElement).click();
    expect(calls).toEqual(['equip:i-sword#1', 'discard:i-sword#1', 'arrange']);
  });
});

it('preserves focus on the primary item action during an inventory refresh', () => {
  const inventory = inv();
  const panel = createInventoryPanel({ inv: inventory, defs: defs(), player: player(), actions: actions() });
  document.body.append(panel.el);
  panel.el.querySelector<HTMLButtonElement>('.item-row-button')!.click();
  panel.el.querySelector<HTMLButtonElement>('[data-field="primary-action"]')!.focus();
  panel.refresh(inventory);
  expect(document.activeElement).toBe(panel.el.querySelector('[data-field="primary-action"]'));
});


it('reveals mobile item details on selection but does not scroll on refresh', () => {
  const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockReturnValue({ matches: true }) });
  const inventory = inv();
  const panel = createInventoryPanel({ inv: inventory, defs: defs(), player: player(), actions: actions() });
  document.body.append(panel.el);
  const details = panel.el.querySelector<HTMLElement>('[data-field="details-host"]')!;
  const scroll = vi.fn();
  details.scrollIntoView = scroll;
  panel.el.querySelector<HTMLButtonElement>('.item-row-button')!.click();
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(details);
  panel.refresh(inventory);
  expect(scroll).toHaveBeenCalledTimes(1);
  if (original) Object.defineProperty(window, 'matchMedia', original);
  else Reflect.deleteProperty(window, 'matchMedia');
});

it('keeps discard confirmation focus through refresh and returns focus on Cancel', () => {
  const inventory = inv();
  const panel = createInventoryPanel({ inv: inventory, defs: defs(), player: player(), actions: actions() });
  document.body.append(panel.el);
  panel.el.querySelector<HTMLButtonElement>('.item-row-button')!.click();
  const discard = panel.el.querySelector<HTMLButtonElement>('[data-action="discard"]')!;
  discard.focus();
  discard.click();
  expect(document.activeElement).toBe(panel.el.querySelector('[data-action="discard-confirm"]'));
  panel.refresh(inventory);
  expect(document.activeElement).toBe(panel.el.querySelector('[data-action="discard-confirm"]'));
  const cancel = panel.el.querySelector<HTMLButtonElement>('[data-action="discard-cancel"]')!;
  cancel.focus();
  cancel.click();
  expect(document.activeElement).toBe(panel.el.querySelector('[data-action="discard"]'));
});
