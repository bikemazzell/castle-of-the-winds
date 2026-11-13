// @vitest-environment jsdom
/**
 * Pause screen (UI plan §4): the Esc screen from gameplay. Blocks map input
 * (it is a modal), consumes no turn, orders its commands Resume / Save-Load /
 * Settings / Help / Quit, shows a compact summary, and focuses Resume.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeAllModals } from '../ui/dialogs';
import { openPauseScreen, type PauseSummary } from '../ui/pause';

const summary = (): PauseSummary => ({
  name: 'Sigrun',
  level: 3,
  place: 'The Mine, Level 2',
  hp: 9,
  maxHp: 12,
  mana: 5,
  maxMana: 6,
  unsaved: false,
});

const overlay = (): HTMLElement | null => document.querySelector('.modal-overlay');

afterEach(() => {
  closeAllModals();
  document.body.innerHTML = '';
});

describe('pause screen (UI plan Phase 3)', () => {
  it('renders the command order Resume, Save / Load, Settings, Help, Quit with a compact summary', () => {
    openPauseScreen({ summary: summary(), onResume: () => {}, onSaveLoad: () => {}, onSettings: () => {}, onHelp: () => {}, onQuit: () => {} });
    const el = overlay();
    expect(el).not.toBeNull();
    const buttons = [...el!.querySelectorAll<HTMLButtonElement>('[data-pause-action]')].map((b) => b.textContent);
    expect(buttons).toEqual(['Resume', 'Save / Load', 'Settings', 'Help', 'Quit to Title']);
    const text = el!.textContent ?? '';
    expect(text).toContain('Sigrun');
    expect(text).toContain('Lv 3');
    expect(text).toContain('The Mine, Level 2');
    expect(text).toContain('9/12');
    expect(text).toContain('5/6');
  });

  it('focuses Resume on open and Escape resumes', () => {
    const onResume = vi.fn();
    const handle = openPauseScreen({ summary: summary(), onResume, onSaveLoad: () => {}, onSettings: () => {}, onHelp: () => {}, onQuit: () => {} });
    const resume = overlay()!.querySelector<HTMLButtonElement>('[data-pause-action="resume"]');
    expect(resume?.textContent).toBe('Resume');
    expect(document.activeElement).toBe(resume);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onResume).toHaveBeenCalledOnce();
    expect(overlay()).toBeNull();
    expect(handle).toBeTruthy();
  });

  it('invokes each command and closes the pause screen', () => {
    const onSaveLoad = vi.fn();
    const onSettings = vi.fn();
    const onHelp = vi.fn();
    openPauseScreen({ summary: summary(), onResume: () => {}, onSaveLoad, onSettings, onHelp, onQuit: () => {} });
    const buttons = [...overlay()!.querySelectorAll<HTMLButtonElement>('[data-pause-action]')];
    const byLabel = (label: string): HTMLButtonElement => buttons.find((b) => b.textContent === label)!;
    byLabel('Save / Load').click();
    expect(onSaveLoad).toHaveBeenCalledOnce();
    byLabel('Settings').click();
    expect(onSettings).toHaveBeenCalledOnce();
    byLabel('Help').click();
    expect(onHelp).toHaveBeenCalledOnce();
  });

  it('labels Quit truthfully when unsaved progress exists', () => {
    const onQuit = vi.fn();
    const unsaved = { ...summary(), unsaved: true };
    openPauseScreen({ summary: unsaved, onResume: () => {}, onSaveLoad: () => {}, onSettings: () => {}, onHelp: () => {}, onQuit });
    const text = overlay()!.textContent ?? '';
    expect(text).toContain('Unsaved progress');
    const quit = [...overlay()!.querySelectorAll<HTMLButtonElement>('[data-pause-action="quit"]')][0]!;
    quit.click();
    expect(onQuit).toHaveBeenCalledOnce();
    expect(overlay()).toBeNull();
  });
});
