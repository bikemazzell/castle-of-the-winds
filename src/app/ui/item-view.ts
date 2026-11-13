/**
 * Shared item presentation for Inventory and shops (UI plan Phase 5).
 *
 * One component renders an item everywhere: a compact row (icon, name,
 * count, equipped state) and a details pane with engine-derived stats and
 * an equipment comparison. Comparisons show raw engine values with a
 * better-direction hint — no invented single "power score" (plan §8).
 */
import type { EquipSlot, InventoryItem, ItemDefRuntime } from '../../engine/types';

/** Slots named as the player sees them; the two ring slots are distinct. */
export const SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: 'Weapon',
  shield: 'Shield',
  armor: 'Armor',
  helm: 'Helm',
  boots: 'Boots',
  gauntlets: 'Gauntlets',
  bracers: 'Bracers',
  cloak: 'Cloak',
  ring1: 'Left Ring',
  ring2: 'Right Ring',
  amulet: 'Amulet',
};

const KIND_ICON_COLORS: Record<string, string> = {
  armor: '#7d8ba6',
  helmet: '#9aa5b8',
  shield: '#b08d57',
  weapon: '#c8ccd4',
  misc: '#c78ad0',
};

export function kindColor(def: ItemDefRuntime): string {
  return KIND_ICON_COLORS[def.kind] ?? '#8a93a3';
}

const kg = (g: number | undefined): string => (g === undefined ? '—' : `${(g / 1000).toFixed(1)} kg`);

export interface ItemRowOptions {
  item: InventoryItem;
  def: ItemDefRuntime;
  equipped?: boolean;
  selected?: boolean;
  onClick?: () => void;
}

/** Compact row: icon, name, count, equipped badge. Selection is visual only. */
export function itemRow({ item, def, equipped, selected, onClick }: ItemRowOptions): HTMLElement {
  const row = document.createElement('div');
  row.className = 'item-row' + (selected ? ' selected' : '');
  row.dataset.uid = item.uid;
  if (onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item-row-button';
    btn.addEventListener('click', onClick);
    row.appendChild(btn);
    attachRowContent(btn, item, def, equipped);
  } else {
    attachRowContent(row, item, def, equipped);
  }
  return row;
}

function attachRowContent(host: HTMLElement, item: InventoryItem, def: ItemDefRuntime, equipped?: boolean): void {
  const icon = document.createElement('span');
  icon.className = 'item-icon';
  icon.style.background = kindColor(def);
  icon.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'item-name';
  name.textContent = def.name;
  host.append(icon, name);
  if (item.count > 1) {
    const count = document.createElement('span');
    count.className = 'item-count';
    count.textContent = `×${item.count}`;
    host.appendChild(count);
  }
  if (equipped) {
    const badge = document.createElement('span');
    badge.className = 'item-badge';
    badge.dataset.field = 'equipped';
    badge.textContent = 'Equipped';
    host.appendChild(badge);
  }
}

export interface CompareRow {
  label: string;
  candidate: number | null;
  current: number | null;
  better: 'higher' | 'lower';
}

/**
 * Engine-derived comparison rows between a candidate item and what is
 * currently equipped. `better` states which direction is an improvement so
 * the UI can explain, not score.
 */
export function compareEquipment(candidate: ItemDefRuntime, current?: ItemDefRuntime): CompareRow[] {
  const rows: CompareRow[] = [];
  if (candidate.armorClass !== undefined || current?.armorClass !== undefined) {
    rows.push({
      label: 'Armor protection (higher is better)',
      candidate: candidate.armorClass ?? null,
      current: current?.armorClass ?? null,
      better: 'higher',
    });
  }
  if (candidate.weaponClass !== undefined || current?.weaponClass !== undefined) {
    rows.push({
      label: 'Weapon damage class (higher is better)',
      candidate: candidate.weaponClass ?? null,
      current: current?.weaponClass ?? null,
      better: 'higher',
    });
  }
  rows.push({
    label: 'Weight (lower is better)',
    candidate: candidate.weightGrams ?? null,
    current: current?.weightGrams ?? null,
    better: 'lower',
  });
  return rows;
}

export interface ItemDetailsOptions {
  def: ItemDefRuntime;
  item?: InventoryItem;
  equipped?: ItemDefRuntime;
}

/** Details pane: identity, weight, stats, and equipment comparison. */
export function itemDetails({ def, equipped }: ItemDetailsOptions): HTMLElement {
  const el = document.createElement('div');
  el.className = 'item-details';
  el.dataset.field = 'item-details';

  const name = document.createElement('h4');
  name.className = 'item-details-name';
  name.textContent = def.name;
  el.appendChild(name);

  const kindLine = document.createElement('p');
  kindLine.className = 'item-kind';
  kindLine.textContent = def.kind === 'misc' ? 'Miscellaneous' : def.kind.charAt(0).toUpperCase() + def.kind.slice(1);
  el.appendChild(kindLine);

  const weight = document.createElement('p');
  weight.textContent = `Weight: ${kg(def.weightGrams)}`;
  el.appendChild(weight);

  if (equipped && equipped.id !== def.id) {
    const heading = document.createElement('h5');
    heading.textContent = `Compared with ${equipped.name}`;
    el.appendChild(heading);
    const table = document.createElement('div');
    table.className = 'item-compare';
    for (const row of compareEquipment(def, equipped)) {
      const line = document.createElement('div');
      line.className = 'compare-row';
      const label = document.createElement('span');
      label.textContent = row.label;
      const values = document.createElement('span');
      values.className = 'compare-values';
      values.textContent = `${row.candidate ?? '—'} vs ${row.current ?? '—'}`;
      line.append(label, values);
      table.appendChild(line);
    }
    el.appendChild(table);
  }

  return el;
}
