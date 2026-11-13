// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCharacter } from '../../engine/character';
import type { Player } from '../../engine/types';
import {
  buildCharacterContent,
  closeAllModals,
  openCharacterDialog,
  openModal,
} from './dialogs';

function testPlayer(overrides: Partial<Player> = {}): Player {
  return { ...createCharacter({
    name: 'Sigrun',
    gender: 'female',
    strength: 55,
    intelligence: 45,
    constitution: 50,
    dexterity: 50,
    difficulty: 'intermediate',
  }), x: 3, y: 3, ...overrides };
}

afterEach(() => {
  closeAllModals();
  document.body.innerHTML = '';
});

describe('modal system', () => {
  it('opens a dialog with title, content and close button', () => {
    const content = document.createElement('p');
    content.textContent = 'hello';
    const modal = openModal({ title: 'Test', content });

    expect(document.body.querySelector('.modal-overlay')).not.toBeNull();
    const dialog = document.body.querySelector('.dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector('.dialog-title')?.textContent).toBe('Test');
    expect(dialog?.contains(content)).toBe(true);
    expect(dialog?.querySelector('[data-action="close"]')).not.toBeNull();
    expect(modal.el).toBe(dialog);
  });

  it('close() removes the overlay from the document', () => {
    const modal = openModal({ title: 'T', content: document.createElement('div') });
    expect(document.body.querySelector('.modal-overlay')).not.toBeNull();
    modal.close();
    expect(document.body.querySelector('.modal-overlay')).toBeNull();
  });

  it('the close button closes the dialog and fires onClose', () => {
    const onClose = vi.fn();
    const modal = openModal({ title: 'T', content: document.createElement('div'), onClose });
    (modal.el.querySelector('[data-action="close"]') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('.modal-overlay')).toBeNull();
  });

  it('Escape closes only the topmost dialog', () => {
    const outer = openModal({ title: 'Outer', content: document.createElement('div') });
    const inner = openModal({ title: 'Inner', content: document.createElement('div') });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.body.contains(inner.el)).toBe(false);
    expect(document.body.contains(outer.el)).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.body.contains(outer.el)).toBe(false);
  });

  it('Escape consumed by a modal does not reach window listeners', () => {
    // Regression: window-level game keyboard handler saw the same Escape that
    // closed the dialog (document fires before window) and opened the menu.
    let windowSawEscape = false;
    const onWin = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') windowSawEscape = true;
    };
    window.addEventListener('keydown', onWin);
    const modal = openModal({ title: 'M', content: document.createElement('div') });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.body.contains(modal.el)).toBe(false);
    expect(windowSawEscape).toBe(false);

    window.removeEventListener('keydown', onWin);
  });

  it('overlay click closes when closeOnOverlay (default), not when disabled', () => {
    const a = openModal({ title: 'A', content: document.createElement('div') });
    (a.el.parentElement as HTMLElement).click();
    expect(document.body.contains(a.el)).toBe(false);

    const b = openModal({ title: 'B', content: document.createElement('div'), closeOnOverlay: false });
    (b.el.parentElement as HTMLElement).click();
    expect(document.body.contains(b.el)).toBe(true);
  });

  it('dispatches cotw:modal events with the open count', () => {
    const events: Array<{ open: number }> = [];
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ open: number }>).detail;
      events.push({ open: detail.open });
    };
    window.addEventListener('cotw:modal', handler);
    const a = openModal({ title: 'A', content: document.createElement('div') });
    const b = openModal({ title: 'B', content: document.createElement('div') });
    b.close();
    a.close();
    window.removeEventListener('cotw:modal', handler);

    expect(events).toEqual([{ open: 1 }, { open: 2 }, { open: 1 }, { open: 0 }]);
  });

  it('clicks inside the dialog body do not close via the overlay', () => {
    const body = document.createElement('button');
    body.textContent = 'inner';
    const modal = openModal({ title: 'T', content: body });
    body.click();
    expect(document.body.contains(modal.el)).toBe(true);
  });
});

