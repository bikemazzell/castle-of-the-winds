// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadOnboarding,
  markStepDone,
  ONBOARDING_STEPS,
  saveOnboarding,
  skipAllHints,
  type OnboardingState,
} from './onboarding';
import type { PreferenceStorage } from '../prefs';
import { closeAllModals } from './dialogs';

function memoryStorage(): PreferenceStorage & { dump(): Map<string, string> } {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    dump: () => store,
  };
}

afterEach(() => {
  closeAllModals();
  document.body.innerHTML = '';
});

describe('onboarding progress storage (UI plan Phase 7)', () => {
  it('exposes four short teaching steps, first explains the turn rule', () => {
    expect(ONBOARDING_STEPS.length).toBe(4);
    expect(ONBOARDING_STEPS[0]?.body).toMatch(/enemies act when you do|monsters take their/i);
    for (const step of ONBOARDING_STEPS) {
      expect(step.title.length).toBeGreaterThan(3);
      expect(step.body.length).toBeGreaterThan(20);
    }
  });

  it('loads a fresh state when nothing is stored', () => {
    const state = loadOnboarding(memoryStorage());
    expect(state.done).toEqual([]);
    expect(state.skipped).toBe(false);
  });

  it('persists done steps and skip across saves', () => {
    const storage = memoryStorage();
    let state = markStepDone(storage, ONBOARDING_STEPS[0]!.id);
    expect(state.done).toEqual([ONBOARDING_STEPS[0]!.id]);
    state = markStepDone(storage, ONBOARDING_STEPS[1]!.id);
    expect(state.done).toEqual([ONBOARDING_STEPS[0]!.id, ONBOARDING_STEPS[1]!.id]);
    state = skipAllHints(storage);
    expect(state.skipped).toBe(true);
    // Round-trip through storage
    const reloaded = loadOnboarding(storage);
    expect(reloaded.done).toEqual([ONBOARDING_STEPS[0]!.id, ONBOARDING_STEPS[1]!.id]);
    expect(reloaded.skipped).toBe(true);
  });

  it('marking a done step again is a no-op (order preserved)', () => {
    const storage = memoryStorage();
    markStepDone(storage, ONBOARDING_STEPS[0]!.id);
    markStepDone(storage, ONBOARDING_STEPS[2]!.id);
    const state = markStepDone(storage, ONBOARDING_STEPS[0]!.id);
    expect(state.done).toEqual([ONBOARDING_STEPS[0]!.id, ONBOARDING_STEPS[2]!.id]);
  });

  it('corrupt stored JSON degrades to a fresh state', () => {
    const storage = memoryStorage();
    storage.setItem('cotw.onboarding', '{not json');
    const state = loadOnboarding(storage);
    expect(state.done).toEqual([]);
    expect(state.skipped).toBe(false);
  });

  it('saveOnboarding tolerates a throwing storage (quota)', () => {
    const throwing: PreferenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };
    expect(() => saveOnboarding(throwing, { done: ['a'], skipped: false })).not.toThrow();
  });

  it('unknown step ids in stored state are dropped', () => {
    const storage = memoryStorage();
    const bogus: OnboardingState = { done: ['nonsense', ONBOARDING_STEPS[1]!.id], skipped: false };
    saveOnboarding(storage, bogus);
    expect(loadOnboarding(storage).done).toEqual([ONBOARDING_STEPS[1]!.id]);
  });
});
