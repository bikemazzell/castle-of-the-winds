// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMerchantPanel } from './merchant';
import { closeAllModals } from './dialogs';
import { createInventory, pickup } from '../../engine/inventory';
import { createCharacter } from '../../engine/character';
import type { Inventory, ItemDefRuntime, Player } from '../../engine/types';

function defs(): Record<string, ItemDefRuntime> {
  return {
    'i-sword': { id: 'i-sword', name: 'Long Sword', kind: 'weapon', slot: 'weapon', stackable: false, consumable: false, weaponClass: 8, weightGrams: 1500 },
    'i-armor': { id: 'i-armor', name: 'Leather Armor', kind: 'armor', slot: 'armor', stackable: false, consumable: false, armorClass: 6, weightGrams: 5000 },
    'i-potion': { id: 'i-potion', name: 'Potion', kind: 'misc', slot: null, stackable: true, consumable: true, weightGrams: 200 },
    'i-mail': { id: 'i-mail', name: 'Chain Mail', kind: 'armor', slot: 'armor', stackable: false, consumable: false, armorClass: 30, weightGrams: 10000 },
  };
}

function player(): Player {
  return { ...createCharacter({ name: 'T', gender: 'female', strength: 50, intelligence: 50, constitution: 50, dexterity: 50, difficulty: 'intermediate' }), x: 1, y: 1 };
}

function inv(): Inventory {
  const i = createInventory();
  const p = player();
  pickup(i, p, 'i-potion', defs());
  pickup(i, p, 'i-potion', defs());
  pickup(i, p, 'i-mail', defs());
  return i;
}

function stockShop() {
  return { id: 'sverting', name: "Sverting's Armor Shop", kind: 'armor' as const, stock: ['i-armor', 'i-mail'] };
}

afterEach(() => closeAllModals());

