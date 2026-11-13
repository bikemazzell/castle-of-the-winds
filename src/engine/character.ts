// Character sheet lifecycle: creation, experience/level-ups, natural regen.
// Level gains and regen rates follow manual topics 289-296 (qualitative) with
// APPROX constants from formulas.ts (exact originals unrecoverable —
// docs/EXTRACTION-GAPS.md #1).
import {
  HP_TURNS_PER_POINT,
  MANA_TURNS_PER_POINT,
  STAT_MAX,
  STAT_MIN,
  STAT_POOL,
  hpGainOnLevelUp,
  manaGainOnLevelUp,
  startingHp,
  startingMana,
  xpThresholdFor,
} from './formulas';
import type { Difficulty, Gender, Player } from './types';

export interface CharacterInit {
  name: string;
  gender: Gender;
  strength: number;
  intelligence: number;
  constitution: number;
  dexterity: number;
  difficulty: Difficulty;
}

/**
 * Creates a level-1 character. Stats must be within [STAT_MIN, STAT_MAX] and
 * sum to at most STAT_POOL (the creation dialog distributes a fixed pool).
 * Hit points start at startingHp(con), mana at startingMana(int).
 */
export function createCharacter(init: CharacterInit): Player {
  const stats = {
    strength: init.strength,
    intelligence: init.intelligence,
    constitution: init.constitution,
    dexterity: init.dexterity,
  };
  for (const [key, value] of Object.entries(stats)) {
    if (!Number.isInteger(value) || value < STAT_MIN || value > STAT_MAX) {
      throw new Error(
        `${key} must be an integer in [${STAT_MIN}, ${STAT_MAX}], got ${String(value)}`,
      );
    }
  }
  const sum =
    stats.strength + stats.intelligence + stats.constitution + stats.dexterity;
  if (sum > STAT_POOL) {
    throw new Error(`stat pool exceeded: ${sum} > ${STAT_POOL}`);
  }
  const maxHp = startingHp(stats.constitution);
  const maxMana = startingMana(stats.intelligence);
  return {
    name: init.name,
    gender: init.gender,
    x: 0,
    y: 0,
    level: 1,
    experience: 0,
    hp: maxHp,
    maxHp,
    mana: maxMana,
    maxMana,
    strength: stats.strength,
    intelligence: stats.intelligence,
    constitution: stats.constitution,
    dexterity: stats.dexterity,
    maxStrength: stats.strength,
    maxIntelligence: stats.intelligence,
    maxConstitution: stats.constitution,
    maxDexterity: stats.dexterity,
    difficulty: init.difficulty,
    knownSpells: [],
    statuses: [],
    regen: { hpTicks: 0, manaTicks: 0 },
  };
}

/**
 * Adds experience and applies level-ups one threshold at a time (manual 289:
 * each level adds hit points, mana, spells; mana is restored on level-up per
 * topic 296). Per-level gains use the character's max attributes so drained
 * current attributes do not permanently reduce growth.
 */
export function gainExperience(p: Player, amount: number, thresholds: number[]): number {
  if (amount < 0) throw new Error('use drainExperience for xp loss');
  p.experience += amount;
  let levels = 0;
  while (
    p.level < thresholds.length &&
    p.experience >= xpThresholdFor(p.level + 1, thresholds, p.difficulty)
  ) {
    p.level += 1;
    levels += 1;
    p.maxHp += hpGainOnLevelUp(p.maxConstitution);
    p.maxMana += manaGainOnLevelUp(p.maxIntelligence);
    p.mana = p.maxMana; // manual 296: mana restored on level-up
  }
  return levels;
}

/**
 * Natural regeneration per elapsed turn (manual 295/296: ~1 hp per minute,
 * ~1 mana per hour). With TURNS_PER_HOUR = 360 that is one hp every 6 turns
 * and one mana every 360 turns. Remainders accumulate across calls.
 */
export function tickRegen(p: Player, turns = 1): void {
  if (turns <= 0) return;
  p.regen.hpTicks += turns;
  p.regen.manaTicks += turns;
  const hpGain = Math.floor(p.regen.hpTicks / HP_TURNS_PER_POINT);
  if (hpGain > 0) {
    p.regen.hpTicks -= hpGain * HP_TURNS_PER_POINT;
    p.hp = Math.min(p.maxHp, p.hp + hpGain);
  }
  const manaGain = Math.floor(p.regen.manaTicks / MANA_TURNS_PER_POINT);
  if (manaGain > 0) {
    p.regen.manaTicks -= manaGain * MANA_TURNS_PER_POINT;
    p.mana = Math.min(p.maxMana, p.mana + manaGain);
  }
}
