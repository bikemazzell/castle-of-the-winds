import { describe, expect, it } from 'vitest';

import {
  LEVEL_AREA,
  LEVEL_SIZE,
  allocateEntityId,
  createEmptyLevel,
  fromInterleaved,
  getTile,
  idx,
  toInterleaved,
  validateOccupancy,
  type Entity,
  type Level,
} from './map';

/** Deterministic pseudo-random filler (independent of engine MSLCG). */
function fill(bytes: Uint8Array, seed: number): void {
  let s = seed;
  for (let i = 0; i < bytes.length; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    bytes[i] = s & 0xff;
  }
}

describe('level plane codec', () => {
  it('LEVEL constants', () => {
    expect(LEVEL_SIZE).toBe(64);
    expect(LEVEL_AREA).toBe(4096);
  });

  it('idx() matches row-major 64-wide layout', () => {
    expect(idx(0, 0)).toBe(0);
    expect(idx(5, 7)).toBe(7 * 64 + 5);
    expect(idx(63, 63)).toBe(4095);
  });

  it('fromInterleaved deinterleaves shrine-layout cells (tile/flags/entity)', () => {
    const raw = new Uint8Array(LEVEL_AREA * 3);
    // Cell (5,7): tile 0x12 stairs down, flag 0x20 room, entity 9.
    const cell = idx(5, 7) * 3;
    raw[cell] = 0x12;
    raw[cell + 1] = 0x20;
    raw[cell + 2] = 9;
    const level = fromInterleaved(raw, 3);
    expect(level.index).toBe(3);
    expect(level.tiles[idx(5, 7)]).toBe(0x12);
    expect(level.flags[idx(5, 7)]).toBe(0x20);
    expect(level.occupancy[idx(5, 7)]).toBe(9);
  });

  it('fromInterleaved rejects wrong sizes', () => {
    expect(() => fromInterleaved(new Uint8Array(10))).toThrow(/12288|size/i);
    expect(() => fromInterleaved(new Uint8Array(LEVEL_AREA * 3 + 1))).toThrow(
      /12288|size/i,
    );
  });

  it('toInterleaved ∘ fromInterleaved round-trips arbitrary bytes', () => {
    const raw = new Uint8Array(LEVEL_AREA * 3);
    fill(raw, 1234);
    const level = fromInterleaved(raw, 0);
    const out = toInterleaved(level);
    expect(Array.from(out)).toEqual(Array.from(raw));
  });

  it('round-trip preserves planar structure (planes not aliased)', () => {
    const level = createEmptyLevel(1);
    level.tiles[0] = 1;
    level.flags[0] = 2;
    level.occupancy[0] = 3;
    const out = fromInterleaved(toInterleaved(level), 1);
    expect(out.tiles[0]).toBe(1);
    expect(out.flags[0]).toBe(2);
    expect(out.occupancy[0]).toBe(3);
  });
});

describe('getTile bounds', () => {
  const level = createEmptyLevel(0);
  level.tiles[idx(10, 10)] = 0x13;

  it('returns the tile for in-bounds coords', () => {
    expect(getTile(level, 10, 10)).toBe(0x13);
    expect(getTile(level, 0, 0)).toBe(0);
  });

  it('returns null out of bounds', () => {
    expect(getTile(level, -1, 0)).toBeNull();
    expect(getTile(level, 0, -1)).toBeNull();
    expect(getTile(level, 64, 0)).toBeNull();
    expect(getTile(level, 0, 64)).toBeNull();
    expect(getTile(level, 999, 999)).toBeNull();
  });
});

describe('occupancy ↔ entity pairing', () => {
  function inhabitedLevel(): Level {
    const level = createEmptyLevel(2);
    level.occupancy[idx(3, 3)] = 7;
    level.entities.set(7, {
      id: 7,
      kind: 'monster',
      name: 'Kobold',
      x: 3,
      y: 3,
    });
    return level;
  }

  it('validates a consistent level', () => {
    const result = validateOccupancy(inhabitedLevel());
    expect(result.errors).toEqual([]);
  });

  it('flags occupancy id with no entity record', () => {
    const level = inhabitedLevel();
    level.occupancy[idx(9, 9)] = 42; // no entity 42
    expect(validateOccupancy(level).errors.join('\n')).toMatch(/42/);
  });

  it('flags entity record not placed on its occupancy cell', () => {
    const level = inhabitedLevel();
    const e = level.entities.get(7)!;
    e.x = 8; // moved without updating the plane
    expect(validateOccupancy(level).errors.join('\n')).toMatch(/7/);
  });

  it('flags an entity id appearing on two cells', () => {
    const level = inhabitedLevel();
    level.occupancy[idx(1, 1)] = 7; // duplicate placement
    expect(validateOccupancy(level).errors.join('\n')).toMatch(/7/);
  });

  it('flags empty-plane entity (record exists, plane has 0)', () => {
    const level = inhabitedLevel();
    level.occupancy[idx(3, 3)] = 0;
    expect(validateOccupancy(level).errors.join('\n')).toMatch(/7/);
  });

  it('createEmptyLevel yields zeroed planes and empty entity map', () => {
    const level = createEmptyLevel(5);
    expect(level.index).toBe(5);
    expect(level.tiles.length).toBe(LEVEL_AREA);
    expect(level.flags.length).toBe(LEVEL_AREA);
    expect(level.occupancy.length).toBe(LEVEL_AREA);
    expect(level.tiles.every((b) => b === 0)).toBe(true);
    expect(level.entities.size).toBe(0);
    expect(validateOccupancy(level).errors).toEqual([]);
  });
});

describe('entity id allocation (CODE-QUALITY Task 8)', () => {
  function levelWithIds(ids: number[]): Level {
    const level = createEmptyLevel(1);
    for (const id of ids) {
      const x = id % LEVEL_SIZE;
      const y = Math.floor(id / LEVEL_SIZE);
      const entity: Entity = { id, kind: 'monster', name: `T${id}`, x, y };
      level.entities.set(id, entity);
      level.occupancy[idx(x, y)] = id;
    }
    return level;
  }

  it('allocates the lowest unused id starting at 1', () => {
    expect(allocateEntityId(createEmptyLevel(1))).toBe(1);
    expect(allocateEntityId(levelWithIds([1, 2, 3]))).toBe(4);
  });

  it('reuses freed ids across kill/spawn cycles', () => {
    const level = levelWithIds([1, 2, 3]);
    level.entities.delete(2);
    expect(allocateEntityId(level)).toBe(2);
    level.entities.delete(1);
    level.entities.delete(3);
    expect(allocateEntityId(level)).toBe(1);
  });

  it('fills a gap below an existing id 255 and never exceeds 255', () => {
    const level = levelWithIds([1, 2, 3, 255]);
    level.entities.delete(3);
    expect(allocateEntityId(level)).toBe(3);
  });

  it('reports exhaustion as 0 when all 255 ids are occupied', () => {
    const all: number[] = [];
    for (let id = 1; id <= 255; id++) all.push(id);
    const level = levelWithIds(all);
    expect(validateOccupancy(level).errors).toEqual([]);
    expect(allocateEntityId(level)).toBe(0);
  });
});
