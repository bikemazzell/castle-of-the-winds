/**
 * Public save-file boundary validation (code-quality Task 2, F03/F04/F26).
 *
 * `deserializeGame` accepts unknown input; this module decides — before any
 * world construction — whether a save is structurally sound, registry-consistent,
 * and within the documented collection limits. Every rejection is
 * field-specific so callers can surface the offending field.
 *
 * Collection limits (derived from the level graph and the entity-id byte):
 *   - levels:        at most `data.levels.length` entries (12 in Part 1)
 *   - entities/level: at most 255 (occupancy plane is one byte per cell)
 *   - pack items:    at most 256 (arbitrary anti-bloat bound; real packs are
 *                    carry-limited to a few dozen)
 *   - statuses:      at most 16
 *   - journal:       at most 512 entries
 *   - pending story: at most 32 ids
 */

import { LEVEL_AREA, LEVEL_SIZE, idx } from './map';
import { b64ToBytes } from './save';
import type { Entity, Level } from './map';
import type { Inventory, Player, WorldData } from './types';
import type { QuestState } from './quests';
import type { SaveFile, SerializedLevel } from './save';

export const SAVE_LIMITS = {
  packItems: 256,
  statuses: 16,
  journal: 512,
  pending: 32,
} as const;

const EQUIP_SLOTS = new Set([
  'weapon',
  'shield',
  'armor',
  'helm',
  'boots',
  'gauntlets',
  'bracers',
  'cloak',
  'ring1',
  'ring2',
  'amulet',
]);

const ENTITY_KINDS = new Set(['monster', 'npc', 'player']);
const GENDERS = new Set(['male', 'female']);
const DIFFICULTIES = new Set(['easy', 'intermediate', 'difficult', 'expert']);

/** Decoded planes for one serialized level (decode-once contract). */
export interface DecodedPlanes {
  tiles: Uint8Array;
  flags: Uint8Array;
  occupancy: Uint8Array;
  seen: Uint8Array;
}

export interface ValidatedSave {
  file: SaveFile;
  planes: Map<number, DecodedPlanes>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUint32(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function isNonNegInt(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function fail(field: string, problem: string): never {
  throw new Error(`save ${field}: ${problem}`);
}

function decodePlane(b64: unknown, field: string): Uint8Array {
  if (typeof b64 !== 'string') fail(field, 'plane must be a base64 string');
  const bytes = b64ToBytes(b64);
  if (bytes.length !== LEVEL_AREA) {
    fail(field, `expected ${LEVEL_AREA} decoded bytes, got ${bytes.length}`);
  }
  return bytes;
}

function validatePlayer(player: unknown, data: WorldData): Player {
  if (!isRecord(player)) fail('player', 'must be an object');
  const name = player.name;
  if (typeof name !== 'string' || name.length < 1 || name.length > 24) {
    fail('player.name', 'must be a string of 1-24 characters');
  }
  if (!GENDERS.has(player.gender as string)) fail('player.gender', 'must be male or female');
  if (!DIFFICULTIES.has(player.difficulty as string)) {
    fail('player.difficulty', 'must be a known difficulty');
  }
  for (const key of ['x', 'y'] as const) {
    const v = player[key];
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) >= LEVEL_SIZE) {
      fail(`player.${key}`, `must be an integer in 0..${LEVEL_SIZE - 1}`);
    }
  }
  if (!Number.isInteger(player.level) || (player.level as number) < 1) {
    fail('player.level', 'must be a positive integer');
  }
  if (!isNonNegInt(player.experience)) fail('player.experience', 'must be a non-negative integer');
  for (const key of ['hp', 'maxHp', 'mana', 'maxMana'] as const) {
    const v = player[key];
    if (!Number.isInteger(v) || (v as number) < 0) {
      fail(`player.${key}`, 'must be an integer ≥ 0 (zero hp allowed for death saves)');
    }
  }
  if ((player.hp as number) > (player.maxHp as number)) {
    fail('player.hp', 'cannot exceed maxHp');
  }
  if ((player.mana as number) > (player.maxMana as number)) {
    fail('player.mana', 'cannot exceed maxMana');
  }
  if ((player.maxHp as number) < 1) fail('player.maxHp', 'must be ≥ 1');
  for (const stat of ['strength', 'intelligence', 'constitution', 'dexterity'] as const) {
    const v = player[stat];
    if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 100) {
      fail(`player.${stat}`, 'must be an integer in 1..100');
    }
    const max = player[`max${stat[0]!.toUpperCase()}${stat.slice(1)}` as `max${Capitalize<typeof stat>}`];
    if (!Number.isInteger(max) || (max as number) < 1 || (max as number) > 100) {
      fail(`player.max${stat[0]!.toUpperCase()}${stat.slice(1)}`, 'must be an integer in 1..100');
    }
  }
  if (!Array.isArray(player.knownSpells)) fail('player.knownSpells', 'must be an array');
  const registry = Object.keys(data.spells ?? {});
  for (const id of player.knownSpells) {
    if (typeof id !== 'string') fail('player.knownSpells', 'entries must be strings');
    if (registry.length > 0 && !registry.includes(id)) {
      fail('player.knownSpells', `unknown spell id '${id}'`);
    }
  }
  const regen = player.regen;
  if (!isRecord(regen)) fail('player.regen', 'must be an object');
  if (!isNonNegInt(regen.hpTicks) || !isNonNegInt(regen.manaTicks)) {
    fail('player.regen', 'hpTicks and manaTicks must be non-negative integers');
  }
  if (!Array.isArray(player.statuses)) fail('player.statuses', 'must be an array');
  if (player.statuses.length > SAVE_LIMITS.statuses) {
    fail('player.statuses', `collection limit ${SAVE_LIMITS.statuses} exceeded`);
  }
  return player as unknown as Player;
}

