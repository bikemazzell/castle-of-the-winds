/**
 * Level storage for a 64×64 dungeon level, mirroring the original runtime
 * layout at DS:0xCE2 (per shrine notes): each cell is 3 bytes
 * [tile, flags, entity]. Internally we keep three deinterleaved planes so
 * tile lookups never stride; the interleaved codec is used for save files
 * and for byte-level fidelity with the original memory layout.
 */

import type { DoorState, MonsterState, TrapState } from './types';

export const LEVEL_SIZE = 64;
export const LEVEL_AREA = LEVEL_SIZE * LEVEL_SIZE; // 4096
export const INTERLEAVED_BYTES = LEVEL_AREA * 3; // 12288

export type EntityKind = 'monster' | 'npc' | 'player';

/** Minimal entity record; richer stat blocks attach in M3/M4. */
export interface Entity {
  /** Non-zero id; the occupancy plane stores this id, 0 = empty cell. */
  id: number;
  kind: EntityKind;
  name: string;
  x: number;
  y: number;
  /** Combat state for kind === 'monster' (Task 4.1). */
  monster?: MonsterState;
}

export interface Level {
  /** Level index within the world (0 = town in Part 1). */
  index: number;
  tiles: Uint8Array;
  flags: Uint8Array;
  /** Entity ids per cell (0 = none); records live in `entities`. */
  occupancy: Uint8Array;
  entities: Map<number, Entity>;
  /** Initial monster population done (Task 4.2). */
  populated?: boolean;
  /** Quest boss placed (monsters.ts placeQuestBoss). */
  bossPlaced?: boolean;
  /** Dungeon traps (Task 4.3); undefined = not yet placed. */
  traps?: TrapState[];
  /** Secret doors (Task 4.3); undefined = not yet placed. */
  doors?: DoorState[];
}

/** Row-major cell index for (x, y); caller guarantees bounds. */
export function idx(x: number, y: number): number {
  return y * LEVEL_SIZE + x;
}

export function createEmptyLevel(index: number): Level {
  return {
    index,
    tiles: new Uint8Array(LEVEL_AREA),
    flags: new Uint8Array(LEVEL_AREA),
    occupancy: new Uint8Array(LEVEL_AREA),
    entities: new Map<number, Entity>(),
  };
}

/**
 * Lowest unused entity id in 1..255. Returns 0 when every id is occupied —
 * callers must refuse the spawn then. Ids live in a single byte of the
 * occupancy plane, so 255 is a hard ceiling (CODE-QUALITY F08); lowest-unused
 * keeps ids compact across kill/spawn cycles.
 */
export function allocateEntityId(level: Level): number {
  const used = new Set(level.entities.keys());
  for (let id = 1; id <= 255; id++) {
    if (!used.has(id)) return id;
  }
  return 0;
}

/** First matching stair/feature tile scan (used for level arrivals + spells). */
export function findStair(level: Level, tileByte: number): { x: number; y: number } | null {
  for (let i = 0; i < level.tiles.length; i++) {
    if (level.tiles[i] === tileByte) {
      return { x: i % LEVEL_SIZE, y: Math.floor(i / LEVEL_SIZE) };
    }
  }
  return null;
}

/** Deinterleave the original 3-byte-per-cell layout into planes. */
export function fromInterleaved(bytes: Uint8Array, index = 0): Level {
  if (bytes.length !== INTERLEAVED_BYTES) {
    throw new RangeError(
      `interleaved level must be ${INTERLEAVED_BYTES} bytes, got ${bytes.length}`,
    );
  }
  const tiles = new Uint8Array(LEVEL_AREA);
  const flags = new Uint8Array(LEVEL_AREA);
  const occupancy = new Uint8Array(LEVEL_AREA);
  for (let i = 0; i < LEVEL_AREA; i++) {
    tiles[i] = bytes[i * 3]!;
    flags[i] = bytes[i * 3 + 1]!;
    occupancy[i] = bytes[i * 3 + 2]!;
  }
  return { index, tiles, flags, occupancy, entities: new Map() };
}

/** Re-interleave planes into the original 3-byte-per-cell layout. */
export function toInterleaved(level: Level): Uint8Array {
  const out = new Uint8Array(INTERLEAVED_BYTES);
  for (let i = 0; i < LEVEL_AREA; i++) {
    out[i * 3] = level.tiles[i]!;
    out[i * 3 + 1] = level.flags[i]!;
    out[i * 3 + 2] = level.occupancy[i]!;
  }
  return out;
}

/** Bounds-checked tile read; null when (x, y) is outside the level. */
export function getTile(level: Level, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x >= LEVEL_SIZE || y >= LEVEL_SIZE) return null;
  return level.tiles[idx(x, y)] ?? null;
}

export interface OccupancyCheck {
  ok: boolean;
  errors: string[];
}

/**
 * Verify occupancy plane ↔ entity records are bijective: every non-zero
 * occupancy cell has a record, every record sits on exactly one cell at its
 * (x, y). Save/load runs this on every serialize (Task 2.6).
 */
export function validateOccupancy(level: Level): OccupancyCheck {
  const errors: string[] = [];
  const placed = new Map<number, number>(); // entityId -> cell count
  for (let i = 0; i < LEVEL_AREA; i++) {
    const id = level.occupancy[i]!;
    if (id === 0) continue;
    if (!level.entities.has(id)) {
      errors.push(
        `occupancy cell ${i} (x=${i % LEVEL_SIZE},y=${Math.floor(i / LEVEL_SIZE)}) references missing entity ${id}`,
      );
      continue;
    }
    placed.set(id, (placed.get(id) ?? 0) + 1);
  }
  for (const entity of level.entities.values()) {
    const count = placed.get(entity.id) ?? 0;
    if (count === 0) {
      errors.push(`entity ${entity.id} (${entity.name}) has no occupancy cell`);
    } else if (count > 1) {
      errors.push(`entity ${entity.id} (${entity.name}) occupies ${count} cells`);
    } else {
      const at = level.occupancy[idx(entity.x, entity.y)] ?? 0;
      if (at !== entity.id) {
        errors.push(
          `entity ${entity.id} (${entity.name}) records x=${entity.x},y=${entity.y} but its occupancy cell holds ${at}`,
        );
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
