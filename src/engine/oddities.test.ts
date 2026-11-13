import {expect, it} from 'vitest';
import {ODDITY_ITEMS, ODDITY_SPELLS, oddityCombatModifiers} from './oddities';
import {createCharacter} from './character';
import {tickStatuses} from './effects';
import {loadWorldData} from './game';
import {createWorld} from './world';
import {serializeGame} from './save';
import {importPart1Character} from '../app/import';

it('gives every consumable a clear effect description and affordable price', () => {
  for (const item of Object.values(ODDITY_ITEMS)) {
    expect(item.description?.length).toBeGreaterThan(20);
    expect(item.price).toBeGreaterThan(0);
    expect(item.price).toBeLessThanOrEqual(80);
  }
});
it('provides three playable spells with distinct useful effects', () => {
  expect(Object.values(ODDITY_SPELLS).map(s => s.effect)).toEqual(['debuff_sleep','debuff_slow','light_radius']);
  expect(Object.values(ODDITY_SPELLS).every(s => s.baseMana! > 0 && s.target !== null)).toBe(true);
});
it('temporary modifiers expire with no base stat drift', () => {
  const p = createCharacter({name:'Test',gender:'male',strength:50,intelligence:50,constitution:50,dexterity:50,difficulty:'easy'});
  const base = structuredClone(p);
  p.statuses = [{kind:'drunken',remainingTurns:10},{kind:'hallucination',remainingTurns:12},{kind:'sedated',remainingTurns:12}];
  expect(oddityCombatModifiers(p)).toEqual({accuracy:-7,damage:0,armor:4});
  tickStatuses(p, 12);
  expect(oddityCombatModifiers(p)).toEqual({accuracy:0,damage:0,armor:0});
  expect(p).toEqual(base);
});
it('preserves cosmetic fields and effects when importing Part One', () => {
  const p = createCharacter({name:'Test',gender:'female',strength:50,intelligence:50,constitution:50,dexterity:50,difficulty:'easy'});
  p.underwearColor = 'purple';
  p.statuses = [{kind:'hallucination',remainingTurns:5}];
  const world = createWorld({worldSeed:5,player:p,data:loadWorldData(1)});
  world.inventory.pack.push({uid:'painted',defId:'i-long-sword',count:1,color:'gold'});
  const result = importPart1Character(serializeGame(world), {seed:7});
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.save.player.underwearColor).toBe('purple');
  expect(result.save.player.statuses).toEqual(p.statuses);
  expect(result.save.inventory.pack[0]?.color).toBe('gold');
});


it('explains each expansion spell and its casting cost on generated scrolls in both campaigns', () => {
  const expected = {'x-bedtime': /sleep.*60 turns/i, 'x-paperwork': /half.*rate/i, 'x-lantern': /light.*1,000 turns/i};
  for (const part of [1, 2] as const) {
    const data = loadWorldData(part);
    for (const [id, effect] of Object.entries(expected)) {
      const spell = data.spells[id]!;
      expect(spell.description).toMatch(effect);
      const scroll = Object.values(data.items).find(item => item.name === `Scroll of ${spell.name}`)!;
      expect(scroll.description).toContain(`Read to learn ${spell.name}`);
      expect(scroll.description).toContain(spell.description);
      expect(scroll.description).toContain(`Base casting cost: ${spell.baseMana} mana`);
      expect(scroll.description).toMatch(/consumes the scroll/i);
    }
  }
});