describe('character sheet', () => {
  const derived = {
    armorValue: 6,
    weaponClass: 8,
    toHit: 0,
    damage: 8,
    weightGrams: 6500,
    ratedMax: 11000,
    movementSpeedPercent: 100,
  };

  it('renders identity, level, xp and pools with data fields', () => {
    const el = buildCharacterContent({
      player: testPlayer({ level: 3, experience: 2500, hp: 9, maxHp: 18, mana: 2, maxMana: 4 }),
      thresholds: [0, 1000, 3000, 6000],
      derived,
    });
    const field = (name: string): string => el.querySelector(`[data-field="${name}"]`)?.textContent ?? '';
    expect(field('name')).toBe('Sigrun');
    expect(field('level')).toBe('3');
    expect(field('experience')).toBe('2500');
    expect(field('next-xp')).toBe('6000');
    expect(field('hp')).toBe('9 / 18');
    expect(field('mana')).toBe('2 / 4');
    expect(field('gender')).toContain('female');
    expect(field('difficulty')).toContain('intermediate');
  });

  it('renders current/max attributes and derived combat stats', () => {
    const el = buildCharacterContent({
      player: testPlayer({ strength: 45, maxStrength: 55 }),
      derived,
    });
    expect(el.querySelector('[data-field="str"]')?.textContent).toBe('45 / 55');
    expect(el.querySelector('[data-field="int"]')?.textContent).toBe('45 / 45');
    expect(el.querySelector('[data-field="armor"]')?.textContent).toBe('6');
    expect(el.querySelector('[data-field="weapon"]')?.textContent).toBe('8');
    expect(el.querySelector('[data-field="carry"]')?.textContent).toContain('6.5');
    expect(el.querySelector('[data-field="carry"]')?.textContent).toContain('11');
    expect(el.querySelector('[data-field="speed"]')?.textContent).toContain('100');
  });

  it('lists active statuses', () => {
    const el = buildCharacterContent({
      player: testPlayer({
        statuses: [
          { kind: 'poison', remainingTurns: 12 },
          { kind: 'shield', remainingTurns: 90, magnitude: 2 },
        ],
      }),
      derived,
    });
    const statuses = el.querySelector('[data-field="statuses"]');
    expect(statuses?.textContent).toContain('poison');
    expect(statuses?.textContent).toContain('shield');
  });

  it('shows spell count when spells are known', () => {
    const el = buildCharacterContent({
      player: testPlayer({ knownSpells: ['s510', 's323'] }),
      derived,
    });
    expect(el.querySelector('[data-field="spells"]')?.textContent).toContain('2');
  });

  it('opens as a modal titled after the character', () => {
    const modal = openCharacterDialog({
      player: testPlayer(),
      derived,
    });
    expect(modal.el.querySelector('.dialog-title')?.textContent).toContain('Sigrun');
    expect(modal.el.querySelector('[data-field="name"]')?.textContent).toBe('Sigrun');
  });
});

describe('modal focus semantics (UI plan Phase 1, A15)', () => {
  function contentWithButton(label: string): HTMLElement {
    const el = document.createElement('div');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    el.appendChild(btn);
    return el;
  }

  it('associates the title with the dialog (aria-labelledby)', () => {
    const modal = openModal({ title: 'Titled', content: contentWithButton('Go') });
    const dialog = modal.el;
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const title = dialog.querySelector(`#${labelledBy}`);
    expect(title?.textContent).toBe('Titled');
  });

  it('moves focus into the dialog on open', () => {
    const modal = openModal({ title: 'Focus me', content: contentWithButton('Go') });
    expect(modal.el.contains(document.activeElement)).toBe(true);
  });

  it('restores focus to the opener on close', () => {
    const opener = document.createElement('button');
    opener.type = 'button';
    document.body.appendChild(opener);
    opener.focus();
    const modal = openModal({ title: 'Restore', content: contentWithButton('Go') });
    expect(document.activeElement).not.toBe(opener);
    modal.close();
    expect(document.activeElement).toBe(opener);
  });

  it('contains Tab focus within the dialog and wraps at both ends', () => {
    const modal = openModal({ title: 'Trap', content: contentWithButton('Middle') });
    const focusables = () =>
      [...modal.el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea')];
    const first = focusables()[0]!;
    const last = focusables()[focusables().length - 1]!;
    expect(focusables().length).toBeGreaterThanOrEqual(2);

    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);

    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift+Tab', bubbles: true, cancelable: true }));
    // jsdom reports Shift+Tab as key 'Tab' with shiftKey; send that shape too.
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
  });

  it('restores focus into the underlying modal when a stacked modal closes', () => {
    const base = openModal({ title: 'Base', content: contentWithButton('Base action') });
    const baseButton = base.el.querySelector<HTMLElement>('button:not(.dialog-close)')!;
    baseButton.focus();
    const top = openModal({ title: 'Top', content: contentWithButton('Top action') });
    top.close();
    expect(document.activeElement).toBe(baseButton);
  });
});

it('skips hidden panels and disabled form controls when wrapping focus', () => {
  const content = document.createElement('div');
  content.innerHTML = '<button>Visible</button><div hidden><button>Hidden</button></div><input disabled><div style="display:none"><button>Hidden by style</button></div>';
  const modal = openModal({ title: 'Form', content });
  const first = modal.el.querySelector<HTMLButtonElement>('.dialog-close')!;
  const visible = content.querySelector<HTMLButtonElement>('button')!;
  first.focus();
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(visible);
});