function validateEntityFields(entity: unknown): Entity {
  if (!isRecord(entity)) fail('entities', 'entries must be objects');
  if (!Number.isInteger(entity.id) || (entity.id as number) < 1 || (entity.id as number) > 255) {
    fail('entity id', 'must be an integer in 1..255 (occupancy plane is one byte)');
  }
  if (!ENTITY_KINDS.has(entity.kind as string)) {
    fail('entity kind', `'${String(entity.kind)}' is not a known kind`);
  }
  if (typeof entity.name !== 'string' || (entity.name).length === 0) {
    fail('entity name', 'must be a non-empty string');
  }
  for (const key of ['x', 'y'] as const) {
    const v = entity[key];
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) >= LEVEL_SIZE) {
      fail(`entity.${key}`, 'out of level bounds');
    }
  }
  const monster = entity.monster;
  if (monster !== undefined) {
    if (!isRecord(monster)) fail('entity.monster', 'must be an object');
    const stats = monster.stats;
    if (!isRecord(stats)) fail('entity.monster.stats', 'must be an object');
    for (const key of ['maxHp', 'ac', 'toHit', 'speed', 'xp'] as const) {
      const value = stats[key];
      const minimum = key === 'maxHp' || key === 'speed' ? 1 : key === 'xp' ? 0 : Number.MIN_SAFE_INTEGER;
      if (!Number.isSafeInteger(value) || (value as number) < minimum) {
        fail(`entity.monster.stats.${key}`, 'must be a valid integer');
      }
    }
    const damage = stats.damage;
    if (!isRecord(damage)) fail('entity.monster.stats.damage', 'must be an object');
    for (const key of ['count', 'sides', 'bonus'] as const) {
      const value = damage[key];
      const minimum = key === 'count' ? 0 : key === 'sides' ? 1 : Number.MIN_SAFE_INTEGER;
      if (!Number.isSafeInteger(value) || (value as number) < minimum || (key === 'count' && (value as number) > 100)) {
        fail(`entity.monster.stats.damage.${key}`, 'must be a valid dice value');
      }
    }
    const elements = ['fire', 'cold', 'lightning', 'acid', 'poison_gas'];
    for (const key of ['immuneElement', 'vulnerableElement'] as const) {
      if (stats[key] !== undefined && !elements.includes(stats[key] as string)) {
        fail(`entity.monster.stats.${key}`, 'must be a known element');
      }
    }
    if (stats.breath !== undefined) {
      const breath = stats.breath;
      if (!isRecord(breath) || !elements.includes(breath.element as string)) {
        fail('entity.monster.stats.breath', 'must define a known element');
      }
      for (const key of ['dieSides', 'every'] as const) {
        if (!Number.isSafeInteger(breath[key]) || (breath[key] as number) < 1) {
          fail(`entity.monster.stats.breath.${key}`, 'must be a positive integer');
        }
      }
    }
    if (!Number.isInteger(monster.hp) || (monster.hp as number) < 0) {
      fail('entity.monster.hp', 'must be an integer ≥ 0');
    }
    if (!Number.isInteger(monster.maxHp) || (monster.maxHp as number) < 1) {
      fail('entity.monster.maxHp', 'must be an integer ≥ 1');
    }
    if ((monster.hp as number) > (monster.maxHp as number)) {
      fail('entity.monster.hp', 'cannot exceed maxHp');
    }
    for (const key of ['timer', 'sleepTurns', 'slowDenominator'] as const) {
      const v = monster[key];
      if (v !== undefined && !isNonNegInt(v)) {
        fail(`entity.monster.${key}`, 'must be a non-negative integer when present');
      }
    }
  }
  return entity as unknown as Entity;
}