describe('merchant panel (UI plan Phase 5)', () => {
  it('splits Buy and Sell into tabs; Buy lists stock with prices via the shared item row', () => {
    const panel = createMerchantPanel({ shop: stockShop(), defs: defs(), inv: inv(), player: player(), gold: 500 });
    document.body.appendChild(panel.el);
    expect(panel.el.querySelector('[data-mtab="buy"]')?.classList.contains('active')).toBe(true);
    const buyNames = [...panel.el.querySelectorAll('.merchant-buy-list .item-name')].map((n) => n.textContent);
    expect(buyNames).toEqual(['Leather Armor', 'Chain Mail']);
    expect(panel.el.querySelector('.merchant-buy-list')?.textContent).toContain('Gold');

    (panel.el.querySelector('[data-mtab="sell"]') as HTMLButtonElement).click();
    const sellNames = [...panel.el.querySelectorAll('.merchant-sell-list .item-name')].map((n) => n.textContent);
    expect(sellNames).toContain('Potion');
    expect(sellNames).not.toContain('Leather Armor'); // not carried
  });

  it('uses the term Gold, never C.P.', () => {
    const panel = createMerchantPanel({ shop: stockShop(), defs: defs(), inv: inv(), player: player(), gold: 500 });
    document.body.appendChild(panel.el);
    expect(panel.el.textContent).not.toContain('C.P.');
    expect(panel.el.textContent).toMatch(/Gold/i);
  });

  it('selecting stock shows details with an equipped comparison before purchase', () => {
    const i = inv();
    const equipped = i.pack.find((it) => it.defId === 'i-mail')!;
    i.equipment.armor = equipped;
    i.pack = i.pack.filter((it) => it.uid !== equipped.uid);
    const panel = createMerchantPanel({ shop: stockShop(), defs: defs(), inv: i, player: player(), gold: 500 });
    document.body.appendChild(panel.el);
    (panel.el.querySelector('.merchant-buy-list .item-row[data-def-id="i-armor"] button') as HTMLButtonElement).click();
    const details = panel.el.querySelector('[data-field="item-details"]') as HTMLElement;
    expect(details.textContent).toContain('Leather Armor');
    expect(details.textContent).toContain('Compared with Chain Mail');
    expect((panel.el.querySelector('[data-field="primary-action"]') as HTMLButtonElement).textContent).toMatch(/^Buy/);
  });

  it('shows an inline reason for insufficient gold and carrying limits instead of failing silently', () => {
    const panel = createMerchantPanel({
      shop: stockShop(), defs: defs(), inv: inv(), player: player(), gold: 10,
      actions: { onBuy: () => 'Not enough gold.' },
    });
    document.body.appendChild(panel.el);
    (panel.el.querySelector('.merchant-buy-list .item-row[data-def-id="i-armor"] button') as HTMLButtonElement).click();
    (panel.el.querySelector('[data-field="primary-action"]') as HTMLButtonElement).click();
    const notice = panel.el.querySelector('[data-field="merchant-notice"]') as HTMLElement;
    expect(notice.textContent).toContain('Not enough gold');
  });

  it('preserves the selected stock item across a transaction refresh', () => {
    const onBuy = vi.fn();
    const panel = createMerchantPanel({ shop: stockShop(), defs: defs(), inv: inv(), player: player(), gold: 500, actions: { onBuy } });
    document.body.appendChild(panel.el);
    (panel.el.querySelector('.merchant-buy-list .item-row[data-def-id="i-armor"] button') as HTMLButtonElement).click();
    (panel.el.querySelector('[data-field="primary-action"]') as HTMLButtonElement).click();
    expect(onBuy).toHaveBeenCalledWith('i-armor');
    // The controller refreshes after the purchase; the selection and tab survive.
    panel.refresh({ gold: 500 - 200 });
    expect(panel.el.querySelector('[data-mtab="buy"]')?.classList.contains('active')).toBe(true);
    const details = panel.el.querySelector('[data-field="item-details"]') as HTMLElement;
    expect(details.textContent).toContain('Leather Armor');
  });

  it('sell tab quotes unit and total for stacks from the shared calculation', () => {
    const panel = createMerchantPanel({ shop: stockShop(), defs: defs(), inv: inv(), player: player(), gold: 0 });
    document.body.appendChild(panel.el);
    (panel.el.querySelector('[data-mtab="sell"]') as HTMLButtonElement).click();
    const row = panel.el.querySelector('.merchant-sell-list [data-uid]') as HTMLElement;
    expect(row.textContent).toContain('each');
    expect(row.textContent).toContain('×2');
  });

  it('temple and identify and bank keep their special sections', () => {
    const heal = createMerchantPanel({
      shop: { id: 'church', name: 'Church', kind: 'temple', stock: [] },
      defs: defs(), inv: inv(), player: { ...player(), hp: 4, maxHp: 12 }, gold: 100,
    });
    document.body.appendChild(heal.el);
    expect(heal.el.textContent).toContain('Heal');
    expect(heal.el.querySelector('[data-mtab="buy"]')).toBeNull();

    const sage = createMerchantPanel({
      shop: { id: 'snorri', name: 'Snorri the Sage', kind: 'identify', stock: [] },
      defs: defs(), inv: inv(), player: player(), gold: 100,
    });
    document.body.appendChild(sage.el);
    expect(sage.el.textContent).toContain('Identify');

    const bank = createMerchantPanel({
      shop: { id: 'bank', name: 'First Bank', kind: 'bank', stock: [] },
      defs: defs(), inv: inv(), player: player(), gold: 100,
    });
    document.body.appendChild(bank.el);
    expect(bank.el.textContent).toMatch(/not available yet|later milestone|keeps your gold/i);
  });

  it('alchemy shops open as stock shops with Buy tab (PART2 Task P1)', () => {
    const panel = createMerchantPanel({
      shop: { id: 'ingrid', name: "Ingrid's Alchemy Shop", kind: 'alchemy', stock: ['i-potion'] },
      defs: defs(), inv: inv(), player: player(), gold: 100,
    });
    document.body.appendChild(panel.el);
    expect(panel.el.querySelector('.merchant-buy-list')).not.toBeNull();
    const row = panel.el.querySelector('.item-row[data-def-id="i-potion"]');
    expect(row?.textContent).toMatch(/Potion/);
  });
});
