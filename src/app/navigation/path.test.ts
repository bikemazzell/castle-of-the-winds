import { describe, expect, it } from 'vitest';
import { findCardinalRoute, type RouteWorld } from './path';

/** Minimal 8x8 fixture grid: open floor unless masked. */
class Grid implements RouteWorld {
  size = 8;
  walls = new Set<string>();
  unknown = new Set<string>();
  hazards = new Set<string>();
  monsters = new Set<string>();

  key(x: number, y: number): string {
    return `${x},${y}`;
  }

  wall(x: number, y: number): this {
    this.walls.add(this.key(x, y));
    return this;
  }

  unseen(x: number, y: number): this {
    this.unknown.add(this.key(x, y));
    return this;
  }

  hazard(x: number, y: number): this {
    this.hazards.add(this.key(x, y));
    return this;
  }

  monster(x: number, y: number): this {
    this.monsters.add(this.key(x, y));
    return this;
  }

  known(x: number, y: number): boolean {
    return !this.unknown.has(this.key(x, y));
  }

  walkable(x: number, y: number): boolean {
    return !this.walls.has(this.key(x, y));
  }

  hazardous(x: number, y: number): boolean {
    return this.hazards.has(this.key(x, y));
  }

  occupied(x: number, y: number): boolean {
    return this.monsters.has(this.key(x, y));
  }
}

