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

export interface ShopDef {
  id: string;
  name: string;
  kind: 'identify' | 'junk' | 'bank' | 'armor' | 'weapons' | 'general' | 'magic' | 'alchemy' | 'temple';
  stock: string[];
}

export interface MerchantPanelActions {
  onBuy?: (defId: string) => string | void;
  onSell?: (uid: string) => string | void;
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
  let selectedUid: string | null = null;

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
  }

  function renderBuyDetails(): void {
    if (!selectedDefId) return;
    const def = current.defs[selectedDefId];
    if (!def) return;
    const quote = buyCost(def);
    detailsHost.appendChild(itemDetails({ def, equipped: equippedDefFor(def) }));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'primary-action';
    btn.dataset.field = 'primary-action';
    btn.textContent = `Buy — ${gold(quote.total)}`;
    if (current.gold < quote.total) btn.classList.add('unaffordable');
    btn.addEventListener('click', () => {
      if (selectedDefId) {
        const reason = actions?.onBuy?.(selectedDefId);
        showNotice(reason ?? (current.gold < quote.total ? 'Not enough gold.' : undefined));
      }
    });
    detailsHost.appendChild(btn);
  }

  function renderSellDetails(): void {
    if (!selectedUid) return;
    const item = current.inv?.pack.find((i) => i.uid === selectedUid);
    const def = item ? current.defs[item.defId] : undefined;
    if (!item || !def) return;
    const quote = sellGain(def, shop.kind === 'junk' ? 'junk' : 'store', item.count);
    detailsHost.appendChild(itemDetails({ def, equipped: equippedDefFor(def) }));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'primary-action';
    btn.dataset.field = 'primary-action';
    btn.textContent = item.count > 1 ? `Sell all ${item.count} — ${gold(quote.total)}` : `Sell — ${gold(quote.total)}`;
    btn.addEventListener('click', () => {
      const reason = actions?.onSell?.(item.uid);
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

