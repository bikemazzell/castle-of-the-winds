/**
 * Save manager: 5 manual slots + an autosave slot over an injected storage,
 * plus file import/export. Storage-shape agnostic so tests run on a memory
 * map while the app uses localStorage. Validation is injected: the manager
 * checks format/version cheaply; deep validation (full `deserializeGame`)
 * is wired by the controller.
 */

import { SAVE_FORMAT, SAVE_VERSION, type SaveFile } from '../../engine/save';

export const MANUAL_SLOT_COUNT = 5;

export type SlotId = number | 'auto';

export interface SaveSlotInfo {
  id: SlotId;
  empty: boolean;
  corrupt?: boolean;
  name?: string;
  level?: number;
  turns?: number;
  savedAt?: string;
  difficulty?: string;
  /** Level index the character is on (from save.world.current). */
  current?: number;
  /** Which campaign this payload belongs to (meta.part, absent = 1). */
  part?: 1 | 2;
}

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SaveManager {
  listSlots(): SaveSlotInfo[];
  slotInfo(id: SlotId): SaveSlotInfo;
  /** Most recent valid (non-empty, non-corrupt) slot; deterministic ties. */
  mostRecentSlot(): SlotId | null;
  saveToSlot(slot: number, file: SaveFile): void;
  autosave(file: SaveFile): void;
  loadSlot(id: SlotId): SaveFile;
  deleteSlot(id: SlotId): void;
  renameSlot(id: SlotId, name: string): SaveFile;
  exportSlot(id: SlotId): { filename: string; json: string };
  importJson(text: string): SaveFile;
}

export class SaveSlotError extends Error {}

/**
 * Storage key for a slot. Parts live in SEPARATE key spaces (PART2-PLAN
 * Task P6) so a part-2 autosave can never overwrite a part-1 save: part 1
 * keeps the legacy keys, part 2 appends a `-p2` marker.
 */
export const slotKey = (id: SlotId, part: 1 | 2 = 1): string => {
  const suffix = part === 2 ? '-p2' : '';
  return id === 'auto' ? `cotw.save.auto${suffix}` : `cotw.save${suffix}.${id}`;
};

/** Import size bound (code-quality Task 2): real v1 saves are a few hundred KB. */
export const MAX_IMPORT_CHARS = 12_000_000;

/** Default structural validation: format + version gates. Full content
 * validation is the caller's job (the controller injects a deserializeGame
 * validator that resolves the bundle by meta.part — PART2-PLAN Task P5). */
function defaultValidate(parsed: unknown): void {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new SaveSlotError('save data is corrupt');
  }
  const save = parsed as { format?: unknown; version?: unknown };
  if (save.format !== SAVE_FORMAT) {
    throw new SaveSlotError(`unknown save format '${String(save.format)}' (expected '${SAVE_FORMAT}')`);
  }
  if (save.version !== SAVE_VERSION) {
    throw new SaveSlotError(`save version ${String(save.version)} not supported`);
  }
}

