import { describe, expect, it } from 'vitest';
import { createTravelRunner, type TravelHost } from './travel';
import type { Cell } from './path';

interface RecordedHost extends TravelHost {
  steps: Cell[];
  stops: string[];
  completions: number;
}

function makeHost(
  behavior: {
    stepOutcome?: (to: Cell, nth: number) => 'moved' | 'blocked';
    hostile?: boolean;
    boundary?: (cell: Cell) => string | null;
    stopCheck?: string | null;
  } = {},
): RecordedHost {
  const steps: Cell[] = [];
  const stops: string[] = [];
  let completions = 0;
  let nth = 0;
  return {
    steps,
    stops,
    get completions() {
      return completions;
    },
    hostileVisible: () => behavior.hostile ?? false,
    boundaryAhead: (cell) => behavior.boundary?.(cell) ?? null,
    stopCheck: () => behavior.stopCheck ?? null,
    step: (to) => {
      steps.push(to);
      nth++;
      return behavior.stepOutcome ? behavior.stepOutcome(to, nth) : 'moved';
    },
    onStopped: (reason, remaining) => {
      stops.push(`${reason}:${remaining}`);
      if (reason === 'arrived') completions++;
    },
  };
}

const route = (cells: Array<[number, number]>): Cell[] =>
  cells.map(([x, y]) => ({ x, y }));

describe('travel runner (UI plan Phase 2)', () => {
  it('walks a queued route one step per tick and reports arrival', () => {
    const host = makeHost();
    const runner = createTravelRunner(host);
    runner.start(route([[3, 2], [4, 2], [5, 2]]));
    expect(runner.state.active).toBe(true);
    runner.tick();
    runner.tick();
    expect(host.steps).toEqual([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ]);
    runner.tick();
    expect(runner.state.active).toBe(false);
    expect(runner.state.reason).toBe('arrived');
    expect(host.stops).toContain('arrived:0');
  });

  it('refuses multi-step travel while a hostile is visible', () => {
    const host = makeHost({ hostile: true });
    const runner = createTravelRunner(host);
    const started = runner.start(route([[3, 2], [4, 2]]));
    expect(started).toBe(false);
    expect(runner.state.active).toBe(false);
    expect(runner.state.reason).toBe('hostile visible');
    expect(host.steps).toEqual([]);
  });

  it('allows a deliberate single step even with a hostile visible', () => {
    const host = makeHost({ hostile: true });
    const runner = createTravelRunner(host);
    expect(runner.start(route([[3, 2]]))).toBe(true);
    runner.tick();
    expect(host.steps).toEqual([{ x: 3, y: 2 }]);
    expect(runner.state.reason).toBe('arrived');
  });

  it('stops before entering a boundary cell (stairs/shop) and keeps it queued', () => {
    const host = makeHost({ boundary: (cell) => (cell.x === 4 ? 'stairs' : null) });
    const runner = createTravelRunner(host);
    runner.start(route([[3, 2], [4, 2]]));
    runner.tick();
    expect(host.steps).toEqual([{ x: 3, y: 2 }]);
    runner.tick();
    expect(host.steps).toEqual([{ x: 3, y: 2 }]); // never entered
    expect(runner.state.active).toBe(false);
    expect(runner.state.reason).toBe('stairs');
    expect(host.stops).toContain('stairs:1');
  });

  it('stops when a step fails to move (blocked)', () => {
    const host = makeHost({ stepOutcome: (_c, n) => (n === 2 ? 'blocked' : 'moved') });
    const runner = createTravelRunner(host);
    runner.start(route([[3, 2], [4, 2], [5, 2]]));
    runner.tick();
    runner.tick();
    expect(runner.state.active).toBe(false);
    expect(runner.state.reason).toBe('blocked');
    expect(host.stops).toContain('blocked:2'); // both unentered cells reported
  });

  it('stops when a hostile appears between steps', () => {
    const host = makeHost({ stopCheck: 'enemy visible' });
    const runner = createTravelRunner(host);
    runner.start(route([[3, 2], [4, 2]]));
    runner.tick(); // first step moves, re-evaluate before the next
    runner.tick();
    expect(host.steps).toEqual([{ x: 3, y: 2 }]);
    expect(runner.state.reason).toBe('enemy visible');
  });

  it('stop() halts travel with the given reason and drops the queue', () => {
    const host = makeHost();
    const runner = createTravelRunner(host);
    runner.start(route([[3, 2], [4, 2], [5, 2]]));
    runner.tick();
    runner.stop('cancel');
    expect(runner.state.active).toBe(false);
    expect(runner.state.reason).toBe('cancel');
    runner.tick(); // inert after stop
    expect(host.steps).toEqual([{ x: 3, y: 2 }]);
  });

  it('does not resume automatically: start requires a fresh route', () => {
    const host = makeHost();
    const runner = createTravelRunner(host);
    runner.start(route([[3, 2], [4, 2]]));
    runner.stop('panel');
    runner.tick();
    runner.tick();
    expect(host.steps).toEqual([]); // nothing resumed
    expect(runner.start(route([[4, 2]]))).toBe(true); // explicit restart
  });

  it('single boundary destination stops immediately without stepping', () => {
    const host = makeHost({ boundary: () => 'shop' });
    const runner = createTravelRunner(host);
    runner.start(route([[4, 2]]));
    runner.tick();
    expect(host.steps).toEqual([]);
    expect(runner.state.reason).toBe('shop');
    expect(host.stops).toContain('shop:1');
  });

  it('a hazard boundary stops travel with the hazard named', () => {
    const host = makeHost({ boundary: (c) => (c.x === 5 ? 'known hazard' : null) });
    const runner = createTravelRunner(host);
    runner.start(route([[3, 2], [4, 2], [5, 2]]));
    runner.tick();
    runner.tick();
    runner.tick();
    expect(host.steps).toEqual([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ]);
    expect(runner.state.reason).toBe('known hazard');
  });
});
