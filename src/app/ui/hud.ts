/**
 * HUD (UI plan §4): hero status entry (opens Character), location chip
 * (opens Map), pause button, and the four-entry action dock
 * Bag / Spells / Wait / Actions. Recent events open the full log. All controls expose
 * `data-action`; primary targets are >=48px via CSS tokens.
 */
import { groupLogEntries } from './logview';
import type { LogEntry } from '../../engine/types';

export interface HudSlot {
  spellId: string;
  label: string;
  cost: number;
  castable: boolean;
  reason?: string;
}

export interface HudState {
  name: string;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  gold: number;
  level: number;
  place: string;
  /** Quick-slot favorites in stable slot order. */
  slots?: HudSlot[];
  statuses?: string[];
}

export interface HudActions {
  onAction: (action: string) => void;
}

export interface Hud {
  el: HTMLElement;
  /** Recent grouped events (visual, not a live region). */
  logEl: HTMLElement;
  /** Announce one urgent event (damage/death/level-up) to assistive tech. */
  announce(text: string): void;
  update(state: HudState, log: LogEntry[]): void;
}

/** Dock entries, in the plan's fixed order. Wait never moves. */
const DOCK: ReadonlyArray<{ label: string; action: string }> = [
  { label: 'Bag', action: 'inventory' },
  { label: 'Spells', action: 'cast' },
  { label: 'Wait', action: 'wait' },
  { label: 'Actions', action: 'actions' },
];

/** Small text glyphs supplement spell names; names remain the accessible identity. */
export function spellGlyph(name: string): string {
  if (/heal|cure|neutralize/i.test(name)) return '+';
  if (/shield|resist|ward/i.test(name)) return '◇';
  if (/fire|flame|sunshine/i.test(name)) return '☀';
  if (/cold|ice|frost/i.test(name)) return '❄';
  if (/lightning|bolt/i.test(name)) return 'ϟ';
  if (/sleep|bedtime/i.test(name)) return 'Zz';
  if (/slow|paperwork/i.test(name)) return '⌛';
  if (/light|detect|clairvoyance/i.test(name)) return '◉';
  if (/teleport|return|door|levitat/i.test(name)) return '↗';
  if (/arrow|missile|dart/i.test(name)) return '➶';
  return '✦';
}

