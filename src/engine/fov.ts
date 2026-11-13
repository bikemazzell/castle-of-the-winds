/**
 * Field of view + per-level memory.
 *
 * APPROX per manual (Task 1.4 manual.json): dungeons are dark. Standing in a
 * room shows the entire room (Light spell: "In a room, however, the entire
 * room is lit"); hallways show the 3×3 square around the viewer (Light in a
 * hallway "will light the 3x3 square region around the target square").
 * Clairvoyance maps a 10 rows × 10 columns region without visiting it.
 * Walls adjacent to visible floor are visible.
 */

import { FLAG_ROOM, TILE_WALL } from './dungeon';
import { LEVEL_SIZE, idx, type Level } from './map';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FovOptions {
  /** Square vision half-extent in corridors (default 1 = 3×3). */
  revealRadius?: number;
  /** Lit regions on this level (active Light spells). */
  litRegions?: Rect[];
}

/** Bresenham cell walk from a to b inclusive. */
function bresenham(
  ax: number, ay: number, bx: number, by: number,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  let x = ax;
  let y = ay;
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    pts.push({ x, y });
    if (x === bx && y === by) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return pts;
}

/**
 * Symmetric line of sight: the straight line between a and b is walked in
 * both directions; clear if either walk has no opaque intermediate cell
 * (either endpoint itself may be a wall).
 */
export function hasLos(
  level: Level,
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  if (a.x === b.x && a.y === b.y) return true;
  const clearForward = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const pts = bresenham(from.x, from.y, to.x, to.y);
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]!;
      if (level.tiles[idx(p.x, p.y)] === TILE_WALL) return false;
    }
    return true;
  };
  return clearForward(a, b) || clearForward(b, a);
}

function markSquare(vis: Uint8Array, cx: number, cy: number, r: number): void {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= LEVEL_SIZE || y >= LEVEL_SIZE) continue;
      vis[idx(x, y)] = 1;
    }
  }
}

function floodRoom(level: Level, vis: Uint8Array, sx: number, sy: number): void {
  // 4-neighbour flood over same-room flagged tiles.
  const stack: { x: number; y: number }[] = [{ x: sx, y: sy }];
  const seen = new Set<number>([idx(sx, sy)]);
  while (stack.length > 0) {
    const { x, y } = stack.pop()!;
    vis[idx(x, y)] = 1;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= LEVEL_SIZE || ny >= LEVEL_SIZE) continue;
      const ni = idx(nx, ny);
      if (seen.has(ni)) continue;
      if (level.flags[ni]! & FLAG_ROOM) {
        seen.add(ni);
        stack.push({ x: nx, y: ny });
      }
    }
  }
}

/**
 * Walls adjacent to visible floor become visible (one pass, after marking).
 * Two steps: walls 4-adjacent to visible floor, then corner walls touching
 * at least two already-visible walls (so room rings show their corners
 * without corridor radius-0 leaking diagonals).
 */
function revealAdjacentWalls(level: Level, vis: Uint8Array): void {
  const step1: number[] = [];
  for (let y = 0; y < LEVEL_SIZE; y++) {
    for (let x = 0; x < LEVEL_SIZE; x++) {
      if (!vis[idx(x, y)]) continue;
      if (level.tiles[idx(x, y)] === TILE_WALL) continue;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= LEVEL_SIZE || ny >= LEVEL_SIZE) continue;
        if (level.tiles[idx(nx, ny)] === TILE_WALL) step1.push(idx(nx, ny));
      }
    }
  }
  for (const i of step1) vis[i] = 1;

  // Corner fill: walls 4-adjacent to ≥2 visible walls.
  const step2: number[] = [];
  for (let y = 0; y < LEVEL_SIZE; y++) {
    for (let x = 0; x < LEVEL_SIZE; x++) {
      const i = idx(x, y);
      if (vis[i] || level.tiles[i] !== TILE_WALL) continue;
      let touching = 0;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= LEVEL_SIZE || ny >= LEVEL_SIZE) continue;
        const ni = idx(nx, ny);
        if (vis[ni] && level.tiles[ni] === TILE_WALL) touching++;
      }
      if (touching >= 2) step2.push(i);
    }
  }
  for (const i of step2) vis[i] = 1;
}

/** Compute the visible-cell bitmask for `origin`. */
export function computeFov(
  level: Level,
  origin: { x: number; y: number },
  options: FovOptions = {},
): Uint8Array {
  const vis = new Uint8Array(LEVEL_SIZE * LEVEL_SIZE);
  const radius = options.revealRadius ?? 1; // 3×3 APPROX per manual

  if (level.flags[idx(origin.x, origin.y)]! & FLAG_ROOM) {
    floodRoom(level, vis, origin.x, origin.y);
    // Doorways: corridor floor 4-adjacent to the lit room is visible (there
    // is no wall between the room edge and a corridor carved from its center).
    const doorways: number[] = [];
    for (let y = 0; y < LEVEL_SIZE; y++) {
      for (let x = 0; x < LEVEL_SIZE; x++) {
        if (!vis[idx(x, y)] || level.tiles[idx(x, y)] === TILE_WALL) continue;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= LEVEL_SIZE || ny >= LEVEL_SIZE) continue;
          const ni = idx(nx, ny);
          if (!vis[ni] && level.tiles[ni] !== TILE_WALL) doorways.push(ni);
        }
      }
    }
    for (const i of doorways) vis[i] = 1;
  } else {
    markSquare(vis, origin.x, origin.y, radius);
  }

  for (const region of options.litRegions ?? []) {
    for (let y = region.y; y < region.y + region.h; y++) {
      for (let x = region.x; x < region.x + region.w; x++) {
        if (x < 0 || y < 0 || x >= LEVEL_SIZE || y >= LEVEL_SIZE) continue;
        vis[idx(x, y)] = 1;
      }
    }
  }

  revealAdjacentWalls(level, vis);
  return vis;
}

/** Fold a visibility pass into persistent per-level memory. */
export function updateSeen(seen: Uint8Array, visible: Uint8Array): void {
  for (let i = 0; i < seen.length; i++) {
    if (visible[i]) seen[i] = 1;
  }
}

/** Clairvoyance: 10×10 region centered on the target square. */
export function clairvoyanceRegion(target: { x: number; y: number }): Rect {
  return { x: target.x - 5, y: target.y - 5, w: 10, h: 10 };
}

/** Reveal (remember) a rectangle into `seen`, clamped to the map. */
export function revealRect(seen: Uint8Array, region: Rect): void {
  const x0 = Math.max(0, region.x);
  const y0 = Math.max(0, region.y);
  const x1 = Math.min(LEVEL_SIZE - 1, region.x + region.w - 1);
  const y1 = Math.min(LEVEL_SIZE - 1, region.y + region.h - 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      seen[idx(x, y)] = 1;
    }
  }
}
