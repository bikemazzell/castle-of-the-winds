/**
 * New-game wizard + death screen (Task 5.4g).
 *
 * Creation mirrors the original dialog (manual 22 / overview): name, gender,
 * four attribute bars on a shared point pool, difficulty. The original's
 * custom player-icon picker is not ported (single extracted sprite set — see
 * docs/EXTRACTION-GAPS.md). The death screen replaces the original R.I.P.
 * bitmap + high-score list with the essentials for continuing play.
 */
import type { CharacterInit } from '../../engine/character';
import { STAT_MAX, STAT_MIN, STAT_POOL } from '../../engine/formulas';
import type { Difficulty, Gender } from '../../engine/types';
import { openModal, type ModalHandle } from './dialogs';

export interface NewGameOptions {
  onBegin: (init: CharacterInit) => void;
  defaults?: Partial<CharacterInit>;
  /** Part 2 only — opens the Part 1 character import flow (Task P7). */
  onImportP1?: () => void;
}

const STAT_FIELDS: ReadonlyArray<{
  key: 'strength' | 'intelligence' | 'constitution' | 'dexterity';
  label: string;
  help: string;
}> = [
  {
    key: 'strength',
    label: 'Strength',
    help: 'Melee damage and how much you can carry.',
  },
  {
    key: 'intelligence',
    label: 'Intelligence',
    help: 'Your mana pool and how cheaply you cast spells.',
  },
  {
    key: 'constitution',
    label: 'Constitution',
    help: 'Your hit points and how fast they return.',
  },
  {
    key: 'dexterity',
    label: 'Dexterity',
    help: 'Your armor, your aim, and trap disarming.',
  },
];

const DIFFICULTIES: ReadonlyArray<Difficulty> = ['easy', 'intermediate', 'difficult', 'expert'];

const DIFFICULTY_HELP: Record<Difficulty, string> = {
  easy: 'An easier start — weaker foes, gentler traps, faster progress.',
  intermediate: 'The intended balance of the original game.',
  difficult: 'More monsters and traps; progress costs more experience.',
  expert: 'Deadly — for veterans of the original.',
};

/** Ready-to-play allocations; each spends the full 200-point pool. */
const PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  stats: { strength: number; intelligence: number; constitution: number; dexterity: number };
}> = [
  {
    id: 'balanced',
    label: 'Balanced',
    stats: { strength: 50, intelligence: 50, constitution: 50, dexterity: 50 },
  },
  {
    id: 'warrior',
    label: 'Warrior',
    stats: { strength: 70, intelligence: 30, constitution: 60, dexterity: 40 },
  },
  {
    id: 'wizard',
    label: 'Wizard',
    stats: { strength: 30, intelligence: 70, constitution: 40, dexterity: 60 },
  },
];


