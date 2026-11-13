// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPreferencesContent, buildRestContent, openPreferencesDialog, openRestDialog } from './options';
import { defaultPreferences, loadPreferences, savePreferences, type GamePreferences } from '../prefs';
import { closeAllModals } from './dialogs';

afterEach(() => {
  closeAllModals();
  document.body.innerHTML = '';
});

describe('preferences panel (UI plan Phase 7)', () => {
  it('renders segmented controls reflecting current values', () => {
    const el = buildPreferencesContent({ prefs: defaultPreferences(), onChange: () => {} });
    expect(el.querySelectorAll('[data-text-scale="1.5"] button, button[data-text-scale="1.5"]').length).toBe(1);
    const activeText = el.querySelector('button[data-text-scale="1"]');
    expect(activeText?.classList.contains('active')).toBe(true);
    const activeMap = el.querySelector('button[data-map-scale="0"]');
    expect(activeMap?.classList.contains('active')).toBe(true);
    const activeMotion = el.querySelector('button[data-reduce-motion="system"]');
    expect(activeMotion?.classList.contains('active')).toBe(true);
    const safe = el.querySelector('[data-option="safe-confirmation"]') as HTMLInputElement;
    expect(safe.checked).toBe(false);
  });

  it('picking a text scale fires onChange with the full state', () => {
    const onChange = vi.fn();
    const el = buildPreferencesContent({ prefs: defaultPreferences(), onChange });
    const step = el.querySelector<HTMLButtonElement>('button[data-text-scale="1.5"]');
    step?.click();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ ...defaultPreferences(), textScale: 1.5 });
  });

  it('accumulates successive changes instead of resetting earlier ones (A17)', () => {
    const seen: GamePreferences[] = [];
    const el = buildPreferencesContent({ prefs: defaultPreferences(), onChange: (p) => seen.push({ ...p }) });
    document.body.appendChild(el);
    el.querySelector<HTMLButtonElement>('button[data-text-scale="1.25"]')?.click();
    el.querySelector<HTMLButtonElement>('button[data-map-scale="1"]')?.click();
    el.querySelector<HTMLButtonElement>('button[data-reduce-motion="on"]')?.click();

    expect(seen.length).toBe(3);
    expect(seen[0]!.textScale).toBe(1.25);
    // First change must survive the second and third.
    expect(seen[1]!.textScale).toBe(1.25);
    expect(seen[1]!.mapScale).toBe(1);
    expect(seen[2]!.reduceMotion).toBe('on');
    expect(seen[2]!.textScale).toBe(1.25);
    expect(seen[2]!.mapScale).toBe(1);
  });

  it('safe confirmation checkbox toggles', () => {
    const onChange = vi.fn();
    const el = buildPreferencesContent({ prefs: defaultPreferences(), onChange });
    const box = el.querySelector<HTMLInputElement>('[data-option="safe-confirmation"]');
    box!.checked = true;
    box!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith({ ...defaultPreferences(), safeConfirmation: true });
  });

  it('toggling everything in sequence persists and survives a reopen (CODE-QUALITY Task 6)', () => {
    const store: Record<string, string> = {};
    const storage = {
      getItem: (k: string): string | null => store[k] ?? null,
      setItem: (k: string, v: string): void => {
        store[k] = v;
      },
    };
    // Sequence every control, persisting as the controller does.
    let current = defaultPreferences();
    const el = buildPreferencesContent({
      prefs: current,
      onChange: (p) => {
        current = p;
        savePreferences(storage, p);
      },
    });
    document.body.appendChild(el);
    el.querySelector<HTMLButtonElement>('button[data-text-scale="1.75"]')?.click();
    el.querySelector<HTMLButtonElement>('button[data-map-scale="-1"]')?.click();
    el.querySelector<HTMLButtonElement>('button[data-reduce-motion="off"]')?.click();
    const box = el.querySelector<HTMLInputElement>('[data-option="safe-confirmation"]');
    box!.checked = true;
    box!.dispatchEvent(new Event('change', { bubbles: true }));

    // Reopen from persisted state — the dialog must reflect every choice.
    const reopened = buildPreferencesContent({ prefs: loadPreferences(storage), onChange: () => {} });
    document.body.appendChild(reopened);
    expect(reopened.querySelector('button[data-text-scale="1.75"]')?.classList.contains('active')).toBe(true);
    expect(reopened.querySelector('button[data-map-scale="-1"]')?.classList.contains('active')).toBe(true);
    expect(reopened.querySelector('button[data-reduce-motion="off"]')?.classList.contains('active')).toBe(true);
    expect(reopened.querySelector<HTMLInputElement>('[data-option="safe-confirmation"]')?.checked).toBe(true);
  });

  it('Restore Defaults emits the default state', () => {
    const onChange = vi.fn();
    const prefs: GamePreferences = { textScale: 2, mapScale: -1, reduceMotion: 'off', safeConfirmation: true };
    const el = buildPreferencesContent({ prefs, onChange });
    el.querySelector<HTMLButtonElement>('[data-action="restore-defaults"]')?.click();
    expect(onChange).toHaveBeenCalledWith(defaultPreferences());
  });

  it('opens as a modal titled Options', () => {
    const modal = openPreferencesDialog({ prefs: defaultPreferences(), onChange: () => {} });
    expect(modal.el.querySelector('.dialog-title')?.textContent).toContain('Options');
  });
});

