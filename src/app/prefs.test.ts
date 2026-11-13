import { describe, expect, it } from 'vitest';
import {
  defaultPreferences,
  loadFavoriteSpells,
  loadPreferences,
  saveFavoriteSpells,
  savePreferences,
  toggleFavoriteSpell,
  type PreferenceStorage,
} from './prefs';

function memory(): PreferenceStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

describe('game preferences (UI plan Phase 7)', () => {
  it('returns defaults when nothing is stored', () => {
    const p = loadPreferences(memory());
    expect(p).toEqual(defaultPreferences());
    expect(p.textScale).toBe(1);
    expect(p.mapScale).toBe(0);
    expect(p.reduceMotion).toBe('system');
    expect(p.safeConfirmation).toBe(false);
  });

  it('round-trips a complete preference state', () => {
    const s = memory();
    savePreferences(s, { textScale: 1.5, mapScale: -1, reduceMotion: 'on', safeConfirmation: true });
    expect(loadPreferences(s)).toEqual({
      textScale: 1.5,
      mapScale: -1,
      reduceMotion: 'on',
      safeConfirmation: true,
      blood: true,
    });
  });

  it('falls back to defaults per field on corrupt or out-of-range data', () => {
    const s = memory();
    s.setItem(
      'cotw.preferences',
      JSON.stringify({ textScale: 3, mapScale: 7, reduceMotion: 'maybe', safeConfirmation: 'yes' }),
    );
    const p = loadPreferences(s);
    expect(p.textScale).toBe(1);
    expect(p.mapScale).toBe(0);
    expect(p.reduceMotion).toBe('system');
    expect(p.safeConfirmation).toBe(false);
  });

  it('treats non-object JSON as full defaults', () => {
    const s = memory();
    s.setItem('cotw.preferences', '[1,2,3]');
    expect(loadPreferences(s)).toEqual(defaultPreferences());
    const s2 = memory();
    s2.setItem('cotw.preferences', 'not json');
    expect(loadPreferences(s2)).toEqual(defaultPreferences());
  });

  it('keeps valid fields when one is invalid (A17-style accumulation safety)', () => {
    const s = memory();
    s.setItem('cotw.preferences', JSON.stringify({ textScale: 1.25, mapScale: 99 }));
    const p = loadPreferences(s);
    expect(p.textScale).toBe(1.25);
    expect(p.mapScale).toBe(0);
  });

  it('survives quota errors on save', () => {
    const throwing: PreferenceStorage = {
      getItem: memory().getItem,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() =>
      savePreferences(throwing, { textScale: 2, mapScale: 1, reduceMotion: 'off', safeConfirmation: true }),
    ).not.toThrow();
  });
});

describe('favorite spell preferences', () => {
  it('defaults to an empty list', () => {
    expect(loadFavoriteSpells(memory())).toEqual([]);
  });

  it('round-trips favorites through storage', () => {
    const s = memory();
    saveFavoriteSpells(s, ['s323', 's510']);
    expect(loadFavoriteSpells(s)).toEqual(['s323', 's510']);
  });

  it('keeps at most two favorites (first two win)', () => {
    const s = memory();
    saveFavoriteSpells(s, ['a', 'b', 'c']);
    expect(loadFavoriteSpells(s)).toEqual(['a', 'b']);
  });

  it('toggle adds an id, then removes it', () => {
    const s = memory();
    expect(toggleFavoriteSpell(s, 's510')).toEqual(['s510']);
    expect(loadFavoriteSpells(s)).toEqual(['s510']);
    expect(toggleFavoriteSpell(s, 's510')).toEqual([]);
    expect(loadFavoriteSpells(s)).toEqual([]);
  });

  it('toggle ignores a third favorite when two are set', () => {
    const s = memory();
    toggleFavoriteSpell(s, 'a');
    toggleFavoriteSpell(s, 'b');
    expect(toggleFavoriteSpell(s, 'c')).toEqual(['a', 'b']);
    expect(loadFavoriteSpells(s)).toEqual(['a', 'b']);
  });

  it('survives corrupt storage JSON', () => {
    const s = memory();
    s.setItem('cotw.favorites', '{not json');
    expect(loadFavoriteSpells(s)).toEqual([]);
  });

  it('drops non-string entries on load', () => {
    const s = memory();
    s.setItem('cotw.favorites', JSON.stringify([1, 's510', null]));
    expect(loadFavoriteSpells(s)).toEqual(['s510']);
  });
});

it('loads blood and debris preference without breaking older preferences',()=>{
 const storage={getItem:()=>JSON.stringify({blood:false}),setItem:()=>{}};
 expect(loadPreferences(storage).blood).toBe(false);
 expect(loadPreferences({getItem:()=>JSON.stringify({}),setItem:()=>{}}).blood).toBe(true);
});

it('keeps curses off for old preferences and accepts only an explicit stored true',()=>{
 const storage=memory();expect(defaultPreferences().curses).not.toBe(true);
 for(const value of [undefined,false,'true',1,null]){
  storage.setItem('cotw.preferences',JSON.stringify({curses:value}));
  expect(loadPreferences(storage).curses).not.toBe(true);
 }
 savePreferences(storage,{...defaultPreferences(),curses:true});expect(loadPreferences(storage).curses).toBe(true);
 savePreferences(storage,{...defaultPreferences(),curses:false});expect(loadPreferences(storage).curses).not.toBe(true);
});
