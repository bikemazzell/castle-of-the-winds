import { describe, expect, it } from 'vitest';

import { FLAG_CORRIDOR, FLAG_ROOM, TILE_FLOOR, TILE_WALL } from './dungeon';
import {
  clairvoyanceRegion,
  computeFov,
  hasLos,
  revealRect,
  updateSeen,
} from './fov';
import { createEmptyLevel, idx, type Level } from './map';

/** Room (5,5)-(10,10) + corridor (11,7)-(20,7) carved into an empty level. */
function roomAndCorridor(): Level {
  const level = createEmptyLevel(1);
  for (let y = 5; y <= 10; y++) {
    for (let x = 5; x <= 10; x++) {
      level.tiles[idx(x, y)] = TILE_FLOOR;
      level.flags[idx(x, y)] = FLAG_ROOM;
    }
  }
  for (let x = 11; x <= 20; x++) {
    level.tiles[idx(x, 7)] = TILE_FLOOR;
    level.flags[idx(x, 7)] = FLAG_CORRIDOR;
  }
  return level;
}

describe('computeFov — rooms', () => {
  it('standing in a room shows the whole room and its surrounding walls', () => {
    const level = roomAndCorridor();
    const vis = computeFov(level, { x: 7, y: 7 });
    for (let y = 5; y <= 10; y++) {
      for (let x = 5; x <= 10; x++) {
        expect(vis[idx(x, y)], `room ${x},${y}`).toBe(1);
      }
    }
    // Wall ring around the room (border of the room rect expanded by 1).
    for (let x = 4; x <= 11; x++) {
      expect(vis[idx(x, 4)], `top wall ${x}`).toBe(1);
      expect(vis[idx(x, 11)], `bottom wall ${x}`).toBe(1);
    }
    for (let y = 4; y <= 11; y++) {
      expect(vis[idx(4, y)], `left wall ${y}`).toBe(1);
      expect(vis[idx(11, y)], `right wall ${y}`).toBe(1);
    }
  });

  it('does not see through the room wall into the corridor', () => {
    const level = roomAndCorridor();
    const vis = computeFov(level, { x: 7, y: 7 });
    // Corridor starts at x=11 (also the room's east wall column).
    expect(vis[idx(12, 7)]).toBe(0);
    expect(vis[idx(16, 7)]).toBe(0);
    // Nothing beyond the room in open darkness.
    expect(vis[idx(30, 30)]).toBe(0);
  });

  it('a second disconnected room stays hidden', () => {
    const level = roomAndCorridor();
    for (let y = 30; y <= 33; y++) {
      for (let x = 30; x <= 33; x++) {
        level.tiles[idx(x, y)] = TILE_FLOOR;
        level.flags[idx(x, y)] = FLAG_ROOM;
      }
    }
    const vis = computeFov(level, { x: 7, y: 7 });
    expect(vis[idx(31, 31)]).toBe(0);
  });
});

describe('computeFov — corridors', () => {
  it('default corridor vision is the 3x3 square around the player', () => {
    const level = roomAndCorridor();
    const vis = computeFov(level, { x: 16, y: 7 });
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        expect(vis[idx(16 + dx, 7 + dy)], `at ${16 + dx},${7 + dy}`).toBe(1);
      }
    }
    expect(vis[idx(19, 7)]).toBe(0);
  });

  it('revealRadius 0 shows the origin square plus its side walls only', () => {
    const level = roomAndCorridor();
    const vis = computeFov(level, { x: 16, y: 7 }, { revealRadius: 0 });
    expect(vis[idx(16, 7)]).toBe(1);
    // Walls 4-adjacent to the visible floor square are visible…
    expect(vis[idx(16, 6)]).toBe(1);
    expect(vis[idx(16, 8)]).toBe(1);
    // …but not floor further down the corridor, nor diagonal wall corners.
    expect(vis[idx(17, 7)]).toBe(0);
    expect(vis[idx(15, 7)]).toBe(0);
    expect(vis[idx(15, 6)]).toBe(0);
    expect(vis[idx(17, 8)]).toBe(0);
  });

  it('corridor vision cannot see around corners into a room', () => {
    const level = roomAndCorridor();
    const vis = computeFov(level, { x: 16, y: 7 });
    // The room is far west; nothing of it visible.
    expect(vis[idx(6, 6)]).toBe(0);
  });
});