export function createHud(root: HTMLElement, actions: HudActions): Hud {
  const el = document.createElement('header');
  el.className = 'hud-bar';

  // Hero status entry: opens the Character sheet.
  const hero = document.createElement('button');
  hero.type = 'button';
  hero.className = 'hud-hero';
  hero.dataset.action = 'character';
  hero.setAttribute('aria-label', 'Character');
  hero.innerHTML = `
    <span class="hud-name" data-field="name"></span>
    <span data-field="level"></span>
    <span class="hud-bar-hp"><span class="pool-label">HP</span><span class="bar hp"><span class="fill" data-field="hp-fill"></span></span><span data-field="hp"></span></span>
    <span class="hud-bar-mana"><span class="pool-label">MP</span><span class="bar mana"><span class="fill" data-field="mana-fill"></span></span><span class="mana" data-field="mana"></span></span>
  `;
  const status = document.createElement('span');
  status.className = 'hud-status';
  status.hidden = true;
  hero.append(status);
  hero.title = 'Open character details';
  hero.addEventListener('click', () => actions.onAction('character'));

  const right = document.createElement('div');
  right.className = 'hud-right';

  // Location chip: opens the map.
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'hud-location';
  chip.dataset.action = 'map';
  chip.dataset.field = 'place';
  chip.textContent = '';
  chip.title = 'Open map (M)';
  chip.addEventListener('click', () => actions.onAction('map'));

  const pause = document.createElement('button');
  pause.type = 'button';
  pause.className = 'hud-pause';
  pause.dataset.action = 'pause';
  pause.setAttribute('aria-label', 'Pause');
  pause.textContent = '❚❚';
  pause.addEventListener('click', () => actions.onAction('pause'));

  right.append(chip, pause);

  // Recent event line + dock start inside the hud element; the controller
  // moves them into the bottom sheet region via mountSheetControls.
  const logEl = document.createElement('button');
  logEl.type = 'button';
  logEl.className = 'recent-event';
  logEl.dataset.action = 'log';
  logEl.setAttribute('aria-label', 'Open message history');
  const logPanel = document.createElement('section');
  logPanel.className = 'event-panel';
  logPanel.setAttribute('aria-label', 'Recent events');
  const logHeading = document.createElement('div');
  logHeading.className = 'event-heading';
  const history = document.createElement('button');
  history.type = 'button';
  history.textContent = 'Recent events ↗';
  history.setAttribute('aria-label', 'Open message history');
  history.addEventListener('click', () => actions.onAction('log'));
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'log-expand';
  expand.textContent = 'More';
  expand.setAttribute('aria-expanded', 'false');
  expand.setAttribute('aria-label', 'Expand recent events');
  expand.addEventListener('click', () => {
    const expanded = logPanel.classList.toggle('expanded');
    expand.setAttribute('aria-expanded', String(expanded));
    expand.setAttribute('aria-label', expanded ? 'Collapse recent events' : 'Expand recent events');
    expand.textContent = expanded ? 'Less' : 'More';
  });
  logHeading.append(history, expand);
  logPanel.append(logHeading, logEl);
  logEl.addEventListener('click', () => actions.onAction('log'));

  // Urgent announcements for assistive tech (UI plan §382): a dedicated
  // assertive region that only ever receives NEW relevant events (damage,
  // death, level-up). The visual recent-event line above stays silent.
  const announceEl = document.createElement('div');
  announceEl.className = 'sr-only-announce';
  announceEl.setAttribute('aria-live', 'assertive');
  announceEl.setAttribute('aria-atomic', 'true');

  const dock = document.createElement('div');
  dock.className = 'dock';
  for (const { label, action } of DOCK) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.action = action;
    const shortcut = { inventory: 'I', cast: 'C', wait: '.' }[action];
    if (shortcut) button.title = `${label} (${shortcut})`;
    button.addEventListener('click', () => actions.onAction(action));
    dock.appendChild(button);
  }

  // Assigned favorites retain their slot identity. Empty slots stay hidden.
  // Button references are kept (not re-queried): mountSheetControls moves
  // the quickbar out of this header element into the sheet region.
  const quickbar = document.createElement('div');
  quickbar.className = 'quickbar';
  const slotEls: HTMLButtonElement[] = [];
  const addSlot = (): void => {
    const i = slotEls.length;
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.dataset.action = `slot-${i}`;
    slot.disabled = true;
    slot.textContent = '☆';
    slot.addEventListener('click', () => actions.onAction(`slot-${i}`));
    quickbar.appendChild(slot);
    slotEls.push(slot);
  };
  addSlot();
  addSlot();

  el.append(hero, right, announceEl, logPanel, dock, quickbar);
  root.appendChild(el);

  return {
    el,
    logEl,
    /** Announce one urgent event to assistive tech (clears first so identical texts re-announce). */
    announce(text: string): void {
      announceEl.textContent = '';
      announceEl.textContent = text;
    },
    update(state: HudState, log: LogEntry[]): void {
      const set = (field: string, text: string): void => {
        const node = el.querySelector(`[data-field="${field}"]`);
        if (node) node.textContent = text;
      };
      set('name', state.name);
      set('level', `Lv ${state.level}`);
      set('hp', `${state.hp}/${state.maxHp}`);
      set('mana', `${state.mana}/${state.maxMana}`);
      chip.textContent = `Map · ${state.place}`;
      chip.setAttribute('aria-label', `Open map: ${state.place}`);
      hero.setAttribute('aria-label', `Character: ${state.name}, level ${state.level}, health ${state.hp} of ${state.maxHp}, mana ${state.mana} of ${state.maxMana}`);
      status.textContent = (state.statuses ?? []).join(' · ');
      status.hidden = !status.textContent;
      status.title = status.textContent;

      const pct = (cur: number, max: number): string =>
        `${max > 0 ? Math.round((cur / max) * 100) : 0}%`;
      const hpFill = el.querySelector<HTMLElement>('[data-field="hp-fill"]');
      if (hpFill) hpFill.style.width = pct(state.hp, state.maxHp);
      const manaFill = el.querySelector<HTMLElement>('[data-field="mana-fill"]');
      if (manaFill) manaFill.style.width = pct(state.mana, state.maxMana);

      const hpNode = el.querySelector('[data-field="hp"]');
      hpNode?.classList.toggle('low', state.hp * 4 <= state.maxHp);

      const entries = groupLogEntries(log.slice(-100)).slice(-3);
      const signature = JSON.stringify(entries);
      if (logEl.dataset.entries !== signature) {
        logEl.dataset.entries = signature;
        logEl.replaceChildren(...entries.map(entry => {
          const line = document.createElement('span');
          line.className = 'recent-event-line';
          line.textContent = `${entry.text}${entry.count > 1 ? ` ×${entry.count}` : ''}`;
          return line;
        }));
      }
      logPanel.hidden = entries.length === 0;

      // Quick slots: render favorite spells (or stable empty markers).
      const slots = state.slots ?? [];
      quickbar.hidden = slots.length === 0;
      while (slotEls.length < slots.length) addSlot();
      slotEls.forEach((slotEl, i) => {
        const s = slots[i];
        slotEl.hidden = !s;
        if (!s) {
          slotEl.disabled = true;
          slotEl.textContent = '☆';
          slotEl.setAttribute('aria-label', `Favorite slot ${i + 1} (empty)`);
          slotEl.removeAttribute('title');
          return;
        }
        const glyph = document.createElement('span');
        glyph.className = 'spell-glyph';
        glyph.setAttribute('aria-hidden', 'true');
        glyph.textContent = spellGlyph(s.label);
        const name = document.createElement('span');
        name.className = 'shortcut-name';
        name.textContent = s.label;
        const cost = document.createElement('span');
        cost.className = 'shortcut-cost';
        cost.textContent = `${s.cost} MP`;
        slotEl.replaceChildren(glyph, name, cost);
        slotEl.disabled = !s.castable;
        slotEl.setAttribute('aria-label', s.castable ? `Cast ${s.label}, ${s.cost} mana` : `${s.label}, ${s.cost} mana — ${s.reason ?? 'unavailable'}`);
        if (s.reason) slotEl.setAttribute('title', s.reason);
        else slotEl.removeAttribute('title');
      });
    },
  };
}

/** Move the recent-event line + dock (with quick slots) into the sheet region. */
export function mountSheetControls(hud: Hud, sheetEl: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-inner';
  const cluster = document.createElement('div');
  cluster.className = 'action-cluster';
  const quickbar = hud.el.querySelector('.quickbar');
  if (quickbar) cluster.append(quickbar);
  cluster.append(hud.el.querySelector('.dock') ?? document.createElement('div'));
  wrap.append(hud.logEl.closest('.event-panel') ?? hud.logEl, cluster);
  sheetEl.appendChild(wrap);
}
