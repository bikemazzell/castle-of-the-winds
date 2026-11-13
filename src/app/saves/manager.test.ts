import { describe, expect, it } from 'vitest';
import {
  MANUAL_SLOT_COUNT,
  SaveSlotError,
  createSaveManager,
  saveFilename,
  slotKey,
  type SaveManager,
  type SaveStorage,
} from './manager';
import { SAVE_FORMAT, SAVE_VERSION, type SaveFile } from '../../engine/save';

function memoryStorage(): SaveStorage & { dump(): Map<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    dump: () => map,
  };
}

function fakeSave(name = 'Sigrun', level = 2, turn = 42): SaveFile {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    meta: { savedAt: '2026-11-11T00:00:00.000Z', turn },
    player: { name, level, difficulty: 'intermediate' },
    world: { worldSeed: 7, current: 1, turn, gameplayRngState: 5, restedHours: 0 },
    levels: {},
    inventory: { pack: [], gold: 0, equipment: {}, seq: 0 },
  } as unknown as SaveFile;
}

describe('save manager', () => {
  it('round-trips a slot byte-identically', () => {
    const storage = memoryStorage();
    const manager = createSaveManager({ storage });
    const file = fakeSave();
    manager.saveToSlot(0, file);
    const loaded = manager.loadSlot(0);
    expect(JSON.stringify(loaded)).toBe(JSON.stringify(file));
    expect(storage.dump().get('cotw.save.0')).toBe(JSON.stringify(file));
  });

  it('lists slot metadata for auto + manual slots', () => {
    const manager = createSaveManager({ storage: memoryStorage() });
    manager.saveToSlot(1, fakeSave('Olaf', 4, 100));
    const slots = manager.listSlots();
    expect(slots.length).toBe(MANUAL_SLOT_COUNT + 1);
    expect(slots[0]!.id).toBe('auto');
    expect(slots[0]!.empty).toBe(true);
    const slot1 = slots.find((s) => s.id === 1)!;
    expect(slot1.empty).toBe(false);
    expect(slot1.name).toBe('Olaf');
    expect(slot1.level).toBe(4);
    expect(slot1.turns).toBe(100);
    expect(slot1.difficulty).toBe('intermediate');
    expect(slot1.savedAt).toBe('2026-11-11T00:00:00.000Z');
  });

  it('flags corrupt slot data without crashing the list', () => {
    const storage = memoryStorage();
    storage.setItem('cotw.save.2', '{not json');
    const manager = createSaveManager({ storage });
    const slot2 = manager.listSlots().find((s) => s.id === 2)!;
    expect(slot2.empty).toBe(false);
    expect(slot2.corrupt).toBe(true);
    expect(() => manager.loadSlot(2)).toThrow(/corrupt/i);
  });

  it('slot metadata carries the current level index', () => {
    const manager = createSaveManager({ storage: memoryStorage() });
    manager.saveToSlot(0, fakeSave('Sigrun', 3, 7));
    const slot0 = manager.listSlots().find((s) => s.id === 0)!;
    expect(slot0.current).toBe(1);
  });

  it('mostRecentSlot returns null when nothing is saved', () => {
    const manager = createSaveManager({ storage: memoryStorage() });
    expect(manager.mostRecentSlot()).toBeNull();
  });

  it('mostRecentSlot picks the latest timestamp across auto + manual slots', () => {
    const storage = memoryStorage();
    const manager = createSaveManager({ storage });
    const early = fakeSave('Early', 1, 1);
    early.meta.savedAt = '2026-11-11T08:00:00.000Z';
    const late = fakeSave('Late', 9, 2);
    late.meta.savedAt = '2026-11-11T20:00:00.000Z';
    manager.saveToSlot(0, early);
    manager.autosave(late);
    expect(manager.mostRecentSlot()).toBe('auto');
  });

  it('mostRecentSlot breaks timestamp ties deterministically: auto beats manual, higher slot beats lower', () => {
    const storage = memoryStorage();
    const manager = createSaveManager({ storage });
    const a = fakeSave('A', 1, 1);
    a.meta.savedAt = '2026-11-11T12:00:00.000Z';
    const b = fakeSave('B', 2, 2);
    b.meta.savedAt = '2026-11-11T12:00:00.000Z';
    manager.saveToSlot(1, a);
    manager.saveToSlot(3, b);
    expect(manager.mostRecentSlot()).toBe(3);

    const c = fakeSave('C', 3, 3);
    c.meta.savedAt = '2026-11-11T12:00:00.000Z';
    manager.autosave(c);
    expect(manager.mostRecentSlot()).toBe('auto');
  });

  it('mostRecentSlot skips empty and corrupt slots', () => {
    const storage = memoryStorage();
    storage.setItem('cotw.save.0', '{not json');
    const manager = createSaveManager({ storage });
    const onlyGood = fakeSave('Good', 2, 9);
    onlyGood.meta.savedAt = '2026-11-11T06:00:00.000Z';
    manager.saveToSlot(2, onlyGood);
    expect(manager.mostRecentSlot()).toBe(2);
    storage.removeItem('cotw.save.2');
    expect(manager.mostRecentSlot()).toBeNull();
  });

  it('mostRecentSlot treats a slot without a parseable timestamp as older than any dated one', () => {
    const storage = memoryStorage();
    const manager = createSaveManager({ storage });
    const undated = fakeSave('Undated', 1, 1);
    (undated.meta as { savedAt?: string }).savedAt = undefined;
    const dated = fakeSave('Dated', 1, 2);
    dated.meta.savedAt = '2020-01-01T00:00:00.000Z';
    manager.saveToSlot(0, undated);
    manager.saveToSlot(1, dated);
    expect(manager.mostRecentSlot()).toBe(1);
  });

  it('autosave preserves the previous autosave when the write fails (F01)', () => {
    const inner = memoryStorage();
    const storage: SaveStorage = {
      getItem: (k) => inner.getItem(k),
      removeItem: (k) => inner.removeItem(k),
      setItem: (k, v) => {
        // Quota "exceeded" while an autosave already exists: the previous
        // autosave must survive the failed write (old policy deleted it
        // before retrying — a second failure destroyed the last good save).
        if (k === 'cotw.save.auto' && inner.getItem('cotw.save.auto') !== null) {
          throw new Error('QuotaExceededError');
        }
        inner.setItem(k, v);
      },
    };
    const manager = createSaveManager({ storage });
    manager.saveToSlot(0, fakeSave('Kept'));
    manager.autosave(fakeSave('First'));
    expect(() => manager.autosave(fakeSave('Second'))).toThrow(SaveSlotError);
    const auto = manager.loadSlot('auto') as unknown as { player: { name: string } };
    expect(auto.player.name).toBe('First');
    // Manual slots are never touched.
    expect((manager.loadSlot(0) as unknown as { player: { name: string } }).player.name).toBe('Kept');
  });

  it('throws a quota error when even eviction cannot free space', () => {
    const storage: SaveStorage = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const manager = createSaveManager({ storage });
    expect(() => manager.autosave(fakeSave())).toThrow(SaveSlotError);
  });

  it('rejects corrupt and foreign-format imports', () => {
    const manager = createSaveManager({ storage: memoryStorage() });
    expect(() => manager.importJson('this is not json')).toThrow(/corrupt/i);
    expect(() => manager.importJson(JSON.stringify({ format: 'other', version: 9 }))).toThrow(/format/i);
    expect(() => manager.importJson('x'.repeat(12_000_001))).toThrow(/too large/i);
    const ok = manager.importJson(JSON.stringify(fakeSave('Imported')));
    expect((ok as unknown as { player: { name: string } }).player.name).toBe('Imported');
  });

  it('empty slots fail to load with a clear error', () => {
    const manager = createSaveManager({ storage: memoryStorage() });
    expect(() => manager.loadSlot(3)).toThrow(/empty/i);
  });

  it('deletes and renames slots', () => {
    const storage = memoryStorage();
    const manager = createSaveManager({ storage });
    manager.saveToSlot(2, fakeSave('Sigrun'));
    manager.deleteSlot(2);
    expect(() => manager.loadSlot(2)).toThrow(/empty/i);

    manager.saveToSlot(2, fakeSave('Sigrun'));
    const renamed = manager.renameSlot(2, '  Sigrun the Bold  ');
    expect((renamed as unknown as { player: { name: string } }).player.name).toBe('Sigrun the Bold');
    expect(
      (manager.loadSlot(2) as unknown as { player: { name: string } }).player.name,
    ).toBe('Sigrun the Bold');

    expect(() => manager.renameSlot(2, '   ')).toThrow(/name/i);
  });

  it('exports a slot as filename + json', () => {
    const storage = memoryStorage();
    const manager = createSaveManager({ storage });
    manager.saveToSlot(0, fakeSave('Sigrun the Bold'));
    const exported = manager.exportSlot(0);
    expect(exported.filename).toBe('sigrun-the-bold.cotwsave.json');
    expect(JSON.parse(exported.json)).toEqual(manager.loadSlot(0) as unknown as Record<string, unknown>);
  });

  it('validates manual slot bounds', () => {
    const manager = createSaveManager({ storage: memoryStorage() });
    expect(() => manager.saveToSlot(-1, fakeSave())).toThrow(/slot/i);
    expect(() => manager.saveToSlot(MANUAL_SLOT_COUNT, fakeSave())).toThrow(/slot/i);
  });

  it('saveFilename slugs names and falls back for empties', () => {
    expect(saveFilename('Sigrun the Bold')).toBe('sigrun-the-bold.cotwsave.json');
    expect(saveFilename('***')).toBe('save.cotwsave.json');
  });
});

