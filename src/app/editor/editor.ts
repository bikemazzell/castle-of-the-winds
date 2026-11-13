/**
 * Transactional save editor (Task 6.2).
 *
 * Every edit batch flows through ONE `applyEdits` call that:
 *  1. validates the input save by fully deserializing it,
 *  2. applies the whole batch to a structuredClone,
 *  3. revalidates the result with deserializeGame before accepting it.
 * On any failure the caller's save object is returned untouched — there is no
 * partial-state path (codex-review requirement).
 *
 * Reconciliation rules:
 *  - attribute / level edits recompute derived hp/mana caps from formulas;
 *    `keepRatio` preserves the current hp/mana fraction, default clamps,
 *    explicit hp/mana edits are validated against the *new* caps;
 *  - position teleports land on a walkable, unoccupied tile; unvisited
 *    levels are generated deterministically from the world seed first;
 *  - world-seed edits discard generated (non-town) levels — they regenerate
 *    from the new seed on demand;
 *  - inventory additions are validated against the items registry and the
 *    hard carry limit (same rules as in-game pickup).
 */
import type { Difficulty, Gender, Player, Systems, WorldData } from '../../engine/types';
import type { SaveFile } from '../../engine/save';
import { b64ToBytes, bytesToB64, deserializeGame, serializeLevelFor } from '../../engine/save';
import {
  STAT_MAX,
  STAT_MIN,
  hpGainOnLevelUp,
  manaGainOnLevelUp,
  startingHp,
  startingMana,
} from '../../engine/formulas';
import { dropItem, pickup } from '../../engine/inventory';
import { findStair, idx, LEVEL_AREA, LEVEL_SIZE, type Level } from '../../engine/map';
import { TILE_STAIRS_DOWN, TILE_STAIRS_UP } from '../../engine/dungeon';
import { ensureLevel, type World } from '../../engine/world';
import { loadWorldData } from '../../engine/game';

export interface EditorContext {
  data: WorldData;
  systems?: Systems;
}

export type EditResult = { ok: true; save: SaveFile } | { ok: false; error: string };

export interface CharacterEdits {
  name?: string;
  gender?: Gender;
  strength?: number;
  intelligence?: number;
  constitution?: number;
  dexterity?: number;
  level?: number;
  experience?: number;
  /** Difficulty rides along in the character section. */
  difficulty?: Difficulty;
  /** Explicit hp, validated 1..maxHp after cap recompute. */
  hp?: number;
  /** Explicit mana, validated 0..maxMana after cap recompute. */
  mana?: number;
  /** Preserve hp/mana fractions when caps change (default: clamp). */
  keepRatio?: boolean;
  /** Replace the known-spell list; ids validated against the spell registry. */
  knownSpells?: string[];
}

export interface InventoryEdits {
  add?: { defId: string; count?: number }[];
  remove?: { uid: string; count?: number }[];
  gold?: number;
}

export interface PositionEdits {
  /** Target level index (0 = town). */
  level: number;
  /** Explicit destination; omitted → stairs / first free walkable tile. */
  x?: number;
  y?: number;
  /** Fully reveal the target level's map memory. */
  revealMap?: boolean;
}

export interface SaveEdits {
  character?: CharacterEdits;
  inventory?: InventoryEdits;
  position?: PositionEdits;
  /** New world seed (uint32). Discards generated levels; pair with a position edit when standing in the dungeon. */
  worldSeed?: number;
}

const GENDERS = new Set<Gender>(['male', 'female']);
const DIFFICULTIES = new Set<Difficulty>(['easy', 'intermediate', 'difficult', 'expert']);
const STATS = ['strength', 'intelligence', 'constitution', 'dexterity'] as const;
type StatKey = (typeof STATS)[number];