function validateQuestCollections(state: QuestState, data: WorldData): void {
  const quest = (data.quests ?? []).find((q) => q.id === state.questId);
  if (!quest) fail('quests.questId', `'${state.questId}' is not a known quest`);
  const stageIds = new Set(quest.stages.map((s) => s.id));
  for (const stageId of Object.keys(state.completed ?? {})) {
    if (!stageIds.has(stageId)) fail('quests.completed', `unknown stage '${stageId}'`);
  }
  const journal = state.journal ?? [];
  if (journal.length > SAVE_LIMITS.journal) {
    fail('quests.journal', `collection limit ${SAVE_LIMITS.journal} exceeded`);
  }
  const pending = state.pending ?? [];
  if (pending.length > SAVE_LIMITS.pending) {
    fail('quests.pending', `collection limit ${SAVE_LIMITS.pending} exceeded`);
  }
  const storyIds = new Set(Object.keys(data.story ?? {}));
  for (const id of pending) {
    if (storyIds.size > 0 && !storyIds.has(String(id))) {
      fail('quests.pending', `story text ${id} does not exist`);
    }
  }
}

function validateInventoryFields(inv: unknown, data: WorldData): Inventory {
  if (!isRecord(inv)) fail('inventory', 'must be an object');
  if (!Array.isArray(inv.pack)) fail('inventory.pack', 'must be an array');
  if (inv.pack.length > SAVE_LIMITS.packItems) {
    fail('inventory.pack', `collection limit ${SAVE_LIMITS.packItems} exceeded`);
  }
  const defs = Object.keys(data.items ?? {});
  const uids = new Set<string>();
  const seqNumbers: number[] = [];
  const uidSeq = /^#.+/;
  const readUidSeq = (uid: string): void => {
    const at = uid.indexOf('#');
    if (at <= 0) return;
    const tail = uid.slice(at + 1);
    if (!/^[0-9a-z]+$/.test(tail) || uidSeq.test(tail)) return;
    const n = parseInt(tail, 36);
    if (Number.isInteger(n)) seqNumbers.push(n);
  };
  for (const item of inv.pack) {
    if (!isRecord(item)) fail('inventory.pack', 'entries must be objects');
    if (typeof item.uid !== 'string' || item.uid.length === 0) {
      fail('inventory.pack', 'entries need a uid');
    }
    if (typeof item.defId !== 'string' || (defs.length > 0 && !defs.includes(item.defId))) {
      fail('inventory.pack', `unknown item definition '${String(item.defId)}'`);
    }
    if (!Number.isInteger(item.count) || (item.count as number) < 1) {
      fail('inventory.pack', `count for '${String(item.uid)}' must be an integer ≥ 1`);
    }
    for (const opt of ['charges', 'fuelTurns'] as const) {
      const v = item[opt];
      if (v !== undefined && !isNonNegInt(v)) {
        fail('inventory.pack', `${opt} must be a non-negative integer when present`);
      }
    }
    if (uids.has(item.uid)) fail('inventory', `duplicate uid '${item.uid}'`);
    uids.add(item.uid);
    readUidSeq(item.uid);
  }
  if (!isRecord(inv.equipment)) fail('inventory.equipment', 'must be an object');
  for (const [slot, item] of Object.entries(inv.equipment)) {
    if (!EQUIP_SLOTS.has(slot)) fail('inventory.equipment', `'${slot}' is not a valid slot`);
    if (!item) continue;
    if (!isRecord(item)) fail('inventory.equipment', `${slot} must be an item or null`);
    if (typeof item.uid !== 'string' || typeof item.defId !== 'string') {
      fail('inventory.equipment', `${slot} needs uid and defId`);
    }
    if (defs.length > 0 && !defs.includes(item.defId)) {
      fail('inventory.equipment', `unknown item definition '${String(item.defId)}'`);
    }
    if (uids.has(item.uid)) fail('inventory', `duplicate uid '${item.uid}'`);
    uids.add(item.uid);
    readUidSeq(item.uid);
  }
  if (!Number.isInteger(inv.gold) || (inv.gold as number) < 0) {
    fail('inventory.gold', 'must be a non-negative integer');
  }
  if (!Number.isInteger(inv.seq) || (inv.seq as number) < 0) {
    fail('inventory.seq', 'must be a non-negative integer');
  }
  // A crafted seq below an existing uid's number would let the next pickup
  // generate a uid that collides with a saved item.
  const maxExisting = seqNumbers.reduce((m, n) => Math.max(m, n), -1);
  if (maxExisting > (inv.seq as number)) {
    fail(
      'inventory.seq',
      `must be ≥ ${maxExisting} (uid '${'…'}' already uses that sequence number; ` +
        'a lower value would let future pickups collide)',
    );
  }
  return inv as unknown as Inventory;
}