describe('computeFov — lit regions (Light spell)', () => {
  it('a lit 3x3 hallway region away from the player is visible', () => {
    const level = roomAndCorridor();
    const vis = computeFov(level, { x: 20, y: 7 }, {
      litRegions: [{ x: 11, y: 6, w: 3, h: 3 }],
    });
    expect(vis[idx(12, 7)]).toBe(1);
    expect(vis[idx(16, 7)]).toBe(0);
  });

  it('a lit whole-room region shows the room from outside', () => {
    const level = roomAndCorridor();
    const vis = computeFov(level, { x: 18, y: 7 }, {
      litRegions: [{ x: 5, y: 5, w: 6, h: 6 }],
    });
    for (let y = 5; y <= 10; y++) {
      for (let x = 5; x <= 10; x++) {
        expect(vis[idx(x, y)], `lit room ${x},${y}`).toBe(1);
      }
    }
  });
});

describe('hasLos — Bresenham line of sight', () => {
  it('clear straight corridor has LOS', () => {
    const level = roomAndCorridor();
    expect(hasLos(level, { x: 12, y: 7 }, { x: 19, y: 7 })).toBe(true);
  });

  it('a wall between two corridor tiles blocks LOS', () => {
    const level = roomAndCorridor();
    level.tiles[idx(15, 7)] = TILE_WALL;
    expect(hasLos(level, { x: 12, y: 7 }, { x: 19, y: 7 })).toBe(false);
  });

  it('LOS is symmetric A↔B', () => {
    const level = roomAndCorridor();
    // A few walls to create asymmetric-looking diagonals.
    level.tiles[idx(15, 7)] = TILE_WALL;
    level.tiles[idx(25, 12)] = TILE_FLOOR;
    level.flags[idx(25, 12)] = FLAG_CORRIDOR;
    for (let y = 12; y <= 20; y++) {
      level.tiles[idx(25, y)] = TILE_FLOOR;
      level.flags[idx(25, y)] = FLAG_CORRIDOR;
    }
    const points = [
      { x: 12, y: 7 }, { x: 19, y: 7 }, { x: 7, y: 7 },
      { x: 25, y: 13 }, { x: 25, y: 19 }, { x: 16, y: 7 },
    ];
    for (const a of points) {
      for (const b of points) {
        if (a === b) continue;
        expect(hasLos(level, a, b)).toBe(hasLos(level, b, a));
      }
    }
  });
});

describe('memory', () => {
  it('updateSeen accumulates visibility over moves', () => {
    const level = roomAndCorridor();
    const seen = new Uint8Array(64 * 64);
    updateSeen(seen, computeFov(level, { x: 7, y: 7 }));
    expect(seen[idx(6, 6)]).toBe(1);
    expect(seen[idx(30, 30)]).toBe(0);
    updateSeen(seen, computeFov(level, { x: 17, y: 7 }));
    // Earlier room memory persists…
    expect(seen[idx(6, 6)]).toBe(1);
    // …and the new corridor position is remembered.
    expect(seen[idx(17, 7)]).toBe(1);
  });

  it('revealRect fills a clamped rectangle (Clairvoyance 10×10)', () => {
    const region = clairvoyanceRegion({ x: 40, y: 40 });
    expect(region).toEqual({ x: 35, y: 35, w: 10, h: 10 });
    const seen = new Uint8Array(64 * 64);
    revealRect(seen, region);
    expect(seen[idx(35, 35)]).toBe(1);
    expect(seen[idx(44, 44)]).toBe(1);
    expect(seen[idx(34, 40)]).toBe(0);
    expect(seen[idx(45, 40)]).toBe(0);
  });

  it('revealRect clamps at the map edge without throwing', () => {
    const seen = new Uint8Array(64 * 64);
    expect(() => revealRect(seen, clairvoyanceRegion({ x: 1, y: 1 }))).not.toThrow();
    expect(seen[idx(0, 0)]).toBe(1);
    expect(seen[idx(63, 63)]).toBe(0);
  });
});
