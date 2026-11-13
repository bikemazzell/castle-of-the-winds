/**
 * Part-1 → Part-2 character import (PART2-PLAN Task P7).
 *
 * Original design: Part 2 continues with the Part 1 character (manual + order
 * info). The import validates the source against the PART 1 bundle first,
 * remaps spells by NAME (part-2 spell ids are slugs — the only reliable join),
 * carries stats/inventory verbatim, and re-validates against Part 2 before
 * anything is accepted. The source save is never mutated.
 */
import { describe, expect, it } from 'vitest';
import { createCharacter } from '../engine/character';
import { loadWorldData, newWorld } from '../engine/game';
import { deserializeGame, serializeGame } from '../engine/save';
import { pickup } from '../engine/inventory';
import type { Player } from '../engine/types';
import type { WorldData } from '../engine/types';
import { importPart1Character } from './import';

function veteranPlayer(): Player {
  const player = createCharacter({
    name: 'Sigrun',
    gender: 'female',
    strength: 60,
    intelligence: 50,
    constitution: 55,
    dexterity: 35,
    difficulty: 'intermediate',
  });
  player.level = 1;
  player.experience = 0;
  return player;
}

function makePart1Save(): ReturnType<typeof serializeGame> {
  const world = newWorld({ worldSeed: 7, player: veteranPlayer(), part: 1 });
  world.player.level = 5;
  world.player.experience = 4200;
  world.player.knownSpells.push('s323'); // SHIELD (C1 index id)
  world.player.statuses.push({ kind: 'poison', remainingTurns: 12, magnitude: 3 });
  world.inventory.gold = 777;
  pickup(world.inventory, world.player, 'i-long-sword', world.data.items);
  return serializeGame(world, { savedAt: '2026-11-13T10:00:00.000Z' });
}

describe('part 1 character import (PART2-PLAN Task P7)', () => {
  it('carries the character into a part-2 save with spells remapped by name', () => {
    const source = makePart1Save();
    const result = importPart1Character(source, { seed: 99, savedAt: '2026-11-13T11:00:00.000Z' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const save = result.save;

    expect(save.meta.part).toBe(2);
    expect(save.player.name).toBe('Sigrun');
    expect(save.player.level).toBe(5);
    expect(save.player.experience).toBe(4200);
    expect(save.player.knownSpells).toEqual(['s-shield']); // remapped to the part-2 slug id
    expect(save.player.statuses.length).toBe(1);
    expect(save.inventory.gold).toBe(777);
    expect(save.inventory.pack.some((entry) => entry.defId === 'i-long-sword')).toBe(true);

    // The result must load against the PART 2 bundle as a playable world.
    const data2 = loadWorldData(2);
    const world = deserializeGame(save, data2);
    expect(world.data.part).toBe(2);
    expect(world.player.knownSpells).toEqual(['s-shield']);
    // Fresh quest state and position reset to the town spawn.
    expect(world.data.levels.length).toBe(26);
    expect(world.questState?.questId).toBe('lifthransirs-bane');
    expect(world.player.x).toBe(data2.town.spawn.x);
    expect(world.player.y).toBe(data2.town.spawn.y);
  });

  it('rejects dead characters explicitly', () => {
    const source = makePart1Save();
    source.player.hp = 0;
    const result = importPart1Character(source, { seed: 99 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/dead/i);
  });

  it('rejects sources that are not valid part 1 saves', () => {
    const result = importPart1Character({ format: 'nonsense' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/part 1 save/i);
  });

  it('fails loudly when a known spell has no part 2 equivalent', () => {
    const data1: WorldData = { ...loadWorldData(1) };
    data1.spells = {
      ...data1.spells,
      's-zzz': {
        id: 's-zzz',
        name: 'Zap of the North',
        tier: 1,
        baseMana: 1,
        target: 'enemy',
        effect: 'missile',
      },
    };
    const source = makePart1Save();
    source.player.knownSpells = ['s-zzz'];

    const result = importPart1Character(source, { seed: 99, data1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Zap of the North.*no part 2 equivalent/);
  });

  it('never mutates the source save', () => {
    const source = makePart1Save();
    const before = JSON.stringify(source);
    importPart1Character(source, { seed: 99 });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('data pin: every part 1 spell name has a part 2 spell with the same name', () => {
    const data1 = loadWorldData(1);
    const data2 = loadWorldData(2);
    const names2 = new Set(Object.values(data2.spells).map((def) => def.name));
    const part1 = Object.values(data1.spells);
    expect(part1.length).toBe(37);
    for (const def of part1) {
      expect(names2.has(def.name), def.name).toBe(true);
    }
  });
});
it('rejects a Part Two save even when its optional quest state is absent',()=>{
 const save=serializeGame(newWorld({worldSeed:7,player:veteranPlayer(),part:2}));
 delete save.world.quests;
 expect(()=>deserializeGame(save,loadWorldData(1))).toThrow(/part/i);
 expect(importPart1Character(save).ok).toBe(false);
});
