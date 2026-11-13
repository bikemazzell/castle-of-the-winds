// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterInit } from '../../engine/character';
import { STAT_MAX } from '../../engine/formulas';
import {
  buildDeathContent,
  buildNewGameContent,
  openDeathDialog,
  openNewGameDialog,
} from './newgame';
import { closeAllModals } from './dialogs';

afterEach(() => {
  closeAllModals();
  document.body.innerHTML = '';
});

describe('new game wizard', () => {
  it('renders name, gender, four stat steppers and difficulty choices', () => {
    const el = buildNewGameContent({ onBegin: () => {} });
    expect(el.querySelector('[data-field="name"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-stat]').length).toBe(4);
    expect(el.querySelectorAll('[name="gender"]').length).toBe(2);
    expect(el.querySelectorAll('[name="difficulty"]').length).toBe(4);
    expect(el.querySelector('[data-action="begin"]')).not.toBeNull();
  });

  it('renders play-style presets with the balanced build active by default', () => {
    const el = buildNewGameContent({ onBegin: () => {} });
    const presets = el.querySelectorAll('[data-preset]');
    expect(presets.length).toBe(3);
    const balanced = el.querySelector('[data-preset="balanced"]') as HTMLButtonElement;
    expect(balanced.classList.contains('active')).toBe(true);
    expect(balanced.getAttribute('aria-pressed')).toBe('true');
    for (const other of ['warrior', 'wizard']) {
      const btn = el.querySelector(`[data-preset="${other}"]`) as HTMLButtonElement;
      expect(btn.classList.contains('active')).toBe(false);
      expect(btn.getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('applying a preset fills the stat inputs and spends the pool exactly', () => {
    const el = buildNewGameContent({ onBegin: () => {} });
    (el.querySelector('[data-preset="warrior"]') as HTMLButtonElement).click();
    const stat = (key: string): string =>
      (el.querySelector(`[data-stat="${key}"]`) as HTMLInputElement).value;
    expect(stat('strength')).toBe('70');
    expect(stat('intelligence')).toBe('30');
    expect(stat('constitution')).toBe('60');
    expect(stat('dexterity')).toBe('40');
    expect(el.querySelector('[data-field="pool-remaining"]')?.textContent).toBe('0');
    expect(
      (el.querySelector('[data-preset="warrior"]') as HTMLButtonElement).classList.contains(
        'active',
      ),
    ).toBe(true);
  });

  it('a manual stat edit deselects the active preset', () => {
    const el = buildNewGameContent({ onBegin: () => {} });
    const str = el.querySelector('[data-stat="strength"]') as HTMLInputElement;
    const up = str.closest('.stat-row')?.querySelector('[data-step="up"]') as HTMLButtonElement;
    up.click();
    for (const btn of el.querySelectorAll('[data-preset]')) {
      expect(btn.classList.contains('active')).toBe(false);
      expect(btn.getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('each attribute row carries a plain-language explanation', () => {
    const el = buildNewGameContent({ onBegin: () => {} });
    const helps = el.querySelectorAll('[data-stat-help]');
    expect(helps.length).toBe(4);
    for (const help of helps) {
      expect((help.textContent ?? '').length).toBeGreaterThan(10);
    }
    expect(el.querySelector('[data-stat-help="strength"]')?.textContent).toMatch(
      /carry|damage/i,
    );
    expect(el.querySelector('[data-stat-help="intelligence"]')?.textContent).toMatch(
      /mana|spell/i,
    );
  });

  it('each difficulty option carries a plain-language explanation', () => {
    const el = buildNewGameContent({ onBegin: () => {} });
    const helps = el.querySelectorAll('[data-diff-help]');
    expect(helps.length).toBe(4);
    expect(el.querySelector('[data-diff-help="easy"]')?.textContent).toMatch(
      /easier|weaker|faster/i,
    );
    expect(el.querySelector('[data-diff-help="expert"]')?.textContent).toMatch(
      /deadly|veteran|deadliest/i,
    );
  });

  it('focusing the name does not scroll away to the Begin button', () => {
    const el = buildNewGameContent({ onBegin: () => {} });
    const begin = el.querySelector('[data-action="begin"]') as HTMLButtonElement;
    const spy = vi.fn();
    begin.scrollIntoView = spy;
    const name = el.querySelector('[data-field="name"]') as HTMLInputElement;
    name.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('defaults to an even stat split with the full pool available', () => {
    const el = buildNewGameContent({ onBegin: () => {} });
    const remaining = el.querySelector('[data-field="pool-remaining"]') as HTMLElement;
    expect(remaining.textContent).toBe('0');
    for (const input of el.querySelectorAll<HTMLInputElement>('[data-stat]')) {
      expect(input.value).toBe('50');
    }
  });

  it('Begin is disabled until a name is entered', () => {
    const el = buildNewGameContent({ onBegin: () => {} });
    const begin = el.querySelector('[data-action="begin"]') as HTMLButtonElement;
    const name = el.querySelector('[data-field="name"]') as HTMLInputElement;
    expect(begin.disabled).toBe(true);
    name.value = 'Sigrun';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    expect(begin.disabled).toBe(false);
  });

  it('steppers move stats within bounds and track the pool', () => {
    const el = buildNewGameContent({ onBegin: () => {} });
    const str = el.querySelector('[data-stat="strength"]') as HTMLInputElement;
    const inc = str.closest('.stat-row')?.querySelector('[data-step="up"]') as HTMLButtonElement;

    str.value = String(STAT_MAX);
    str.dispatchEvent(new Event('input', { bubbles: true }));
    expect(el.querySelector('[data-field="pool-remaining"]')?.textContent).toBe('-50'); // 100+50+50+50 = 250 used

    inc.click(); // capped at STAT_MAX
    expect(str.value).toBe(String(STAT_MAX));
  });

  it('submitting fires onBegin with the assembled CharacterInit', () => {
    const onBegin = vi.fn();
    const el = buildNewGameContent({ onBegin });
    const name = el.querySelector('[data-field="name"]') as HTMLInputElement;
    name.value = 'Test';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const str = el.querySelector('[data-stat="strength"]') as HTMLInputElement;
    str.value = '60';
    str.dispatchEvent(new Event('input', { bubbles: true }));
    const int = el.querySelector('[data-stat="intelligence"]') as HTMLInputElement;
    int.value = '40';
    int.dispatchEvent(new Event('input', { bubbles: true }));
    (el.querySelector('[name="gender"][value="male"]') as HTMLInputElement).checked = true;
    (el.querySelector('[name="difficulty"][value="easy"]') as HTMLInputElement).checked = true;
    (el.querySelector('[data-action="begin"]') as HTMLButtonElement).click();

    expect(onBegin).toHaveBeenCalledWith({
      name: 'Test',
      gender: 'male',
      strength: 60,
      intelligence: 40,
      constitution: 50,
      dexterity: 50,
      difficulty: 'easy',
    } satisfies CharacterInit);
  });

  it('blocks submit with an error when the pool is exceeded', () => {
    const onBegin = vi.fn();
    const el = buildNewGameContent({ onBegin });
    const name = el.querySelector('[data-field="name"]') as HTMLInputElement;
    name.value = 'Greedy';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    for (const input of el.querySelectorAll<HTMLInputElement>('[data-stat]')) {
      input.value = String(STAT_MAX);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const begin = el.querySelector('[data-action="begin"]') as HTMLButtonElement;
    begin.click();
    expect(onBegin).not.toHaveBeenCalled();
    expect(el.querySelector('[data-field="error"]')?.textContent).toContain('pool');
  });

  it('opens as a modal', () => {
    const modal = openNewGameDialog({ onBegin: () => {} });
    expect(modal.el.querySelector('.dialog-title')?.textContent).toMatch(/new game/i);
  });
});

describe('death screen', () => {
  it('shows who killed the character and the run stats', () => {
    const el = buildDeathContent({
      name: 'Sigrun',
      killedBy: 'a Gruesome Troll',
      level: 5,
      turns: 1234,
      gold: 450,
      onNewGame: () => {},
      onLoad: () => {},
    });
    expect(el.textContent).toContain('Sigrun');
    expect(el.textContent).toContain('Gruesome Troll');
    expect(el.textContent).toContain('5');
    expect(el.textContent).toContain('450');
    expect(el.querySelector('[data-action="new-game"]')).not.toBeNull();
    expect(el.querySelector('[data-action="load"]')).not.toBeNull();
  });

  it('buttons fire their callbacks', () => {
    const onNewGame = vi.fn();
    const onLoad = vi.fn();
    const el = buildDeathContent({
      name: 'X', killedBy: 'Y', level: 1, turns: 2, gold: 3, onNewGame, onLoad,
    });
    (el.querySelector('[data-action="new-game"]') as HTMLButtonElement).click();
    (el.querySelector('[data-action="load"]') as HTMLButtonElement).click();
    expect(onNewGame).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('opens as a modal with no close affordance', () => {
    const modal = openDeathDialog({
      name: 'X', killedBy: 'Y', level: 1, turns: 2, gold: 3,
      onNewGame: () => {}, onLoad: () => {},
    });
    expect(modal.el.querySelector('.dialog-title')?.textContent).toMatch(/dead|fallen/i);
  });

  it('lists recent events leading to the death when provided (UI plan Phase 7)', () => {
    const el = buildDeathContent({
      name: 'Sigrun',
      killedBy: 'a Gruesome Troll',
      level: 5,
      turns: 1234,
      gold: 450,
      recentEvents: ['The gruesome troll claws you!', 'You feel better. (+8 hp)', 'The gruesome troll claws you!'],
      onNewGame: () => {},
      onLoad: () => {},
    });
    const events = el.querySelectorAll('.death-events [data-field="death-event"]');
    expect(events.length).toBe(3);
    expect(events[0]!.textContent).toContain('troll claws you');
    expect(events[1]!.textContent).toContain('+8 hp');
  });

  it('omits the recent-events section when there are none', () => {
    const el = buildDeathContent({
      name: 'X', killedBy: 'Y', level: 1, turns: 2, gold: 3,
      onNewGame: () => {}, onLoad: () => {},
    });
    expect(el.querySelector('.death-events')).toBeNull();
  });
});

it('keeps custom attributes collapsed and explains a missing name beside Begin', () => {
  const el = buildNewGameContent({ onBegin: () => {} });
  const custom = el.querySelector<HTMLDetailsElement>('.custom-attributes');
  expect(custom?.open).toBe(false);
  expect(custom?.querySelectorAll('[data-stat]').length).toBe(4);
  expect(el.querySelector('.newgame-footer [data-field="error"]')?.textContent).toContain('name');
  const name = el.querySelector<HTMLInputElement>('[data-field="name"]')!;
  name.value = 'Hero';
  name.dispatchEvent(new Event('input'));
  expect(el.querySelector('.newgame-footer [data-field="error"]')?.textContent).toBe('');
});
