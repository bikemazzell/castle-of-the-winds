// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeAllModals } from '../ui/dialogs';
import { fieldForError, openEditorDialog } from './ui';
import type { SaveFile } from '../../engine/save';
import { serializeGame } from '../../engine/save';
import { createWorld } from '../../engine/world';
import { createCharacter } from '../../engine/character';
import { loadWorldData } from '../../engine/game';

function makeSave(): SaveFile {
  const data = loadWorldData();
  const player = createCharacter({
    name: 'Sigrun',
    gender: 'female',
    strength: 18,
    intelligence: 18,
    constitution: 18,
    dexterity: 18,
    difficulty: 'intermediate',
  });
  const world = createWorld({ worldSeed: 7, data, player });
  return serializeGame(world, { savedAt: '2026-01-01T00:00:00.000Z' });
}

const click = (el: Element | null | undefined): void => {
  (el as HTMLButtonElement).click();
};

const setInputValue = (input: HTMLInputElement, value: string): void => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

afterEach(() => {
  closeAllModals();
  document.body.innerHTML = '';
});

describe('editor dialog', () => {
  it('opens with four tabs and shows the character panel first', () => {
    openEditorDialog({ save: makeSave(), data: loadWorldData(), onApply: vi.fn() });
    const tabs = document.querySelectorAll('.modal-overlay [data-tab]');
    expect(tabs.length).toBe(4);
    expect(
      document.querySelector('.modal-overlay [data-tab="character"]')?.className,
    ).toContain('active');
    const panel = document.querySelector('.modal-overlay [data-panel="character"]');
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain('active');
    expect(
      document.querySelector('.modal-overlay [data-panel="position"]')?.className,
    ).not.toContain('active');
  });

  it('switches tabs on click', () => {
    openEditorDialog({ save: makeSave(), data: loadWorldData(), onApply: vi.fn() });
    click(document.querySelector('.modal-overlay [data-tab="position"]'));
    expect(
      document.querySelector('.modal-overlay [data-panel="position"]')?.className,
    ).toContain('active');
    expect(
      document.querySelector('.modal-overlay [data-panel="character"]')?.className,
    ).not.toContain('active');
  });

  it('applies a strength edit through onApply', () => {
    const onApply = vi.fn();
    openEditorDialog({ save: makeSave(), data: loadWorldData(), onApply });
    const str = document.querySelector<HTMLInputElement>(
      '.modal-overlay [data-field="str"]',
    );
    expect(str).not.toBeNull();
    setInputValue(str!, '19');
    click(document.querySelector('.modal-overlay [data-action="apply-edits"]'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0]![0] as SaveFile;
    expect(applied.player.strength).toBe(19);
    // Modal closed on success.
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('rejects an invalid hp batch atomically and surfaces the error', () => {
    const onApply = vi.fn();
    openEditorDialog({ save: makeSave(), data: loadWorldData(), onApply });
    const hp = document.querySelector<HTMLInputElement>(
      '.modal-overlay [data-field="hp"]',
    );
    setInputValue(hp!, '0');
    click(document.querySelector('.modal-overlay [data-action="apply-edits"]'));
    expect(onApply).not.toHaveBeenCalled();
    const err = document.querySelector('.modal-overlay [data-field="editor-error"]');
    expect(err?.textContent).toMatch(/hp/i);
    expect(document.querySelector('.modal-overlay')).not.toBeNull();
  });

  it('adds an item from the searchable catalog and applies it', () => {
    const onApply = vi.fn();
    openEditorDialog({ save: makeSave(), data: loadWorldData(), onApply });
    click(document.querySelector('.modal-overlay [data-tab="inventory"]'));
    const search = document.querySelector<HTMLInputElement>(
      '.modal-overlay [data-field="item-search"]',
    );
    setInputValue(search!, 'long sword');
    const addBtn = document.querySelector('.modal-overlay [data-add-id="i-long-sword"]');
    expect(addBtn?.textContent).toContain('Long Sword');
    click(addBtn);
    const pending = document.querySelector('.modal-overlay [data-pending="i-long-sword"]');
    expect(pending).not.toBeNull();
    click(document.querySelector('.modal-overlay [data-action="apply-edits"]'));
    const applied = onApply.mock.calls[0]![0] as SaveFile;
    const entry = applied.inventory.pack.find((i) => i.defId === 'i-long-sword');
    expect(entry).toBeDefined();
  });

  it('teleports to an unvisited level and generates it on apply', () => {
    const onApply = vi.fn();
    const save = makeSave();
    openEditorDialog({ save, data: loadWorldData(), onApply });
    click(document.querySelector('.modal-overlay [data-tab="position"]'));
    const select = document.querySelector<HTMLSelectElement>(
      '.modal-overlay [data-field="pos-level"]',
    );
    // Level 7 is unvisited for a fresh save.
    expect(save.levels['7']).toBeUndefined();
    select!.value = '7';
    select!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(
      document.querySelector('.modal-overlay [data-field="gen-note"]')?.textContent,
    ).toMatch(/generate/i);
    click(document.querySelector('.modal-overlay [data-action="apply-edits"]'));
    const applied = onApply.mock.calls[0]![0] as SaveFile;
    expect(applied.levels['7']).toBeDefined();
    expect(applied.world.current).toBe(7);
  });

  it('changes the world seed and discards generated levels', () => {
    const onApply = vi.fn();
    const save = makeSave();
    openEditorDialog({ save, data: loadWorldData(), onApply });
    click(document.querySelector('.modal-overlay [data-tab="world"]'));
    const seed = document.querySelector<HTMLInputElement>(
      '.modal-overlay [data-field="seed"]',
    );
    setInputValue(seed!, '42');
    click(document.querySelector('.modal-overlay [data-action="apply-edits"]'));
    const applied = onApply.mock.calls[0]![0] as SaveFile;
    expect(applied.world.worldSeed).toBe(42);
    expect(applied.world.current).toBe(0);
    expect(Object.keys(applied.levels)).toEqual(['0']);
  });
});

describe('editor pending changes and discard guard (UI plan Phase 7)', () => {
  it('shows an unapplied-changes note once anything is edited', () => {
    openEditorDialog({ save: makeSave(), data: loadWorldData(), onApply: vi.fn() });
    const note = document.querySelector('.modal-overlay [data-field="pending-note"]')!;
    expect(note.textContent ?? '').toBe('');
    const str = document.querySelector<HTMLInputElement>('.modal-overlay [data-field="str"]');
    setInputValue(str!, '60');
    expect(note.textContent ?? '').toMatch(/unapplied changes/i);
  });

  it('clean cancel closes immediately; edited cancel asks first', () => {
    openEditorDialog({ save: makeSave(), data: loadWorldData(), onApply: vi.fn() });
    click(document.querySelector('.modal-overlay [data-action="cancel-edits"]'));
    expect(document.querySelector('.modal-overlay')).toBeNull();

    openEditorDialog({ save: makeSave(), data: loadWorldData(), onApply: vi.fn() });
    const str = document.querySelector<HTMLInputElement>('.modal-overlay [data-field="str"]');
    setInputValue(str!, '60');
    click(document.querySelector('.modal-overlay [data-action="cancel-edits"]'));
    // Confirm-discard state, still open.
    expect(document.querySelector('.modal-overlay')).not.toBeNull();
    expect(document.querySelector('.modal-overlay [data-action="discard-edits"]')).not.toBeNull();
    click(document.querySelector('.modal-overlay [data-action="keep-editing"]'));
    // Back to the normal footer.
    expect(document.querySelector('.modal-overlay [data-action="apply-edits"]')).not.toBeNull();
    expect(document.querySelector('.modal-overlay [data-action="discard-edits"]')).toBeNull();
    // Second cancel → confirm → discard closes.
    click(document.querySelector('.modal-overlay [data-action="cancel-edits"]'));
    click(document.querySelector('.modal-overlay [data-action="discard-edits"]'));
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('explains a validation failure beside the affected field', () => {
    const onApply = vi.fn();
    openEditorDialog({ save: makeSave(), data: loadWorldData(), onApply });
    const hp = document.querySelector<HTMLInputElement>('.modal-overlay [data-field="hp"]');
    setInputValue(hp!, '0');
    click(document.querySelector('.modal-overlay [data-action="apply-edits"]'));
    expect(onApply).not.toHaveBeenCalled();
    const row = hp!.closest('label')!;
    const inline = row.querySelector('.field-error');
    expect(inline?.textContent ?? '').toMatch(/hp must be between 1 and/i);
    expect(
      document.querySelector('.modal-overlay [data-field="editor-error"]')?.textContent ?? '',
    ).toMatch(/hp must be between 1 and/i);
  });

  it('clears inline field errors on the next Apply attempt', () => {
    const onApply = vi.fn();
    openEditorDialog({ save: makeSave(), data: loadWorldData(), onApply });
    const hp = document.querySelector<HTMLInputElement>('.modal-overlay [data-field="hp"]');
    setInputValue(hp!, '0');
    click(document.querySelector('.modal-overlay [data-action="apply-edits"]'));
    expect(hp!.closest('label')!.querySelector('.field-error')).not.toBeNull();
    setInputValue(hp!, '5');
    click(document.querySelector('.modal-overlay [data-action="apply-edits"]'));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(hp!.closest('label')!.querySelector('.field-error')).toBeNull();
  });
});

describe('fieldForError mapping', () => {
  it('routes known editor failures to their owning field', () => {
    expect(fieldForError('name must be 1-24 characters')).toBe('name');
    expect(fieldForError('strength must be an integer between 1 and 100')).toBe('str');
    expect(fieldForError('intelligence must be an integer between 1 and 100')).toBe('int');
    expect(fieldForError('constitution must be an integer between 1 and 100')).toBe('con');
    expect(fieldForError('dexterity must be an integer between 1 and 100')).toBe('dex');
    expect(fieldForError('hp must be between 1 and 26')).toBe('hp');
    expect(fieldForError('mana must be between 0 and 9')).toBe('mana');
    expect(fieldForError('gold must be a non-negative integer')).toBe('gold');
    expect(fieldForError('level must be an integer between 1 and 99')).toBe('level');
    expect(fieldForError('experience must be a non-negative integer')).toBe('xp');
    expect(fieldForError('unknown spell id(s): s999')).toBe('spells');
    expect(fieldForError('worldSeed must be an integer between 0 and 4294967295')).toBe('seed');
    expect(fieldForError('(3, 4) is not walkable on level 2')).toBe('pos-x');
    expect(fieldForError('(3, 4) is occupied on level 2')).toBe('pos-x');
    expect(fieldForError('x must be between 0 and 63')).toBe('pos-x');
    expect(fieldForError('y must be between 0 and 63')).toBe('pos-y');
    expect(fieldForError('level must be between 0 and 11')).toBe('pos-level');
    expect(fieldForError('level 7 has no free walkable tile')).toBe('pos-level');
    expect(fieldForError("unknown item definition 'i-nope'")).toBe('item-search');
    expect(fieldForError('save is not loadable: boom')).toBeNull();
  });
});

it('opens Inventory directly and applies gold without moving the hero', () => {
  const save = makeSave();
  save.player.x += 1;
  const onApply = vi.fn();
  openEditorDialog({save, data: loadWorldData(), onApply, initialTab: 'inventory', title: 'Debug editor'});
  expect(document.querySelector('.editor-panel.active')?.getAttribute('data-panel')).toBe('inventory');
  const gold = document.querySelector<HTMLInputElement>('[data-field="gold"]')!;
  expect(gold.closest('[data-panel]')?.getAttribute('data-panel')).toBe('inventory');
  gold.value = '1234'; gold.dispatchEvent(new Event('input', {bubbles: true}));
  document.querySelector<HTMLButtonElement>('[data-action="apply-edits"]')!.click();
  expect(onApply).toHaveBeenCalledOnce();
  const edited = onApply.mock.calls[0]![0] as SaveFile;
  expect(edited.inventory.gold).toBe(1234);
  expect([edited.player.x, edited.player.y, edited.world.current]).toEqual([save.player.x, save.player.y, save.world.current]);
});