export function saveFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'save'}.cotwsave.json`;
}

export function createSaveManager(deps: {
  storage: SaveStorage;
  validate?: (parsed: unknown) => void;
  /** Which campaign's key space this manager owns (PART2-PLAN Task P6). */
  part?: 1 | 2;
}): SaveManager {
  const { storage } = deps;
  const validate = deps.validate ?? defaultValidate;
  const part = deps.part ?? 1;

  const readRaw = (id: SlotId): string | null => storage.getItem(slotKey(id, part));

  /** Cross-part writes are rejected before touching storage: a slot list for
   * one campaign must never hold (or destroy) the other campaign's save. */
  const guardPart = (file: SaveFile): void => {
    const filePart = file.meta?.part ?? 1;
    if (filePart !== part) {
      throw new SaveSlotError(
        `save belongs to part ${filePart} but this slot holds part ${part}`,
      );
    }
  };

  const parseSlot = (id: SlotId): SaveFile => {
    const raw = readRaw(id);
    if (raw === null) throw new SaveSlotError(`save slot ${String(id)} is empty`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SaveSlotError(`save slot ${String(id)} is corrupt (bad JSON)`);
    }
    validate(parsed);
    return parsed as SaveFile;
  };

  const manager: SaveManager = {
    slotInfo(id: SlotId): SaveSlotInfo {
      const raw = readRaw(id);
      if (raw === null) return { id, empty: true };
      try {
        const parsed = JSON.parse(raw) as SaveFile;
        // Metadata type gates (CODE-QUALITY F18): the slot list UI calls
        // string methods on these fields; wrong types must surface as
        // `corrupt`, never as a thrown TypeError from the dialog builder.
        const name = parsed.player?.name;
        const level = parsed.player?.level;
        const turns = parsed.world?.turn;
        const savedAt = parsed.meta?.savedAt;
        const difficulty = parsed.player?.difficulty;
        const current = parsed.world?.current;
        const partRaw = parsed.meta?.part;
        const typesOk =
          (name === undefined || typeof name === 'string') &&
          (level === undefined || (typeof level === 'number' && Number.isInteger(level))) &&
          (turns === undefined || (typeof turns === 'number' && Number.isInteger(turns))) &&
          (savedAt === undefined || typeof savedAt === 'string') &&
          (difficulty === undefined || typeof difficulty === 'string') &&
          (current === undefined || (typeof current === 'number' && Number.isInteger(current))) &&
          (partRaw === undefined || partRaw === 1 || partRaw === 2);
        if (!typesOk) return { id, empty: false, corrupt: true };
        return {
          id,
          empty: false,
          name,
          level,
          turns,
          savedAt,
          difficulty,
          current,
          part: partRaw ?? 1,
        };
      } catch {
        return { id, empty: false, corrupt: true };
      }
    },

    listSlots(): SaveSlotInfo[] {
      const slots: SaveSlotInfo[] = [manager.slotInfo('auto')];
      for (let i = 0; i < MANUAL_SLOT_COUNT; i++) slots.push(manager.slotInfo(i));
      return slots;
    },

    mostRecentSlot(): SlotId | null {
      let best: { id: SlotId; time: number; tie: number } | null = null;
      for (const info of manager.listSlots()) {
        if (info.empty || info.corrupt) continue;
        // Defense in depth: a foreign-part payload under one of this part's
        // keys (e.g. legacy contamination) never becomes this part's Continue.
        if (info.part !== undefined && info.part !== part) continue;
        // Unparseable/missing timestamps rank oldest but still qualify.
        const ts = info.savedAt !== undefined ? Date.parse(info.savedAt) : Number.NaN;
        const time = Number.isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
        // Deterministic ties: auto beats manual; higher manual slot beats lower.
        const tie = info.id === 'auto' ? Number.POSITIVE_INFINITY : info.id;
        if (best === null || time > best.time || (time === best.time && tie > best.tie)) {
          best = { id: info.id, time, tie };
        }
      }
      return best ? best.id : null;
    },

    saveToSlot(slot: number, file: SaveFile): void {
      if (!Number.isInteger(slot) || slot < 0 || slot >= MANUAL_SLOT_COUNT) {
        throw new SaveSlotError(`manual slots are 0..${MANUAL_SLOT_COUNT - 1}`);
      }
      guardPart(file);
      storage.setItem(slotKey(slot, part), JSON.stringify(file));
    },

    autosave(file: SaveFile): void {
      // Single-attempt write (CODE-QUALITY F01): the old policy evicted the
      // previous autosave before retrying, so a second failure destroyed the
      // last good save. A failed write now reports the error and leaves the
      // previous autosave untouched.
      guardPart(file);
      try {
        storage.setItem(slotKey('auto', part), JSON.stringify(file));
      } catch (err) {
        throw new SaveSlotError(
          `autosave failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    loadSlot(id: SlotId): SaveFile {
      return parseSlot(id);
    },

    deleteSlot(id: SlotId): void {
      storage.removeItem(slotKey(id, part));
    },

    renameSlot(id: SlotId, name: string): SaveFile {
      const trimmed = name.trim();
      if (trimmed.length === 0) throw new SaveSlotError('slot name cannot be empty');
      const file = parseSlot(id);
      file.player.name = trimmed;
      storage.setItem(slotKey(id, part), JSON.stringify(file));
      return file;
    },

    exportSlot(id: SlotId): { filename: string; json: string } {
      const raw = readRaw(id);
      if (raw === null) throw new SaveSlotError(`save slot ${String(id)} is empty`);
      let normalized: string;
      try {
        normalized = JSON.stringify(JSON.parse(raw)); // throws on corrupt
      } catch {
        throw new SaveSlotError(`save slot ${String(id)} is corrupt (bad JSON)`);
      }
      const name = (JSON.parse(normalized) as SaveFile).player?.name ?? 'save';
      return { filename: saveFilename(name), json: normalized };
    },

    importJson(text: string): SaveFile {
      if (text.length > MAX_IMPORT_CHARS) {
        // Bound parsing before any allocation (code-quality Task 2). A real
        // v1 save with every level visited is a few hundred KB.
        throw new SaveSlotError(
          `imported file is too large (${text.length} chars; limit ${MAX_IMPORT_CHARS})`,
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new SaveSlotError('imported file is corrupt (bad JSON)');
      }
      validate(parsed);
      return parsed as SaveFile;
    },
  };

  return manager;
}