function validateLevelRecord(
  key: string,
  lv: unknown,
  data: WorldData,
): { level: SerializedLevel; planes: DecodedPlanes } {
  if (!isRecord(lv)) fail(`levels['${key}']`, 'must be an object');
  const index = lv.index;
  if (!Number.isInteger(index)) fail(`levels['${key}'].index`, 'must be an integer');
  if (key !== String(index)) {
    fail(`levels['${key}']`, `key must match index (found index ${String(index)})`);
  }
  if ((index as number) < 0 || (index as number) >= data.levels.length) {
    fail(`levels['${key}'].index`, `${String(index)} is outside the level graph`);
  }
  if (!Array.isArray(lv.entities)) fail(`levels['${key}'].entities`, 'must be an array');
  if ((lv.entities as unknown[]).length > 255) {
    fail(`levels['${key}'].entities`, 'at most 255 entities fit the occupancy byte');
  }
  if (!Array.isArray(lv.groundItems)) fail(`levels['${key}'].groundItems`, 'must be an array');
  if (!Array.isArray(lv.traps)) fail(`levels['${key}'].traps`, 'must be an array');
  if (!Array.isArray(lv.doors)) fail(`levels['${key}'].doors`, 'must be an array');
  if (lv.populated !== undefined && typeof lv.populated !== 'boolean') {
    fail(`levels['${key}'].populated`, 'must be a boolean');
  }
  if (lv.bossPlaced !== undefined && typeof lv.bossPlaced !== 'boolean') {
    fail(`levels['${key}'].bossPlaced`, 'must be a boolean');
  }

  const seenIds = new Set<number>();
  for (const raw of lv.entities as unknown[]) {
    const entity = validateEntityFields(raw);
    if (seenIds.has(entity.id)) {
      fail('entities', `duplicate entity id ${entity.id} in level ${key}`);
    }
    seenIds.add(entity.id);
  }

  const planes: DecodedPlanes = {
    tiles: decodePlane(lv.tilesB64, `levels['${key}'].tiles`),
    flags: decodePlane(lv.flagsB64, `levels['${key}'].flags`),
    occupancy: decodePlane(lv.occupancyB64, `levels['${key}'].occupancy`),
    seen: decodePlane(lv.seenB64, `levels['${key}'].seen`),
  };
  // Entity positions must agree with the occupancy plane.
  for (const entity of lv.entities as Entity[]) {
    const cell = planes.occupancy[idx(entity.x, entity.y)] ?? 0;
    if (cell !== entity.id) {
      fail(
        `levels['${key}'].occupancy`,
        `cell (${entity.x},${entity.y}) holds ${cell}, expected entity id ${entity.id}`,
      );
    }
  }
  return { level: lv as unknown as SerializedLevel, planes };
}

/**
 * Validate an unknown save payload. Throws field-specific errors; returns the
 * typed file plus each level's decoded planes so reconstruction never has to
 * decode twice.
 */
