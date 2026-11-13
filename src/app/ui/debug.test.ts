// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { openDebugDialog } from './debug';
import { openPauseScreen } from './pause';
import { closeAllModals } from './dialogs';
afterEach(() => { closeAllModals(); document.body.innerHTML = ''; });
it('exposes Debug in Pause and closes Pause before opening it', () => {
  const onDebug = vi.fn();
  openPauseScreen({summary: {name: 'Hero', level: 1, place: 'Town', hp: 10, maxHp: 10, mana: 5, maxMana: 5, unsaved: false}, onResume: vi.fn(), onSaveLoad: vi.fn(), onSettings: vi.fn(), onHelp: vi.fn(), onQuit: vi.fn(), onDebug});
  document.querySelector<HTMLButtonElement>('[data-pause-action="debug"]')!.click();
  expect(onDebug).toHaveBeenCalledOnce();
  expect(document.querySelector('.modal-overlay')).toBeNull();
});
it('toggles full visibility and opens the requested editor tab', () => {
  const onReveal = vi.fn(), onEdit = vi.fn();
  openDebugDialog({revealMap: false, onReveal, onEdit});
  const toggle = document.querySelector<HTMLInputElement>('[data-field="debug-reveal"]')!;
  toggle.click(); toggle.click();
  expect(onReveal.mock.calls).toEqual([[true], [false]]);
  document.querySelector<HTMLButtonElement>('[data-debug-edit="inventory"]')!.click();
  expect(onEdit).toHaveBeenCalledWith('inventory');
  expect(document.querySelector('.modal-overlay')).toBeNull();
});
