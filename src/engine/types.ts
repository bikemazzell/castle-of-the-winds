// Shared data shapes for extracted game tables.
// Pure types only — runtime validation lives in src/data/table-contract.ts,
// engine-side approximation adapters live in src/engine/items.ts|monsters.ts|spells.ts.

/** Provenance block required in every extracted data file. */
export interface SourceProvenance {
  /** Original file name, e.g. 'CASTLE1.EXE'. */
  exe: string;
  /** SHA-256 hex (64 chars) of the source file. */
  sha256: string;
  /** File offset of the source table when it is a contiguous blob. */
  tableOffset?: number;
  /** Version tag of the decoder that produced this file. */
  decoderVersion: string;
}

/** A field the extractor could not recover. Reasons must reference recon notes / EXTRACTION-GAPS.md. */
export interface TableGap {
  /** Field name from the contract, e.g. 'weight'. */
  field: string;
  /** Why it is missing. */
  reason: string;
  /** Record ids missing the field. Omit for a table-wide gap. */
  records?: string[];
}

/** Envelope shared by items.json / monsters.json / spells.json. */
export interface TableEnvelope<R> {
  version: number;
  source: SourceProvenance;
  records: R[];
  gaps: TableGap[];
  /**
   * Optional machine-check binding the file to the pointer-table walk:
   * records.length must equal expectedCount exactly (no magic ranges).
   */
  expectedCount?: number;
}

/** Item as extracted. Stat fields may be absent when covered by a gap entry. */
export interface ItemRecord {
  id: string;
  name: string;
  kind?: string;
  weight?: number;
  value?: number;
  /** Dice notation for weapons, e.g. '2d6'. */
  damage?: string;
  /** AC bonus for wearable pieces (positive = better). */
  armorClass?: number;
  /** Weapon Class (higher class = more damage; original uses classes, not dice). */
  weaponClass?: number;
  notes?: string;
}

/** Monster as extracted. */
export interface MonsterRecord {
  id: string;
  name: string;
  hp?: number;
  ac?: number;
  damage?: string;
  speed?: number;
  xp?: number;
  /** Item ids that can drop on death. */
  drops?: string[];
  notes?: string;
}

/** Spell as extracted. */
export interface SpellRecord {
  id: string;
  name: string;
  manaCost?: number;
  target?: 'self' | 'enemy' | 'tile' | (string & {});
  /** Free-form effect descriptor, e.g. 'damage 1d3+1', 'light radius 2'. */
  effect?: string;
  tier?: number;
  notes?: string;
}

export type ItemsFile = TableEnvelope<ItemRecord>;
export type MonstersFile = TableEnvelope<MonsterRecord>;
export type SpellsFile = TableEnvelope<SpellRecord>;

// ─── Engine runtime types (Milestone 2+) ────────────────────────────────────

import type { SpellDefRuntime } from './spells';

export type UnderwearColor = 'blue' | 'red' | 'green' | 'purple';
export type ItemColor = UnderwearColor | 'silver' | 'gold';

export type Gender = 'male' | 'female';
export type Difficulty = 'easy' | 'intermediate' | 'difficult' | 'expert';

/** Timed magical states (Task 3.4). Poison magnitude doubles as tick accumulator. */
export type StatusKind =
  | 'drunken' | 'stimulated' | 'crash' | 'hallucination' | 'sedated'
  | 'poison'
  | 'shield'
  | 'resist_fire'
  | 'resist_cold'
  | 'resist_lightning'
  | 'light'
  | 'levitation'
  | 'detect_traps'
  | 'detect_objects'
  | 'detect_monsters';

export interface Status {
  kind: StatusKind;
  remainingTurns: number;
  /** Shield: AV bonus. Poison: accumulated tick fraction. */
  magnitude?: number;
}

/**
 * The player character (Task 3.1). Attributes are tracked as current + max
 * because magic items can push current above or below max (manual topic 287).
 * There are no classes in Castle of the Winds — the sheet is stats-driven.
 */
