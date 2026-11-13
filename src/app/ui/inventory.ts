/**
 * Inventory panel (UI plan Phase 5).
 *
 * Replaces the dialogs.ts inventory builder: Pack opens first (equipment
 * is a tab, not the dominant view — A11), items show icon/name/count,
 * selection opens details with ONE primary action while Drop sits in a
 * secondary area stating its real consequence (no floor storage exists —
 * A25 forbids implying recovery). Filters and sorting change presentation
 * only. `refresh()` updates the panel IN PLACE so selection, filters,
 * scroll, and focus survive item actions (A13) — the controller no longer
 * closes and reopens the dialog after every action.
 */
import type { EquipSlot, Inventory, ItemDefRuntime, Player } from '../../engine/types';
import { SLOT_LABELS, itemDetails, itemRow } from './item-view';

export interface InventoryPanelData {
  inv: Inventory;
  defs: Record<string, ItemDefRuntime>;
  player: Player;
  derived?: { weightGrams: number; ratedMax: number; movementSpeedPercent: number };
  actions?: InventoryDialogActions;
}

/** Controller callbacks invoked by panel actions (kept name for continuity). */
export interface InventoryDialogActions {
  onEquip: (uid: string) => void;
  onUnequip: (slot: EquipSlot) => void;
  onUse: (uid: string) => void;
  onDiscard: (uid: string) => void;
  onAutoArrange: () => void;
}

export interface InventoryPanel {
  el: HTMLElement;
  /** Re-render rows/footer from new state, preserving panel context (A13). */
  refresh: (inv: Inventory, derived?: InventoryPanelData['derived']) => void;
  /** Currently selected pack uid (or equipment slot uid), if any. */
  selectedUid: () => string | null;
}

type Filter = 'all' | 'equipment' | 'consumables';
type Sort = 'type' | 'name' | 'weight';

const KIND_RANK: Record<string, number> = { armor: 0, helmet: 1, shield: 2, weapon: 3, misc: 4 };

const kg = (g: number): string => `${(g / 1000).toFixed(1)} kg`;

