// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeAllModals } from './dialogs';
import {
  openJournalDialog,
  showStoryTexts,
  showVictory,
  substituteGender,
} from './story';

const body = () => document.body;

afterEach(() => {
  closeAllModals();
  document.body.innerHTML = '';
});

describe('substituteGender', () => {
  it('replaces %x with son/daughter', () => {
    expect(substituteGender('My %x, welcome.', 'female')).toBe('My daughter, welcome.');
    expect(substituteGender('My %x, welcome.', 'male')).toBe('My son, welcome.');
  });
});

describe('showStoryTexts', () => {
  it('shows texts one at a time with a counter and finishes on the last', () => {
    const done = vi.fn();
    const overlay = showStoryTexts(body(), ['First %x.', 'Second.'], { gender: 'female', onDone: done });
    const text = overlay.querySelector('[data-field="story-text"]')!;
    const count = overlay.querySelector('[data-field="story-count"]')!;
    expect(text.textContent).toBe('First daughter.');
    expect(count.textContent).toBe('1 / 2');

    (overlay.querySelector('[data-action="continue"]') as HTMLButtonElement).click();
    expect(text.textContent).toBe('Second.');
    expect(count.textContent).toBe('2 / 2');
    expect(done).not.toHaveBeenCalled();
    expect(document.body.contains(overlay)).toBe(true);

    (overlay.querySelector('[data-action="continue"]') as HTMLButtonElement).click();
    expect(done).toHaveBeenCalledTimes(1);
    expect(document.body.contains(overlay)).toBe(false);
  });
});

describe('showVictory', () => {
  it('renders ending text, campaign stats and buttons', () => {
    const onNewGame = vi.fn();
    const overlay = showVictory(
      body(),
      { name: 'Sigrun', level: 8, turns: 4096, gold: 5300, experience: 6000 },
      'Here ends Part One... %x.',
      { gender: 'male', onNewGame },
    );
    expect(overlay.querySelector('[data-field="story-text"]')!.textContent)
      .toContain('Here ends Part One... son.');
    const stats = overlay.querySelector('.victory-stats')!;
    expect(stats.textContent).toContain('Sigrun');
    expect(stats.textContent).toContain('5300');
    (overlay.querySelector('[data-action="new-game"]') as HTMLButtonElement).click();
    expect(onNewGame).toHaveBeenCalledTimes(1);
    expect(document.body.contains(overlay)).toBe(false);
  });

  it('offers Journal and Return to Title when wired (UI plan Phase 7)', () => {
    const onJournal = vi.fn();
    const onReturnToTitle = vi.fn();
    const onSave = vi.fn();
    const overlay = showVictory(
      body(),
      { name: 'Sigrun', level: 8, turns: 4096, gold: 5300, experience: 6000 },
      'Here ends Part One... %x.',
      { gender: 'female', onNewGame: () => {}, onSave, onJournal, onReturnToTitle },
    );
    // Save is offered and does not dismiss the ending.
    (overlay.querySelector('[data-action="save"]') as HTMLButtonElement).click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(document.body.contains(overlay)).toBe(true);
    // Journal keeps the ending available: overlay stays, callback fires.
    (overlay.querySelector('[data-action="journal"]') as HTMLButtonElement).click();
    expect(onJournal).toHaveBeenCalledTimes(1);
    expect(document.body.contains(overlay)).toBe(true);
    // Return to Title leaves the screen entirely.
    (overlay.querySelector('[data-action="return-title"]') as HTMLButtonElement).click();
    expect(onReturnToTitle).toHaveBeenCalledTimes(1);
    expect(document.body.contains(overlay)).toBe(false);
  });

  it('renders the hero name as literal text, never as markup (F02)', () => {
    const overlay = showVictory(
      body(),
      { name: '<b>Hero</b> <img src=x onerror=alert(1)>', level: 8, turns: 4096, gold: 1, experience: 2 },
      'The end.',
      { gender: 'female', onNewGame: () => {} },
    );
    const stats = overlay.querySelector('.victory-stats')!;
    // No generated elements from the imported name.
    expect(stats.querySelector('b')).toBeNull();
    expect(stats.querySelector('img')).toBeNull();
    // The name renders as literal text content.
    expect(stats.textContent).toContain('<b>Hero</b>');
  });
});

describe('openJournalDialog', () => {
  it('lists entries newest-first and notes an empty journal', () => {
    openJournalDialog([
      { turn: 1, text: 'First entry.' },
      { turn: 9, text: 'Later entry.' },
    ]);
    const entries = document.querySelectorAll('.modal-overlay .journal-entry');
    expect(entries).toHaveLength(2);
    expect(entries[0]!.textContent).toBe('Later entry.');

    closeAllModals();
    openJournalDialog([]);
    expect(document.querySelector('.modal-overlay .journal')!.textContent)
      .toContain('empty');
  });

  it('fires onClose when the journal closes (UI plan Phase 7)', () => {
    const onClose = vi.fn();
    openJournalDialog([{ turn: 3, text: 'Entry.' }], { onClose });
    const modal = document.querySelector('.modal-overlay')!;
    (modal.querySelector('[data-action="close"]') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('story keyboard ownership', () => {
  it('focuses Continue, makes the background inert, and restores focus on completion', () => {
    const game = document.createElement('main');
    const opener = document.createElement('button');
    game.append(opener);
    document.body.append(game);
    opener.focus();
    const overlay = showStoryTexts(body(), ['Story.'], { gender: 'female' });
    const next = overlay.querySelector<HTMLButtonElement>('[data-action="continue"]')!;
    expect(document.activeElement).toBe(next);
    expect(game.hasAttribute('inert')).toBe(true);
    expect(overlay.getAttribute('role')).toBe('dialog');
    expect(overlay.querySelector('.story-text')?.getAttribute('tabindex')).toBe('0');
    next.click();
    expect(game.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('restores the background after the controller removes an overlay directly', async () => {
    const game = document.createElement('main');
    document.body.append(game);
    const overlay = showStoryTexts(body(), ['Story.'], { gender: 'female' });
    expect(game.hasAttribute('inert')).toBe(true);
    overlay.remove();
    await Promise.resolve();
    expect(game.hasAttribute('inert')).toBe(false);
  });

  it('allows a nested victory journal and returns focus after it closes', () => {
    const overlay = showVictory(body(), { name: 'Hero', level: 1, turns: 1, gold: 2, experience: 0 }, 'End.', {
      gender: 'female', onJournal: () => openJournalDialog([]),
    });
    const journal = overlay.querySelector<HTMLButtonElement>('[data-action="journal"]')!;
    journal.focus();
    journal.click();
    const close = document.querySelector<HTMLButtonElement>('.dialog-close')!;
    expect(document.activeElement).toBe(close);
    expect(overlay.hasAttribute('inert')).toBe(true);
    close.click();
    expect(document.activeElement).toBe(journal);
    expect(overlay.hasAttribute('inert')).toBe(false);
  });

  it('offers Skip and completes only once', () => {
    const done = vi.fn();
    const overlay = showStoryTexts(body(), ['One.', 'Two.'], { gender: 'female', onDone: done });
    const skip = overlay.querySelector<HTMLButtonElement>('[data-action="skip-story"]')!;
    expect(skip).not.toBeNull();
    skip.click();
    skip.click();
    expect(done).toHaveBeenCalledTimes(1);
    expect(overlay.isConnected).toBe(false);
  });
});
