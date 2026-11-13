/**
 * Game bootstrap: adapters from extracted JSON data (src/data/*) to engine
 * runtime types. Pure data plumbing — no DOM.
 */

import overworldJson from '../data/part1/overworld.json';
import levelsJson from '../data/part1/levels.json';
import tilesJson from '../data/tiles.json';
import itemsJson from '../data/part1/items.json';
import spellsJson from '../data/part1/spells.json';
import monstersJson from '../data/part1/monsters.json';
import xpJson from '../data/xp.json';
import questsJson from '../data/part1/quests.json';
import storyJson from '../data/part1/story.json';
import part2LevelsJson from '../data/part2/levels.json';
import part2OverworldJson from '../data/part2/overworld.json';
import part2ItemsJson from '../data/part2/items.json';
import part2SpellsJson from '../data/part2/spells.json';
import part2MonstersJson from '../data/part2/monsters.json';
import part2QuestsJson from '../data/part2/quests.json';
import part2StoryJson from '../data/part2/story.json';
import { loadItemDefs, spellScrollDefs } from './items';
import { loadSpellDefs } from './spells';
import { createCharacter, type CharacterInit } from './character';
import { createWorld, type World } from './world';
import type { LevelNodeLite, WorldData } from './types';

interface TilesFileLite {
  tiles: { id: number; walkable: boolean }[];
}

interface LevelsFileLite {
  levels: LevelNodeLite[];
}

interface OverworldFileLite {
  rows: string[];
  spawn: { x: number; y: number };
  mineEntrance: { x: number; y: number };
}

const cache = new Map<1 | 2, WorldData>();

/** Load (and cache) engine world data from the extracted JSON files. */
export function loadWorldData(part: 1 | 2 = 1): WorldData {
  const existing = cache.get(part);
  if (existing) return existing;
  const data = part === 1 ? buildPart1() : buildPart2();
  cache.set(part, data);
  return data;
}

function buildPart1(): WorldData {
  const levels = (levelsJson as unknown as LevelsFileLite).levels;
  const overworld = overworldJson as unknown as OverworldFileLite;
  const tiles: Record<string, { walkable: boolean }> = {};
  for (const tile of (tilesJson as unknown as TilesFileLite).tiles) {
    tiles[String(tile.id)] = { walkable: tile.walkable };
  }
  return {
    part: 1,
    levels,
    town: {
      rows: overworld.rows,
      spawn: overworld.spawn,
      mineEntrance: overworld.mineEntrance,
    },
    tiles,
    items: {...loadItemDefs(itemsJson), ...spellScrollDefs(loadSpellDefs(spellsJson))},
    spells: loadSpellDefs(spellsJson),
    monsters: (monstersJson as unknown as { records: { id: string; name: string }[] }).records,
    xpThresholds: (xpJson as unknown as { thresholds: number[] }).thresholds,
    quests: (questsJson as unknown as { quests: import('./quests').QuestDef[] }).quests,
    story: (storyJson as unknown as { texts: Record<string, string> }).texts,
  };
}

function buildPart2(): WorldData {
  const levels = (part2LevelsJson as unknown as LevelsFileLite).levels;
  const overworld = part2OverworldJson as unknown as OverworldFileLite;
  const tiles: Record<string, { walkable: boolean }> = {};
  for (const tile of (tilesJson as unknown as TilesFileLite).tiles) {
    tiles[String(tile.id)] = { walkable: tile.walkable };
  }
  return {
    part: 2,
    levels,
    town: {
      rows: overworld.rows,
      spawn: overworld.spawn,
      // Schema-compatible field: in part 2 this stair leads into the castle.
      mineEntrance: overworld.mineEntrance,
    },
    tiles,
    items: {...loadItemDefs(part2ItemsJson), ...spellScrollDefs(loadSpellDefs(part2SpellsJson))},
    spells: loadSpellDefs(part2SpellsJson),
    monsters: (part2MonstersJson as unknown as { records: { id: string; name: string }[] }).records,
    xpThresholds: (xpJson as unknown as { thresholds: number[] }).thresholds,
    quests: (part2QuestsJson as unknown as { quests: import('./quests').QuestDef[] }).quests,
    story: (part2StoryJson as unknown as { texts: Record<string, string> }).texts,
  };
}

/** Create a fresh world from a new-game wizard CharacterInit. */
export function newWorld(init: {
  worldSeed: number;
  player: CharacterInit;
  data?: WorldData;
  part?: 1 | 2;
}): World {
  return createWorld({
    worldSeed: init.worldSeed,
    data: init.data ?? loadWorldData(init.part ?? 1),
    player: createCharacter(init.player),
  });
}
