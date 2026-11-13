/**
 * Cardinal route planning over *permitted* map knowledge (UI plan Phase 2).
 *
 * Routes use four-direction steps only (the engine rejects diagonal moves),
 * consider only cells the player has discovered, avoid known hazards when an
 * alternative exists, never path through visible monsters, and treat a visible
 * monster destination as an attack target (path ends adjacent). The planner is
 * pure: it queries {@link RouteWorld} and never inspects hidden occupants.
 */

export interface Cell {
  x: number;
  y: number;
}

/** Why a destination cannot be reached. */
export type BlockedReason =
  | 'self'
  | 'unknown'
  | 'wall'
  | 'unreachable'
  | 'no-adjacent-cell';

export interface RouteResult {
  from: Cell;
  to: Cell;
  /** Cells to enter, excluding the origin, ending at the destination. */
  steps: Cell[];
  /** Set when the destination is a visible monster: the bump-attack cell. */
  attack?: Cell;
  /** True when the only available route crosses known hazardous cells. */
  crossesHazard: boolean;
  blocked?: BlockedReason;
}

/**
 * Map knowledge the planner may consult. Implementations must answer from
 * discovered terrain and *visible* occupants only.
 */
export interface RouteWorld {
  size: number;
  /** Has the player discovered this cell? */
  known(x: number, y: number): boolean;
  /** Is the terrain passable (ignoring occupants)? */
  walkable(x: number, y: number): boolean;
  /** Is this a known hazardous cell (e.g. a revealed trap)? */
  hazardous(x: number, y: number): boolean;
  /** Is this cell occupied by a *visible* monster? */
  occupied(x: number, y: number): boolean;
}

const SAME = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;

/** Fixed expansion order keeps routes deterministic. */
const NEIGHBORS: readonly [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

interface BfsResult {
  steps: Cell[] | null;
  crossesHazard: boolean;
}

function bfs(
  world: RouteWorld,
  from: Cell,
  isGoal: (cell: Cell) => boolean,
  passable: (x: number, y: number) => boolean,
): BfsResult {
  const size = world.size;
  const parents = new Map<number, number>();
  const queued = new Set<number>();
  const origin = from.y * size + from.x;
  const queue: number[] = [origin];
  queued.add(origin);
  let goal = -1;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const cx = current % size;
    const cy = Math.floor(current / size);
    if (current !== origin && isGoal({ x: cx, y: cy })) {
      goal = current;
      break;
    }
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const key = ny * size + nx;
      if (queued.has(key)) continue;
      if (!passable(nx, ny)) continue;
      queued.add(key);
      parents.set(key, current);
      queue.push(key);
    }
  }

  if (goal < 0) return { steps: null, crossesHazard: false };

  const steps: Cell[] = [];
  let node = goal;
  while (node !== origin) {
    steps.push({ x: node % size, y: Math.floor(node / size) });
    const parent = parents.get(node);
    if (parent === undefined) return { steps: null, crossesHazard: false };
    node = parent;
  }
  steps.reverse();
  return { steps, crossesHazard: steps.some((c) => world.hazardous(c.x, c.y)) };
}

/** Plan a four-direction route from `from` to `to` using permitted knowledge. */
export function findCardinalRoute(world: RouteWorld, from: Cell, to: Cell): RouteResult {
  const base: RouteResult = { from, to, steps: [], crossesHazard: false };

  if (SAME(from, to)) return { ...base, blocked: 'self' };
  if (!world.known(to.x, to.y)) return { ...base, blocked: 'unknown' };

  const inBounds = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < world.size && y < world.size;

  if (!inBounds(to.x, to.y)) return { ...base, blocked: 'unreachable' };

  // Visible monster destination: attack target. Path to the nearest passable
  // cardinal-adjacent cell; the caller performs the final bump.
  if (world.occupied(to.x, to.y)) {
    if (!world.walkable(to.x, to.y)) return { ...base, blocked: 'wall' };
    const attack = { ...to };
    let best: { steps: Cell[]; crossesHazard: boolean } | null = null;

    // Try each adjacent cell in fixed order; keep the shortest route.
    for (const [dx, dy] of NEIGHBORS) {
      const nx = to.x + dx;
      const ny = to.y + dy;
      if (!inBounds(nx, ny)) continue;
      const candidate: Cell = { x: nx, y: ny };
      if (SAME(candidate, from)) {
        // Already adjacent: zero-step attack.
        return { ...base, steps: [], attack, crossesHazard: false };
      }
      const run = routePassable(world, from, candidate);
      const steps = run.steps;
      if (steps !== null && (best === null || steps.length < best.steps.length)) {
        best = { steps, crossesHazard: run.crossesHazard };
      }
    }
    if (!best) return { ...base, blocked: 'no-adjacent-cell' };
    return { ...base, steps: best.steps, attack, crossesHazard: best.crossesHazard };
  }

  if (!world.walkable(to.x, to.y)) return { ...base, blocked: 'wall' };

  const direct = routePassable(world, from, to);
  if (direct.steps) return { ...base, steps: direct.steps, crossesHazard: direct.crossesHazard };
  return { ...base, blocked: 'unreachable' };
}

function routePassable(
  world: RouteWorld,
  from: Cell,
  to: Cell,
): { steps: Cell[] | null; crossesHazard: boolean } {
  const passableNonHazard = (x: number, y: number): boolean =>
    world.known(x, y) && world.walkable(x, y) && !world.occupied(x, y) && !world.hazardous(x, y);
  const passableAny = (x: number, y: number): boolean =>
    world.known(x, y) && world.walkable(x, y) && !world.occupied(x, y);

  const goal = (cell: Cell): boolean => SAME(cell, to);
  const safe = bfs(world, from, goal, passableNonHazard);
  if (safe.steps) return { steps: safe.steps, crossesHazard: false };
  const unsafe = bfs(world, from, goal, passableAny);
  if (unsafe.steps) return { steps: unsafe.steps, crossesHazard: true };
  return { steps: null, crossesHazard: false };
}
