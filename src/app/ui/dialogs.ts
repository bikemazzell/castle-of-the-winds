/**
 * Modal dialog system + game dialogs.
 *
 * Modals stack; Escape closes the topmost only. Every open/close dispatches a
 * `cotw:modal` window event with `{open: <count of open modals>}` so the input
 * layer can gate gameplay input while a dialog is up (Task 5.3 contract).
 * `.dialog` keeps `touch-action: auto` so lists scroll naturally on touch.
 */
import type { Player } from '../../engine/types';
import { xpThresholdFor } from '../../engine/formulas';
import { ownFocus } from './focus';

export interface ModalOptions {
  title: string;
  content: HTMLElement;
  onClose?: () => void;
  /** Clicking the backdrop closes (default true). */
  closeOnOverlay?: boolean;
  /** Extra class for the dialog element. */
  className?: string;
}

export interface ModalHandle {
  el: HTMLElement;
  close(): void;
}

const openStack: ModalHandleImpl[] = [];

/** Stable id source for dialog title association (A15). */
let nextTitleId = 1;

class ModalHandleImpl implements ModalHandle {
  readonly el: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly onClose?: () => void;
  private readonly releaseFocus: () => void;
  private closed = false;

  constructor(opts: ModalOptions) {
    this.onClose = opts.onClose;

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';

    this.el = document.createElement('div');
    this.el.className = `dialog${opts.className ? ` ${opts.className}` : ''}`;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');

    const header = document.createElement('div');
    header.className = 'dialog-header';
    const title = document.createElement('h2');
    title.className = 'dialog-title';
    title.id = `dialog-title-${nextTitleId++}`;
    title.textContent = opts.title;
    this.el.setAttribute('aria-labelledby', title.id);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'dialog-close';
    closeBtn.dataset.action = 'close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => this.close());
    header.append(title, closeBtn);

    const body = document.createElement('div');
    body.className = 'dialog-body';
    body.appendChild(opts.content);

    this.el.append(header, body);
    this.overlay.appendChild(this.el);
    this.overlay.addEventListener('click', (e) => {
      if (opts.closeOnOverlay !== false && e.target === this.overlay) this.close();
    });
    document.body.appendChild(this.overlay);
    // Focus entry (A15): keyboard users land inside the dialog, not behind it.
    this.releaseFocus = ownFocus(this.overlay, closeBtn);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const i = openStack.indexOf(this);
    if (i >= 0) openStack.splice(i, 1);
    this.overlay.remove();
    this.releaseFocus();
    if (openStack.length === 0) document.removeEventListener('keydown', onKeydown);
    this.onClose?.();
    announce(openStack.length);
  }
}

function announce(openCount: number): void {
  window.dispatchEvent(new CustomEvent('cotw:modal', { detail: { open: openCount } }));
}

function onKeydown(e: KeyboardEvent): void {
  const top = openStack[openStack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation(); // window-level game handlers must not also see this Escape
    top.close();
    return;
  }
}

export function openModal(opts: ModalOptions): ModalHandle {
  if (openStack.length === 0) {
    document.addEventListener('keydown', onKeydown);
  }
  const handle = new ModalHandleImpl(opts);
  openStack.push(handle);
  announce(openStack.length);
  return handle;
}

/** Number of currently open modals (0 = gameplay input allowed). */
export function openModalCount(): number {
  return openStack.length;
}

/** Closes every open modal (topmost first). Test/app shutdown helper. */
export function closeAllModals(): void {
  while (openStack.length > 0) {
    openStack[openStack.length - 1]?.close();
  }
}

// ─── Character sheet ────────────────────────────────────────────────────────

export interface DerivedStats {
  armorValue: number;
  weaponClass: number;
  toHit: number;
  damage: number;
  weightGrams: number;
  ratedMax: number;
  movementSpeedPercent: number;
}

export interface CharacterDialogData {
  player: Player;
  thresholds?: number[];
  derived?: DerivedStats;
}

function row(label: string, value: string, field?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'char-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'char-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'char-value';
  if (field) valueEl.dataset.field = field;
  valueEl.textContent = value;
  el.append(labelEl, valueEl);
  return el;
}

function section(title: string, rows: HTMLElement[]): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'char-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  wrap.append(heading, ...rows);
  return wrap;
}

const STAT_LABELS: ReadonlyArray<{
  key: 'strength' | 'intelligence' | 'constitution' | 'dexterity';
  maxKey: 'maxStrength' | 'maxIntelligence' | 'maxConstitution' | 'maxDexterity';
  short: string;
  field: string;
}> = [
  { key: 'strength', maxKey: 'maxStrength', short: 'Strength', field: 'str' },
  { key: 'intelligence', maxKey: 'maxIntelligence', short: 'Intelligence', field: 'int' },
  { key: 'constitution', maxKey: 'maxConstitution', short: 'Constitution', field: 'con' },
  { key: 'dexterity', maxKey: 'maxDexterity', short: 'Dexterity', field: 'dex' },
];

export function buildCharacterContent(data: CharacterDialogData): HTMLElement {
  const p = data.player;
  const el = document.createElement('div');
  el.className = 'character-sheet';

  const nextXp = data.thresholds
    ? p.level < data.thresholds.length
      ? String(xpThresholdFor(p.level + 1, data.thresholds, p.difficulty))
      : '—'
    : '';

  el.append(
    section('Character', [
      row('Name', p.name, 'name'),
      row('Gender', p.gender, 'gender'),
      row('Difficulty', p.difficulty, 'difficulty'),
      row('Level', String(p.level), 'level'),
      row('Experience', String(p.experience), 'experience'),
      row('Next level at', nextXp, 'next-xp'),
    ]),
    section('Pools', [
      row('Hit points', `${p.hp} / ${p.maxHp}`, 'hp'),
      row('Mana', `${p.mana} / ${p.maxMana}`, 'mana'),
    ]),
    section('Attributes', STAT_LABELS.map(({ key, maxKey, short, field }) =>
      row(short, `${p[key]} / ${p[maxKey]}`, field),
    )),
  );

  if (data.derived) {
    const d = data.derived;
    const kg = (g: number): string => `${(g / 1000).toFixed(1)} kg`;
    el.append(
      section('Combat & load', [
        row('Armor value', String(d.armorValue), 'armor'),
        row('Weapon class', String(d.weaponClass), 'weapon'),
        row('To-hit bonus', String(d.toHit), 'tohit'),
        row('Damage bonus', String(d.damage), 'damage'),
        row('Carried', `${kg(d.weightGrams)} / ${kg(d.ratedMax)} rated`, 'carry'),
        row('Movement speed', `${d.movementSpeedPercent}%`, 'speed'),
      ]),
    );
  }

  const statusRow = row(
    'Statuses',
    p.statuses.length > 0
      ? p.statuses.map((s) => `${s.kind} (${s.remainingTurns})`).join(', ')
      : 'None',
    'statuses',
  );
  const spellsRow = row('Spells known', String(p.knownSpells.length), 'spells');
  el.prepend(section('Effects & knowledge', [statusRow, spellsRow]));
  const pools = [...el.querySelectorAll<HTMLElement>('.char-section')].find(
    (section) => section.querySelector('[data-field="hp"]'),
  );
  if (pools) {
    pools.querySelector('h3')!.textContent = 'Health & mana';
    el.prepend(pools);
  }

  return el;
}

export function openCharacterDialog(data: CharacterDialogData): ModalHandle {
  return openModal({
    title: `${data.player.name} — Character`,
    content: buildCharacterContent(data),
    className: 'dialog-character',
  });
}
