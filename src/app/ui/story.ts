import { openModal } from './dialogs';
import { ownFocus } from './focus';

export interface StoryTexts {
  [id: string]: string;
}

/** Substitute the gender placeholder used by the original story texts. */
export function substituteGender(text: string, gender: 'male' | 'female'): string {
  return text.replaceAll('%x', gender === 'female' ? 'daughter' : 'son');
}

function reflowStory(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/)
    .map(paragraph => paragraph.replace(/\s+/g, ' ').trim()).join('\n\n');
}

/**
 * Full-screen cutscene overlay: shows each story text in order with a
 * touch-friendly Continue button; %x placeholders resolved via gender.
 */
export function showStoryTexts(
  root: HTMLElement | Document,
  texts: string[],
  options: { gender: 'male' | 'female'; onDone?: () => void },
): HTMLElement {
  const host =
    root instanceof Document ? (root.body) : root;
  const overlay = document.createElement('div');
  overlay.className = 'story-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Castle of the Winds story');

  const title = document.createElement('h2');
  title.className = 'story-title';
  title.textContent = 'Castle of the Winds';

  const body = document.createElement('p');
  body.className = 'story-text';
  body.setAttribute('data-field', 'story-text');
  body.tabIndex = 0;
  body.setAttribute('aria-label', 'Story text. Scroll to read more.');

  const count = document.createElement('div');
  count.className = 'story-count';
  count.setAttribute('data-field', 'story-count');

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'story-continue';
  next.setAttribute('data-action', 'continue');
  next.textContent = 'Continue';

  const buttons = document.createElement('div');
  buttons.className = 'story-buttons';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.dataset.action = 'skip-story';
  skip.textContent = 'Skip story';
  buttons.append(next, skip);
  const cue = document.createElement('span');
  cue.className = 'story-scroll-cue';
  cue.textContent = 'Scroll to read more';
  cue.hidden = true;
  body.addEventListener('scroll', () => {
    cue.hidden = body.scrollHeight <= body.clientHeight + body.scrollTop + 2;
  });
  buttons.append(cue);
  overlay.append(title, body, count, buttons);
  host.append(overlay);
  const releaseFocus = ownFocus(overlay, next);
  let completed = false;
  const finish = (): void => {
    if (completed) return;
    completed = true;
    overlay.remove();
    releaseFocus();
    options.onDone?.();
  };
  skip.addEventListener('click', finish);

  let index = 0;
  const render = (): void => {
    const raw = texts[index] ?? '';
    body.textContent = reflowStory(substituteGender(raw, options.gender));
    body.scrollTop = 0;
    requestAnimationFrame(() => { cue.hidden = body.scrollHeight <= body.clientHeight + 2; });
    count.textContent = `${index + 1} / ${texts.length}`;
    next.textContent = index === texts.length - 1 ? 'Continue' : 'Next';
  };
  render();

  next.addEventListener('click', () => {
    index++;
    if (index >= texts.length) {
      finish();
      return;
    }
    render();
  });
  return overlay;
}

export interface VictoryStats {
  name: string;
  level: number;
  turns: number;
  gold: number;
  experience: number;
}

/** Ending screen: story text 15 plus the campaign stats. */
export function showVictory(
  root: HTMLElement | Document,
  stats: VictoryStats,
  endingText: string,
  options: {
    gender: 'male' | 'female';
    onNewGame?: () => void;
    onSave?: () => void;
    onJournal?: () => void;
    onReturnToTitle?: () => void;
  },
): HTMLElement {
  const host = root instanceof Document ? (root.body) : root;
  const overlay = document.createElement('div');
  overlay.className = 'story-overlay victory';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Victory');

  const title = document.createElement('h2');
  title.className = 'story-title';
  title.textContent = 'Victory!';

  const body = document.createElement('p');
  body.className = 'story-text';
  body.setAttribute('data-field', 'story-text');
  body.tabIndex = 0;
  body.setAttribute('aria-label', 'Story text. Scroll to read more.');
  body.textContent = reflowStory(substituteGender(endingText, options.gender));

  const list = document.createElement('ul');
  list.className = 'victory-stats';
  const rows: [string, string][] = [
    ['Hero', stats.name],
    ['Level reached', String(stats.level)],
    ['Experience', String(stats.experience)],
    ['Gold', `${stats.gold} Gold`],
    ['Turns', String(stats.turns)],
  ];
  for (const [label, value] of rows) {
    const li = document.createElement('li');
    // Build the row from elements + textContent (CODE-QUALITY F02): the hero
    // name comes from an imported save and must never be parsed as HTML.
    const labelSpan = document.createElement('span');
    labelSpan.className = 'char-label';
    labelSpan.textContent = label;
    const valueSpan = document.createElement('span');
    valueSpan.className = 'char-value';
    valueSpan.textContent = value;
    li.append(labelSpan, ' ', valueSpan);
    list.append(li);
  }

  const actions = document.createElement('div');
  actions.className = 'story-buttons';
  if (options.onSave) {
    const save = document.createElement('button');
    save.type = 'button';
    save.setAttribute('data-action', 'save');
    save.textContent = 'Save Game';
    save.addEventListener('click', options.onSave);
    actions.append(save);
  }
  if (options.onJournal) {
    // Reading the journal keeps the ending on screen behind the dialog.
    const journal = document.createElement('button');
    journal.type = 'button';
    journal.setAttribute('data-action', 'journal');
    journal.textContent = 'Journal';
    journal.addEventListener('click', options.onJournal);
    actions.append(journal);
  }
  if (options.onReturnToTitle) {
    const title = document.createElement('button');
    title.type = 'button';
    title.setAttribute('data-action', 'return-title');
    title.textContent = 'Return to Title';
    title.addEventListener('click', () => {
      overlay.remove();
      releaseFocus();
      options.onReturnToTitle?.();
    });
    actions.append(title);
  }
  const again = document.createElement('button');
  again.type = 'button';
  again.setAttribute('data-action', 'new-game');
  again.textContent = 'New Game';
  again.addEventListener('click', () => {
    overlay.remove();
    releaseFocus();
    options.onNewGame?.();
  });
  actions.append(again);

  overlay.append(title, body, list, actions);
  host.append(overlay);
  const releaseFocus = ownFocus(overlay, actions.querySelector<HTMLElement>('button') ?? body);
  return overlay;
}

export interface JournalEntryLite {
  turn: number;
  text: string;
}

/** Quest journal dialog (menu → Journal). */
export function openJournalDialog(
  entries: JournalEntryLite[],
  options: { onClose?: () => void } = {},
): void {
  const content = document.createElement('div');
  content.className = 'journal';
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'Your journal is empty. Adventure awaits!';
    content.append(empty);
  } else {
    for (const entry of [...entries].reverse()) {
      const row = document.createElement('div');
      row.className = 'journal-entry';
      row.setAttribute('data-turn', String(entry.turn));
      row.textContent = entry.text;
      content.append(row);
    }
  }
  openModal({ title: 'Journal', content, onClose: options.onClose });
}
