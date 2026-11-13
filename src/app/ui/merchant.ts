/**
 * Merchant panel (UI plan Phase 5).
 *
 * Rebuilt on the shared item component: Buy and Sell are tabs, quotes and
 * transactions share one calculation (A23), selection and tab survive
 * `refresh()` after a transaction, failures surface as inline reasons
 * (insufficient gold, carrying capacity) instead of silent no-ops, and the
 * player-facing currency term is Gold everywhere (A24). Temple, Sage, and
 * bank keep their special sections.
 */
import type { Inventory, ItemDefRuntime, Player } from '../../engine/types';
import type { EquipSlot } from '../../engine/types';
import { buyCost, healPrice, sellGain } from '../../engine/pricing';
import { itemDetails, itemRow } from './item-view';
import { quantityControl } from './quantity';

export interface ShopDef {
  id: string;
  name: string;
  kind: 'identify' | 'junk' | 'bank' | 'armor' | 'weapons' | 'general' | 'magic' | 'alchemy' | 'temple';
  stock: string[];
}

export interface MerchantPanelActions {
  onBuy?: (defId: string, count?: number) => string | void;
  onSell?: (uid: string, count?: number) => string | void;
  onIdentify?: (uid: string) => string | void;
  onHeal?: () => string | void;
}

export interface MerchantPanelData {
  shop: ShopDef;
  defs: Record<string, ItemDefRuntime>;
  inv?: Inventory;
  player?: Player;
  gold: number;
  actions?: MerchantPanelActions;
}

export interface MerchantPanel {
  el: HTMLElement;
  /** Update gold/inventory after a transaction, preserving tab + selection. */
  refresh: (data: Partial<Pick<MerchantPanelData, 'inv' | 'player' | 'gold'>>) => void;
}

const gold = (n: number): string => `${n} Gold`;

