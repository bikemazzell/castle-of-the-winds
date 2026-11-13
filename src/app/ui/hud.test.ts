// @vitest-environment jsdom
/**
 * HUD (UI plan §4, Phase 3): hero status entry (opens Character), location
 * chip (opens Map), pause button, and the three-entry action dock
 * Bag / Spells / Actions. Wait lives in the Actions panel. The message
 * log is demoted to a single recent-event line that opens the full log.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeAllModals } from '../ui/dialogs';
import { createHud, mountSheetControls, type HudActions } from './hud';

const actions = (fn: (a: string) => void): HudActions => ({ onAction: fn });

const state = (): Parameters<ReturnType<typeof createHud>['update']>[0] => ({
  name: 'Sigrun',
  hp: 9,
  maxHp: 12,
  mana: 5,
  maxMana: 6,
  gold: 123,
  level: 3,
  place: 'The Mine, Level 2',
});

afterEach(() => {
  closeAllModals();
  document.body.innerHTML = '';
});

describe('hud quick slots (UI plan Phase 6)', () => {
  it('keeps slot identities but hides empty favorites', () => {
    const hud = createHud(document.body, actions(() => {}));
    hud.update(state(), []);
    const slots = document.querySelectorAll('.quickbar [data-action^="slot-"]');
    expect(slots.length).toBe(2);
    const first = slots[0] as HTMLButtonElement;
    expect(first.dataset.action).toBe('slot-0');
    expect(first.disabled).toBe(true);
    expect(first.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('.quickbar')?.hidden).toBe(true);
  });

  it('shows the favorite spell name and cost, and fires onAction on click', () => {
    const onAction = vi.fn();
    const hud = createHud(document.body, actions(onAction));
    hud.update(
      {
        ...state(),
        slots: [
          { spellId: 's323', label: 'SHIELD', cost: 1, castable: true },
          { spellId: 's527', label: 'FIREBALL', cost: 8, castable: false, reason: 'not enough mana' },
        ],
      },
      [],
    );
    const slots = document.querySelectorAll<HTMLButtonElement>('.quickbar [data-action^="slot-"]');
    expect(slots[0]?.textContent).toContain('SHIELD');
    expect(slots[0]?.textContent).toContain('1');
    expect(slots[0]?.disabled).toBe(false);
    expect(slots[1]?.textContent).toContain('FIREBALL');
    expect(slots[1]?.disabled).toBe(true); // depleted/uncastable stays in place
    slots[0]?.click();
    expect(onAction).toHaveBeenCalledWith('slot-0');
  });
});


describe('hud (UI plan Phase 3)', () => {
  it('renders the hero status entry with bars and values, opening Character on click', () => {
    const onAction = vi.fn();
    const hud = createHud(document.body, actions(onAction));
    hud.update(state(), []);
    const hero = document.querySelector('.hud-hero');
    expect(hero).not.toBeNull();
    const text = hero!.textContent ?? '';
    expect(text).toContain('Sigrun');
    expect(text).toContain('Lv 3');
    expect(text).toContain('9/12'); // hp value
    expect(text).toContain('5/6'); // mana value
    (hero as HTMLElement).click();
    expect(onAction).toHaveBeenCalledWith('character');
  });

  it('renders the location chip opening Map, and the pause button', () => {
    const onAction = vi.fn();
    const hud = createHud(document.body, actions(onAction));
    hud.update(state(), []);
    const chip = document.querySelector<HTMLElement>('.hud-location');
    expect(chip?.textContent).toContain('The Mine, Level 2');
    chip?.click();
    expect(onAction).toHaveBeenCalledWith('map');
    const pause = document.querySelector<HTMLButtonElement>('[data-action="pause"]');
    expect(pause?.getAttribute('aria-label')).toBe('Pause');
    pause?.click();
    expect(onAction).toHaveBeenCalledWith('pause');
  });

  it('shows Bag, Spells, and Actions with Wait inside the action palette', () => {
    const onAction = vi.fn();
    createHud(document.body, actions(onAction));
    const dock = [...document.querySelectorAll('.dock [data-action]')];
    expect(dock.map((b) => b.textContent)).toEqual(['Bag', 'Spells', 'Actions']);
    for (const button of dock) (button as HTMLElement).click();
    expect((onAction.mock.calls as unknown as string[][]).map((c) => c[0])).toEqual([
      'inventory',
      'cast',
      'actions',
    ]);
  });

  it('low health flags the hp readout', () => {
    const hud = createHud(document.body, actions(() => {}));
    hud.update({ ...state(), hp: 2 }, []);
    const hp = document.querySelector('[data-field="hp"]');
    expect(hp?.classList.contains('low')).toBe(true);
  });

  it('shows recent events and opens the full history', () => {
    const onAction = vi.fn();
    const hud = createHud(document.body, actions(onAction));
    hud.update(state(), [
      { turn: 1, text: 'You feel better.' },
      { turn: 2, text: 'The kobold misses you!' },
    ]);
    const recent = document.querySelector<HTMLElement>('.recent-event');
    expect(recent?.textContent).toContain('The kobold misses you!');
    expect(recent?.textContent).toContain('You feel better');
    recent?.click();
    expect(onAction).toHaveBeenCalledWith('log');
  });

  it('mounts the recent-event line and dock into the sheet region', () => {
    const hud = createHud(document.body, actions(() => {}));
    const sheet = document.createElement('footer');
    mountSheetControls(hud, sheet);
    expect(sheet.querySelector('.recent-event')).not.toBeNull();
    expect(sheet.querySelector('.dock')).not.toBeNull();
  });

  it('exposes a separate assertive announce region for urgent events only', () => {
    const hud = createHud(document.body, actions(() => {}));
    const region = hud.el.querySelector<HTMLElement>('.sr-only-announce');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-live')).toBe('assertive');
    expect(region?.getAttribute('aria-atomic')).toBe('true');
    // The visual recent-event line is NOT a live region (UI plan §378-382:
    // announce only new relevant events — never rewrite it per action).
    expect(hud.logEl.getAttribute('aria-live')).toBeNull();
    expect(region?.textContent).toBe('');
    hud.announce('You take 4 damage.');
    expect(region?.textContent).toBe('You take 4 damage.');
  });
});

it('groups repeated events and expands without dispatching a game action', () => {
  const onAction = vi.fn();
  const hud = createHud(document.body, actions(onAction));
  hud.update(state(), [{turn:1,text:'Miss.'},{turn:2,text:'Miss.'},{turn:3,text:'Hit.'}]);
  expect(document.querySelectorAll('.recent-event-line').length).toBe(2);
  expect(hud.logEl.textContent).toContain('×2');
  const expand = document.querySelector<HTMLButtonElement>('.log-expand')!;
  expand.click();
  expect(expand.getAttribute('aria-expanded')).toBe('true');
  expect(onAction).not.toHaveBeenCalled();
});


it('shows distinct spell glyphs, costs, and accessible labels for every supplied shortcut', () => {
  const onAction = vi.fn();
  const hud = createHud(document.body, actions(onAction));
  hud.update({...state(), slots: [
    {spellId:'shield',label:'SHIELD',cost:1,castable:true},
    {spellId:'fire',label:'FIREBALL',cost:8,castable:false,reason:'not enough mana'},
    {spellId:'heal',label:'HEAL MINOR WOUNDS',cost:2,castable:true},
  ]}, []);
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.quickbar button')];
  expect(buttons).toHaveLength(3);
  const glyphs = buttons.map(button => button.querySelector('.spell-glyph'));
  expect(glyphs.every(glyph => glyph?.getAttribute('aria-hidden') === 'true')).toBe(true);
  expect(new Set(glyphs.map(glyph => glyph?.textContent)).size).toBe(3);
  expect(buttons[0]?.getAttribute('aria-label')).toBe('Cast SHIELD, 1 mana');
  expect(buttons[1]?.textContent).toContain('8 MP');
  expect(buttons[1]?.getAttribute('aria-label')).toContain('not enough mana');
  buttons[2]?.click();
  expect(onAction).toHaveBeenCalledWith('slot-2');
  hud.update(state(), []);
  expect(buttons.every(button => button.hidden && button.disabled)).toBe(true);
});