export function buildNewGameContent(opts: NewGameOptions): HTMLElement {
  const defaults = {
    gender: 'female' as Gender,
    strength: 50,
    intelligence: 50,
    constitution: 50,
    dexterity: 50,
    difficulty: 'intermediate' as Difficulty,
    ...opts.defaults,
    name: opts.defaults?.name ?? '',
  };

  const el = document.createElement('div');
  el.className = 'newgame-dialog';

  const statInputs = new Map<string, HTMLInputElement>();

  const errorEl = document.createElement('p');
  errorEl.dataset.field = 'error';
  errorEl.className = 'spell-reason';
  errorEl.textContent = '';

  // Name
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 24;
  nameInput.dataset.field = 'name';
  nameInput.value = defaults.name;
  nameLabel.appendChild(nameInput);

  // Gender
  const genderField = document.createElement('fieldset');
  const genderLegend = document.createElement('legend');
  genderLegend.textContent = 'Gender';
  genderField.appendChild(genderLegend);
  for (const g of ['female', 'male'] as Gender[]) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'gender';
    radio.value = g;
    radio.checked = defaults.gender === g;
    label.append(radio, document.createTextNode(g));
    genderField.appendChild(label);
  }

  // Play-style presets (ready-to-play allocations; manual edits below)
  const presetSection = document.createElement('div');
  presetSection.className = 'preset-row';
  const presetHeader = document.createElement('h4');
  presetHeader.textContent = 'Play style';
  presetSection.appendChild(presetHeader);
  const presetButtons: HTMLButtonElement[] = [];
  let applyingPreset = false;

  function setActivePreset(id: string | null): void {
    for (const btn of presetButtons) {
      const active = btn.dataset.preset === id;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
  }

  for (const preset of PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.preset = preset.id;
    btn.textContent = preset.label;
    btn.addEventListener('click', () => {
      applyingPreset = true;
      for (const [key, value] of Object.entries(preset.stats)) {
        const input = statInputs.get(key);
        if (input) {
          input.value = String(value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      applyingPreset = false;
      setActivePreset(preset.id);
    });
    presetButtons.push(btn);
    presetSection.appendChild(btn);
  }

  // Stats (manual allocation under its own heading)
  const statSection = document.createElement('div');
  statSection.className = 'stat-grid';
  const custom = document.createElement('details');
  custom.className = 'custom-attributes';
  const statsHeader = document.createElement('summary');
  statsHeader.textContent = 'Customize attributes';
  const poolLine = document.createElement('p');
  const poolLabel = document.createElement('span');
  poolLabel.textContent = 'Points remaining: ';
  const poolRemaining = document.createElement('b');
  poolRemaining.dataset.field = 'pool-remaining';
  poolLine.append(poolLabel, poolRemaining);


  function statValue(key: string): number {
    const input = statInputs.get(key);
    const n = input ? Number.parseInt(input.value, 10) : Number.NaN;
    return Number.isFinite(n) ? n : 50;
  }

  function refreshPool(): void {
    const used = ['strength', 'intelligence', 'constitution', 'dexterity']
      .map(statValue)
      .reduce((a, b) => a + b, 0);
    poolRemaining.textContent = String(STAT_POOL - used);
    beginBtn.disabled = nameInput.value.trim() === '' || used > STAT_POOL;
    if (used > STAT_POOL) {
      errorEl.textContent = `Stat pool exceeded: ${used} > ${STAT_POOL}. Lower some attributes.`;
    } else {
      errorEl.textContent = nameInput.value.trim() === '' ? 'Enter a name to begin.' : '';
    }
  }

  for (const { key, label, help } of STAT_FIELDS) {
    const row = document.createElement('div');
    row.className = 'stat-row';
    const text = document.createElement('span');
    text.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(STAT_MIN);
    input.max = String(STAT_MAX);
    input.dataset.stat = key;
    input.setAttribute('aria-label', label);
    input.value = String(defaults[key]);
    statInputs.set(key, input);

    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '−';
    down.dataset.step = 'down';
    down.setAttribute('aria-label', `Decrease ${label}`);
    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '+';
    up.dataset.step = 'up';
    up.setAttribute('aria-label', `Increase ${label}`);
    down.addEventListener('click', () => {
      input.value = String(Math.max(STAT_MIN, statValue(key) - 1));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    up.addEventListener('click', () => {
      input.value = String(Math.min(STAT_MAX, statValue(key) + 1));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    input.addEventListener('input', () => {
      refreshPool();
      if (!applyingPreset) setActivePreset(null);
    });
    const helpEl = document.createElement('p');
    helpEl.className = 'stat-help';
    helpEl.dataset.statHelp = key;
    helpEl.textContent = help;
    row.append(down, text, input, up);
    statSection.appendChild(row);
    statSection.appendChild(helpEl);
  }

  // Initial preset highlight: active only when defaults match a preset exactly.
  const matchingPreset = PRESETS.find(
    (p) =>
      p.stats.strength === defaults.strength &&
      p.stats.intelligence === defaults.intelligence &&
      p.stats.constitution === defaults.constitution &&
      p.stats.dexterity === defaults.dexterity,
  );
  setActivePreset(matchingPreset?.id ?? null);

  // Difficulty
  const diffField = document.createElement('fieldset');
  const diffLegend = document.createElement('legend');
  diffLegend.textContent = 'Difficulty';
  diffField.appendChild(diffLegend);
  for (const d of DIFFICULTIES) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'difficulty';
    radio.value = d;
    radio.checked = defaults.difficulty === d;
    const radioLine = document.createElement('span');
    radioLine.textContent = d;
    const helpEl = document.createElement('span');
    helpEl.className = 'diff-help';
    helpEl.dataset.diffHelp = d;
    helpEl.textContent = DIFFICULTY_HELP[d];
    label.append(radio, radioLine, helpEl);
    diffField.appendChild(label);
  }

  const beginBtn = document.createElement('button');
  beginBtn.type = 'button';
  beginBtn.className = 'begin-btn';
  beginBtn.textContent = 'Begin the adventure';
  beginBtn.dataset.action = 'begin';
  beginBtn.addEventListener('click', () => {
    const init = getCurrent();
    const used = init.strength + init.intelligence + init.constitution + init.dexterity;
    if (init.name.trim() === '' || used > STAT_POOL) {
      refreshPool();
      return;
    }
    opts.onBegin(init);
  });

  custom.append(statsHeader, poolLine, statSection);
  const fields = document.createElement('div');
  fields.className = 'newgame-fields';
  fields.append(nameLabel, genderField, presetSection, diffField, custom);
  const footer = document.createElement('div');
  footer.className = 'newgame-footer';
  errorEl.setAttribute('aria-live', 'polite');
  footer.append(errorEl, beginBtn);
  // Part-2 only: continue with a Part 1 character (PART2-PLAN Task P7).
  if (opts.onImportP1) {
    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'import-p1-btn';
    importBtn.textContent = 'Import Part 1 Character…';
    importBtn.dataset.action = 'import-p1';
    importBtn.addEventListener('click', () => {
      opts.onImportP1?.();
    });
    const importErr = document.createElement('p');
    importErr.dataset.field = 'import-error';
    importErr.className = 'spell-reason';
    importErr.setAttribute('aria-live', 'polite');
    importErr.textContent = '';
    footer.append(importBtn, importErr);
  }
  el.append(fields, footer);


  function getCurrent(): CharacterInit {
    const checked = (sel: string): HTMLInputElement | null =>
      el.querySelector(`input[name="${sel}"]:checked`);
    return {
      name: nameInput.value.trim(),
      gender: (checked('gender')?.value ?? 'female') as Gender,
      strength: statValue('strength'),
      intelligence: statValue('intelligence'),
      constitution: statValue('constitution'),
      dexterity: statValue('dexterity'),
      difficulty: (checked('difficulty')?.value ?? 'intermediate') as Difficulty,
    };
  }

  nameInput.addEventListener('input', refreshPool);
  refreshPool();

  return el;
}

export function openNewGameDialog(opts: NewGameOptions): ModalHandle {
  return openModal({
    title: 'New Game',
    content: buildNewGameContent(opts),
    className: 'dialog-newgame',
  });
}

// ─── Death screen ────────────────────────────────────────────────────────────

export interface DeathDialogData {
  name: string;
  killedBy: string;
  level: number;
  turns: number;
  gold: number;
  /** Last relevant log lines, shown so the player can see what led here. */
  recentEvents?: string[];
  onNewGame: () => void;
  onLoad: () => void;
  onDismiss?: () => void;
}

export function buildDeathContent(data: DeathDialogData): HTMLElement {
  const el = document.createElement('div');
  el.className = 'death-dialog';

  const title = document.createElement('h3');
  title.textContent = `${data.name} has fallen`;
  const cause = document.createElement('p');
  cause.textContent = `Killed by ${data.killedBy}.`;

  const stats = document.createElement('ul');
  for (const line of [
    `Level ${data.level}`,
    `${data.turns} turns survived`,
    `${data.gold} gold gathered`,
  ]) {
    const li = document.createElement('li');
    li.textContent = line;
    stats.appendChild(li);
  }

  const children: HTMLElement[] = [title, cause, stats];
  if (data.recentEvents && data.recentEvents.length > 0) {
    const events = document.createElement('div');
    events.className = 'death-events';
    const head = document.createElement('h4');
    head.textContent = 'Recent events';
    events.appendChild(head);
    for (const text of data.recentEvents) {
      const row = document.createElement('p');
      row.setAttribute('data-field', 'death-event');
      row.textContent = text;
      events.appendChild(row);
    }
    children.push(events);
  }

  const buttons = document.createElement('div');
  buttons.className = 'actions';
  const load = document.createElement('button');
  load.type = 'button';
  load.textContent = 'Load saved game';
  load.dataset.action = 'load';
  load.addEventListener('click', () => data.onLoad());
  const fresh = document.createElement('button');
  fresh.type = 'button';
  fresh.textContent = 'New game';
  fresh.dataset.action = 'new-game';
  fresh.addEventListener('click', () => data.onNewGame());
  buttons.append(load, fresh);

  children.push(buttons);
  el.append(...children);
  return el;
}

export function openDeathDialog(data: DeathDialogData): ModalHandle {
  const modal = openModal({
    title: 'You are dead',
    content: buildDeathContent(data),
    className: 'dialog-death',
    onClose: data.onDismiss,
  });
  return modal;
}