export function validateSave(save: unknown, data: WorldData): ValidatedSave {
  if (!isRecord(save)) throw new Error('save must be an object');
  if (save.format !== 'cotw-save') {
    fail('format', `'${String(save.format)}' is not 'cotw-save'`);
  }
  if (save.version !== 1) fail('version', `${String(save.version)} is not supported`);
  if (!isRecord(save.meta)) fail('meta', 'must be an object');
  if (typeof save.meta.savedAt !== 'string') fail('meta.savedAt', 'must be a string');
  if (!isNonNegInt(save.meta.turn)) fail('meta.turn', 'must be a non-negative integer');
  if (save.meta.part !== undefined && save.meta.part !== 1 && save.meta.part !== 2) {
    fail('meta.part', 'must be 1 or 2 when present');
  }

  if ((save.meta.part ?? 1) !== data.part) fail('meta.part', `does not match campaign ${data.part}`);

  if (!isRecord(save.world)) fail('world', 'must be an object');
  if (!isUint32(save.world.worldSeed)) fail('world.worldSeed', 'must be an unsigned 32-bit integer');
  if (!isUint32(save.world.gameplayRngState)) {
    fail('world.gameplayRngState', 'must be an unsigned 32-bit integer');
  }
  if (!isNonNegInt(save.world.turn)) fail('world.turn', 'must be a non-negative integer');
  if (!isNonNegInt(save.world.restedHours)) {
    fail('world.restedHours', 'must be a non-negative integer');
  }
  const current = save.world.current;
  if (!Number.isInteger(current) || (current as number) < 0 || (current as number) >= data.levels.length) {
    fail('world.current', 'must be a known level index');
  }
  if (save.world.quests !== undefined) {
    const quests = save.world.quests;
    if (!isRecord(quests)) fail('world.quests', 'must be an object');
    if (typeof quests.questId !== 'string' || quests.questId.length === 0) {
      fail('world.quests.questId', 'must be a non-empty string');
    }
    if (typeof quests.done !== 'boolean' || typeof quests.victory !== 'boolean') {
      fail('world.quests', 'done and victory must be booleans');
    }
    if (quests.endingShown !== undefined && typeof quests.endingShown !== 'boolean') {
      fail('world.quests.endingShown', 'must be a boolean');
    }
    if (quests.completed !== undefined && !isRecord(quests.completed)) {
      fail('world.quests.completed', 'must be an object');
    }
    if (quests.journal !== undefined && !Array.isArray(quests.journal)) {
      fail('world.quests.journal', 'must be an array');
    }
    if (quests.pending !== undefined && !Array.isArray(quests.pending)) {
      fail('world.quests.pending', 'must be an array');
    }
  }

  if (!isRecord(save.levels)) fail('levels', 'must be an object');
  const levelKeys = Object.keys(save.levels);
  if (levelKeys.length > data.levels.length) {
    fail('levels', `at most ${data.levels.length} levels fit the level graph`);
  }
  const planes = new Map<number, DecodedPlanes>();
  const validatedLevels: Record<string, SerializedLevel> = {};
  for (const key of levelKeys) {
    const { level, planes: decoded } = validateLevelRecord(key, save.levels[key], data);
    validatedLevels[key] = level;
    planes.set(level.index, decoded);
  }
  if (!planes.has(current as number)) {
    fail('levels', `save does not contain current level ${String(current)}`);
  }
  // The player never shares a cell with an entity on the current level.
  const player = validatePlayer(save.player, data);
  const currentPlanes = planes.get(current as number)!;
  const playerCell = currentPlanes.occupancy[idx(player.x, player.y)] ?? 0;
  if (playerCell !== 0) {
    fail(
      'player position',
      `is occupied by entity ${playerCell} on level ${String(current)} ` +
        '(save was captured mid-bump or is inconsistent)',
    );
  }

  if (save.world.quests !== undefined) {
    validateQuestCollections(save.world.quests as unknown as QuestState, data);
  }

  const inventory = validateInventoryFields(save.inventory, data);

  const file: SaveFile = {
    format: 'cotw-save',
    version: 1,
    meta: {
      savedAt: save.meta.savedAt,
      turn: save.meta.turn as number,
      ...(save.meta.part !== undefined ? { part: save.meta.part } : {}),
    },
    player,
    world: {
      worldSeed: save.world.worldSeed as number,
      current: current as number,
      turn: save.world.turn as number,
      gameplayRngState: save.world.gameplayRngState as number,
      restedHours: save.world.restedHours as number,
      ...(save.world.quests !== undefined
        ? { quests: save.world.quests as unknown as QuestState }
        : {}),
    },
    levels: validatedLevels,
    inventory,
  };
  return { file, planes };
}

// Level import used by callers that build a Level from decoded planes.
export type { Level };