export interface Player {
  name: string;
  gender: Gender;
  underwearColor?: UnderwearColor;
  x: number;
  y: number;
  level: number;
  experience: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  strength: number;
  intelligence: number;
  constitution: number;
  dexterity: number;
  maxStrength: number;
  maxIntelligence: number;
  maxConstitution: number;
  maxDexterity: number;
  difficulty: Difficulty;
  /** Learned spell ids (scrolls teach spells — manual 315 "first 10 you learn"). */
  knownSpells: string[];
  /** Active timed states (Task 3.4). */
  statuses: Status[];
  /** Regen accumulators: turn fractions toward the next hp/mana point. */
  regen: { hpTicks: number; manaTicks: number };
}

/** Level graph node as curated in levels.json (subset the engine reads). */
export interface LevelNodeLite {
  index: number;
  name: string;
  kind: string;
  links: {
    down: number | null;
    up: number | null;
    special?: { kind: string; to: number } | null;
  };
}

/** Static world data: level graph, town layout, tile properties. */
export interface WorldData {
  /** Which game this data drives; saves record it (absent = 1). */
  part: 1 | 2;
  levels: LevelNodeLite[];
  town: {
    rows: string[]; // hex, 2 chars per tile
    spawn: { x: number; y: number };
    mineEntrance: { x: number; y: number };
  };
  /** Keyed by tile id as string (JSON shape). */
  tiles: Record<string, { walkable: boolean }>;
  /** Item definitions keyed by items.json record id (Task 3.2). */
  items: Record<string, ItemDefRuntime>;
  /** Spell definitions keyed by spells.json record id (Task 3.3/3.4). */
  spells: Record<string, SpellDefRuntime>;
  /** XP thresholds (xp.json); combat kill awards use this. Optional for tests. */
  xpThresholds?: XpThresholds;
  /** Monster roster (monsters.json records) for spawning. Optional for tests. */
  monsters?: { id: string; name: string }[];
  /** Quest definitions (quests.json). Optional for tests. */
  quests?: import('./quests').QuestDef[];
  /** Story texts keyed by resource id (story.json). Optional for tests. */
  story?: Record<string, string>;
}

export interface LogEntry {
  turn: number;
  text: string;
}

// ─── Combat (Task 4.1) ──────────────────────────────────────────────────────

/** Breath elements (original damage-type strings 370–374). */
export type BreathElement = 'fire' | 'cold' | 'lightning' | 'acid' | 'poison_gas';

/**
 * APPROX monster stat block. The original runtime-built stat tables were not
 * recoverable (EXTRACTION-GAPS.md #1); combat.ts derives these from the
 * monster's name tier until disasm recovers the real values.
 */
export interface MonsterCombatStats {
  maxHp: number;
  /** Defense value; attacks hit when roll + toHit ≥ 10 + ac. */
  ac: number;
  toHit: number;
  damage: { count: number; sides: number; bonus: number };
  /** Acts every N turns (1 = every turn). */
  speed: number;
  xp: number;
  breath?: { element: BreathElement; dieSides: number; /** 1-in-N chance per turn. */ every: number };
  /** Part-2 bosses: spell element that deals ×1.5 (rounded up). */
  vulnerableElement?: BreathElement;
  /** Part-2 bosses: spell element that deals 0 damage. */
  immuneElement?: BreathElement;
}

/** Per-entity combat state attached to monster entities. */
export interface MonsterState {
  hp: number;
  maxHp: number;
  stats: MonsterCombatStats;
  /** AI: has noticed the player (Task 4.2). */
  alert?: boolean;
  /** Turns until the monster acts again (speed/slow bookkeeping). */
  timer?: number;
  /** Enchanted sleep (Sleep Monster): turns remaining; attacks wake it. */
  sleepTurns?: number;
  /** Slow Monster stacks: acts every speed × denominator turns. */
  slowDenominator?: number;
}

