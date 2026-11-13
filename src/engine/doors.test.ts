import { describe, expect, it } from 'vitest';

import { createCharacter } from './character';
import { FLAG_DOOR, TILE_FLOOR, TILE_WALL } from './dungeon';
import { createEmptyLevel, idx, type Level } from './map';
import {
  bumpSecretDoor,
  placeSecretDoors,
  revealDoorsInRect,
  revealSecretDoor,
  searchAdjacent,
  secretDoorAt,
} from './doors';
import { MSLCG } from './rng';
import type { DoorState, Player, TrapState, WorldData } from './types';
import { createWorld, dispatch, type World } from './world';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Two 5-wide rooms separated by a 1-wide wall column at x=8 (secret-door spots). */
function dungeonData(): WorldData {
  const rows: string[] = [];
  for (let y = 0; y < 32; y++) rows.push('00'.repeat(32));
  for (let y = 2; y <= 6; y++) {
    rows[y] = `${'00'.repeat(3)}${'01'.repeat(5)}00${'01'.repeat(5)}${'00'.repeat(23)}`;
  }
  return {
    part: 1,
    levels: [
      {
        index: 0,
        name: 'Town',
        kind: 'town',
        links: { down: null, up: null, special: { kind: 'town-entrance', to: 1 } },
      },
      { index: 1, name: 'Dungeon 1', kind: 'mine', links: { down: 2, up: null } },
      { index: 2, name: 'Dungeon 2', kind: 'mine', links: { down: null, up: 1 } },
    ],
    town: { rows, spawn: { x: 3, y: 3 }, mineEntrance: { x: 5, y: 5 } },
    tiles: { 0: { walkable: false }, 1: { walkable: true } },
    items: {},
    spells: {
      's-clair': {
        id: 's-clair',
        name: 'CLAIRVOYANCE',
        tier: 2,
        baseMana: 3,
        target: 'self',
        effect: 'clairvoyance',
      },
    },
    monsters: [{ id: 'm-kobold', name: 'Kobold' }],
  };
}

function testPlayer(overrides: Partial<Player> = {}): Omit<Player, 'x' | 'y'> {
  const base = createCharacter({
    name: 'Test',
    gender: 'female',
    strength: 50,
    intelligence: 50,
    constitution: 50,
    dexterity: 50,
    difficulty: 'intermediate',
  });
  return { ...base, ...overrides };
}

function twoRoomWorld(rngSeed = 1): World {
  const world = createWorld({
    worldSeed: 42,
    data: dungeonData(),
    player: testPlayer(),
    rngSeed,
  });
  const level: Level = createEmptyLevel(1);
  for (let y = 2; y <= 6; y++) {
    for (let x = 3; x <= 7; x++) level.tiles[idx(x, y)] = TILE_FLOOR;
    for (let x = 9; x <= 13; x++) level.tiles[idx(x, y)] = TILE_FLOOR;
  }
  world.levels.set(1, level);
  world.seen.set(1, new Uint8Array(64 * 64));
  world.current = 1;
  world.player.x = 7;
  world.player.y = 4; // west of the wall column, facing (8,4)
  return world;
}

function seedWhere(...rolls: Array<(rng: MSLCG) => boolean>): number {
  for (let s = 1; s < 200_000; s++) {
    const rng = new MSLCG(s);
    if (rolls.every((check) => check(rng))) return s;
  }
  throw new Error('no seed found');
}

// ─── Placement ───────────────────────────────────────────────────────────────