export function createMerchantPanel(data: MerchantPanelData): MerchantPanel {
  const { shop } = data;
  const actions = data.actions;

  let tab: 'buy' | 'sell' = 'buy';
  let selectedDefId: string | null = null;
  let quantity = 1;
  let selectedUid: string | null = null;
  let purchasedDefId: string | null = null;

  let current: MerchantPanelData = { ...data };

  const el = document.createElement('div');
  el.className = 'merchant-panel';

  const goldBar = document.createElement('p');
  goldBar.className = 'inv-summary';
  el.appendChild(goldBar);

  const notice = document.createElement('p');
  notice.className = 'merchant-notice';
  notice.dataset.field = 'merchant-notice';
  el.appendChild(notice);

  const tabRow = document.createElement('div');
  tabRow.className = 'inv-tabs merchant-tabs';
  const buyTab = document.createElement('button');
  buyTab.type = 'button';
  buyTab.textContent = 'Buy';
  buyTab.dataset.mtab = 'buy';
  buyTab.addEventListener('click', () => {
    tab = 'buy';
    selectedUid = null;
    render();
  });
  const sellTab = document.createElement('button');
  sellTab.type = 'button';
  sellTab.textContent = 'Sell';
  sellTab.dataset.mtab = 'sell';
  sellTab.addEventListener('click', () => {
    tab = 'sell';
    selectedDefId = null;
    render();
  });
  tabRow.append(buyTab, sellTab);

  const list = document.createElement('div');
  list.className = 'merchant-list';
  const detailsHost = document.createElement('div');
  detailsHost.dataset.field = 'details-host';

  function showNotice(text?: string): void {
    notice.textContent = text ?? '';
  }

  function equippedDefFor(def: ItemDefRuntime): ItemDefRuntime | undefined {
    const invNow = current.inv;
    if (!invNow || !def.slot) return undefined;
    const slot: EquipSlot = def.slot;
    const item = slot === 'ring1' || slot === 'ring2' ? invNow.equipment.ring1 ?? invNow.equipment.ring2 : invNow.equipment[slot];
    return item ? current.defs[item.defId] : undefined;
  }

  function renderSpecial(): boolean {
    if (shop.kind === 'bank') {
      const note = document.createElement('p');
      note.textContent =
        'The First Bank of Crossroads keeps your gold safe. Vault services are not available yet — your purse is secure here.';
      list.appendChild(note);
      return true;
    }
    if (shop.kind === 'temple') {
      const missing = current.player ? Math.max(0, current.player.maxHp - current.player.hp) : 0;
      if (!current.player || missing === 0) {
        const note = document.createElement('p');
        note.textContent = 'You are healthy. Odin watches over you.';
        list.appendChild(note);
      } else {
        const price = healPrice(missing);
        const row = document.createElement('div');
        row.className = 'inv-row';
        const label = document.createElement('span');
        label.className = 'char-value';
        label.textContent = `Heal all wounds (${missing} hp)`;
        const priceEl = document.createElement('span');
        priceEl.textContent = gold(price);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Heal';
        btn.dataset.action = 'heal';
        if (current.gold < price) btn.classList.add('unaffordable');
        btn.addEventListener('click', () => {
          const reason = actions?.onHeal?.();
          showNotice(reason ?? undefined);
        });
        row.append(label, priceEl, btn);
        list.appendChild(row);
      }
      return true;
    }
    if (shop.kind === 'identify') {
      const heading = document.createElement('h4');
      heading.textContent = 'Identify an item';
      list.appendChild(heading);
      if (!current.inv || current.inv.pack.length === 0) {
        const note = document.createElement('p');
        note.textContent = 'Bring an item and the Sage will examine it — free while nothing can be hidden.';
        list.appendChild(note);
      }
      for (const item of current.inv?.pack ?? []) {
        const def = current.defs[item.defId];
        if (!def) continue;
        const row = document.createElement('div');
        row.className = 'inv-row';
        row.dataset.identifyUid = item.uid;
        const label = document.createElement('span');
        label.className = 'char-value';
        label.textContent = def.name;
        const priceEl = document.createElement('span');
        priceEl.textContent = 'Free'; // the engine has no unidentified state — the Sage never charges for nothing (Task 6)
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Identify';
        btn.addEventListener('click', () => {
          const reason = actions?.onIdentify?.(item.uid);
          showNotice(reason ?? undefined);
        });
        row.append(label, priceEl, btn);
        list.appendChild(row);
      }
      return true;
    }
    return false;
  }

  function render(): void {
    goldBar.textContent = `Your purse: ${gold(current.gold)}`;
    showNotice();
    list.replaceChildren();
    detailsHost.replaceChildren();
    if (!list.isConnected) el.appendChild(list);
    // Remove tab row for special shops.
    if (tabRow.isConnected) tabRow.remove();

    if (renderSpecial()) {
      if (el.contains(detailsHost)) detailsHost.remove();
      return;
    }

    el.insertBefore(tabRow, list);
    if (!detailsHost.isConnected) el.appendChild(detailsHost);
    buyTab.classList.toggle('active', tab === 'buy');
    sellTab.classList.toggle('active', tab === 'sell');

    if (tab === 'buy' && shop.stock.length > 0) {
      const heading = document.createElement('h4');
      heading.textContent = 'For sale';
      list.appendChild(heading);
      const buyList = document.createElement('div');
      buyList.className = 'merchant-buy-list';
      list.appendChild(buyList);
      for (const defId of shop.stock) {
        const def = current.defs[defId];
        if (!def) continue;
        const quote = buyCost(def);
        const row = itemRow({
          item: { uid: defId, defId, count: 1 },
          def,
          selected: selectedDefId === defId,
          onClick: () => {
            selectedDefId = defId;
            quantity = 1;
            purchasedDefId = null;
            showNotice();
            render();
          },
        });
        row.dataset.defId = defId;
        const priceEl = document.createElement('span');
        priceEl.className = 'merchant-price';
        priceEl.textContent = gold(quote.total);
        row.querySelector('.item-row-button')?.append(priceEl);
        buyList.appendChild(row);
      }
      renderBuyDetails();
      return;
    }

    if (tab === 'buy') {
      const note = document.createElement('p');
      note.textContent = 'This shop buys, but sells nothing. Try the Sell tab.';
      list.appendChild(note);
    }

    // Sell tab (or sell-only junk shops landing here by default).
    const heading = document.createElement('h4');
    heading.textContent = shop.kind === 'junk' ? 'Sell anything' : 'Sell from your pack';
    list.appendChild(heading);
    const sellList = document.createElement('div');
    sellList.className = 'merchant-sell-list';
    list.appendChild(sellList);
    if (!current.inv || current.inv.pack.length === 0) {
      const note = document.createElement('p');
      note.textContent = 'Your pack is empty.';
      list.appendChild(note);
    }
    for (const item of current.inv?.pack ?? []) {
      const def = current.defs[item.defId];
      if (!def) continue;
      const quote = sellGain(def, shop.kind === 'junk' ? 'junk' : 'store', item.count);
      const row = itemRow({
        item,
        def,
        selected: selectedUid === item.uid,
        onClick: () => {
          selectedUid = item.uid;
          render();
        },
      });
      const priceEl = document.createElement('span');
      priceEl.className = 'merchant-price';
      priceEl.textContent = item.count > 1 ? `${quote.unit} each — ${gold(quote.total)}` : gold(quote.total);
      row.querySelector('.item-row-button')?.append(priceEl);
      sellList.appendChild(row);
    }
    renderSellDetails();
    if (current.inv?.pack.length && actions?.onSell) {
      const all = document.createElement('button');
      all.type = 'button';
      all.dataset.action = 'sell-all';
      all.textContent = 'Sell All from Pack…';
      all.addEventListener('click', confirmSellAll);
      detailsHost.appendChild(all);
    }
  }

  function confirmSellAll(): void {
    const items = (current.inv?.pack ?? []).map(item => ({ ...item }));
    if (!items.length || !actions?.onSell) return;
    const total = items.reduce((sum, item) => {
      const def = current.defs[item.defId];
      return sum + (def ? sellGain(def, shop.kind === 'junk' ? 'junk' : 'store', item.count).total : 0);
    }, 0);
    const count = items.reduce((sum, item) => sum + item.count, 0);
    detailsHost.replaceChildren();
    const summary = document.createElement('p');
    summary.textContent = `Sell all ${count} items in your pack for ${gold(total)}? Equipped items stay with you.`;
    const contents = document.createElement('p');
    contents.className = 'merchant-sale-preview';
    contents.textContent = items.map(item => `${current.defs[item.defId]?.name ?? item.defId} ×${item.count}`).join(', ');
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.dataset.action = 'confirm-sell-all';
    confirm.textContent = `Confirm sale — ${gold(total)}`;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.dataset.action = 'cancel-sell-all';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', render);
    let completed = false;
    confirm.addEventListener('click', () => {
      if (completed) return;
      completed = true;
      confirm.disabled = true;
      // Sell exactly the previewed pack. Never include equipped items or new arrivals.
      if (items.some(item => !current.inv?.pack.some(now => now.uid === item.uid && now.defId === item.defId && now.count === item.count))) {
        render();
        showNotice('Your pack changed. Review the sale again.');
        return;
      }
      for (const item of items) {
        const reason = actions.onSell?.(item.uid);
        if (reason) {
          render();
          showNotice(reason);
          return;
        }
      }
      selectedUid = null;
      render();
      const receipt = document.createElement('p');
      receipt.setAttribute('role', 'status');
      receipt.className = 'merchant-receipt';
      receipt.textContent = `Sold ${count} items for ${gold(total)}.`;
      detailsHost.prepend(receipt);
    });
    detailsHost.append(summary, contents, confirm, cancel);
    cancel.focus();
  }

  function renderBuyDetails(): void {
    if (!selectedDefId) return;
    const def = current.defs[selectedDefId];
    if (!def) return;
    let quote = buyCost(def, quantity);
    detailsHost.appendChild(itemDetails({ def, equipped: equippedDefFor(def) }));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'primary-action';
    btn.dataset.field = 'primary-action';
    btn.disabled = purchasedDefId === def.id;
    btn.textContent = btn.disabled ? 'Purchased' : `Buy — ${gold(quote.total)}`;
    if (btn.disabled) {
      const receipt = document.createElement('p');
      receipt.setAttribute('role', 'status');
      receipt.className = 'merchant-receipt';
      receipt.textContent = `Purchased ${def.name}${quantity > 1 ? ` ×${quantity}` : ''} for ${gold(quote.total)}. Select an item to buy again.`;
      detailsHost.appendChild(receipt);
    }
    let quantityInput: HTMLInputElement | undefined;
    if (def.stackable) {
      const controls = quantityControl({ field: 'buy-quantity', max: 999, value: quantity,
        disabled: purchasedDefId === def.id,
        onChange: (value, valid) => {
          quantity = value;
          const purchased = purchasedDefId === def.id;
          quote = buyCost(def, valid ? quantity : 1);
          btn.disabled = purchased || !valid;
          btn.textContent = purchased ? 'Purchased' : valid ? `Buy ×${quantity} — ${gold(quote.total)}` : 'Choose a quantity from 1 to 999';
          btn.classList.toggle('unaffordable', valid && current.gold < quote.total);
        },
      });
      quantityInput = controls.input;
      detailsHost.append(controls.el);
    }
    if (current.gold < quote.total) btn.classList.add('unaffordable');
    btn.addEventListener('click', () => {
      if (!selectedDefId || purchasedDefId === selectedDefId) return;
      if (quantityInput && !quantityInput.checkValidity()) return;
      const id = selectedDefId;
      const affordable = current.gold >= quote.total;
      const reason = actions?.onBuy?.(id, quantity);
      if (reason || !actions?.onBuy) {
        showNotice(reason ?? (affordable ? undefined : 'Not enough gold.'));
        return;
      }
      purchasedDefId = id;
      showNotice();
      render();
    });
    detailsHost.appendChild(btn);
  }

  function renderSellDetails(): void {
    if (!selectedUid) return;
    const item = current.inv?.pack.find((i) => i.uid === selectedUid);
    const def = item ? current.defs[item.defId] : undefined;
    if (!item || !def) return;
    let count = 1;
    detailsHost.appendChild(itemDetails({ def, equipped: equippedDefFor(def) }));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'primary-action';
    btn.dataset.field = 'primary-action';
    const update = (value: number, valid: boolean): void => {
      count = value;
      btn.disabled = !valid;
      btn.textContent = valid ? `Sell${item.count > 1 ? ` ×${count}` : ''} — ${gold(sellGain(def, shop.kind === 'junk' ? 'junk' : 'store', count).total)}` : `Choose a quantity from 1 to ${item.count}`;
    };
    update(1, true);
    if (item.count > 1) detailsHost.append(quantityControl({ field: 'sell-quantity', max: item.count, onChange: update }).el);
    let submitted = false;
    btn.addEventListener('click', () => {
      if (submitted || btn.disabled) return;
      submitted = true;
      btn.disabled = true;
      const reason = actions?.onSell?.(item.uid, count);
      if (reason || !actions?.onSell) { submitted = false; btn.disabled = false; }
      showNotice(reason ?? undefined);
    });
    detailsHost.appendChild(btn);
  }

  // Junk shops have nothing to buy — open on Sell.
  if (shop.kind === 'junk') tab = 'sell';
  render();

  return {
    el,
    refresh(next: Partial<Pick<MerchantPanelData, 'inv' | 'player' | 'gold'>>): void {
      current = { ...current, ...next };
      // Selection repair: dropped/sold items vanish.
      if (selectedUid && !(current.inv?.pack ?? []).some((i) => i.uid === selectedUid)) {
        selectedUid = null;
      }
      if (selectedDefId && !shop.stock.includes(selectedDefId)) selectedDefId = null;
      render();
    },
  };
}