describe('cardinal route planning (UI plan Phase 2)', () => {
  it('routes straight across open floor in cardinal steps', () => {
    const route = findCardinalRoute(new Grid(), { x: 2, y: 2 }, { x: 5, y: 2 });
    expect(route.blocked).toBeUndefined();
    expect(route.steps).toEqual([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
    ]);
    expect(route.crossesHazard).toBe(false);
  });

  it('routes around a wall via the nearest gap (L-shaped detour)', () => {
    const grid = new Grid();
    // wall column x=3 except a gap at y=5
    for (let y = 0; y < 8; y++) if (y !== 5) grid.wall(3, y);
    const route = findCardinalRoute(grid, { x: 2, y: 2 }, { x: 5, y: 2 });
    expect(route.blocked).toBeUndefined();
    // must pass through the gap (3,5)
    expect(route.steps).toContainEqual({ x: 3, y: 5 });
    // every step is cardinal-adjacent to the previous one
    let prev = { x: 2, y: 2 };
    for (const step of route.steps) {
      const cardinal = Math.abs(step.x - prev.x) + Math.abs(step.y - prev.y);
      expect(cardinal).toBe(1);
      prev = step;
    }
    expect(route.steps[route.steps.length - 1]).toEqual({ x: 5, y: 2 });
  });

  it('never emits diagonal steps even for off-axis diagonal targets', () => {
    const route = findCardinalRoute(new Grid(), { x: 1, y: 1 }, { x: 4, y: 4 });
    expect(route.blocked).toBeUndefined();
    expect(route.steps.length).toBe(6); // |dx|+|dy| = 3+3
    let prev = { x: 1, y: 1 };
    for (const step of route.steps) {
      expect(Math.abs(step.x - prev.x) + Math.abs(step.y - prev.y)).toBe(1);
      prev = step;
    }
  });

  it('rejects destinations in undiscovered cells with reason unknown', () => {
    const grid = new Grid().unseen(5, 2).unseen(6, 2);
    const route = findCardinalRoute(grid, { x: 2, y: 2 }, { x: 5, y: 2 });
    expect(route.blocked).toBe('unknown');
    expect(route.steps).toEqual([]);
  });

  it('rejects known wall destinations with reason wall', () => {
    const grid = new Grid().wall(5, 2);
    const route = findCardinalRoute(grid, { x: 2, y: 2 }, { x: 5, y: 2 });
    expect(route.blocked).toBe('wall');
  });

  it('never routes through undiscovered cells even when the target is known', () => {
    const grid = new Grid();
    // the only connecting column (x=4) is entirely undiscovered
    for (let y = 0; y < 8; y++) grid.unseen(4, y);
    // target (6,2) itself is known but every approach is unknown
    const route = findCardinalRoute(grid, { x: 2, y: 2 }, { x: 6, y: 2 });
    expect(route.blocked).toBe('unreachable');
  });

  it('reports unreachable when the target is sealed off', () => {
    const grid = new Grid();
    for (let y = 0; y < 8; y++) grid.wall(3, y);
    const route = findCardinalRoute(grid, { x: 2, y: 2 }, { x: 5, y: 2 });
    expect(route.blocked).toBe('unreachable');
  });

  it('selecting the current cell reports self with no steps', () => {
    const route = findCardinalRoute(new Grid(), { x: 3, y: 3 }, { x: 3, y: 3 });
    expect(route.blocked).toBe('self');
    expect(route.steps).toEqual([]);
  });

  it('routes AROUND known hazards when an alternative exists', () => {
    const grid = new Grid();
    // hazard in the direct path (3,2); detour via y=3 exists
    grid.hazard(3, 2);
    const route = findCardinalRoute(grid, { x: 2, y: 2 }, { x: 5, y: 2 });
    expect(route.blocked).toBeUndefined();
    expect(route.steps).not.toContainEqual({ x: 3, y: 2 });
    expect(route.crossesHazard).toBe(false);
  });

  it('returns a hazard-crossing route flagged when no hazard-free route exists', () => {
    const grid = new Grid();
    // hazard ring: the only gap row is fully hazardous
    for (let y = 0; y < 8; y++) if (y !== 2) grid.wall(3, y);
    grid.hazard(3, 2);
    const route = findCardinalRoute(grid, { x: 2, y: 2 }, { x: 5, y: 2 });
    expect(route.blocked).toBeUndefined();
    expect(route.steps).toContainEqual({ x: 3, y: 2 });
    expect(route.crossesHazard).toBe(true);
  });

  it('treats a visible monster as an attack target: path ends adjacent, attack cell set', () => {
    const grid = new Grid().monster(5, 2);
    const route = findCardinalRoute(grid, { x: 2, y: 2 }, { x: 5, y: 2 });
    expect(route.blocked).toBeUndefined();
    expect(route.attack).toEqual({ x: 5, y: 2 });
    const last = route.steps[route.steps.length - 1]!;
    expect(Math.abs(last.x - 5) + Math.abs(last.y - 2)).toBe(1);
    expect(route.steps).not.toContainEqual({ x: 5, y: 2 });
  });

  it('never routes THROUGH a visible monster even on the way elsewhere', () => {
    const grid = new Grid().monster(3, 2);
    const route = findCardinalRoute(grid, { x: 2, y: 2 }, { x: 5, y: 2 });
    expect(route.blocked).toBeUndefined();
    expect(route.steps).not.toContainEqual({ x: 3, y: 2 });
    expect(route.steps[route.steps.length - 1]).toEqual({ x: 5, y: 2 });
  });

  it('rejects monster cells that are not discovered (no hidden-occupant knowledge)', () => {
    const grid = new Grid().monster(5, 2).unseen(5, 2);
    const route = findCardinalRoute(grid, { x: 2, y: 2 }, { x: 5, y: 2 });
    expect(route.blocked).toBe('unknown');
  });

  it('is deterministic: identical inputs produce identical routes', () => {
    const grid = new Grid();
    for (let y = 0; y < 8; y++) if (y !== 6) grid.wall(4, y);
    const a = findCardinalRoute(grid, { x: 2, y: 2 }, { x: 6, y: 2 });
    const b = findCardinalRoute(grid, { x: 2, y: 2 }, { x: 6, y: 2 });
    expect(a.steps).toEqual(b.steps);
  });

  it('clamps to the map bounds: out-of-range targets are unreachable', () => {
    const route = findCardinalRoute(new Grid(), { x: 2, y: 2 }, { x: 9, y: 2 });
    expect(route.blocked).toBe('unreachable');
  });
});
