/**
 * Post-story onboarding hints (UI plan Phase 7).
 *
 * Plan rules: teach one action at a time after the opening story; the first
 * hint explains that enemies act when the player takes a turn; hints are
 * dismissable without ever spending a turn; Skip ends the sequence; replay is
 * available through Help. Progress lives in preferences storage, separate
 * from saves.
 */
import type { PreferenceStorage } from '../prefs';


export interface OnboardingStep {
  id: string;
  title: string;
  body: string;
}

export const ONBOARDING_STEPS: ReadonlyArray<OnboardingStep> = [
  {
    id: 'turn-rule',
    title: 'Turns',
    body: 'Enemies act when you do. Every step, cast, or search is a turn — monsters take theirs after yours.',
  },
  {
    id: 'destination',
    title: 'Moving',
    body: 'Tap an explored tile to preview a route; tap it again to travel. Tap next to yourself to take a single step.',
  },
  {
    id: 'bag',
    title: 'Your bag',
    body: 'The Bag holds your gear: use, equip, and drop from there. Sorting it is free.',
  },
  {
    id: 'pause',
    title: 'Pausing',
    body: 'The ❚❚ button pauses the game — saving, loading, settings, and help live there.',
  },
];

export interface OnboardingState {
  done: string[];
  skipped: boolean;
}

const STORAGE_KEY = 'cotw.onboarding';

function freshState(): OnboardingState {
  return { done: [], skipped: false };
}

export function loadOnboarding(storage: PreferenceStorage): OnboardingState {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return freshState();
  }
  if (!raw) return freshState();
  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    const known = new Set(ONBOARDING_STEPS.map((s) => s.id));
    const done = Array.isArray(parsed.done)
      ? parsed.done.filter((id): id is string => typeof id === 'string' && known.has(id))
      : [];
    return { done, skipped: parsed.skipped === true };
  } catch {
    return freshState();
  }
}

export function saveOnboarding(storage: PreferenceStorage, state: OnboardingState): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota or privacy-mode failures must never break play.
  }
}

export function markStepDone(storage: PreferenceStorage, stepId: string): OnboardingState {
  const state = loadOnboarding(storage);
  if (!state.done.includes(stepId)) {
    state.done.push(stepId);
  }
  saveOnboarding(storage, state);
  return state;
}

export function skipAllHints(storage: PreferenceStorage): OnboardingState {
  const state = loadOnboarding(storage);
  state.skipped = true;
  saveOnboarding(storage, state);
  return state;
}

/** Clears progress so the hint sequence replays (Help entry point). */
export function resetOnboarding(storage: PreferenceStorage): OnboardingState {
  const state = freshState();
  saveOnboarding(storage, state);
  return state;
}

// ─── Hint toast ──────────────────────────────────────────────────────────────

export interface HintToastOptions {
  step: OnboardingStep;
  index: number;
  total: number;
  onAdvance: () => void;
  onSkipAll: () => void;
}

/**
 * Non-blocking hint bar (NOT a modal — the game stays interactive and no turn
 * is spent by dismissing). One hint at a time per the plan.
 */
export function showHintToast(opts: HintToastOptions): HTMLElement {
  const el = document.createElement('aside');
  el.className = 'hint-toast';
  el.dataset.hintId = opts.step.id;
  el.setAttribute('role', 'status');

  const head = document.createElement('strong');
  head.dataset.field = 'hint-title';
  head.textContent = `${opts.step.title} (${opts.index + 1}/${opts.total})`;

  const body = document.createElement('p');
  body.dataset.field = 'hint-body';
  body.textContent = opts.step.body;

  const actions = document.createElement('div');
  actions.className = 'hint-actions';
  const gotIt = document.createElement('button');
  gotIt.type = 'button';
  gotIt.textContent = 'Got it';
  gotIt.dataset.action = 'hint-next';
  gotIt.addEventListener('click', opts.onAdvance);
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.textContent = 'Skip all';
  skip.dataset.action = 'hint-skip';
  skip.addEventListener('click', opts.onSkipAll);

  actions.append(gotIt, skip);
  el.append(head, body, actions);
  return el;
}
