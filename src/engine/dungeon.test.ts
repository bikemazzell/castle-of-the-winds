import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  FLAG_CORRIDOR,
  FLAG_DOOR,
  FLAG_ROOM,
  TILE_FLOOR,
  TILE_STAIRS_DOWN,
  TILE_STAIRS_UP,
  generateLevel,
  generateLevelForWorld,
  type GenDescriptor,
} from './dungeon';
import { idx } from './map';
import { MSLCG, levelGenSeed } from './rng';

interface FixtureCase {
  seed: number;
  level: number;
  maxRooms: number;
  corrChance: number;
  rooms: { col: number; row: number; w: number; h: number; cx: number; cy: number }[];
  stairsDown: [number, number] | null;
  stairsUp: [number, number] | null;
  rngState: number;
  tilesB64: string;
  flagsB64: string;
  tilesMd5: string;
  flagsMd5: string;
}

const fixture = JSON.parse(
  readFileSync(new URL('../../docs/recon/dungeon-xcheck.json', import.meta.url), 'utf8'),
) as { generator: string; cases: FixtureCase[] };

/** The Python reference gates up-stairs on `level > 3`. */
function pythonDescriptor(c: FixtureCase): GenDescriptor {
  return {
    maxRooms: c.maxRooms,
    corrChance: c.corrChance,
    hasUpStair: c.level > 3,
  };
}

describe('dungeon generator — port fidelity vs Python reference', () => {
  it('fixture covers 3 seeds × 11 levels', () => {
    expect(fixture.cases.length).toBe(33);
  });

  for (const c of fixture.cases) {
    it(`seed ${c.seed} level ${c.level} matches rooms, stairs, planes and final RNG state`, () => {
      const gen = generateLevel(c.level, new MSLCG(c.seed), pythonDescriptor(c));
      expect(gen.rooms).toEqual(c.rooms);
      expect(gen.stairs.down ? [gen.stairs.down.x, gen.stairs.down.y] : null).toEqual(
        c.stairsDown,
      );
      expect(gen.stairs.up ? [gen.stairs.up.x, gen.stairs.up.y] : null).toEqual(c.stairsUp);
      expect(gen.finalRngState).toBe(c.rngState);
      const tilesB64 = Buffer.from(gen.level.tiles).toString('base64');
      const flagsB64 = Buffer.from(gen.level.flags).toString('base64');
      expect(tilesB64).toBe(c.tilesB64);
      expect(flagsB64).toBe(c.flagsB64);
    });
  }
});

describe('dungeon generator — properties (50 seeds × levels 1..11)', () => {
  const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

  for (const seed of SEEDS) {
    it(`seed ${seed}: bounds, no overlap, connectivity, stair placement`, () => {
      for (let level = 1; level <= 11; level++) {
        const gen = generateLevel(level, new MSLCG(seed), { hasUpStair: level > 3 });
        const { rooms, stairs, level: lv } = gen;
        expect(rooms.length).toBeGreaterThan(0);

        for (const r of rooms) {
          expect(r.col).toBeGreaterThanOrEqual(1);
          expect(r.row).toBeGreaterThanOrEqual(1);
          expect(r.col + r.w).toBeLessThan(63);
          expect(r.row + r.h).toBeLessThan(63);
          expect(r.cx).toBe(r.col + (r.w >> 1));
          expect(r.cy).toBe(r.row + (r.h >> 1));
        }
        // No overlap: each room's placement span (rect + 1-tile border) must
        // be disjoint from every earlier room's tiles (can_place guarantee).
        for (let a = 0; a < rooms.length; a++) {
          for (let b = a + 1; b < rooms.length; b++) {
            const ra = rooms[a]!;
            const rb = rooms[b]!;
            const overlap =
              ra.col <= rb.col + rb.w &&
              rb.col <= ra.col + ra.w &&
              ra.row <= rb.row + rb.h &&
              rb.row <= ra.row + ra.h;
            expect(overlap).toBe(false);
          }
        }

        // BFS from room 0's center over floor tiles reaches every room center.
        const visited = new Uint8Array(64 * 64);
        const queue = [idx(rooms[0]!.cx, rooms[0]!.cy)];
        visited[queue[0]!] = 1;
        while (queue.length > 0) {
          const at = queue.pop()!;
          const x = at % 64;
          const y = Math.floor(at / 64);
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= 64 || ny >= 64) continue;
            const ni = idx(nx, ny);
            if (visited[ni] || lv.tiles[ni] === 0) continue;
            visited[ni] = 1;
            queue.push(ni);
          }
        }
        for (const r of rooms) {
          expect(visited[idx(r.cx, r.cy)]).toBe(1);
        }

        // Stairs: down always in first room; up only when descriptor allows.
        const d0 = stairs.down!;
        expect(lv.tiles[idx(d0.x, d0.y)]).toBe(TILE_STAIRS_DOWN);
        expect(lv.flags[idx(d0.x, d0.y)]! & FLAG_ROOM).toBeTruthy();
        if (level > 3) {
          const u0 = stairs.up!;
          expect(lv.tiles[idx(u0.x, u0.y)]).toBe(TILE_STAIRS_UP);
          expect(lv.flags[idx(u0.x, u0.y)]! & FLAG_ROOM).toBeTruthy();
        } else {
          expect(stairs.up).toBeNull();
        }
      }
    });
  }
});

