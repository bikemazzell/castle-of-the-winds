// Character derived-stat formulas.
//
// Sources:
// - Castle of the Winds Part One manual (CASTLE1.HLP, topics 22 Statistics,
//   47 Glossary, 49 Spells) for qualitative behavior.
// - Exact numeric formulas were NOT recoverable from the binary
//   (docs/EXTRACTION-GAPS.md #1: stats built at runtime) — every constant
//   below marked APPROX is a bounded approximation documented in
//   docs/PLAN.md Task 3.1 and tunable in one place.
import type { Difficulty } from './types';

// ─── Attribute bounds ───────────────────────────────────────────────────────

/** Manual topic 22: statistics measured on a scale of 1-100. */
export const STAT_MIN = 1;
export const STAT_MAX = 100;
/** APPROX: point pool for character creation (default even split 50/50/50/50). */
export const STAT_POOL = 200;

export type DifficultyKey = Difficulty;

/** APPROX multipliers — manual: harder games "need more experience". */
export const DIFFICULTY_XP_MULTIPLIER: Record<Difficulty, number> = {
  easy: 0.75,
  intermediate: 1,
  difficult: 1.25,
  expert: 1.5,
};

// ─── Carry capacity & movement speed (manual topics 291/294) ────────────────

/** APPROX: rated maximum carry in grams = strength * 200. */
export function ratedMaxCarry(strength: number): number {
  return strength * 200;
}

/** Manual: twice the rated maximum is "the real limit on what you can carry". */
export function hardCarryLimit(strength: number): number {
  return ratedMaxCarry(strength) * 2;
}

/**
 * Movement speed percent from carried weight (manual topic 294):
 * <= rated/2 -> 200%, at rated -> 100%, at 2x rated -> 50% (linear between).
 */
export function movementSpeedPercent(weightGrams: number, ratedMax: number): number {
  if (weightGrams <= ratedMax / 2) return 200;
  if (weightGrams <= ratedMax) {
    return Math.round(200 - (100 * (weightGrams - ratedMax / 2)) / (ratedMax / 2));
  }
  if (weightGrams <= ratedMax * 2) {
    return Math.round(100 - (50 * (weightGrams - ratedMax)) / ratedMax);
  }
  return 50;
}

// ─── Per-level gains (manual topics 289/295/296) ────────────────────────────

/** APPROX: 4 base + one extra per 25 points of constitution. */
export function hpGainOnLevelUp(constitution: number): number {
  return 4 + Math.floor(constitution / 25);
}

/** APPROX: 2 base + one extra per 25 points of intelligence. */
export function manaGainOnLevelUp(intelligence: number): number {
  return 2 + Math.floor(intelligence / 25);
}

/** APPROX starting hit points: 10 + constitution bracket. */
export function startingHp(constitution: number): number {
  return 10 + Math.floor(constitution / 20);
}

/** APPROX starting mana: intelligence / 10. */
export function startingMana(intelligence: number): number {
  return Math.floor(intelligence / 10);
}

// ─── Combat bonuses (manual glossary 467-471) ───────────────────────────────

/** APPROX: dexterity improves AV — dex/20 (0..5 at 1..100). */
export function dexArmorBonus(dexterity: number): number {
  return Math.floor(dexterity / 20);
}

/** APPROX: to-hit bonus centered at dexterity 50. */
export function toHitBonus(dexterity: number): number {
  return Math.floor((dexterity - 50) / 10);
}

/** APPROX: damage bonus centered at strength 50. */
export function damageBonus(strength: number): number {
  return Math.floor((strength - 50) / 10);
}

// ─── Spell costs (manual topic 296) ─────────────────────────────────────────

/**
 * Mana cost of a spell for a given caster (manual topic 296: "mana required
 * for a spell decreases as you go up in level. Casting a spell that is more
 * powerful than you can normally handle requires extra mana").
 * APPROX: base + (tier - casterLevel), clamped to [1, 3 * base].
 */
export function spellManaCost(baseMana: number, tier: number, casterLevel: number): number {
  return Math.max(1, Math.min(baseMana * 3, baseMana + tier - casterLevel));
}

// ─── Experience & leveling ──────────────────────────────────────────────────

/** Turn periods for natural regen (see character.ts tickRegen). */
export const HP_TURNS_PER_POINT = 6; // manual: ~1 hp per minute, 360 turns/hour
export const MANA_TURNS_PER_POINT = 360; // manual: ~1 mana per hour

/**
 * XP required to BE at `level` (1-based). `thresholds` is the xp table
 * (thresholds[0] === 0 for level 1). Difficulty scales the requirement.
 */
export function xpThresholdFor(level: number, thresholds: number[], difficulty: Difficulty): number {
  const idx = Math.max(0, Math.min(thresholds.length - 1, level - 1));
  return Math.round(thresholds[idx]! * DIFFICULTY_XP_MULTIPLIER[difficulty]);
}

/**
 * Highest level whose threshold the xp total satisfies (sequential walk,
 * no skipping; capped by table length).
 */
export function levelForXp(xp: number, thresholds: number[], difficulty: Difficulty): number {
  let level = 1;
  while (level < thresholds.length && xp >= xpThresholdFor(level + 1, thresholds, difficulty)) {
    level += 1;
  }
  return level;
}
