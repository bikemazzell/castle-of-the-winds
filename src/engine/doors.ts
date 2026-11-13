/**
 * Secret doors (Task 4.3). A secret door is a wall cell hiding a passage;
 * the manual documents the reveal paths: the 'c' search command over
 * adjacent sites (may take several tries), Clairvoyance ("maps out an area
 * of the dungeon 10 rows by 10 columns … including showing all secret doors
 * and traps"), and — as a port convenience — bumping the wall face.
 * Revealed doors become flagged floor (TILE_FLOOR | FLAG_DOOR).
 */

import { FLAG_DOOR, TILE_FLOOR, TILE_WALL } from './dungeon';
import { idx, type Level } from './map';
import { MSLCG, levelGenSeed } from './rng';
import { SEARCH_CHANCE, trapAt } from './traps';
import type { DoorState, WorldData } from './types';
import type { World } from './world';

/** Dedicated placement RNG discriminator (never the gameplay RNG). */
const DOOR_SEED_XOR = 0x5ec7e7;

function walkable(data: WorldData, tile: number): boolean {
  return data.tiles[String(tile)]?.walkable ?? false;
}

/** A wall cell that would be a genuine shortcut: floor on opposite sides. */
function isSecretDoorCandidate(level: Level, data: WorldData, x: number, y: number): boolean {
  const tile = level.tiles[idx(x, y)] ?? 0;
  if (tile !== TILE_WALL) return false;
  if ((level.flags[idx(x, y)] ?? 0) & FLAG_DOOR) return false; // already a doorway
  const ew =
    walkable(data, level.tiles[idx(x - 1, y)] ?? -1) && walkable(data, level.tiles[idx(x + 1, y)] ?? -1);
  const ns =
    walkable(data, level.tiles[idx(x, y - 1)] ?? -1) && walkable(data, level.tiles[idx(x, y + 1)] ?? -1);
  return ew || ns;
}

/**
 * Place 1–3 secret doors on qualifying walls. Deterministic: dedicated RNG
 * derived from the level gen seed.
 */
export function placeSecretDoors(world: World, level: Level, levelIndex: number): number {
  if ((level.doors?.length ?? 0) > 0) return 0;
  // Town has no secret doors (index 0 guard mirrors populateLevel).
  if (levelIndex === 0) return 0;

  const candidates: { x: number; y: number }[] = [];
  // Skip the outermost ring: those walls never qualify anyway (OOB reads).
  for (let y = 1; y < 63; y++) {
    for (let x = 1; x < 63; x++) {
      if (isSecretDoorCandidate(level, world.data, x, y)) candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return 0;

  const rng = new MSLCG((levelGenSeed(world.worldSeed, levelIndex) ^ DOOR_SEED_XOR) >>> 0);
  const wanted = 1 + rng.rand(3); // 1–3 (APPROX)
  const doors: DoorState[] = [];
  const pool = [...candidates];
  while (doors.length < wanted && pool.length > 0) {
    const pick = rng.rand(pool.length);
    const cell = pool.splice(pick, 1)[0]!;
    doors.push({ x: cell.x, y: cell.y, secret: true, found: false });
  }
  level.doors = doors;
  return doors.length;
}

/** Only unfound secret doors are "secret". */
export function secretDoorAt(level: Level, x: number, y: number): DoorState | null {
  return level.doors?.find((d) => d.x === x && d.y === y && d.secret && !d.found) ?? null;
}

/** Flip a secret door into a flagged doorway. */
function openDoor(level: Level, door: DoorState): void {
  door.found = true;
  const i = idx(door.x, door.y);
  level.tiles[i] = TILE_FLOOR;
  level.flags[i] = (level.flags[i] ?? 0) | FLAG_DOOR;
}

/** Reveal one secret door with the original message. */
export function revealSecretDoor(world: World, level: Level, door: DoorState): void {
  if (door.found) return;
  openDoor(level, door);
  world.log.push({ turn: world.turn, text: 'You find a secret door!' });
}

export interface BumpResult {
  /** A secret door is hiding in this wall. */
  present: boolean;
  /** The bump search revealed it (consumes a turn). */
  revealed: boolean;
}

/**
 * Bump-search a wall face. A hidden door is found with SEARCH_CHANCE odds;
 * finding it takes the turn, a miss costs nothing (the player cannot tell
 * this wall from any other).
 */
export function bumpSecretDoor(world: World, level: Level, x: number, y: number): BumpResult {
  const door = secretDoorAt(level, x, y);
  if (!door) return { present: false, revealed: false };
  if (world.rng.rand(SEARCH_CHANCE) === 0) {
    revealSecretDoor(world, level, door);
    return { present: true, revealed: true };
  }
  return { present: true, revealed: false };
}

/** Silent batch reveal for Clairvoyance (no per-door log spam). */
export function revealDoorsInRect(
  world: World,
  level: Level,
  rect: { x: number; y: number; w: number; h: number },
): number {
  void world; // kept for signature symmetry with revealTrapsInRect callers
  let revealed = 0;
  for (const door of level.doors ?? []) {
    if (door.found || !door.secret) continue;
    if (door.x >= rect.x && door.x < rect.x + rect.w && door.y >= rect.y && door.y < rect.y + rect.h) {
      openDoor(level, door);
      revealed++;
    }
  }
  return revealed;
}

/** Neighbor scan order for the search command (8 sites, clockwise from NW). */
const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * The 'c' search: "Searches the surrounding sites for traps and secret doors.
 * Note that you may have to search more than once to find them!" Each hidden
 * thing gets an independent SEARCH_CHANCE roll.
 */
export function searchAdjacent(world: World): { traps: number; doors: number } {
  const level = world.levels.get(world.current);
  if (!level) return { traps: 0, doors: 0 };
  let trapsFound = 0;
  let doorsFound = 0;
  for (const [dx, dy] of NEIGHBORS) {
    const x = world.player.x + dx;
    const y = world.player.y + dy;
    if (x < 0 || y < 0 || x >= 64 || y >= 64) continue;
    const trap = trapAt(level, x, y);
    if (trap && !trap.known && world.rng.rand(SEARCH_CHANCE) === 0) {
      trap.known = true;
      trapsFound++;
    }
    const door = secretDoorAt(level, x, y);
    if (door && world.rng.rand(SEARCH_CHANCE) === 0) {
      revealSecretDoor(world, level, door);
      doorsFound++;
    }
  }
  return { traps: trapsFound, doors: doorsFound };
}