describe('secret door placement', () => {
  it('places 1–3 deterministic doors on qualifying walls', () => {
    const a = twoRoomWorld();
    const b = twoRoomWorld();
    const la = a.levels.get(1)!;
    const lb = b.levels.get(1)!;
    const n = placeSecretDoors(a, la, 1);
    expect(n).toBe(placeSecretDoors(b, lb, 1));
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(3);
    expect(JSON.stringify(la.doors)).toBe(JSON.stringify(lb.doors));

    // Qualifying: a wall cell with floor on opposite sides.
    for (const door of la.doors ?? []) {
      expect(la.tiles[idx(door.x, door.y)]).toBe(TILE_WALL);
      const ewFloor =
        la.tiles[idx(door.x - 1, door.y)] === TILE_FLOOR && la.tiles[idx(door.x + 1, door.y)] === TILE_FLOOR;
      const nsFloor =
        la.tiles[idx(door.x, door.y - 1)] === TILE_FLOOR && la.tiles[idx(door.x, door.y + 1)] === TILE_FLOOR;
      expect(ewFloor || nsFloor).toBe(true);
      expect(door.secret).toBe(true);
      expect(door.found).toBe(false);
    }
    const cells = new Set((la.doors ?? []).map((d) => `${d.x},${d.y}`));
    expect(cells.size).toBe((la.doors ?? []).length);
  });

  it('does not double-place', () => {
    const w = twoRoomWorld();
    const level = w.levels.get(1)!;
    expect(placeSecretDoors(w, level, 1)).toBeGreaterThan(0);
    const first = JSON.stringify(level.doors);
    expect(placeSecretDoors(w, level, 1)).toBe(0);
    expect(JSON.stringify(level.doors)).toBe(first);
  });
});

// ─── Reveal ──────────────────────────────────────────────────────────────────

describe('secret door reveal', () => {
  it('revealSecretDoor opens the wall into a flagged doorway', () => {
    const w = twoRoomWorld();
    const level = w.levels.get(1)!;
    const door: DoorState = { x: 8, y: 4, secret: true, found: false };
    level.doors = [door];
    revealSecretDoor(w, level, door);
    expect(door.found).toBe(true);
    expect(level.tiles[idx(8, 4)]).toBe(TILE_FLOOR);
    expect(level.flags[idx(8, 4)]! & FLAG_DOOR).toBe(FLAG_DOOR);
    expect(w.log.some((e) => e.text === 'You find a secret door!')).toBe(true);
  });

  it('a revealed door can be walked through', () => {
    const w = twoRoomWorld();
    const level = w.levels.get(1)!;
    const door: DoorState = { x: 8, y: 4, secret: true, found: false };
    level.doors = [door];
    revealSecretDoor(w, level, door);
    dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });
    expect(w.player.x).toBe(8);
    expect(w.turn).toBe(1);
  });

  it('secretDoorAt only finds unfound doors', () => {
    const level = createEmptyLevel(1);
    const door: DoorState = { x: 8, y: 4, secret: true, found: false };
    level.doors = [door];
    expect(secretDoorAt(level, 8, 4)).toBe(door);
    door.found = true;
    expect(secretDoorAt(level, 8, 4)).toBeNull();
    expect(secretDoorAt(level, 9, 4)).toBeNull();
  });
});

// ─── Bump search ─────────────────────────────────────────────────────────────

describe('bump search', () => {
  it('a lucky bump reveals the door and consumes a turn', () => {
    const w = twoRoomWorld(seedWhere((rng) => rng.rand(3) === 0));
    const level = w.levels.get(1)!;
    level.doors = [{ x: 8, y: 4, secret: true, found: false }];
    dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });
    expect(w.player.x).toBe(7); // did not step in this turn
    expect(w.turn).toBe(1);
    expect(level.tiles[idx(8, 4)]).toBe(TILE_FLOOR);
    expect(w.log.some((e) => e.text === 'You find a secret door!')).toBe(true);
  });

  it('an unlucky bump leaves the wall and spends no turn', () => {
    const w = twoRoomWorld(seedWhere((rng) => rng.rand(3) !== 0));
    const level = w.levels.get(1)!;
    level.doors = [{ x: 8, y: 4, secret: true, found: false }];
    const result = bumpSecretDoor(w, level, 8, 4);
    expect(result.present).toBe(true); // a secret door was there…
    expect(result.revealed).toBe(false); // …but stayed hidden
    expect(level.tiles[idx(8, 4)]).toBe(TILE_WALL);
    expect(level.doors[0]!.found).toBe(false);
    expect(w.turn).toBe(0);
  });

  it('plain walls are untouched', () => {
    const w = twoRoomWorld();
    const level = w.levels.get(1)!;
    expect(bumpSecretDoor(w, level, 8, 4).present).toBe(false); // no door placed
    dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });
    expect(w.turn).toBe(0);
  });
});

