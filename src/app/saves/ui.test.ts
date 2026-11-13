// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSaveManager, type SaveManager, type SaveStorage } from './manager';
import { openSaveDialog } from './ui';
import { closeAllModals } from '../ui/dialogs';
import { SAVE_FORMAT, SAVE_VERSION, type SaveFile } from '../../engine/save';

function memoryStorage(): SaveStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

function fakeSave(name = 'Sigrun', level = 3, turn = 77): SaveFile {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    meta: { savedAt: '2026-11-11T10:00:00.000Z', turn },
    player: { name, level, difficulty: 'difficult' },
    world: { worldSeed: 1, current: 2, turn, gameplayRngState: 9, restedHours: 0 },
    levels: {},
    inventory: { pack: [], gold: 0, equipment: {}, seq: 0 },
  } as unknown as SaveFile;
}

function setup(mode: 'save' | 'load'): { manager: SaveManager; storage: SaveStorage } {
  void mode;
  const storage = memoryStorage();
  const manager = createSaveManager({ storage });
  return { manager, storage };
}

function dialog(): HTMLElement {
  return document.querySelector('.modal-overlay') as HTMLElement;
}

afterEach(() => {
  closeAllModals();
  document.body.innerHTML = '';
});

describe('save dialog', () => {
  it('renders all slots with metadata', () => {
    const { manager } = setup('load');
    manager.saveToSlot(1, fakeSave());
    manager.autosave(fakeSave('AutoChar', 5, 9));
    openSaveDialog({ mode: 'load', manager });
    const rows = dialog().querySelectorAll('.slot-row');
    expect(rows.length).toBe(6);
    const row1 = dialog().querySelector('[data-slot-id="1"]') as HTMLElement;
    expect(row1.textContent).toContain('Sigrun');
    expect(row1.textContent).toContain('Lv 3');
    expect(row1.textContent).toContain('77 turns');
    const auto = dialog().querySelector('[data-slot-id="auto"]') as HTMLElement;
    expect(auto.textContent).toContain('AutoChar');
    const empty = dialog().querySelector('[data-slot-id="0"]') as HTMLElement;
    expect(empty.textContent).toContain('Empty');
  });

  it('save mode fires onSave for manual slots', () => {
    const { manager } = setup('save');
    const onSave = vi.fn();
    openSaveDialog({ mode: 'save', manager, onSave });
    const autoRow = dialog().querySelector('[data-slot-id="auto"]') as HTMLElement;
    expect(autoRow.querySelector('[data-action="save-here"]')).toBeNull();
    (dialog().querySelector('[data-slot-id="3"] [data-action="save-here"]') as HTMLElement).click();
    expect(onSave).toHaveBeenCalledWith(3);
  });

  it('load mode fires onLoad with the parsed file', () => {
    const { manager } = setup('load');
    manager.saveToSlot(2, fakeSave('LoadMe'));
    const onLoad = vi.fn();
    openSaveDialog({ mode: 'load', manager, onLoad });
    (dialog().querySelector('[data-slot-id="2"] [data-action="load"]') as HTMLElement).click();
    expect(onLoad).toHaveBeenCalledTimes(1);
    const file = onLoad.mock.calls[0]![0] as SaveFile;
    expect(file.player.name).toBe('LoadMe');
  });

  it('load buttons are disabled for empty or corrupt slots', () => {
    const { manager, storage } = setup('load');
    storage.setItem('cotw.save.4', '{broken');
    openSaveDialog({ mode: 'load', manager });
    const emptyBtn = dialog().querySelector('[data-slot-id="0"] [data-action="load"]') as HTMLButtonElement;
    expect(emptyBtn.disabled).toBe(true);
    const corruptBtn = dialog().querySelector('[data-slot-id="4"] [data-action="load"]') as HTMLButtonElement;
    expect(corruptBtn.disabled).toBe(true);
  });

  it('delete requires a second confirming click (A18)', () => {
    const { manager } = setup('load');
    manager.saveToSlot(1, fakeSave('Doomed'));
    openSaveDialog({ mode: 'load', manager });
    const first = dialog().querySelector('[data-slot-id="1"] [data-action="delete"]') as HTMLElement;
    first.click();
    // Armed, not deleted: the save is still loadable and a cancel path exists.
    expect(manager.loadSlot(1).player.name).toBe('Doomed');
    const cancel = dialog().querySelector('[data-slot-id="1"] [data-action="delete-cancel"]') as HTMLElement;
    cancel.click();
    expect(manager.loadSlot(1).player.name).toBe('Doomed');
    expect(dialog().querySelector('[data-slot-id="1"] [data-action="delete"]')).not.toBeNull();
    // Second arm + confirm deletes.
    (dialog().querySelector('[data-slot-id="1"] [data-action="delete"]') as HTMLElement).click();
    const confirm = dialog().querySelector('[data-slot-id="1"] [data-action="delete-confirm"]') as HTMLElement;
    confirm.click();
    const rebuilt = dialog().querySelector('[data-slot-id="1"]') as HTMLElement;
    expect(rebuilt.textContent).toContain('Empty');
    expect(() => manager.loadSlot(1)).toThrow(/empty/i);
  });

  it('delete confirmation names the character at risk (A18)', () => {
    const { manager } = setup('load');
    manager.saveToSlot(2, fakeSave('Sigrun'));
    openSaveDialog({ mode: 'load', manager });
    (dialog().querySelector('[data-slot-id="2"] [data-action="delete"]') as HTMLElement).click();
    const confirm = dialog().querySelector('[data-slot-id="2"] [data-action="delete-confirm"]') as HTMLElement;
    expect(confirm.textContent).toContain('Sigrun');
  });

  it('saving over an occupied slot asks for confirmation; empty slots do not (A18)', () => {
    const { manager } = setup('save');
    manager.saveToSlot(1, fakeSave('Existing'));
    const onSave = vi.fn();
    openSaveDialog({ mode: 'save', manager, onSave });
    // Occupied: first click only arms.
    (dialog().querySelector('[data-slot-id="1"] [data-action="save-here"]') as HTMLElement).click();
    expect(onSave).not.toHaveBeenCalled();
    (dialog().querySelector('[data-slot-id="1"] [data-action="save-cancel"]') as HTMLElement).click();
    expect(onSave).not.toHaveBeenCalled();
    expect(dialog().querySelector('[data-slot-id="1"] [data-action="save-here"]')).not.toBeNull();
    // Arm + confirm fires the save.
    (dialog().querySelector('[data-slot-id="1"] [data-action="save-here"]') as HTMLElement).click();
    (dialog().querySelector('[data-slot-id="1"] [data-action="save-confirm"]') as HTMLElement).click();
    expect(onSave).toHaveBeenCalledWith(1);
    // Empty: immediate.
    (dialog().querySelector('[data-slot-id="3"] [data-action="save-here"]') as HTMLElement).click();
    expect(onSave).toHaveBeenCalledWith(3);
  });

  it('rebuild closes the previous modal through the shared lifecycle (A18)', async () => {
    const { manager } = setup('load');
    manager.saveToSlot(0, fakeSave('Lifecycle'));
    const { openModalCount } = await import('../ui/dialogs');
    openSaveDialog({ mode: 'load', manager });
    expect(openModalCount()).toBe(1);
    (dialog().querySelector('[data-slot-id="0"] [data-action="rename"]') as HTMLElement).click();
    (dialog().querySelector('[data-slot-id="0"] [data-action="rename-ok"]') as HTMLElement).click();
    // One overlay in the DOM and one entry in the modal stack (old rebuild leaked stack entries).
    expect(document.querySelectorAll('.modal-overlay').length).toBe(1);
    expect(openModalCount()).toBe(1);
  });

  it('three rename/delete rebuilds then close leave zero open modals (Task 5)', async () => {
    const { manager } = setup('load');
    manager.saveToSlot(0, fakeSave('First'));
    manager.saveToSlot(1, fakeSave('Second'));
    const { openModalCount, closeAllModals } = await import('../ui/dialogs');
    openSaveDialog({ mode: 'load', manager });
    // Rebuild 1: rename slot 0.
    (dialog().querySelector('[data-slot-id="0"] [data-action="rename"]') as HTMLElement).click();
    (dialog().querySelector('[data-slot-id="0"] [data-action="rename-ok"]') as HTMLElement).click();
    // Rebuild 2: arm + cancel a delete (rebuilds again).
    (dialog().querySelector('[data-slot-id="1"] [data-action="delete"]') as HTMLElement).click();
    (dialog().querySelector('[data-slot-id="1"] [data-action="delete-cancel"]') as HTMLElement).click();
    // Rebuild 3: rename slot 1.
    (dialog().querySelector('[data-slot-id="1"] [data-action="rename"]') as HTMLElement).click();
    (dialog().querySelector('[data-slot-id="1"] [data-action="rename-ok"]') as HTMLElement).click();
    expect(document.querySelectorAll('.modal-overlay').length).toBe(1);
    expect(openModalCount()).toBe(1);
    // Explicit close: nothing left open, gameplay input would be re-enabled.
    closeAllModals();
    expect(openModalCount()).toBe(0);
    expect(document.querySelectorAll('.modal-overlay').length).toBe(0);
  });

  it('rename edits inline and writes back', () => {
    const { manager } = setup('load');
    manager.saveToSlot(0, fakeSave('OldName'));
    openSaveDialog({ mode: 'load', manager });
    (dialog().querySelector('[data-slot-id="0"] [data-action="rename"]') as HTMLElement).click();
    const input = dialog().querySelector('[data-slot-id="0"] input') as HTMLInputElement;
    input.value = 'NewName';
    (dialog().querySelector('[data-slot-id="0"] [data-action="rename-ok"]') as HTMLElement).click();
    expect(manager.loadSlot(0).player.name).toBe('NewName');
    const row = dialog().querySelector('[data-slot-id="0"]') as HTMLElement;
    expect(row.textContent).toContain('NewName');
  });

  it('export hands the file to the injected download hook', () => {
    const { manager } = setup('load');
    manager.saveToSlot(0, fakeSave('Export Me'));
    const download = vi.fn();
    openSaveDialog({ mode: 'load', manager, download });
    (dialog().querySelector('[data-slot-id="0"] [data-action="export"]') as HTMLElement).click();
    expect(download).toHaveBeenCalledTimes(1);
    const arg = download.mock.calls[0]![0] as { filename: string; json: string };
    expect(arg.filename).toBe('export-me.cotwsave.json');
    expect((JSON.parse(arg.json) as SaveFile).player.name).toBe('Export Me');
  });

  it('import validates file text and surfaces errors', async () => {
    const { manager } = setup('load');
    const onImport = vi.fn();
    openSaveDialog({ mode: 'load', manager, onImport });
    const input = dialog().querySelector('input[type="file"]') as HTMLInputElement;
    const bad = new File(['not json at all'], 'bad.cotwsave.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [bad], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    const error = dialog().querySelector('[data-field="import-error"]') as HTMLElement;
    expect(error.textContent).toMatch(/corrupt/i);
    expect(onImport).not.toHaveBeenCalled();

    const good = new File([JSON.stringify(fakeSave('FromFile'))], 'good.cotwsave.json', {
      type: 'application/json',
    });
    Object.defineProperty(input, 'files', { value: [good], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect((dialog().querySelector('[data-field="import-error"]') as HTMLElement).textContent).toBe('');
    expect(onImport).toHaveBeenCalledTimes(1);
    expect((onImport.mock.calls[0]![0] as SaveFile).player.name).toBe('FromFile');
  });

  it('drag-drop imports a dropped save file', async () => {
    const { manager } = setup('load');
    const onImport = vi.fn();
    openSaveDialog({ mode: 'load', manager, onImport });
    const file = new File([JSON.stringify(fakeSave('Dropped'))], 'drop.cotwsave.json', {
      type: 'application/json',
    });
    const drop = new Event('drop', { bubbles: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
    (dialog().querySelector('.save-dialog') as HTMLElement).dispatchEvent(drop);
    await new Promise((r) => setTimeout(r, 0));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect((onImport.mock.calls[0]![0] as SaveFile).player.name).toBe('Dropped');
  });

  it('load mode renders Edit buttons firing onEdit for non-empty slots', () => {
    const { manager } = setup('load');
    manager.saveToSlot(2, fakeSave('Editorial', 5, 12));
    const onEdit = vi.fn();
    openSaveDialog({ mode: 'load', manager, onEdit });
    const rows = [...dialog().querySelectorAll('[data-slot-id]')];
    expect(rows.length).toBeGreaterThan(0);
    // Empty autosave gets no Edit button; slot 2 does.
    const autoRow = rows.find((r) => r.getAttribute('data-slot-id') === 'auto');
    expect(autoRow?.querySelector('[data-action="edit"]')).toBeNull();
    const slotRow = rows.find((r) => r.getAttribute('data-slot-id') === '2');
    const editBtn = slotRow?.querySelector<HTMLButtonElement>('[data-action="edit"]');
    expect(editBtn).not.toBeNull();
    editBtn!.click();
    expect(onEdit).toHaveBeenCalledWith(2);
  });

  it('no onEdit hook means no Edit buttons', () => {
    const { manager } = setup('load');
    manager.saveToSlot(1, fakeSave('NoHook', 2, 3));
    openSaveDialog({ mode: 'load', manager });
    expect(dialog().querySelector('[data-action="edit"]')).toBeNull();
  });

  it('a rejected File.text() surfaces an import error instead of an unhandled rejection (F18)', async () => {
    const { manager } = setup('load');
    const onImport = vi.fn();
    openSaveDialog({ mode: 'load', manager, onImport });
    const input = dialog().querySelector('input[type="file"]') as HTMLInputElement;
    const unreadable = {
      name: 'locked.cotwsave.json',
      text: () => Promise.reject(new Error('The file could not be read')),
    } as unknown as File;
    Object.defineProperty(input, 'files', { value: [unreadable], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    const error = dialog().querySelector('[data-field="import-error"]') as HTMLElement;
    expect(error.textContent).toMatch(/could not be read/i);
    expect(onImport).not.toHaveBeenCalled();
  });

  it('a corrupt-metadata slot renders as Corrupt without crashing the dialog (F18)', () => {
    const { manager, storage } = setup('load');
    const raw = fakeSave();
    (raw as unknown as { meta: { savedAt: number } }).meta.savedAt = 42;
    storage.setItem('cotw.save.1', JSON.stringify(raw));
    expect(() => openSaveDialog({ mode: 'load', manager })).not.toThrow();
    const row = dialog().querySelector('[data-slot-id="1"]');
    expect(row!.textContent).toMatch(/Corrupt/);
    const loadBtn = row!.querySelector<HTMLButtonElement>('[data-action="load"]');
    expect(loadBtn!.disabled).toBe(true);
  });
});
