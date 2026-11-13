/**
 * Dungeon generator — TypeScript port of the reconstructed seg11 algorithm
 * (docs/recon/cotw_dungeon_gen_reference.py, from castleofthewinds.com shrine).
 *
 * Port fidelity is contract-tested byte-for-byte against JSON emitted by the
 * Python reference (docs/recon/dungeon-xcheck.json): identical RNG consumption
 * order, room placement, corridor drawing, bridging staleness semantics and
 * stair placement. Extensions the reference lacks (doors, branch stairs) are
 * explicit, individually tested options.
 */

import { createEmptyLevel, idx, type Level } from './map';
import { MSLCG, levelGenSeed } from './rng';

// Tile/flag bytes matching the original DS:0xCE2 encoding.
export const TILE_WALL = 0x00;
export const TILE_FLOOR = 0x01;
export const TILE_STAIRS_DOWN = 0x12;
export const TILE_STAIRS_UP = 0x13;
export const FLAG_ROOM = 0x20;
export const FLAG_CORRIDOR = 0x0c;
export const FLAG_DOOR = 0x40;

export const MAP_W = 64;
export const MAP_H = 64;

export interface RoomRect {
  col: number;
  row: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface StairPos {
  x: number;
  y: number;
}

/** Branch stairs beyond the main down/up pair (levels.json special links). */
export interface ExtraStair {
  roomIndex: number;
  kind: 'down' | 'up';
}

export interface GenDescriptor {
  /** Attempt cap; the reference default is 12. */
  maxRooms?: number;
  /** Percent chance a corridor is drawn to the previous room (default 70). */
  corrChance?: number;
  /** Whether an up-stair is placed (levels.json gating: absent on levels 1-3). */
  hasUpStair: boolean;
  /** Place doors (flag 0x40) at room↔corridor junctions. Extension. */
  placeDoors?: boolean;
  /** Additional stairs for branch levels (6/10/20 in the original). Extension. */
  extraStairs?: ExtraStair[];
}

export interface GeneratedLevel {
  level: Level;
  rooms: RoomRect[];
  stairs: {
    down: StairPos | null;
    up: StairPos | null;
    extra: (StairPos & { kind: 'down' | 'up' })[];
  };
  /** Generator RNG state after generation (for cross-checks). */
  finalRngState: number;
}

/** Port-faithful can_place: area + 1-tile border must be untouched (seg11:0x164E). */
function canPlace(level: Level, col: number, row: number, w: number, h: number): boolean {
  const rMax = Math.min(MAP_H, row + h + 1);
  const cMax = Math.min(MAP_W, col + w + 1);
  for (let r = Math.max(0, row - 1); r < rMax; r++) {
    for (let c = Math.max(0, col - 1); c < cMax; c++) {
      if (level.tiles[idx(c, r)] !== TILE_WALL) return false;
    }
  }
  return true;
}

/** draw_room (seg11:0x0E30): OR floor and room flags into the rect. */
function drawRoom(level: Level, col: number, row: number, w: number, h: number): void {
  for (let r = row; r < row + h; r++) {
    for (let c = col; c < col + w; c++) {
      const i = idx(c, r);
      level.tiles[i] = (level.tiles[i] ?? 0) | TILE_FLOOR;
      level.flags[i] = (level.flags[i] ?? 0) | FLAG_ROOM;
    }
  }
}

/** draw_corridor (seg11:0x1A88): L-shape, horizontal then vertical, wall-only. */
function drawCorridor(level: Level, c1: number, r1: number, c2: number, r2: number): void {
  for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
    const i = idx(c, r1);
    if (level.tiles[i] === TILE_WALL) {
      level.tiles[i] = (level.tiles[i] ?? 0) | TILE_FLOOR;
      level.flags[i] = (level.flags[i] ?? 0) | FLAG_CORRIDOR;
    }
  }
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
    const i = idx(c2, r);
    if (level.tiles[i] === TILE_WALL) {
      level.tiles[i] = (level.tiles[i] ?? 0) | TILE_FLOOR;
      level.flags[i] = (level.flags[i] ?? 0) | FLAG_CORRIDOR;
    }
  }
}

/** BFS component labels per floor cell (matches reference flood fill). */
function floodFillComponents(level: Level): Int32Array {
  const comp = new Int32Array(MAP_W * MAP_H).fill(-1);
  let num = 0;
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  for (let sr = 0; sr < MAP_H; sr++) {
    for (let sc = 0; sc < MAP_W; sc++) {
      const si = idx(sc, sr);
      if (level.tiles[si] === TILE_WALL || comp[si] !== -1) continue;
      const queue: number[] = [si];
      comp[si] = num;
      while (queue.length > 0) {
        const at = queue.shift()!;
        const x = at % MAP_W;
        const y = Math.floor(at / MAP_W);
        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
          const ni = idx(nx, ny);
          if (level.tiles[ni] !== TILE_WALL && comp[ni] === -1) {
            comp[ni] = num;
            queue.push(ni);
          }
        }
      }
      num++;
    }
  }
  return comp;
}

/**
 * Bridge every room not reachable from room 0 to its nearest connected room.
 * Replicates the reference's stale-component semantics exactly: components are
 * computed once and the connected set accumulates without re-flooding.
 */