// ─── Search + clairvoyance ───────────────────────────────────────────────────

describe('searchAdjacent', () => {
  it('a lucky search reveals an adjacent trap and secret door', () => {
    const w = twoRoomWorld(seedWhere((rng) => rng.rand(3) === 0, (rng) => rng.rand(3) === 0));
    const level = w.levels.get(1)!;
    const trap: TrapState = { id: 't1', kind: 'pit', x: 7, y: 5, known: false };
    level.traps = [trap];
    level.doors = [{ x: 8, y: 4, secret: true, found: false }];
    const found = searchAdjacent(w);
    expect(found.traps).toBe(1);
    expect(found.doors).toBe(1);
    expect(trap.known).toBe(true);
    expect(level.doors[0]!.found).toBe(true);
    expect(level.tiles[idx(8, 4)]).toBe(TILE_FLOOR);
    expect(w.log.some((e) => e.text === 'You find a secret door!')).toBe(true);
  });

  it('an unlucky search keeps both hidden', () => {
    const w = twoRoomWorld(seedWhere((rng) => rng.rand(3) !== 0, (rng) => rng.rand(3) !== 0));
    const level = w.levels.get(1)!;
    const trap: TrapState = { id: 't1', kind: 'pit', x: 7, y: 5, known: false };
    level.traps = [trap];
    level.doors = [{ x: 8, y: 4, secret: true, found: false }];
    const found = searchAdjacent(w);
    expect(found.traps).toBe(0);
    expect(found.doors).toBe(0);
    expect(trap.known).toBe(false);
    expect(level.doors[0]!.found).toBe(false);
  });

  it('SEARCH action consumes a turn', () => {
    const w = twoRoomWorld();
    dispatch(w, { type: 'SEARCH' });
    expect(w.turn).toBe(1);
  });
});

describe('revealDoorsInRect (clairvoyance)', () => {
  it('opens only doors inside the rect', () => {
    const w = twoRoomWorld();
    const level = w.levels.get(1)!;
    const inside: DoorState = { x: 8, y: 4, secret: true, found: false };
    const outside: DoorState = { x: 8, y: 6, secret: true, found: false };
    level.doors = [inside, outside];
    const n = revealDoorsInRect(w, level, { x: 7, y: 3, w: 3, h: 2 });
    expect(n).toBe(1);
    expect(inside.found).toBe(true);
    expect(level.tiles[idx(8, 4)]).toBe(TILE_FLOOR);
    expect(outside.found).toBe(false);
    expect(level.tiles[idx(8, 6)]).toBe(TILE_WALL);
  });

  it('CAST CLAIRVOYANCE reveals doors and traps around the player', () => {
    const w = twoRoomWorld();
    const level = w.levels.get(1)!;
    level.traps = [{ id: 't1', kind: 'pit', x: 9, y: 4, known: false }];
    level.doors = [{ x: 8, y: 4, secret: true, found: false }];
    w.player.knownSpells = ['s-clair'];
    dispatch(w, { type: 'CAST', spellId: 's-clair' });
    expect(level.traps[0]!.known).toBe(true);
    expect(level.doors[0]!.found).toBe(true);
    expect(level.tiles[idx(8, 4)]).toBe(TILE_FLOOR);
    expect(w.turn).toBe(1);
  });
});