describe('RNG contract (dedicated generation RNG)', () => {
  it('levelGenSeed differs per level', () => {
    expect(levelGenSeed(123, 1)).not.toBe(levelGenSeed(123, 2));
    expect(levelGenSeed(123, 1)).toBe(levelGenSeed(123, 1));
  });

  it('regeneration is deterministic and independent of gameplay rolls', () => {
    const desc: GenDescriptor = { hasUpStair: true };
    const a = generateLevelForWorld(777, 2, desc);

    const gameplay = new MSLCG(555);
    gameplay.next();
    gameplay.next();

    const b = generateLevelForWorld(777, 2, desc);
    expect(Buffer.from(b.level.tiles).toString('base64')).toBe(
      Buffer.from(a.level.tiles).toString('base64'),
    );
    expect(b.finalRngState).toBe(a.finalRngState);
  });
});

describe('extensions beyond the Python reference', () => {
  it('placeDoors flags corridor cells adjacent to room cells (flag 0x40)', () => {
    // Find a seed/level that actually produces corridors (doors possible).
    let found = false;
    for (let seed = 1; seed <= 20 && !found; seed++) {
      const gen = generateLevel(2, new MSLCG(seed), {
        hasUpStair: false,
        placeDoors: true,
      });
      let doors = 0;
      for (let i = 0; i < 64 * 64; i++) {
        const f = gen.level.flags[i]!;
        if (!(f & FLAG_DOOR)) continue;
        doors++;
        // Every door cell is a corridor floor cell…
        expect(f & FLAG_CORRIDOR).toBeTruthy();
        expect(gen.level.tiles[i]).toBe(TILE_FLOOR);
        // …adjacent to at least one room cell.
        const x = i % 64;
        const y = Math.floor(i / 64);
        const neighbors = ([[-1, 0], [1, 0], [0, -1], [0, 1]] as const).map(
          ([dx, dy]) => (x + dx < 0 || y + dy < 0 || x + dx >= 64 || y + dy >= 64
            ? 0
            : gen.level.flags[idx(x + dx, y + dy)]!),
        );
        expect(neighbors.some((n) => (n & FLAG_ROOM) !== 0)).toBe(true);
      }
      if (doors > 0) {
        found = true;
        expect(doors).toBeGreaterThan(0);
      }
    }
    expect(found).toBe(true);
  });

  it('placeDoors=false keeps flag plane byte-identical to the reference', () => {
    const case0 = fixture.cases[0]!;
    const gen = generateLevel(
      case0.level,
      new MSLCG(case0.seed),
      pythonDescriptor(case0),
    );
    expect(Buffer.from(gen.level.flags).toString('base64')).toBe(case0.flagsB64);
  });

  it('extraStairs places branch stairs in the requested rooms', () => {
    const gen = generateLevel(6, new MSLCG(42), {
      hasUpStair: true,
      extraStairs: [{ roomIndex: 1, kind: 'down' }],
    });
    const room1 = gen.rooms[1]!;
    const pos = gen.stairs.extra[0]!;
    expect(pos.kind).toBe('down');
    expect(pos.x).toBe(room1.col + 1);
    expect(pos.y).toBe(room1.row + 1);
    expect(gen.level.tiles[idx(pos.x, pos.y)]).toBe(TILE_STAIRS_DOWN);
  });
});