function ensureConnected(level: Level, rooms: RoomRect[]): void {
  const comp = floodFillComponents(level);
  const connected = new Set<number>([comp[idx(rooms[0]!.cx, rooms[0]!.cy)]!]);
  for (let i = 1; i < rooms.length; i++) {
    const b = rooms[i]!;
    const bComp = comp[idx(b.cx, b.cy)]!;
    if (connected.has(bComp)) continue;
    let best: RoomRect | null = null;
    let bestDist = Infinity;
    for (const a of rooms) {
      if (!connected.has(comp[idx(a.cx, a.cy)]!)) continue;
      const dist = Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);
      if (dist < bestDist) {
        best = a;
        bestDist = dist;
      }
    }
    if (best) {
      drawCorridor(level, best.cx, best.cy, b.cx, b.cy);
      connected.add(bComp);
    }
  }
}

/** Extension: door flag on corridor cells orthogonally adjacent to room cells. */
function placeDoorsAtJunctions(level: Level): void {
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = idx(x, y);
      const f = level.flags[i]!;
      if (!(f & FLAG_CORRIDOR) || f & FLAG_ROOM) continue;
      const adjacentRoom =
        (x > 0 && level.flags[idx(x - 1, y)]! & FLAG_ROOM) !== 0 ||
        (x < MAP_W - 1 && level.flags[idx(x + 1, y)]! & FLAG_ROOM) !== 0 ||
        (y > 0 && level.flags[idx(x, y - 1)]! & FLAG_ROOM) !== 0 ||
        (y < MAP_H - 1 && level.flags[idx(x, y + 1)]! & FLAG_ROOM) !== 0;
      if (adjacentRoom) level.flags[i] = (level.flags[i] ?? 0) | FLAG_DOOR;
    }
  }
}

/**
 * Generate a level with the given (already seeded) generator RNG.
 * RNG consumption order is byte-faithful to the Python reference.
 */
export function generateLevel(
  levelIndex: number,
  genRng: MSLCG,
  descriptor: GenDescriptor,
): GeneratedLevel {
  const maxRooms = descriptor.maxRooms ?? 12;
  const corrChance = descriptor.corrChance ?? 70;

  const level = createEmptyLevel(levelIndex);
  const rooms: RoomRect[] = [];
  let prev: RoomRect | null = null;

  for (let attempt = 0; attempt < maxRooms * 3; attempt++) {
    if (rooms.length >= maxRooms) break;
    // rand(W/3) + rand(W/3) + 1 — center bias (seg11:0x0BCE).
    const col = genRng.rand(MAP_W / 3 | 0) + genRng.rand(MAP_W / 3 | 0) + 1;
    const row = genRng.rand(MAP_H / 3 | 0) + genRng.rand(MAP_H / 3 | 0) + 1;
    const w = genRng.rand(8) + 4;
    const h = genRng.rand(8) + 4;

    if (col + w >= MAP_W - 1 || row + h >= MAP_H - 1) continue;
    if (!canPlace(level, col, row, w, h)) continue;

    drawRoom(level, col, row, w, h);
    const room: RoomRect = {
      col,
      row,
      w,
      h,
      cx: col + (w >> 1),
      cy: row + (h >> 1),
    };
    rooms.push(room);

    if (prev && genRng.rand(100) < corrChance) {
      drawCorridor(level, prev.cx, prev.cy, room.cx, room.cy);
    }
    prev = room;
  }

  if (rooms.length > 1) ensureConnected(level, rooms);

  if (descriptor.placeDoors) placeDoorsAtJunctions(level);

  const extra: (StairPos & { kind: 'down' | 'up' })[] = [];
  let down: StairPos | null = null;
  let up: StairPos | null = null;

  if (rooms.length > 0) {
    const r0 = rooms[0]!;
    level.tiles[idx(r0.col + 1, r0.row + 1)] = TILE_STAIRS_DOWN;
    down = { x: r0.col + 1, y: r0.row + 1 };
    if (descriptor.hasUpStair && rooms.length > 1) {
      const rL = rooms[rooms.length - 1]!;
      level.tiles[idx(rL.col + 1, rL.row + 1)] = TILE_STAIRS_UP;
      up = { x: rL.col + 1, y: rL.row + 1 };
    }
    for (const ex of descriptor.extraStairs ?? []) {
      const r = rooms[ex.roomIndex];
      if (!r) throw new RangeError(`extraStairs: no room index ${ex.roomIndex}`);
      level.tiles[idx(r.col + 1, r.row + 1)] =
        ex.kind === 'down' ? TILE_STAIRS_DOWN : TILE_STAIRS_UP;
      extra.push({ x: r.col + 1, y: r.row + 1, kind: ex.kind });
    }
  }

  return {
    level,
    rooms,
    stairs: { down, up, extra },
    finalRngState: genRng.getState(),
  };
}

/**
 * Generate with the dedicated per-level seed derived from the world seed
 * (worldSeed * 7919 + levelIndex, 32-bit folded). Gameplay RNG never feeds
 * generation, so unvisited levels regenerate deterministically regardless of
 * combat rolls.
 */
export function generateLevelForWorld(
  worldSeed: number,
  levelIndex: number,
  descriptor: GenDescriptor,
): GeneratedLevel {
  return generateLevel(levelIndex, new MSLCG(levelGenSeed(worldSeed, levelIndex)), descriptor);
}
