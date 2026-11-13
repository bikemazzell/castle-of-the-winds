/** Isolated fixture check for the inventory layout and stack controls. */
import assert from 'node:assert/strict';
import type { Inventory, ItemDefRuntime } from '../../src/engine/types';
import { ensureVite, launchBrave, newPage } from './brave';
import { assertNoPageErrors, collectPageErrors, runWith, screenshot } from './helpers';

await runWith([], async close => {
  const vite = await ensureVite(console.log); close(() => vite.stop());
  const brave = await launchBrave(console.log); close(() => brave.close());
  const page = await newPage(brave.browser, vite.url);
  const { errors } = collectPageErrors(page);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewport(viewport);
    await page.evaluate(async () => {
      const inventoryModule = '/src/app/ui/inventory.ts';
      const merchantModule = '/src/app/ui/merchant.ts';
      const characterModule = '/src/engine/character.ts';
      const dialogsModule = '/src/app/ui/dialogs.ts';
      const { openModal, closeAllModals } = await import(dialogsModule) as typeof import('../../src/app/ui/dialogs');
      const { createInventoryPanel } = await import(inventoryModule) as typeof import('../../src/app/ui/inventory');
      const { createMerchantPanel } = await import(merchantModule) as typeof import('../../src/app/ui/merchant');
      const { createCharacter } = await import(characterModule) as typeof import('../../src/app/../engine/character');
      const defs: Record<string, ItemDefRuntime> = {
        sword: { id: 'sword', name: 'Long Sword', kind: 'weapon', slot: 'weapon', stackable: false, consumable: false, weightGrams: 1500 },
        shield: { id: 'shield', name: 'Wooden Shield', kind: 'shield', slot: 'shield', stackable: false, consumable: false, weightGrams: 1500 },
        armor: { id: 'armor', name: 'Leather Armor', kind: 'armor', slot: 'armor', stackable: false, consumable: false, weightGrams: 2000 },
        helm: { id: 'helm', name: 'Iron Helmet', kind: 'helmet', slot: 'helm', stackable: false, consumable: false, weightGrams: 500 },
        potion: { id: 'potion', name: 'Healing Potion', kind: 'misc', slot: null, stackable: true, consumable: true, weightGrams: 100 },
      };
      const inv: Inventory = { pack: [{ uid: 'potion#1', defId: 'potion', count: 5 }], equipment: {
        weapon: { uid: 'sword#2', defId: 'sword', count: 1 }, shield: { uid: 'shield#3', defId: 'shield', count: 1 },
        armor: { uid: 'armor#4', defId: 'armor', count: 1 }, helm: { uid: 'helm#5', defId: 'helm', count: 1 },
      }, gold: 10000, seq: 6 };
      const player = { ...createCharacter({ name: 'Inventory review', gender: 'male', strength: 50, intelligence: 50, constitution: 50, dexterity: 50, difficulty: 'intermediate' }), x: 1, y: 1 };
      const panel = createInventoryPanel({ inv, defs, player, actions: {
        onEquip() {}, onUnequip() {}, onUse() {}, onAutoArrange() {},
        onDiscard(uid: string, count = 1) { if (uid !== 'potion#1') throw new Error('Wrong discard'); inv.pack[0]!.count -= count; panel.refresh(inv); },
      } });
      closeAllModals();
      openModal({ title: 'Inventory', content: panel.el, className: 'dialog-inventory' });
      panel.el.querySelector<HTMLButtonElement>('[data-uid="potion#1"] button')!.click();
      const input = panel.el.querySelector<HTMLInputElement>('[data-field="discard-quantity"]')!;
      input.value = '2'; input.dispatchEvent(new Event('input'));
      panel.el.querySelector<HTMLButtonElement>('[data-action="discard"]')!.click();
      const confirm = panel.el.querySelector<HTMLButtonElement>('[data-action="discard-confirm"]')!; confirm.click(); confirm.click();
      if (inv.pack[0]!.count !== 3) throw new Error('Partial discard or duplicate protection failed');
      panel.el.querySelector<HTMLButtonElement>('[data-tab="equipment"]')!.click();
      panel.el.querySelector<HTMLButtonElement>('[data-slot="weapon"] button')!.click();
      if (panel.el.querySelector('[data-action="discard"]')) throw new Error('Equipped discard exposed');
      // Keep the merchant fixture available for the second capture and quantity checks.
      const merchant = createMerchantPanel({ shop: { id: 'test', name: 'General Store', kind: 'general', stock: ['potion'] }, inv, defs, player, gold: 10000,
        actions: { onBuy(_id: string, count = 1) { if (count !== 2) throw new Error('Wrong buy count'); }, onSell(_uid: string, count = 1) { if (count !== 2) throw new Error('Wrong sell count'); } },
      });
      merchant.el.id = 'merchant-fixture'; merchant.el.hidden = true; panel.el.after(merchant.el);
    });
    const geometry = await page.evaluate(() => {
      const hero = document.querySelector('.equipment-hero svg')!.getBoundingClientRect();
      const center = document.elementFromPoint(hero.x + hero.width / 2, hero.y + hero.height / 2);
      return { heroCenterVisible: !!center?.closest('.equipment-hero'), overflow: document.documentElement.scrollWidth > innerWidth,
        head: document.querySelector('[data-slot="helm"]')!.getBoundingClientRect().y,
        armor: document.querySelector('[data-slot="armor"]')!.getBoundingClientRect().y,
        boots: document.querySelector('[data-slot="boots"]')!.getBoundingClientRect().y,
        weapon: document.querySelector('[data-slot="weapon"]')!.getBoundingClientRect().x,
        shield: document.querySelector('[data-slot="shield"]')!.getBoundingClientRect().x,
      };
    });
    assert.equal(geometry.overflow, false);
    assert.equal(geometry.heroCenterVisible, true, 'Equipment cards must not cover the hero');
    assert.ok(geometry.head < geometry.armor && geometry.armor < geometry.boots);
    assert.ok(geometry.shield < geometry.weapon);
    await screenshot(page, `docs/e2e/inventory/equipment-${viewport.width}.png`);
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('[data-tab="pack"]')!.click();
      document.querySelector<HTMLButtonElement>('[data-uid="potion#1"] button')!.click();
    });
    await screenshot(page, `docs/e2e/inventory/pack-${viewport.width}.png`);
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('[data-action="quantity-plus"]')!.click();
      document.querySelector<HTMLButtonElement>('[data-action="discard"]')!.click();
    });
    await screenshot(page, `docs/e2e/inventory/discard-${viewport.width}.png`);
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('.inventory-panel')!.hidden = true;
      document.querySelector<HTMLElement>('#merchant-fixture')!.hidden = false;
      const merchant = document.querySelector('#merchant-fixture')!;
      merchant.querySelector<HTMLButtonElement>('.merchant-buy-list button')!.click();
      merchant.querySelector<HTMLButtonElement>('[data-action="quantity-plus"]')!.click();
      merchant.querySelector<HTMLButtonElement>('[data-field="primary-action"]')!.click();
      merchant.querySelector<HTMLButtonElement>('[data-mtab="sell"]')!.click();
      merchant.querySelector<HTMLButtonElement>('.merchant-sell-list button')!.click();
      const input = merchant.querySelector<HTMLInputElement>('[data-field="sell-quantity"]')!;
      input.value = '2'; input.dispatchEvent(new Event('input'));
    });
    await screenshot(page, `docs/e2e/inventory/merchant-${viewport.width}.png`);
    await page.click('#merchant-fixture [data-field="primary-action"]');
    await page.reload({ waitUntil: 'load' });
  }
  assertNoPageErrors(errors);
  console.log('Inventory desktop/mobile fixtures passed; screenshots: docs/e2e/inventory/');
});
