/**
 * Complete-state save format v1.
 *
 * Every *visited* level is persisted in full (planes + entities + memory);
 * unvisited levels regenerate deterministically from worldSeed via the
 * dedicated generation RNG (Task 2.3 contract), independent of the gameplay
 * RNG state stored here. Base64 is implemented in pure TS so the same code
 * runs in Node (tests) and the browser (no Buffer/btoa mismatch).
 */

import {
  LEVEL_AREA,
  LEVEL_SIZE,
  fromInterleaved,
  idx,
  validateOccupancy,
  type Entity,
  type DungeonProp,
  type Level,
} from './map';
import { computeFov, updateSeen } from './fov';
import { ALL_TRAP_KINDS } from './traps';
import { validateSave } from './save-validation';
import type { DoorState, Inventory, Player, Systems, TrapState, WorldData } from './types';
import type { QuestState } from './quests';
import { createWorld, repairLevelStairs, type World } from './world';

export type { DoorState, TrapState } from './types';

export const SAVE_FORMAT = 'cotw-save';
export const SAVE_VERSION = 1;

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Pure Uint8Array → base64 (RFC 4648, padded). */
export function bytesToB64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_ALPHABET[b0 >> 2]!;
    out += B64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]!;
    out += b1 === undefined ? '=' : B64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]!;
    out += b2 === undefined ? '=' : B64_ALPHABET[b2 & 0x3f]!;
  }
  return out;
}

const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64_ALPHABET.length; i++) {
  B64_LOOKUP[B64_ALPHABET[i]!] = i;
}

/** Pure base64 → Uint8Array. Throws on invalid characters or padding. */
export function b64ToBytes(text: string): Uint8Array {
  if (text.length === 0) return new Uint8Array(0);
  if (text.length % 4 !== 0) throw new Error('base64: length must be a multiple of 4');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const outLen = (text.length / 4) * 3 - padding;
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => {
      const ch = text[i + k]!;
      if (ch === '=') return -1;
      const v = B64_LOOKUP[ch];
      if (v === undefined) throw new Error(`base64: invalid character '${ch}'`);
      return v;
    });
    // Strict padding (F26): '=' is legal only in the final quad, only as a
    // suffix, and at most two of them. '=AAA', 'A=AA', 'AB=A', 'A===' are all
    // rejected before any byte is written.
    const isFinalQuad = i + 4 === text.length;
    for (let k = 0; k < 4; k++) {
      if (c[k] !== -1) continue;
      if (!isFinalQuad || k < 4 - padding) {
        throw new Error('base64: padding only allowed as trailing = or == in the last group');
      }
    }
    out[o++] = (c[0]! << 2) | (c[1]! >> 4);
    if (c[2]! >= 0) out[o++] = ((c[1]! & 0x0f) << 4) | (c[2]! >> 2);
    if (c[3]! >= 0) out[o++] = ((c[2]! & 0x03) << 6) | c[3]!;
  }
  return out;
}

/** Reserved for M3 (items on the ground). */
export interface GroundItem {
  id: string;
  item: string; // items.json id
  x: number;
  y: number;
}

export interface SerializedLevel {
  index: number;
  tilesB64: string;
  flagsB64: string;
  occupancyB64: string;
  seenB64: string;
  entities: Entity[];
  groundItems: GroundItem[];
  traps: TrapState[];
  doors: DoorState[];
  /** Initial monster population done (Task 4.2). */
  populated: boolean;
  /** Quest boss placed (Task 5.6). */
  bossPlaced?: boolean;
  encountersPopulated?: boolean;
  props?: DungeonProp[];
}

export interface SaveFile {
  format: string;
  version: number;
  meta: { savedAt: string; turn: number; part?: 1 | 2 };
  player: Player;
  world: {
    worldSeed: number;
    current: number;
    turn: number;
    gameplayRngState: number;
    restedHours: number;
    /** Campaign quest state (Task 5.6). */
    quests?: QuestState;
  };
  levels: Record<string, SerializedLevel>;
  /** Player inventory (pack + equipment + gold), Task 3.2. */
  inventory: Inventory;
}

export interface SerializeOptions {
  /** Override for deterministic comparisons in tests. */
  savedAt?: string;
}