/** Optional XP thresholds (xp.json) for combat kills; [] keeps level 1. */
export type XpThresholds = number[];

// ─── Traps & secret doors (Task 4.3) ────────────────────────────────────────

/** Trap kinds — names follow the original trap strings ("A pit", "A blade trap"…). */
export type TrapKind =
  | 'pit'
  | 'trap_door'
  | 'dart'
  | 'blade'
  | 'fire'
  | 'acid'
  | 'gas'
  | 'poison'
  | 'teleport';

/** A dungeon trap. Hidden until detected, sprung, disarmed or searched. */
export interface TrapState {
  id: string;
  kind: TrapKind;
  x: number;
  y: number;
  known: boolean;
}

/** A secret door: a wall cell hiding a passage until revealed. */
export interface DoorState {
  x: number;
  y: number;
  secret: boolean;
  found: boolean;
}

// ─── Items & inventory (Task 3.2) ───────────────────────────────────────────

/** Equipment slots (original also has belt/ready-hand — M3.4 extension). */
export type EquipSlot =
  | 'weapon'
  | 'shield'
  | 'armor'
  | 'helm'
  | 'boots'
  | 'gauntlets'
  | 'bracers'
  | 'cloak'
  | 'ring1'
  | 'ring2'
  | 'amulet';

/** Runtime item instance (stack of a definition + per-instance state). */
export interface InventoryItem {
  color?: ItemColor;
  /** Runtime-unique id (save-stable). */
  uid: string;
  /** items.json record id. */
  defId: string;
  /** Stack size (potions, scrolls…). */
  count: number;
  /** Wand/staff charges (M3.4). */
  charges?: number;
  /** Light-source fuel in turns (torches/lanterns; burns down per turn). */
  fuelTurns?: number;
}

export type Equipment = Partial<Record<EquipSlot, InventoryItem>>;

export interface Inventory {
  /** Carried-but-not-equipped items (APPROX list model for original slots/containers). */
  pack: InventoryItem[];
  /** Copper pieces. */
  gold: number;
  equipment: Equipment;
  /** Monotonic uid sequence (serialized so post-load uids never collide). */
  seq: number;
}

/** Runtime view of an items.json record (adapter output, see engine/items.ts). */
export interface ItemDefRuntime {
  description?: string;
  price?: number;
  id: string;
  name: string;
  kind: string;
  weightGrams?: number;
  armorClass?: number;
  weaponClass?: number;
  /** Which equip slot this item fits, null if not equippable. */
  slot: EquipSlot | null;
  /** Stackable consumables (potions, scrolls). */
  stackable: boolean;
  /** Consumed on use. */
  consumable: boolean;
}

/** Result of activating an item. */
export interface UseEffect {
  consumed: boolean;
  message?: string;
}

/**
 * Narrow effect interface — stubs now (Task 3.2), real potion/scroll/light
 * effects land in Task 3.3/3.4.
 */
export interface EffectSystem {
  onUse(world: unknown, item: InventoryItem, def: ItemDefRuntime): UseEffect | null;
  onEquip?(world: unknown, item: InventoryItem, def: ItemDefRuntime): void;
  onUnequip?(world: unknown, item: InventoryItem, def: ItemDefRuntime): void;
}

/** Narrow system interfaces — stubs now, real implementations in M3/M4. */
export interface MonsterSystem {
  takeTurns(world: unknown): void;
}

export interface TrapSystem {
  onTurn(world: unknown): void;
  onPlayerEnter(world: unknown, x: number, y: number): string | null;
}

export interface StatusSystem {
  /** Per-turn status ticking (poison, regen timers…). M4. */
  tick(world: unknown): void;
  /** One rest hour: mana +2/hour (CHANGES.DOC v1.1). */
  restHour(world: unknown): void;
}

export interface Systems {
  monsters: MonsterSystem;
  traps: TrapSystem;
  status: StatusSystem;
  effects: EffectSystem;
}
