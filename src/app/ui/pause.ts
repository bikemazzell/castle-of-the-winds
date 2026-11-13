/**
 * Pause screen (UI plan §4): opened from gameplay by Esc or the Pause
 * button. Rendered through the shared modal system so it inherits focus
 * containment, Escape handling, and the input gate — pausing consumes no
 * turn and blocks map commands.
 */
import { openModal, type ModalHandle } from './dialogs';

export interface PauseSummary {
  name: string;
  level: number;
  place: string;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  /** True when progress exists that is not in any save slot. */
  unsaved: boolean;
}

export interface PauseOptions {
  summary: PauseSummary;
  onResume: () => void;
  onSaveLoad: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onQuit: () => void;
  onDebug?: () => void;
}

/** Open the pause screen; closing it (Escape / Resume) resumes the game. */
export function openPauseScreen(options: PauseOptions): ModalHandle {
  const { summary } = options;
  const content = document.createElement('div');
  content.className = 'pause-list';

  const recap = document.createElement('p');
  recap.className = 'pause-recap';
  recap.textContent =
    `${summary.name} Lv ${summary.level} — ${summary.place} — ` +
    `HP ${summary.hp}/${summary.maxHp} MP ${summary.mana}/${summary.maxMana}`;
  content.appendChild(recap);

  if (summary.unsaved) {
    const note = document.createElement('p');
    note.className = 'pause-unsaved';
    note.textContent = 'Unsaved progress';
    content.appendChild(note);
  }

  // Escape and the × button mean Resume; explicit commands must not also
  // fire the resume callback (UI plan §4: Esc closes the screen and
  // restores gameplay focus).
  let chose = false;
  const handle = openModal({
    title: 'Paused',
    content,
    className: 'pause',
    closeOnOverlay: false,
    onClose: () => {
      if (!chose) options.onResume();
    },
  });

  const rows: Array<[string, () => void]> = [
    ['Resume', options.onResume],
    ['Save / Load', options.onSaveLoad],
    ['Settings', options.onSettings],
    ['Help', options.onHelp],
    ...(options.onDebug ? [['Debug', options.onDebug] as [string, () => void]] : []),
    ['Quit to Title', options.onQuit],
  ];
  for (const [label, fn] of rows) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.dataset.pauseAction = (label.split(' ')[0] ?? '').toLowerCase();
    btn.addEventListener('click', () => {
      chose = true;
      handle.close();
      fn();
    });
    content.appendChild(btn);
  }
  // The dialog's focus entry lands on the header close button; the pause
  // screen's primary action is Resume (UI plan §4).
  content.querySelector<HTMLButtonElement>('[data-pause-action="resume"]')?.focus();

  return handle;
}