export function createInventoryPanel(data: InventoryPanelData): InventoryPanel {
  const { defs } = data;
  const actions = data.actions;

  // Panel-local UI state — survives refresh (A13).
  let tab: 'pack' | 'equipment' = 'pack';
  let filter: Filter = 'all';
  let sort: Sort = 'type';
  let selectedUid: string | null = null;
  let selectedSlot: EquipSlot | null = null;
  let discardUid: string | null = null;

  const el = document.createElement('div');
  el.className = 'inventory-panel';

  // --- Toolbar: tabs + filters + sort -------------------------------------
  const toolbar = document.createElement('div');
  toolbar.className = 'inv-toolbar';
  const tabs = document.createElement('div');
  tabs.className = 'inv-tabs';
  const tabPack = tabButton('Pack', 'pack');
  const tabEquip = tabButton('Equipment', 'equipment');
  tabs.append(tabPack, tabEquip);
  const filters = document.createElement('div');
  filters.className = 'inv-filters';
  const filterBtns: Record<Filter, HTMLButtonElement> = {
    all: smallBtn('All', 'filter', 'all'),
    equipment: smallBtn('Equipment', 'filter', 'equipment'),
    consumables: smallBtn('Consumables', 'filter', 'consumables'),
  };
  filters.append(filterBtns.all, filterBtns.equipment, filterBtns.consumables);
  const sorts = document.createElement('div');
  sorts.className = 'inv-sorts';
  const sortBtns: Record<Sort, HTMLButtonElement> = {
    type: smallBtn('Type', 'sort', 'type'),
    name: smallBtn('Name', 'sort', 'name'),
    weight: smallBtn('Weight', 'sort', 'weight'),
  };
  sorts.append(sortBtns.type, sortBtns.name, sortBtns.weight);
  toolbar.append(tabs, filters, sorts);
  el.appendChild(toolbar);

  // --- Split: list + details ----------------------------------------------
  const split = document.createElement('div');
  split.className = 'inv-split';
  const listCol = document.createElement('div');
  listCol.className = 'inv-list-col';
  const packList = document.createElement('div');
  packList.className = 'pack-list';
  const equipList = document.createElement('div');
  equipList.className = 'equip-list';
  listCol.append(packList, equipList);
  const detailsCol = document.createElement('div');
  detailsCol.className = 'inv-details-col';
  const detailsHost = document.createElement('div');
  detailsHost.dataset.field = 'details-host';
  detailsHost.tabIndex = -1;
  detailsCol.appendChild(detailsHost);
  split.append(listCol, detailsCol);
  el.appendChild(split);

  // --- Footer ---------------------------------------------------------------
  const footer = document.createElement('div');
  footer.className = 'inv-footer';
  footer.dataset.field = 'inv-footer';
  el.appendChild(footer);

  const arrange = document.createElement('button');
  arrange.type = 'button';
  arrange.textContent = 'Auto arrange';
  arrange.dataset.action = 'auto-arrange';
  arrange.addEventListener('click', () => actions?.onAutoArrange());
  footer.appendChild(arrange);

  function tabButton(label: string, name: 'pack' | 'equipment'): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.dataset.tab = name;
    btn.addEventListener('click', () => {
      tab = name;
      renderTabs();
      renderLists();
    });
    return btn;
  }

  function smallBtn(label: string, kind: 'filter' | 'sort', value: Filter | Sort): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.dataset[kind] = value;
    btn.addEventListener('click', () => {
      if (kind === 'filter') {
        filter = value as Filter;
        Object.entries(filterBtns).forEach(([k, b]) => b.classList.toggle('active', k === value));
      } else {
        sort = value as Sort;
        Object.entries(sortBtns).forEach(([k, b]) => b.classList.toggle('active', k === value));
      }
      renderLists();
    });
    return btn;
  }

  function renderTabs(): void {
    tabPack.classList.toggle('active', tab === 'pack');
    tabEquip.classList.toggle('active', tab === 'equipment');
    packList.style.display = tab === 'pack' ? '' : 'none';
    equipList.style.display = tab === 'equipment' ? '' : 'none';
    filters.hidden = tab !== 'pack';
    sorts.hidden = tab !== 'pack';
  }

  function visiblePack(inv: Inventory): { item: (typeof inv.pack)[number]; def: ItemDefRuntime }[] {
    const rows = inv.pack
      .map((item) => ({ item, def: defs[item.defId] }))
      .filter((r): r is { item: (typeof inv.pack)[number]; def: ItemDefRuntime } => Boolean(r.def));
    const filtered = rows.filter(({ def }) => {
      if (filter === 'equipment') return def.slot !== null;
      if (filter === 'consumables') return def.consumable;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => {
      if (sort === 'name') return a.def.name.localeCompare(b.def.name);
      if (sort === 'weight') return (a.def.weightGrams ?? 0) - (b.def.weightGrams ?? 0);
      const rank = (KIND_RANK[a.def.kind] ?? 9) - (KIND_RANK[b.def.kind] ?? 9);
      return rank !== 0 ? rank : a.def.name.localeCompare(b.def.name);
    });
    return sorted;
  }

  let announceEl: HTMLElement | null = null;
  // Remember item names across refreshes so removal announcements can name
  // an item that is no longer in the pack.
  const nameMemory = new Map<string, string>();

  function renderLists(announce?: string): void {
    const active = document.activeElement instanceof HTMLElement && el.contains(document.activeElement)
      ? document.activeElement : null;
    const field = active?.dataset.field;
    const action = active?.dataset.action;
    const uid = active?.closest<HTMLElement>('[data-uid]')?.dataset.uid;
    const slot = active?.closest<HTMLElement>('[data-slot]')?.dataset.slot;
    const scroll = listCol.scrollTop;
    renderPack(announce);
    renderEquipment();
    if (active && !active.isConnected) {
      const replacement = [...el.querySelectorAll<HTMLElement>('button, [tabindex]')].find((candidate) =>
        field ? candidate.dataset.field === field : action ? candidate.dataset.action === action :
          uid ? candidate.closest<HTMLElement>('[data-uid]')?.dataset.uid === uid :
            slot ? candidate.closest<HTMLElement>('[data-slot]')?.dataset.slot === slot : false,
      );
      const fallback = packList.querySelector<HTMLElement>('.selected button') ?? tabPack;
      (replacement ?? fallback).focus({ preventScroll: true });
    }
    listCol.scrollTop = scroll;
  }

  function revealDetails(): void {
    if (!window.matchMedia?.('(max-width: 700px)').matches) return;
    detailsHost.focus({ preventScroll: true });
    detailsHost.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
  }

  function renderPack(announce?: string): void {
    const inv = currentInv;
    packList.replaceChildren();
    if (announceEl) announceEl = null;

    const rows = visiblePack(inv);
    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.dataset.field = 'empty';
      empty.textContent = filter === 'all' ? 'Your pack is empty.' : 'Nothing matches this filter.';
      packList.appendChild(empty);
    }
    for (const { item, def } of rows) {
      nameMemory.set(item.uid, def.name);
      packList.appendChild(
        itemRow({
          item,
          def,
          selected: item.uid === selectedUid,
          onClick: () => {
            selectedUid = item.uid;
            selectedSlot = null;
            renderLists();
            revealDetails();
          },
        }),
      );
    }
    if (announce) {
      const note = document.createElement('p');
      note.dataset.field = 'announce';
      note.className = 'inv-announce';
      note.textContent = announce;
      packList.appendChild(note);
      announceEl = note;
    }
    // Selection repair: if the selected item vanished, select the next
    // valid row and announce the removal (plan §8 inventory).
    if (selectedUid && !rows.some((r) => r.item.uid === selectedUid)) {
      const gone = selectedUid;
      selectedUid = null;
      const next = rows[0];
      if (next) selectedUid = next.item.uid;
      renderPack(`${labelFor(gone)} removed.`);
    }
    renderDetails();
  }

  function labelFor(uid: string): string {
    const item = currentInv.pack.find((i) => i.uid === uid);
    const def = item ? defs[item.defId] : undefined;
    if (def) return def.name;
    return nameMemory.get(uid) ?? 'Item';
  }

  function renderEquipment(): void {
    const inv = currentInv;
    equipList.replaceChildren();
    for (const slot of SLOT_ORDER_KEYS) {
      const item = inv.equipment[slot];
      const row = document.createElement('div');
      row.className = 'equip-row' + (selectedSlot === slot ? ' selected' : '');
      row.dataset.slot = slot;
      const label = document.createElement('span');
      label.className = 'slot-label';
      label.textContent = SLOT_LABELS[slot];
      const value = document.createElement('span');
      value.className = 'slot-value';
      value.textContent = item ? (defs[item.defId]?.name ?? item.defId) : '—';
      row.append(label, value);
      if (item) {
        const select = document.createElement('button');
        select.type = 'button';
        select.textContent = 'View';
        select.addEventListener('click', () => {
          selectedSlot = slot;
          selectedUid = null;
          renderLists();
          revealDetails();
        });
        row.appendChild(select);
      }
      equipList.appendChild(row);
    }
  }

  function renderDetails(): void {
    detailsHost.replaceChildren();
    const inv = currentInv;
    let def: ItemDefRuntime | undefined;
    let itemUid: string | null = null;
    let equippedDef: ItemDefRuntime | undefined;
    let primary: { label: string; run: () => void } | undefined;

    if (selectedUid) {
      const item = inv.pack.find((i) => i.uid === selectedUid);
      def = item ? defs[item.defId] : undefined;
      if (def && item) {
        itemUid = item.uid;
        if (def.slot) {
          const equippedItem = def.slot === 'ring1' || def.slot === 'ring2'
            ? inv.equipment.ring1 ?? inv.equipment.ring2
            : inv.equipment[def.slot];
          equippedDef = equippedItem ? defs[equippedItem.defId] : undefined;
          primary = { label: 'Equip', run: () => actions?.onEquip(item.uid) };
        } else if (def.consumable) {
          primary = { label: 'Use', run: () => actions?.onUse(item.uid) };
        }
      }
    } else if (selectedSlot) {
      const item = inv.equipment[selectedSlot];
      def = item ? defs[item.defId] : undefined;
      if (def && item) {
        itemUid = item.uid;
        primary = { label: 'Unequip', run: () => actions?.onUnequip(selectedSlot!) };
      }
    }

    if (discardUid !== itemUid) discardUid = null;

    if (!def) {
      const hint = document.createElement('p');
      hint.className = 'inv-hint';
      hint.textContent = 'Select an item to see its details.';
      detailsHost.appendChild(hint);
      return;
    }

    detailsHost.appendChild(itemDetails({ def, equipped: equippedDef }));

    if (primary) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'primary-action';
      btn.dataset.field = 'primary-action';
      btn.textContent = primary.label;
      btn.addEventListener('click', primary.run);
      detailsHost.appendChild(btn);
    }

    if (itemUid) {
      // F21: the operation is destructive — Discard, with an explicit
      // confirmation naming the item. No floor storage exists; a future
      // drop-and-recover feature needs its own specification.
      const itemName = def.name;
      const discardArea = document.createElement('div');
      discardArea.className = 'drop-area';
      const note = document.createElement('p');
      note.dataset.field = 'drop-note';
      note.textContent = 'Discarding destroys the item — it cannot be recovered. Floor storage does not exist yet.';
      const discard = document.createElement('button');
      discard.type = 'button';
      discard.textContent = 'Discard';
      discard.dataset.action = 'discard';
      discard.addEventListener('click', () => {
        discardUid = itemUid;
        renderDetails();
        detailsHost.querySelector<HTMLButtonElement>('[data-action="discard-confirm"]')?.focus();
      });
      if (discardUid === itemUid) {
        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'danger';
        confirmBtn.dataset.action = 'discard-confirm';
        confirmBtn.textContent = `Discard ${itemName}?`;
        confirmBtn.addEventListener('click', () => actions?.onDiscard(itemUid));
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.dataset.action = 'discard-cancel';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => {
          discardUid = null;
          renderDetails();
          detailsHost.querySelector<HTMLButtonElement>('[data-action="discard"]')?.focus();
        });
        discardArea.append(note, confirmBtn, cancel);
      } else {
        discardArea.append(note, discard);
      }
      detailsHost.appendChild(discardArea);
    }
  }

  function renderFooter(derived?: InventoryPanelData['derived']): void {
    for (const child of [...footer.children]) {
      if (child !== arrange) child.remove();
    }
    const info = document.createElement('span');
    info.className = 'inv-footer-info';
    const gold = document.createElement('span');
    gold.textContent = `Gold: ${currentInv.gold}`;
    const weight = document.createElement('span');
    weight.textContent = derived ? `Carried ${kg(derived.weightGrams)} / ${kg(derived.ratedMax)} rated` : '';
    const speed = document.createElement('span');
    speed.textContent = derived ? `Movement speed: ${derived.movementSpeedPercent}%` : '';
    info.append(gold, weight, speed);
    footer.insertBefore(info, arrange);
  }

  // --- State + refresh ------------------------------------------------------
  let currentInv = data.inv;
  let currentDerived = data.derived;

  filterBtns.all.classList.add('active');
  sortBtns.type.classList.add('active');
  renderTabs();
  renderLists();
  renderFooter(currentDerived);

  return {
    el,
    refresh(inv: Inventory, derived?: InventoryPanelData['derived']): void {
      currentInv = inv;
      if (derived !== undefined) currentDerived = derived;
      renderLists();
      renderFooter(currentDerived);
    },
    selectedUid: () => selectedUid,
  };
}

const SLOT_ORDER_KEYS: EquipSlot[] = [
  'weapon', 'shield', 'armor', 'helm', 'amulet',
  'cloak', 'boots', 'gauntlets', 'bracers', 'ring1', 'ring2',
];
