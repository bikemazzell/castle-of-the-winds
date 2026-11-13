/**
 * Settings (working preferences, UI plan Phase 7) + Rest dialog.
 *
 * The legacy INI-mirror checkboxes (VisualEffects/AutoArrange/FastMapDisplay)
 * had no gameplay consumers; they were replaced by preferences that actually
 * change behavior: text size, map scale, reduced motion, and safe travel
 * confirmation. State accumulates locally across changes (A17) and persists
 * as one object through the injected storage.
 */
import type { GamePreferences } from '../prefs';
import { openModal, type ModalHandle } from './dialogs';

export interface PreferencesDialogData {
  prefs: GamePreferences;
  onChange: (prefs: GamePreferences) => void;
}

const TEXT_SCALE_STEPS: ReadonlyArray<{ value: GamePreferences['textScale']; label: string }> = [
  { value: 1, label: '100%' },
  { value: 1.25, label: '125%' },
  { value: 1.5, label: '150%' },
  { value: 1.75, label: '175%' },
  { value: 2, label: '200%' },
];

const MAP_SCALE_STEPS: ReadonlyArray<{ value: GamePreferences['mapScale']; label: string }> = [
  { value: -1, label: 'Smaller' },
  { value: 0, label: 'Default' },
  { value: 1, label: 'Larger' },
];

const REDUCE_MOTION_STEPS: ReadonlyArray<{ value: GamePreferences['reduceMotion']; label: string }> = [
  { value: 'system', label: 'Follow system' },
  { value: 'on', label: 'Always reduce' },
  { value: 'off', label: 'Never reduce' },
];

function segmentedRow(
  label: string,
  hint: string,
  steps: ReadonlyArray<{ value: string | number | boolean; label: string }>,
  activeValue: string | number | boolean,
  attr: string,
  onPick: (value: string) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'option-row';
  const name = document.createElement('span');
  name.className = 'char-value';
  name.textContent = label;
  const sub = document.createElement('small');
  sub.textContent = hint;
  row.append(name, document.createElement('br'), sub);
  const group = document.createElement('div');
  group.className = 'segmented';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  for (const step of steps) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = step.label;
    if (step.value === activeValue) btn.classList.add('active');
    btn.setAttribute(attr, String(step.value));
    btn.addEventListener('click', () => {
      onPick(String(step.value));
    });
    group.appendChild(btn);
  }
  row.appendChild(group);
  return row;
}

export function buildPreferencesContent(data: PreferencesDialogData): HTMLElement {
  const el = document.createElement('div');
  el.className = 'options-dialog';

  // Track the LATEST state locally: spreading data.prefs on every change
  // would silently revert earlier changes made in the same dialog session
  // (UI plan Phase 1, A17).
  let current: GamePreferences = { ...data.prefs };
  const emit = (): void => {
    for (const [attr,value] of [['data-text-scale',current.textScale],['data-map-scale',current.mapScale],['data-reduce-motion',current.reduceMotion]] as const) {
      for (const button of el.querySelectorAll<HTMLButtonElement>(`button[${attr}]`)) {
        const active = button.getAttribute(attr) === String(value);
        button.classList.toggle('active',active);
        button.setAttribute('aria-pressed',String(active));
      }
    }
    const safe = el.querySelector<HTMLInputElement>('[data-option="safe-confirmation"]');
    const blood = el.querySelector<HTMLInputElement>('[data-option="blood"]');
    if (safe) safe.checked = current.safeConfirmation;
    if (blood) blood.checked = current.blood !== false;
    data.onChange({ ...current });
  };

  el.appendChild(
    segmentedRow(
      'Text size',
      'Scales all interface text',
      TEXT_SCALE_STEPS,
      current.textScale,
      'data-text-scale',
      (v) => {
        current = { ...current, textScale: Number(v) as GamePreferences['textScale'] };
        emit();
      },
    ),
  );

  el.appendChild(
    segmentedRow(
      'Map tiles',
      'Zoom the world map in or out',
      MAP_SCALE_STEPS,
      current.mapScale,
      'data-map-scale',
      (v) => {
        current = { ...current, mapScale: Number(v) as GamePreferences['mapScale'] };
        emit();
      },
    ),
  );

  el.appendChild(
    segmentedRow(
      'Reduce motion',
      'Freezes idle motion, foliage, flames, and action effects',
      REDUCE_MOTION_STEPS,
      current.reduceMotion,
      'data-reduce-motion',
      (v) => {
        current = { ...current, reduceMotion: v as GamePreferences['reduceMotion'] };
        emit();
      },
    ),
  );

  const confirmRow = document.createElement('label');
  confirmRow.className = 'option-row';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.dataset.option = 'safe-confirmation';
  box.checked = current.safeConfirmation;
  box.addEventListener('change', () => {
    current = { ...current, safeConfirmation: box.checked };
    emit();
  });
  const text = document.createElement('span');
  const name = document.createElement('span');
  name.className = 'char-value';
  name.textContent = 'Safe travel confirmation';
  const sub = document.createElement('small');
  sub.textContent = 'Mouse travel asks for a confirm tap, like touch';
  text.append(name, document.createElement('br'), sub);
  confirmRow.append(box, text);
  el.appendChild(confirmRow);

  const bloodRow = document.createElement('label');
  bloodRow.className = 'option-row';
  const bloodBox = document.createElement('input');
  bloodBox.type = 'checkbox'; bloodBox.dataset.option = 'blood'; bloodBox.checked = current.blood !== false;
  bloodBox.addEventListener('change', () => { current = {...current,blood:bloodBox.checked}; emit(); });
  bloodRow.append(bloodBox, document.createTextNode('Blood and debris'));
  el.appendChild(bloodRow);

  const footer = document.createElement('div');
  footer.className = 'options-footer';
  const restore = document.createElement('button');
  restore.type = 'button';
  restore.textContent = 'Restore Defaults';
  restore.dataset.action = 'restore-defaults';
  restore.addEventListener('click', () => {
    current = { textScale: 1, mapScale: 0, reduceMotion: 'system', safeConfirmation: false, blood: true };
    emit();
  });
  footer.appendChild(restore);
  el.appendChild(footer);

  return el;
}

export function openPreferencesDialog(data: PreferencesDialogData): ModalHandle {
  return openModal({
    title: 'Options',
    content: buildPreferencesContent(data),
    className: 'dialog-options',
  });
}

// ─── Rest ────────────────────────────────────────────────────────────────────

export interface RestDialogData {
  onRest: () => void;
  hpMissing: number;
  manaMissing: number;
}

export function buildRestContent(data: RestDialogData): HTMLElement {
  const el = document.createElement('div');
  el.className = 'rest-dialog';

  const status = document.createElement('p');
  status.textContent = `You are missing ${data.hpMissing} hit point${data.hpMissing === 1 ? '' : 's'} and ${data.manaMissing} mana.`;
  const warn = document.createElement('p');
  warn.textContent = 'Resting recovers both hit points and mana — monsters that see you will interrupt your rest.';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Rest until recovered';
  btn.dataset.action = 'rest';
  const nothingToRecover = data.hpMissing === 0 && data.manaMissing === 0;
  if (nothingToRecover) {
    btn.disabled = true;
    warn.textContent = 'You are fully rested.';
  } else {
    btn.addEventListener('click', () => data.onRest());
  }

  el.append(status, warn, btn);
  return el;
}

export function openRestDialog(data: RestDialogData): ModalHandle {
  return openModal({
    title: 'Rest',
    content: buildRestContent(data),
    className: 'dialog-rest',
  });
}
