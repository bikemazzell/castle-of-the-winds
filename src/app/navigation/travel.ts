/**
 * Travel runner: executes a queued route one ordinary step at a time with the
 * UI plan's interruption rules (Phase 2, "Travel safety").
 *
 * The runner owns no timers — the host (controller) calls {@link
 * TravelRunner.tick} once per animation beat and {@link TravelRunner.stop} for
 * external interruptions (Esc, panels, visibility loss, new interaction).
 * Travel never resumes on its own after any stop.
 */

import type { Cell } from './path';

export type StepOutcome = 'moved' | 'blocked';

export interface TravelHost {
  /** Is a hostile currently visible? Blocks *starting* multi-step travel. */
  hostileVisible(): boolean;
  /**
   * Non-null when entering `cell` crosses an interaction boundary that needs an
   * explicit final action (stairs, shop door, known hazard). The returned
   * string is the stop reason shown to the player.
   */
  boundaryAhead(cell: Cell): string | null;
  /**
   * Re-evaluation between steps: return a stop reason (enemy appeared, damage
   * taken, panel opened, …) or null to continue.
   */
  stopCheck(): string | null;
  /** Perform one ordinary move; report whether the player actually moved. */
  step(cell: Cell): StepOutcome;
  /** Notification with the stop reason and how many cells remain queued. */
  onStopped(reason: string, remaining: number): void;
}

export interface TravelState {
  active: boolean;
  reason: string | null;
  remaining: Cell[];
}

export interface TravelRunner {
  /** Queue a route. Returns false (and reports why) if start is refused. */
  start(cells: Cell[]): boolean;
  /** Attempt the next step; no-op when inactive. */
  tick(): void;
  /** Halt with an external reason; the remaining queue is dropped. */
  stop(reason: string): void;
  state: TravelState;
}

export function createTravelRunner(host: TravelHost): TravelRunner {
  const state: TravelState = { active: false, reason: null, remaining: [] };

  const halt = (reason: string, keepQueue: boolean): void => {
    const remaining = state.remaining.length;
    state.active = false;
    state.reason = reason;
    if (!keepQueue) state.remaining = [];
    host.onStopped(reason, remaining);
  };

  const runner: TravelRunner = {
    state,
    start(cells) {
      if (state.active) runner.stop('new interaction');
      if (cells.length === 0) {
        halt('arrived', false);
        return true;
      }
      if (cells.length > 1 && host.hostileVisible()) {
        halt('hostile visible', false);
        return false;
      }
      state.remaining = [...cells];
      state.active = true;
      state.reason = null;
      return true;
    },
    tick() {
      if (!state.active) return;
      const next = state.remaining[0];
      if (!next) {
        halt('arrived', false);
        return;
      }
      const boundary = host.boundaryAhead(next);
      if (boundary) {
        // Stop BEFORE entering; keep the boundary cell queued so the explicit
        // Enter/Descend/Open action can perform it deliberately.
        halt(boundary, true);
        return;
      }
      const outcome = host.step(next);
      if (outcome === 'blocked') {
        // The route is dead: drop the queue, report cells not yet entered.
        halt('blocked', false);
        return;
      }
      state.remaining.shift();
      if (state.remaining.length === 0) {
        halt('arrived', false);
        return;
      }
      const interrupt = host.stopCheck();
      if (interrupt) halt(interrupt, false);
    },
    stop(reason: string) {
      if (!state.active) return;
      halt(reason, false);
    },
  };

  return runner;
}
