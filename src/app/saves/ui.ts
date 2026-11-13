/**
 * Save/load slot dialog: lists the autosave + 5 manual slots with metadata,
 * supports save-here/load/delete/rename/export/import (file picker and
 * drag-drop). All storage work goes through the injected SaveManager; the
 * download hook is injectable so jsdom tests don't need URL.createObjectURL.
 */

import type { SaveFile } from '../../engine/save';
import { openModal, type ModalHandle } from '../ui/dialogs';
import type { SaveManager } from './manager';

export interface SaveDialogOptions {
  mode: 'save' | 'load';
  levelName?: (index: number) => string;
  manager: SaveManager;
  onSave?: (slot: number) => void;
  onLoad?: (file: SaveFile) => void;
  onImport?: (file: SaveFile) => void;
  /** Open the save editor for a stored slot (load mode only). */
  onEdit?: (slot: number | 'auto') => void;
  /** Injected download hook ({filename, json}); defaults to a Blob anchor download. */
  download?: (data: { filename: string; json: string }) => void;
}

function defaultDownload(data: { filename: string; json: string }): void {
  if (typeof URL.createObjectURL !== 'function') return;
  const blob = new Blob([data.json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = data.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function readSaveFile(file: File): Promise<string> {
  return await file.text();
}

export function openSaveDialog(options: SaveDialogOptions): void {
  const { mode, manager } = options;
  const download = options.download ?? defaultDownload;
  let handle: ModalHandle | null = null;

  /**
   * Two-step confirmation for destructive actions (A18): the clicked button
   * is replaced by an explicit confirm (labelled with what is at risk) plus a
   * cancel that restores the row. Confirming performs the action; canceling
   * rebuilds the dialog unchanged.
   */
  const armConfirm = (
    trigger: HTMLButtonElement,
    confirmLabel: string,
    confirmAction: string,
    cancelAction: string,
    onConfirm: () => void,
  ): void => {
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.textContent = confirmLabel;
    confirm.dataset.action = confirmAction;
    confirm.className = 'danger';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.dataset.action = cancelAction;
    confirm.addEventListener('click', onConfirm);
    cancel.addEventListener('click', () => rebuild());
    trigger.replaceWith(confirm);
    confirm.after(cancel);
    confirm.focus();
  };

  const build = (): void => {
    const content = document.createElement('div');
    content.className = 'save-dialog';

    const showError = (message: string): void => {
      const err = content.querySelector<HTMLElement>('[data-field="import-error"]');
      if (err) err.textContent = message;
    };

    const importText = (text: string): void => {
      try {
        const file = manager.importJson(text);
        options.onImport?.(file);
        showError('');
      } catch (err) {
        showError(err instanceof Error ? err.message : 'import failed');
      }
    };

    for (const info of manager.listSlots()) {
      const row = document.createElement('div');
      row.className = 'slot-row';
      row.dataset.slotId = String(info.id);

      const label = document.createElement('span');
      label.className = 'slot-label';
      if (info.empty) {
        label.textContent = info.id === 'auto' ? 'Autosave · Empty' : `Slot ${info.id} · Empty`;
      } else if (info.corrupt) {
        label.textContent = info.id === 'auto' ? 'Autosave — Corrupt' : 'Corrupt save data';
      } else {
        const date = info.savedAt ? new Date(info.savedAt) : null;
        const when = date && Number.isFinite(date.getTime()) ? ` · ${date.toLocaleString([], {dateStyle:'short', timeStyle:'short'})}` : '';
        const place = info.current !== undefined ? ` · ${options.levelName?.(info.current) ?? `Level ${info.current}`}` : '';
        label.textContent =
          `${info.id === 'auto' ? 'Autosave · ' : `Slot ${info.id} · `}${info.name ?? '?'} ` +
          `Lv ${info.level ?? '?'}${place} · ${info.turns ?? '?'} turns${when}`;
      }
      row.appendChild(label);

      if (mode === 'save' && info.id !== 'auto') {
        const save = document.createElement('button');
        save.type = 'button';
        save.textContent = 'Save here';
        save.dataset.action = 'save-here';
        save.addEventListener('click', () => {
          if (info.empty) {
            options.onSave?.(info.id as number);
            return;
          }
          armConfirm(
            save,
            `Overwrite ${info.name ?? 'save'}?`,
            'save-confirm',
            'save-cancel',
            () => options.onSave?.(info.id as number),
          );
        });
        row.appendChild(save);
      }
      if (mode === 'load') {
        const load = document.createElement('button');
        load.type = 'button';
        load.textContent = 'Load';
        load.dataset.action = 'load';
        load.disabled = info.empty || (info.corrupt ?? false);
        if (!load.disabled) {
          load.addEventListener('click', () => {
            try {
              options.onLoad?.(manager.loadSlot(info.id));
            } catch (err) {
              showError(err instanceof Error ? err.message : 'load failed');
            }
          });
        }
        row.appendChild(load);

        if (!info.empty && !info.corrupt && options.onEdit) {
          const edit = document.createElement('button');
          edit.type = 'button';
          edit.textContent = 'Edit';
          edit.dataset.action = 'edit';
          edit.addEventListener('click', () => options.onEdit?.(info.id));
          row.appendChild(edit);
        }
      }
      if (!info.empty) {
        if (!info.corrupt) {
          const rename = document.createElement('button');
          rename.type = 'button';
          rename.textContent = 'Rename';
          rename.dataset.action = 'rename';
          rename.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'text';
            input.maxLength = 24;
            input.value = info.name ?? '';
            const ok = document.createElement('button');
            ok.type = 'button';
            ok.textContent = 'OK';
            ok.dataset.action = 'rename-ok';
            ok.addEventListener('click', () => {
              try {
                manager.renameSlot(info.id, input.value);
                rebuild();
              } catch (err) {
                showError(err instanceof Error ? err.message : 'rename failed');
              }
            });
            label.replaceWith(input);
            rename.replaceWith(ok);
          });
          row.appendChild(rename);

          const exportBtn = document.createElement('button');
          exportBtn.type = 'button';
          exportBtn.textContent = 'Export';
          exportBtn.dataset.action = 'export';
          exportBtn.addEventListener('click', () => {
            try {
              download(manager.exportSlot(info.id));
            } catch (err) {
              showError(err instanceof Error ? err.message : 'export failed');
            }
          });
          row.appendChild(exportBtn);
        }
        const del = document.createElement('button');
        del.type = 'button';
        del.textContent = 'Delete';
        del.dataset.action = 'delete';
        del.addEventListener('click', () => {
          armConfirm(
            del,
            `Delete ${info.name ?? 'save'}?`,
            'delete-confirm',
            'delete-cancel',
            () => {
              manager.deleteSlot(info.id);
              rebuild();
            },
          );
        });
        row.appendChild(del);
      }
      content.appendChild(row);
    }

    if (mode === 'load') {
      const footer = document.createElement('div');
      footer.className = 'save-footer';
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.json,application/json';
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        void readSaveFile(file)
          .then(importText)
          .catch((err: unknown) => {
            // File.text() can reject (locked file, permission revoked);
            // surface it in the dialog instead of an unhandled rejection.
            showError(err instanceof Error ? err.message : 'the file could not be read');
          });
      });
      const importBtn = document.createElement('button');
      importBtn.type = 'button';
      importBtn.textContent = 'Import file…';
      importBtn.dataset.action = 'import';
      importBtn.addEventListener('click', () => fileInput.click());
      footer.append(fileInput, importBtn);
      content.appendChild(footer);

      const error = document.createElement('p');
      error.dataset.field = 'import-error';
      error.className = 'import-error';
      error.textContent = '';
      content.appendChild(error);

      content.addEventListener('dragover', (e) => e.preventDefault());
      content.addEventListener('drop', (e) => {
        e.preventDefault();
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        void readSaveFile(file)
          .then(importText)
          .catch((err: unknown) => {
            showError(err instanceof Error ? err.message : 'the file could not be read');
          });
      });
    }

    handle = openModal({
      title: mode === 'save' ? 'Save Game' : 'Load Game',
      content,
      onClose: undefined,
    });
  };

  const rebuild = (): void => {
    // Go through the shared modal lifecycle so focus restoration and the
    // cotw:modal stack accounting stay correct (A18/A15).
    handle?.close();
    handle = null;
    build();
  };

  build();
}
