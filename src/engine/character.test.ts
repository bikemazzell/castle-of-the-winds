import { describe, expect, it } from 'vitest';
import { HP_TURNS_PER_POINT } from './formulas';
import { createCharacter, gainExperience, tickRegen } from './character';
import type { CharacterInit } from './character';

const base: CharacterInit = {
  name: 'Testa',
  gender: 'female',
  strength: 50,
  intelligence: 50,
  constitution: 50,
  dexterity: 50,
  difficulty: 'intermediate',
};

const thresholds = [0, 1000, 3000, 6000, 10000];

describe('createCharacter', () => {
  it('creates a level-1 character with derived starting pools', () => {
    const c = createCharacter(base);
    expect(c.level).toBe(1);
    expect(c.experience).toBe(0);
    expect(c.maxHp).toBe(12); // 10 + floor(50/20)
    expect(c.hp).toBe(12);
    expect(c.maxMana).toBe(5); // floor(50/10)
    expect(c.mana).toBe(5);
    expect(c.maxStrength).toBe(50);
    expect(c.difficulty).toBe('intermediate');
  });

  it('rejects out-of-range attributes', () => {
    expect(() => createCharacter({ ...base, strength: 0 })).toThrow(/strength/);
    expect(() => createCharacter({ ...base, dexterity: 101 })).toThrow(/dexterity/);
    expect(() => createCharacter({ ...base, constitution: 1.5 })).toThrow(/constitution/);
  });

  it('rejects stat pools above the cap', () => {
    expect(() => createCharacter({ ...base, strength: 100, intelligence: 100 })).toThrow(
      /pool/,
    );
    // A legal heavy split.
    expect(() =>
      createCharacter({ ...base, strength: 100, intelligence: 20, constitution: 40, dexterity: 40 }),
    ).not.toThrow();
  });
});

describe('gainExperience', () => {
  it('grants no level before the first threshold', () => {
    const c = createCharacter(base);
    expect(gainExperience(c, 999, thresholds)).toBe(0);
    expect(c.level).toBe(1);
  });

  it('levels sequentially without skipping thresholds', () => {
    const c = createCharacter(base);
    const levels = gainExperience(c, 3000, thresholds);
    expect(levels).toBe(2); // 1000 and 3000 both crossed
    expect(c.level).toBe(3);
  });

  it('level-ups grow maxHp/maxMana and restore mana (manual 296)', () => {
    const c = createCharacter(base);
    c.mana = 1;
    c.hp = 3;
    gainExperience(c, 1000, thresholds);
    expect(c.level).toBe(2);
    expect(c.maxHp).toBe(12 + 6); // hpGainOnLevelUp(50) = 6
    expect(c.maxMana).toBe(5 + 4); // manaGainOnLevelUp(50) = 4
    expect(c.mana).toBe(9); // restored to full
    expect(c.hp).toBe(3); // hp not restored by leveling
  });

  it('respects difficulty multipliers', () => {
    const easy = createCharacter({ ...base, difficulty: 'easy' });
    gainExperience(easy, 750, thresholds); // 750 >= 0.75 * 1000
    expect(easy.level).toBe(2);

    const expert = createCharacter({ ...base, difficulty: 'expert' });
    gainExperience(expert, 1000, thresholds); // 1000 < 1.5 * 1000
    expect(expert.level).toBe(1);
  });

  it('caps at the table length and rejects negative amounts', () => {
    const c = createCharacter(base);
    gainExperience(c, 1_000_000, thresholds);
    expect(c.level).toBe(thresholds.length);
    expect(() => gainExperience(c, -5, thresholds)).toThrow(/drainExperience/);
  });
});

describe('tickRegen', () => {
  it('regenerates 1 hp every 6 turns and 1 mana every 360 turns', () => {
    const c = createCharacter(base);
    c.hp = 1;
    c.mana = 0;
    for (let i = 0; i < 6; i++) tickRegen(c, 1);
    expect(c.hp).toBe(2);
    for (let i = 0; i < 360; i++) tickRegen(c, 1);
    expect(c.mana).toBe(1);
  });

  it('accumulates remainders across calls', () => {
    const c = createCharacter(base);
    c.hp = 1;
    tickRegen(c, 5);
    expect(c.hp).toBe(1); // not yet
    tickRegen(c, 1);
    expect(c.hp).toBe(2);
    expect(c.regen.hpTicks).toBe(0);
  });

  it('never exceeds maxima and ignores non-positive turns', () => {
    const c = createCharacter(base);
    c.hp = c.maxHp;
    c.mana = c.maxMana;
    tickRegen(c, 1000);
    expect(c.hp).toBe(c.maxHp);
    expect(c.mana).toBe(c.maxMana);
    tickRegen(c, 0);
    tickRegen(c, -3);
    expect(c.regen.hpTicks).toBeLessThan(HP_TURNS_PER_POINT);
  });
});