describe('save manager with injected deep validation', () => {
  it('runs the validator on load and import', () => {
    const seen: unknown[] = [];
    const manager: SaveManager = createSaveManager({
      storage: memoryStorage(),
      validate: (parsed) => {
        seen.push(parsed);
        if ((parsed as { player?: { hp?: number } }).player?.hp === 0) {
          throw new Error('cannot save a dead character');
        }
      },
    });
    const file = fakeSave();
    manager.saveToSlot(0, file);
    manager.loadSlot(0);
    manager.importJson(JSON.stringify(file));
    expect(seen.length).toBe(2);
    const deadFile = fakeSave('Dead');
    (deadFile as unknown as { player: { hp: number } }).player.hp = 0;
    expect(() => manager.importJson(JSON.stringify(deadFile))).toThrow(/dead/);
  });
});

describe('save manager robustness (CODE-QUALITY Task 1, F01/F18)', () => {
  it('a failed autosave write preserves the previous autosave bytes', () => {
    // Storage that already holds a good autosave but rejects every write.
    const good = JSON.stringify(fakeSave('Sigrun', 3, 77));
    const map = new Map<string, string>([['cotw.save.auto', good]]);
    const storage: SaveStorage = {
      getItem: (k) => map.get(k) ?? null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: (k) => {
        map.delete(k);
      },
    };
    const manager = createSaveManager({ storage });
    expect(() => manager.autosave(fakeSave('Sigrun', 4, 90))).toThrow(SaveSlotError);
    // F01 regression: the old delete-then-retry policy destroyed the last
    // good autosave before retrying; a second failure left nothing.
    expect(storage.getItem('cotw.save.auto')).toBe(good);
    const loaded = manager.loadSlot('auto');
    expect(loaded.player.name).toBe('Sigrun');
    expect(loaded.meta.turn).toBe(77);
  });

  it('marks a slot corrupt when metadata fields have the wrong type', () => {
    const storage = memoryStorage();
    const raw = fakeSave();
    // Tampered storage: savedAt is a number — the UI calls .slice() on it.
    (raw as unknown as { meta: { savedAt: number } }).meta.savedAt = 42;
    storage.setItem('cotw.save.2', JSON.stringify(raw));
    const manager = createSaveManager({ storage });
    const info = manager.slotInfo(2);
    expect(info.corrupt).toBe(true);

    const raw2 = fakeSave();
    (raw2 as unknown as { player: { name: object } }).player.name = { oh: 'no' };
    storage.setItem('cotw.save.3', JSON.stringify(raw2));
    expect(manager.slotInfo(3).corrupt).toBe(true);
    // List stays usable (no throw) with the corrupt rows flagged.
    const slots = manager.listSlots();
    expect(slots.find((s) => s.id === 2)!.corrupt).toBe(true);
    expect(slots.find((s) => s.id === 3)!.corrupt).toBe(true);
  });
});