/** Serialize one level + memory plane (shared by serializeGame and the editor). */
export function serializeLevelFor(level: Level, seen: Uint8Array): SerializedLevel {
  return {
    index: level.index,
    tilesB64: bytesToB64(level.tiles),
    flagsB64: bytesToB64(level.flags),
    occupancyB64: bytesToB64(level.occupancy),
    seenB64: bytesToB64(seen),
    entities: structuredClone([...level.entities.values()]),
    groundItems: [],
    traps: (level.traps ?? []).map((t) => ({ ...t })),
    doors: (level.doors ?? []).map((d) => ({ ...d })),
    populated: level.populated ?? false,
    bossPlaced: level.bossPlaced ?? false,
    ...(level.encountersPopulated !== undefined ? { encountersPopulated: level.encountersPopulated } : {}),
    ...(level.props ? { props: structuredClone(level.props) } : {}),
  };
}

export function serializeGame(world: World, options: SerializeOptions = {}): SaveFile {
  const levels: Record<string, SerializedLevel> = {};
  const indexes = [...world.levels.keys()].sort((a, b) => a - b);
  for (const index of indexes) {
    const level = world.levels.get(index)!;
    const seen = world.seen.get(index) ?? new Uint8Array(LEVEL_AREA);
    levels[String(index)] = serializeLevelFor(level, seen);
  }
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    meta: {
      savedAt: options.savedAt ?? new Date().toISOString(),
      turn: world.turn,
      part: world.data.part,
    },
    // Deep copy: statuses/regen/knownSpells must not alias the live world (F04).
    player: structuredClone(world.player),
    world: {
      worldSeed: world.worldSeed,
      current: world.current,
      turn: world.turn,
      gameplayRngState: world.rng.getState(),
      restedHours: world.restedHours,
      ...(world.questState ? { quests: structuredClone(world.questState) } : {}),
    },
    levels,
    inventory: structuredClone(world.inventory),
  };
}

function validateTraps(traps: TrapState[], key: string): void {
  for (const trap of traps) {
    if (typeof trap.id !== 'string' || trap.id.length === 0) {
      throw new Error(`invalid trap id in level ${key}`);
    }
    if (!ALL_TRAP_KINDS.includes(trap.kind)) {
      throw new Error(`unknown trap kind '${String(trap.kind)}' in level ${key}`);
    }
    if (!Number.isInteger(trap.x) || trap.x < 0 || trap.x >= LEVEL_SIZE) {
      throw new Error(`trap x out of bounds in level ${key}`);
    }
    if (!Number.isInteger(trap.y) || trap.y < 0 || trap.y >= LEVEL_SIZE) {
      throw new Error(`trap y out of bounds in level ${key}`);
    }
    if (typeof trap.known !== 'boolean') {
      throw new Error(`invalid trap known flag in level ${key}`);
    }
  }
}

function validateDoors(doors: DoorState[], key: string): void {
  for (const door of doors) {
    if (!Number.isInteger(door.x) || door.x < 0 || door.x >= LEVEL_SIZE) {
      throw new Error(`door x out of bounds in level ${key}`);
    }
    if (!Number.isInteger(door.y) || door.y < 0 || door.y >= LEVEL_SIZE) {
      throw new Error(`door y out of bounds in level ${key}`);
    }
    if (typeof door.secret !== 'boolean' || typeof door.found !== 'boolean') {
      throw new Error(`invalid door flags in level ${key}`);
    }
  }
}

const KNOWN_STATUSES = new Set([
  'drunken', 'stimulated', 'crash', 'hallucination', 'sedated',
  'poison',
  'shield',
  'resist_fire',
  'resist_cold',
  'resist_lightning',
  'light',
  'levitation',
  'detect_traps',
  'detect_objects',
  'detect_monsters',
]);