function fail(error: string): EditResult {
  return { ok: false, error };
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function applyCharacterEdits(player: Player, edits: CharacterEdits): string | null {
  if (edits.name !== undefined) {
    const name = edits.name.trim();
    if (name.length < 1 || name.length > 24) return `name must be 1-24 characters`;
    player.name = name;
  }
  if (edits.gender !== undefined) {
    if (!GENDERS.has(edits.gender)) return `unknown gender '${String(edits.gender)}'`;
    player.gender = edits.gender;
  }
  for (const stat of STATS) {
    const value = edits[stat];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < STAT_MIN || value > STAT_MAX) {
      return `${stat} must be an integer between ${STAT_MIN} and ${STAT_MAX}`;
    }
    player[stat] = value;
    if (player[`max${stat[0]!.toUpperCase()}${stat.slice(1)}` as `max${Capitalize<StatKey>}`] < value) {
      (player as unknown as Record<string, number>)[
        `max${stat[0]!.toUpperCase()}${stat.slice(1)}`
      ] = value;
    }
  }
  if (edits.level !== undefined) {
    if (!Number.isInteger(edits.level) || edits.level < 1 || edits.level > 99) {
      return 'level must be an integer between 1 and 99';
    }
    player.level = edits.level;
  }
  if (edits.experience !== undefined) {
    if (!Number.isInteger(edits.experience) || edits.experience < 0) {
      return 'experience must be a non-negative integer';
    }
    player.experience = edits.experience;
  }
  // Derived-cap reconciliation (always recomputed — idempotent).
  const oldMaxHp = Math.max(1, player.maxHp);
  const oldMaxMana = Math.max(1, player.maxMana);
  const newMaxHp = startingHp(player.constitution) + (player.level - 1) * hpGainOnLevelUp(player.constitution);
  const newMaxMana =
    startingMana(player.intelligence) + (player.level - 1) * manaGainOnLevelUp(player.intelligence);
  player.maxHp = newMaxHp;
  player.maxMana = newMaxMana;
  if (edits.keepRatio) {
    player.hp = Math.max(1, Math.min(newMaxHp, Math.round((player.hp / oldMaxHp) * newMaxHp)));
    player.mana = Math.max(0, Math.min(newMaxMana, Math.round((player.mana / oldMaxMana) * newMaxMana)));
  } else {
    player.hp = Math.max(1, Math.min(newMaxHp, player.hp));
    player.mana = Math.max(0, Math.min(newMaxMana, player.mana));
  }
  if (edits.hp !== undefined) {
    if (!Number.isInteger(edits.hp) || edits.hp < 1 || edits.hp > newMaxHp) {
      return `hp must be between 1 and ${newMaxHp}`;
    }
    player.hp = edits.hp;
  }
  if (edits.mana !== undefined) {
    if (!Number.isInteger(edits.mana) || edits.mana < 0 || edits.mana > newMaxMana) {
      return `mana must be between 0 and ${newMaxMana}`;
    }
    player.mana = edits.mana;
  }
  return null;
}

