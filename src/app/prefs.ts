/**
 * Harmless presentation preferences (UI plan §9): stored separately from
 * save files. Favorite spells are quick-slot assignments, not character
 * data, so they live in the browser's own storage with defensive loading.
 */

export interface PreferenceStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

const FAVORITES_KEY = 'cotw.favorites';
export const MAX_FAVORITES = 2;

const PREFERENCES_KEY = 'cotw.preferences';

export type TextScale = 1 | 1.25 | 1.5 | 1.75 | 2;
export type MapScale = -1 | 0 | 1;
export type ReduceMotionPref = 'system' | 'on' | 'off';

export interface GamePreferences {
  textScale: TextScale;
  mapScale: MapScale;
  reduceMotion: ReduceMotionPref;
  safeConfirmation: boolean;
  blood?: boolean;
  chatter?: boolean;
  idleRestSeconds?: number;
  idleSearchSeconds?: number;
}

const TEXT_SCALES: readonly number[] = [1, 1.25, 1.5, 1.75, 2];
const MAP_SCALES: readonly number[] = [-1, 0, 1];
const REDUCE_MOTION_VALUES: readonly string[] = ['system', 'on', 'off'];

export function defaultPreferences(): GamePreferences {
  return { textScale: 1, mapScale: 0, reduceMotion: 'system', safeConfirmation: false, blood: true };
}

function clampTextScale(v: unknown): TextScale {
  return typeof v === 'number' && TEXT_SCALES.includes(v) ? (v as TextScale) : 1;
}

function clampMapScale(v: unknown): MapScale {
  return typeof v === 'number' && MAP_SCALES.includes(v) ? (v as MapScale) : 0;
}

function clampReduceMotion(v: unknown): ReduceMotionPref {
  return typeof v === 'string' && REDUCE_MOTION_VALUES.includes(v) ? (v as ReduceMotionPref) : 'system';
}

export function loadPreferences(storage: PreferenceStorage): GamePreferences {
  let raw: string | null;
  try {
    raw = storage.getItem(PREFERENCES_KEY);
  } catch {
    // Unreadable storage (disabled by policy, IO error): keep defaults.
    return defaultPreferences();
  }
  if (!raw) return defaultPreferences();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultPreferences();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return defaultPreferences();
  }
  const p = parsed as Record<string, unknown>;
  return {
    textScale: clampTextScale(p.textScale),
    mapScale: clampMapScale(p.mapScale),
    reduceMotion: clampReduceMotion(p.reduceMotion),
    safeConfirmation: p.safeConfirmation === true,
    blood: p.blood !== false,
    ...(p.chatter === false ? { chatter: false } : {}),
    ...([5, 15, 30].includes(p.idleRestSeconds as number) ? { idleRestSeconds: p.idleRestSeconds as number } : {}),
    ...([5, 15, 30].includes(p.idleSearchSeconds as number) ? { idleSearchSeconds: p.idleSearchSeconds as number } : {}),
  };
}

export function savePreferences(storage: PreferenceStorage, prefs: GamePreferences): void {
  try {
    storage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are best-effort; never break gameplay on quota errors.
  }
}

export function loadFavoriteSpells(storage: PreferenceStorage): string[] {
  let raw: string | null;
  try {
    raw = storage.getItem(FAVORITES_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .slice(0, MAX_FAVORITES);
}

export function saveFavoriteSpells(storage: PreferenceStorage, ids: string[]): void {
  const kept = [...new Set(ids)].slice(0, MAX_FAVORITES);
  try {
    storage.setItem(FAVORITES_KEY, JSON.stringify(kept));
  } catch {
    // Preferences are best-effort; never break gameplay on quota errors.
  }
}

/** Toggle one spell id; returns the new favorite list (unchanged when full). */
export function toggleFavoriteSpell(storage: PreferenceStorage, id: string): string[] {
  const current = loadFavoriteSpells(storage);
  const next = current.includes(id)
    ? current.filter((v) => v !== id)
    : current.length >= MAX_FAVORITES
      ? current
      : [...current, id];
  saveFavoriteSpells(storage, next);
  return next;
}