function validateQuestState(state: QuestState | undefined): void {
  if (state === undefined) return;
  if (typeof state.questId !== 'string' || state.questId.length === 0) {
    throw new Error('invalid quest id');
  }
  if (typeof state.done !== 'boolean' || typeof state.victory !== 'boolean') {
    throw new Error('invalid quest completion flags');
  }
  if (state.endingShown !== undefined && typeof state.endingShown !== 'boolean') {
    throw new Error('invalid endingShown flag');
  }
  for (const [stageId, turn] of Object.entries(state.completed ?? {})) {
    if (typeof stageId !== 'string' || !Number.isInteger(turn) || turn < 0) {
      throw new Error('invalid completed stage entry');
    }
  }
  for (const entry of state.journal ?? []) {
    if (
      typeof entry.questId !== 'string' ||
      typeof entry.text !== 'string' ||
      !Number.isInteger(entry.turn) ||
      entry.turn < 0
    ) {
      throw new Error('invalid journal entry');
    }
  }
  for (const id of state.pending ?? []) {
    if (!Number.isInteger(id) || id < 0) throw new Error('invalid pending story id');
  }
}

function validateStatuses(statuses: Player['statuses']): void {
  if (!Array.isArray(statuses)) throw new Error('player.statuses must be an array');
  for (const status of statuses) {
    if (!status || !KNOWN_STATUSES.has(status.kind)) {
      throw new Error(`unknown status kind: ${JSON.stringify(status)}`);
    }
    if (!Number.isInteger(status.remainingTurns) || status.remainingTurns < 0) {
      throw new Error(`invalid status duration: ${JSON.stringify(status)}`);
    }
  }
}

/**
 * Rebuild a live World from a save. Accepts unknown input; the whole file is
 * validated (structure, registries, limits) before any world state exists.
 * Throws on any inconsistency — the caller never receives a partially-loaded
 * world. Mutating the returned world never aliases the input save (F04).
 */
export function deserializeGame(
  save: unknown,
  data: WorldData,
  systems?: Systems,
): World {
  const { file, planes } = validateSave(save, data);

  // Rebuild.
  const world = createWorld({
    worldSeed: file.world.worldSeed,
    data,
    player: structuredClone(file.player),
    systems,
  });

  world.levels.clear();
  world.seen.clear();
  for (const [key, lv] of Object.entries(file.levels)) {
    const decoded = planes.get(lv.index)!;
    const interleaved = new Uint8Array(LEVEL_AREA * 3);
    for (let i = 0; i < LEVEL_AREA; i++) {
      interleaved[i * 3] = decoded.tiles[i]!;
      interleaved[i * 3 + 1] = decoded.flags[i]!;
      interleaved[i * 3 + 2] = decoded.occupancy[i]!;
    }
    const level: Level = fromInterleaved(interleaved, lv.index);
    for (const entity of lv.entities) {
      // Deep copy: the loaded world must never alias the save (F04).
      level.entities.set(entity.id, structuredClone(entity));
    }
    const check = validateOccupancy(level);
    if (!check.ok) {
      throw new Error(`occupancy/entity mismatch in level ${key}: ${check.errors.join('; ')}`);
    }
    level.populated = lv.populated ?? false;
    level.bossPlaced = lv.bossPlaced ?? false;
    level.encountersPopulated = lv.encountersPopulated;
    level.props = lv.props ? structuredClone(lv.props) : undefined;
    level.traps = lv.traps.map((t) => ({ ...t }));
    level.doors = lv.doors.map((d) => ({ ...d }));
    repairLevelStairs(level, data.levels.find(node => node.index === lv.index)!);
    world.levels.set(lv.index, level);
    world.seen.set(lv.index, decoded.seen);
    validateTraps(lv.traps, key);
    validateDoors(lv.doors, key);
  }

  validateStatuses(file.player.statuses);
  validateQuestState(file.world.quests);

  world.current = file.world.current;
  world.turn = file.world.turn;
  world.restedHours = file.world.restedHours;
  world.rng.setState(file.world.gameplayRngState);
  world.player = structuredClone(file.player);
  world.inventory = structuredClone(file.inventory);
  if (file.world.quests) world.questState = structuredClone(file.world.quests);
  world.visible = computeFov(world.levels.get(world.current)!, {
    x: world.player.x,
    y: world.player.y,
  });
  const seen = world.seen.get(world.current);
  if (seen) updateSeen(seen, world.visible);
  return world;
}

// Re-export for consumers that build worlds + saves together.
export { idx };