describe('part-scoped slots (PART2-PLAN Task P6)', () => {
  const p1 = (name = 'Sigrun'): SaveFile => fakeSave(name);
  const p2 = (name = 'Beta'): SaveFile => {
    const base = fakeSave(name);
    return { ...base, meta: { ...base.meta, part: 2 } };
  };

  it('slotKey separates the two parts', () => {
    expect(slotKey('auto', 1)).toBe('cotw.save.auto');
    expect(slotKey(0, 1)).toBe('cotw.save.0');
    expect(slotKey('auto', 2)).toBe('cotw.save.auto-p2');
    expect(slotKey(0, 2)).toBe('cotw.save-p2.0');
    // Default stays part 1 (legacy key space).
    expect(slotKey('auto')).toBe('cotw.save.auto');
    expect(slotKey(3)).toBe('cotw.save.3');
  });

  it('a part-2 manager writes and reads its own key space', () => {
    const storage = memoryStorage();
    const m2 = createSaveManager({ storage, part: 2 });
    m2.saveToSlot(0, p2());
    expect(storage.dump().has('cotw.save-p2.0')).toBe(true);
    expect(m2.loadSlot(0).player.name).toBe('Beta');
    // A part-1 manager over the same storage sees slot 0 empty.
    const m1 = createSaveManager({ storage, part: 1 });
    expect(m1.slotInfo(0).empty).toBe(true);
  });

  it('rejects cross-part writes before touching storage', () => {
    const storage = memoryStorage();
    const m1 = createSaveManager({ storage, part: 1 });
    const m2 = createSaveManager({ storage, part: 2 });
    expect(() => m1.saveToSlot(0, p2())).toThrow(/part/i);
    expect(() => m1.autosave(p2())).toThrow(/part/i);
    expect(() => m2.saveToSlot(0, p1())).toThrow(/part/i);
    expect(() => m2.autosave(p1())).toThrow(/part/i);
    expect(storage.dump().size).toBe(0);
  });

  it('slotInfo reports the payload part for the row chip', () => {
    const m2 = createSaveManager({ storage: memoryStorage(), part: 2 });
    m2.saveToSlot(1, p2('Gamma'));
    expect(m2.slotInfo(1).part).toBe(2);
    const m1 = createSaveManager({ storage: memoryStorage(), part: 1 });
    m1.saveToSlot(1, p1());
    expect(m1.slotInfo(1).part).toBe(1); // absent meta.part = part 1
  });

  it('mostRecentSlot skips a foreign-part payload in a legacy key', () => {
    const storage = memoryStorage();
    // Simulate contamination: a part-2 payload under the part-1 auto key,
    // newer than the legit part-1 manual slot.
    storage.setItem('cotw.save.auto', JSON.stringify({ ...p2('Intruder'), meta: { ...p2().meta, part: 2, savedAt: '2026-11-12T00:00:00.000Z' } }));
    storage.setItem('cotw.save.1', JSON.stringify(p1('Legit')));
    const m1 = createSaveManager({ storage, part: 1 });
    expect(m1.mostRecentSlot()).toBe(1);
  });
});