function applyInventoryEdits(
  save: SaveFile,
  edits: InventoryEdits,
  data: WorldData,
): string | null {
  if (edits.gold !== undefined) {
    if (!Number.isInteger(edits.gold) || edits.gold < 0) return 'gold must be a non-negative integer';
    save.inventory.gold = edits.gold;
  }
  for (const add of edits.add ?? []) {
    const count = add.count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 99) {
      return `add count for '${add.defId}' must be 1-99`;
    }
    if (!data.items[add.defId]) return `unknown item definition '${add.defId}'`;
    try {
      // Same rules as in-game pickup: stacking, uid sequencing, hard carry limit.
      pickup(save.inventory, save.player, add.defId, data.items, count);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  for (const remove of edits.remove ?? []) {
    const entry = save.inventory.pack.find((i) => i.uid === remove.uid);
    if (!entry) return `unknown item uid '${remove.uid}' (equipped items must be unequipped in game first)`;
    try {
      dropItem(save.inventory, remove.uid, remove.count);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  return null;
}

/** Ensure draft.levels contains `index`, generating it deterministically when missing. */
function ensureDraftLevel(
  draft: SaveFile,
  working: World,
  index: number,
  _data: WorldData,
): string | null {
  if (draft.levels[String(index)]) return null;
  const level = ensureLevel(working, index);
  const seen = working.seen.get(index) ?? new Uint8Array(LEVEL_AREA);
  draft.levels[String(index)] = serializeLevelFor(level, seen);
  return null;
}

function firstWalkableFree(level: Level, data: WorldData): { x: number; y: number } | null {
  for (let y = 0; y < LEVEL_SIZE; y++) {
    for (let x = 0; x < LEVEL_SIZE; x++) {
      const tile = level.tiles[idx(x, y)]!;
      if (!data.tiles[String(tile)]?.walkable) continue;
      if (level.occupancy[idx(x, y)] !== 0) continue;
      return { x, y };
    }
  }
  return null;
}

function applyPositionEdits(
  draft: SaveFile,
  working: World,
  edits: PositionEdits,
  ctx: EditorContext,
): string | null {
  const { data } = ctx;
  if (!Number.isInteger(edits.level) || edits.level < 0 || edits.level >= data.levels.length) {
    return `level must be between 0 and ${data.levels.length - 1}`;
  }
  if (edits.x !== undefined && (!Number.isInteger(edits.x) || edits.x < 0 || edits.x >= LEVEL_SIZE)) {
    return `x must be between 0 and ${LEVEL_SIZE - 1}`;
  }
  if (edits.y !== undefined && (!Number.isInteger(edits.y) || edits.y < 0 || edits.y >= LEVEL_SIZE)) {
    return `y must be between 0 and ${LEVEL_SIZE - 1}`;
  }
  const err = ensureDraftLevel(draft, working, edits.level, data);
  if (err) return err;
  const stored = draft.levels[String(edits.level)]!;
  const tiles = b64ToBytes(stored.tilesB64);
  const occupancy = b64ToBytes(stored.occupancyB64);

  let dest: { x: number; y: number };
  if (edits.x !== undefined && edits.y !== undefined) {
    dest = { x: edits.x, y: edits.y };
  } else if (edits.level === 0) {
    dest = { ...data.town.spawn };
  } else {
    const level = working.levels.get(edits.level);
    const stair =
      (level && findStair(level, TILE_STAIRS_UP)) ??
      (level && findStair(level, TILE_STAIRS_DOWN));
    dest = stair ?? firstWalkableFree(
      { index: edits.level, tiles, flags: b64ToBytes(stored.flagsB64), occupancy, entities: new Map() },
      data,
    ) ?? { x: -1, y: -1 };
    if (dest.x < 0) return `level ${edits.level} has no free walkable tile`;
  }
  const at = idx(dest.x, dest.y);
  const tile = tiles[at]!;
  if (!data.tiles[String(tile)]?.walkable) {
    return `(${dest.x}, ${dest.y}) is not walkable on level ${edits.level}`;
  }
  if (occupancy[at] !== 0) {
    return `(${dest.x}, ${dest.y}) is occupied on level ${edits.level}`;
  }
  draft.player.x = dest.x;
  draft.player.y = dest.y;
  draft.world.current = edits.level;
  if (edits.revealMap) {
    stored.seenB64 = seenAll();
  }
  return null;
}

let cachedAllSeen = '';
function seenAll(): string {
  if (!cachedAllSeen) {
    const bytes = new Uint8Array(LEVEL_AREA).fill(1);
    cachedAllSeen = bytesToB64(bytes);
  }
  return cachedAllSeen;
}

/**
 * Apply one atomic edit batch. Returns a new SaveFile on success; the input
 * save is never mutated.
 */
export function applyEdits(save: SaveFile, edits: SaveEdits, ctx: EditorContext): EditResult {
  // PART2-PLAN Task P5: resolve the bundle by meta.part FIRST so a part-2
  // save edits correctly even if the caller passed the wrong context data.
  const data = save.meta?.part === 2 && ctx.data.part !== 2 ? loadWorldData(2) : ctx.data;
  const editCtx: EditorContext = data === ctx.data ? ctx : { ...ctx, data };
  // 1. The input must itself be loadable.
  let working: World;
  try {
    working = deserializeGame(save, editCtx.data, editCtx.systems);
  } catch (error) {
    return fail(`save is not loadable: ${error instanceof Error ? error.message : String(error)}`);
  }

  const draft: SaveFile = structuredClone(save);
  const wantsSeedChange =
    edits.worldSeed !== undefined && edits.worldSeed !== save.world.worldSeed;
  if (edits.worldSeed !== undefined && !isUint32(edits.worldSeed)) {
    return fail('worldSeed must be an integer between 0 and 4294967295');
  }

  // 2. Character edits + cap reconciliation.
  if (edits.character) {
    const err = applyCharacterEdits(draft.player, edits.character);
    if (err) return fail(err);
  }
  // Difficulty rides along in the character section.
  const diff = (edits.character)?.difficulty;
  if (diff !== undefined) {
    if (!DIFFICULTIES.has(diff)) return fail(`unknown difficulty '${String(diff)}'`);
    draft.player.difficulty = diff;
  }
  // Known spells ride along too (validated against the registry).
  const spells = (edits.character)?.knownSpells;
  if (spells !== undefined) {
    if (!Array.isArray(spells) || spells.some((s) => typeof s !== 'string')) {
      return fail('knownSpells must be an array of spell ids');
    }
    const registry = editCtx.data.spells;
    const unknown = spells.filter((s) => !registry || !(s in registry));
    if (unknown.length > 0) return fail(`unknown spell id(s): ${unknown.join(', ')}`);
    draft.player.knownSpells = [...new Set(spells)];
  }

  // 3. Inventory edits (carry limits enforced via engine pickup).
  if (edits.inventory) {
    const err = applyInventoryEdits(draft, edits.inventory, editCtx.data);
    if (err) return fail(err);
  }

  // 4. World seed: discard generated levels; rebuild the working world with
  //    the new seed so later position edits generate from it. The rebuild is
  //    UNCONDITIONAL: when the save stands in town with the town level already
  //    present, skipping it left `working` on the OLD seed, so position edits
  //    silently generated levels from the previous seed while the save claimed
  //    the new one (F19). Town bytes are seed-independent (fixed layout), so
  //    reusing them under the new seed is correct.
  if (wantsSeedChange) {
    const inDungeon = draft.world.current > 0;
    if (inDungeon && edits.position === undefined) {
      return fail('changing the seed discards the current dungeon level; add a position edit');
    }
    draft.world.worldSeed = edits.worldSeed!;
    for (const key of Object.keys(draft.levels)) {
      if (Number(key) > 0) delete draft.levels[key];
    }
    const town = draft.levels['0'] ?? serializeLevelFor(
      ensureLevel(working, 0),
      working.seen.get(0) ?? new Uint8Array(LEVEL_AREA),
    );
    const boot: SaveFile = {
      ...structuredClone(draft),
      levels: { 0: structuredClone(town) },
      world: { ...draft.world, current: 0 },
      player: { ...draft.player, x: editCtx.data.town.spawn.x, y: editCtx.data.town.spawn.y },
    };
    try {
      working = deserializeGame(boot, editCtx.data, editCtx.systems);
    } catch (error) {
      return fail(`seed change rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!draft.levels['0']) draft.levels['0'] = town;
  }

  // 5. Position edits (may generate unvisited levels from the working seed).
  if (edits.position) {
    const err = applyPositionEdits(draft, working, edits.position, ctx);
    if (err) return fail(err);
  }

  // 6. Whole-file revalidation — the accept gate.
  try {
    deserializeGame(draft, editCtx.data, editCtx.systems);
  } catch (error) {
    return fail(`edited save rejected: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ok: true, save: draft };
}

export type { Difficulty, Gender, Player };
