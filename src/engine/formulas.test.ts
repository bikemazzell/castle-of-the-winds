import { describe, expect, it } from 'vitest';
import {
  DIFFICULTY_XP_MULTIPLIER,
  STAT_MAX,
  STAT_MIN,
  STAT_POOL,
  damageBonus,
  dexArmorBonus,
  hardCarryLimit,
  hpGainOnLevelUp,
  levelForXp,
  manaGainOnLevelUp,
  movementSpeedPercent,
  ratedMaxCarry,
  spellManaCost,
  startingHp,
  startingMana,
  toHitBonus,
  xpThresholdFor,
} from './formulas';

describe('carry capacity (manual: rated max at normal speed, 2x max is the real limit)', () => {
  it('rated max scales with strength', () => {
    // APPROX: strength * 200 grams — strong enough for plate armor (15000 g).
    expect(ratedMaxCarry(50)).toBe(10000);
    expect(ratedMaxCarry(100)).toBe(20000);
    expect(ratedMaxCarry(1)).toBe(200);
  });

  it('hard limit is twice the rated maximum', () => {
    expect(hardCarryLimit(50)).toBe(20000);
  });

  it('movement speed follows the manual breakpoints', () => {
    const rated = ratedMaxCarry(50); // 10000
    expect(movementSpeedPercent(0, rated)).toBe(200); // lightly loaded
    expect(movementSpeedPercent(rated / 2, rated)).toBe(200); // at half: 200%
    expect(movementSpeedPercent(rated, rated)).toBe(100); // at rated: 100%
    expect(movementSpeedPercent(rated * 2, rated)).toBe(50); // at 2x: 50%
    // Linear between breakpoints.
    expect(movementSpeedPercent(rated * 0.75, rated)).toBe(150);
    expect(movementSpeedPercent(rated * 1.5, rated)).toBe(75);
  });
});

describe('per-level gains (manual: high CON -> extra HP, high INT -> extra mana)', () => {
  it('HP gain per level is base + constitution bracket', () => {
    expect(hpGainOnLevelUp(10)).toBe(4);
    expect(hpGainOnLevelUp(50)).toBe(6);
    expect(hpGainOnLevelUp(74)).toBe(6);
    expect(hpGainOnLevelUp(75)).toBe(7);
    expect(hpGainOnLevelUp(100)).toBe(8);
  });

  it('mana gain per level is base + intelligence bracket', () => {
    expect(manaGainOnLevelUp(10)).toBe(2);
    expect(manaGainOnLevelUp(50)).toBe(4);
    expect(hpGainOnLevelUp(75)).toBe(7); // sanity: same bracket shape
    expect(manaGainOnLevelUp(100)).toBe(6);
  });

  it('starting values derive from attributes', () => {
    expect(startingHp(10)).toBe(10);
    expect(startingHp(50)).toBe(12);
    expect(startingHp(100)).toBe(15);
    expect(startingMana(10)).toBe(1);
    expect(startingMana(50)).toBe(5);
    expect(startingMana(100)).toBe(10);
  });
});

describe('combat bonuses (manual: STR damage/carry, DEX to-hit/AV)', () => {
  it('dexterity armor bonus is dex/20', () => {
    expect(dexArmorBonus(0)).toBe(0);
    expect(dexArmorBonus(50)).toBe(2);
    expect(dexArmorBonus(100)).toBe(5);
  });

  it('to-hit and damage bonuses are centered at 50', () => {
    expect(toHitBonus(50)).toBe(0);
    expect(toHitBonus(90)).toBe(4);
    expect(toHitBonus(10)).toBe(-4);
    expect(damageBonus(50)).toBe(0);
    expect(damageBonus(100)).toBe(5);
    expect(damageBonus(1)).toBe(-5);
  });
});

describe('spell mana cost (manual: above-level costs extra, low-level gets cheaper)', () => {
  it('costs base at caster level equal to spell tier', () => {
    expect(spellManaCost(5, 4, 4)).toBe(5); // Fireball at level 4
  });

  it('gets cheaper as the caster levels past the spell tier', () => {
    expect(spellManaCost(5, 4, 8)).toBe(1); // clamped to minimum 1
    expect(spellManaCost(1, 1, 10)).toBe(1);
  });

  it('costs extra when the spell is above the caster level, capped at 3x base', () => {
    expect(spellManaCost(5, 4, 1)).toBe(8);
    expect(spellManaCost(2, 3, 1)).toBe(4);
    expect(spellManaCost(1, 5, 1)).toBe(3); // 1 + 4 = 5 -> capped at 3x1
  });
});

describe('experience and levels', () => {
  const thresholds = [0, 1000, 3000, 6000, 10000];

  it('stat bounds and pool constants', () => {
    expect(STAT_MIN).toBe(1);
    expect(STAT_MAX).toBe(100);
    expect(STAT_POOL).toBe(200);
  });

  it('difficulty multiplies thresholds (manual: harder game needs more xp)', () => {
    expect(DIFFICULTY_XP_MULTIPLIER.intermediate).toBe(1);
    expect(DIFFICULTY_XP_MULTIPLIER.easy).toBeLessThan(1);
    expect(DIFFICULTY_XP_MULTIPLIER.expert).toBeGreaterThan(1);
    expect(xpThresholdFor(3, thresholds, 'intermediate')).toBe(3000);
    expect(xpThresholdFor(3, thresholds, 'easy')).toBe(2250);
    // Level 1 always costs 0 regardless of difficulty.
    expect(xpThresholdFor(1, thresholds, 'expert')).toBe(0);
  });

  it('levelForXp walks thresholds without skipping', () => {
    expect(levelForXp(0, thresholds, 'intermediate')).toBe(1);
    expect(levelForXp(999, thresholds, 'intermediate')).toBe(1);
    expect(levelForXp(1000, thresholds, 'intermediate')).toBe(2);
    expect(levelForXp(2999, thresholds, 'intermediate')).toBe(2);
    expect(levelForXp(3000, thresholds, 'intermediate')).toBe(3);
    expect(levelForXp(999999, thresholds, 'intermediate')).toBe(5); // capped by table
  });
});