describe('rest dialog', () => {
  it('explains interruption risk and starts resting on confirm', () => {
    const onRest = vi.fn();
    const el = buildRestContent({ onRest, hpMissing: 4, manaMissing: 2 });
    expect(el.textContent).toMatch(/interrupt/i);
    expect(el.textContent).toContain('4');
    const btn = el.querySelector('[data-action="rest"]') as HTMLButtonElement;
    btn.click();
    expect(onRest).toHaveBeenCalledTimes(1);
  });

  it('warns when fully rested (button disabled)', () => {
    const onRest = vi.fn();
    const el = buildRestContent({ onRest, hpMissing: 0, manaMissing: 0 });
    const btn = el.querySelector('[data-action="rest"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('opens as a modal titled Rest', () => {
    const modal = openRestDialog({ onRest: () => {}, hpMissing: 1, manaMissing: 0 });
    expect(modal.el.querySelector('.dialog-title')?.textContent).toContain('Rest');
  });
});

it('changes blood and debris without changing other preferences',()=>{
 const onChange=vi.fn(),el=buildPreferencesContent({prefs:defaultPreferences(),onChange});
 document.body.appendChild(el);
 const box=el.querySelector<HTMLInputElement>('[data-option="blood"]')!;
 expect(box.closest('label')!.textContent).toBe('Blood and Gore');
 expect(box.checked).toBe(true);box.click();expect(onChange).toHaveBeenCalledWith({...defaultPreferences(),blood:false});
});

it('restores the visible blood checkbox and selected controls along with their values',()=>{
 const el=buildPreferencesContent({prefs:{...defaultPreferences(),blood:false,safeConfirmation:true,textScale:2},onChange:()=>{}});
 document.body.appendChild(el);el.querySelector<HTMLButtonElement>('[data-action="restore-defaults"]')!.click();
 expect(el.querySelector<HTMLInputElement>('[data-option="blood"]')!.checked).toBe(true);
 expect(el.querySelector<HTMLInputElement>('[data-option="safe-confirmation"]')!.checked).toBe(false);
 expect(el.querySelector('[data-text-scale="1"]')!.classList.contains('active')).toBe(true);
});

it('offers an off-by-default Curses checkbox, preserves other options, and resets it visibly',()=>{
 const onChange=vi.fn(),el=buildPreferencesContent({prefs:defaultPreferences(),onChange});document.body.append(el);
 const box=el.querySelector<HTMLInputElement>('[data-option="curses"]')!;
 expect(box).not.toBeNull();expect(box.checked).toBe(false);expect(box.closest('label')!.textContent).toBe('Curses (player swearing)');
 box.click();expect(onChange).toHaveBeenLastCalledWith({...defaultPreferences(),curses:true});
 el.querySelector<HTMLInputElement>('[data-option="blood"]')!.click();
 expect(onChange).toHaveBeenLastCalledWith({...defaultPreferences(),curses:true,blood:false});
 el.querySelector<HTMLButtonElement>('[data-action="restore-defaults"]')!.click();
 expect(box.checked).toBe(false);expect(onChange).toHaveBeenLastCalledWith(defaultPreferences());
 const restored=buildPreferencesContent({prefs:{...defaultPreferences(),curses:true},onChange:()=>{}});
 expect(restored.querySelector<HTMLInputElement>('[data-option="curses"]')!.checked).toBe(true);
});
