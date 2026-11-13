import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import questsJson from '../data/quests.json';
import storyJson from '../data/story.json';
import part2QuestsJson from '../data/part2/quests.json';
import part2MonstersJson from '../data/part2/monsters.json';
import part2StoryJson from '../data/part2/story.json';
import { createWorld, dispatch, type WorldData } from './world';
import { createCharacter } from './character';
import { idx } from './map';
import { TILE_FLOOR, TILE_STAIRS_DOWN } from './dungeon';
import {
  advanceQuests,
  createQuestState,
  questBosses,
  type QuestDef,
  type QuestEvent,
} from './quests';
import { MSLCG } from './rng';

/** Burn gameplay-rng rolls until the NEXT d20 (+toHit) would hit the AC. */
function burnUntilHit(world: ReturnType<typeof createWorld>, toHit: number, ac: number): void {
  const probe = new MSLCG(world.rng.getState());
  for (;;) {
    const before = probe.getState();
    if ((probe.rand(20) + 1) + toHit >= 10 + ac) {
      world.rng.setState(before);
      return;
    }
  }
}

const def = questsJson.quests[0] as QuestDef;

describe('quest engine (real quests.json)', () => {
  it('has 8 stages, boss on level 11 matching the monster roster name', () => {
    expect(def.id).toBe('vengeance');
    expect(def.stages).toHaveLength(8);
    expect(def.boss?.level).toBe(11);
    expect(def.boss?.monster).toBe('Hrungnir, The Hill Giant Lord');
    expect(def.boss?.guards[0]?.name).toBe('Huge Ogre');
    const optional = def.stages.filter((s) => s.optional).map((s) => s.id);
    expect(optional).toEqual(['magic-ward']);
  });

  it('all story ids referenced by stages exist in story.json', () => {
    const keys = new Set(Object.keys(storyJson.texts));
    for (const stage of def.stages) {
      for (const id of stage.storyTexts ?? []) {
        expect(keys.has(String(id)), `story id ${id}`).toBe(true);
      }
    }
    expect(keys.has(String(def.victoryStoryText))).toBe(true);
  });

  it('full scripted progression completes the quest and queues every story text', () => {
    const state = createQuestState(def);
    const events: QuestEvent[] = [
      { kind: 'game-start' },
      { kind: 'level-entered', level: 1 },
      { kind: 'level-entered', level: 8 },
      { kind: 'town-entered' }, // homecoming (requires mine-bottom, done)
      { kind: 'level-entered', level: 9 },
      { kind: 'level-entered', level: 10 },
      { kind: 'level-entered', level: 11 },
      { kind: 'spell-cast-at', name: 'Hrungnir, The Hill Giant Lord' },
      { kind: 'monster-killed', name: 'Hrungnir, The Hill Giant Lord' },
    ];
    let turn = 0;
    for (const event of events) advanceQuests(state, def, event, turn++);
    expect(state.completed['intro']).toBe(0);
    expect(state.completed['homecoming']).toBeDefined();
    expect(state.completed['magic-ward']).toBeDefined();
    expect(state.done).toBe(true);
    expect(state.victory).toBe(true);
    // 1 + 1 + 2 + 1 + 1 + 2 + 1 + 5 = 14 story texts queued in order.
    expect(state.pending).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(state.journal).toHaveLength(8);
    expect(state.journal[0]?.text).toContain('Avenge');
    expect(state.journal[7]?.text).toContain('Vengeance is yours');
  });

  it('town-entered before mine-bottom does not complete homecoming; later entry does', () => {
    const state = createQuestState(def);
    advanceQuests(state, def, { kind: 'game-start' }, 0);
    advanceQuests(state, def, { kind: 'town-entered' }, 5);
    expect(state.completed['homecoming']).toBeUndefined();
    advanceQuests(state, def, { kind: 'level-entered', level: 8 }, 10);
    advanceQuests(state, def, { kind: 'town-entered' }, 20);
    expect(state.completed['homecoming']).toBe(20);
  });

  it('quest completes without the optional magic-ward stage', () => {
    const state = createQuestState(def);
    for (const [turn, event] of [
      { kind: 'game-start' },
      { kind: 'level-entered', level: 8 },
      { kind: 'town-entered' },
      { kind: 'level-entered', level: 9 },
      { kind: 'level-entered', level: 10 },
      { kind: 'level-entered', level: 11 },
      { kind: 'monster-killed', name: 'Hrungnir, The Hill Giant Lord' },
    ].entries()) {
      advanceQuests(state, def, event as QuestEvent, turn);
    }
    expect(state.completed['magic-ward']).toBeUndefined();
    expect(state.victory).toBe(true);
  });

  it('spell-cast-at a non-boss name triggers nothing', () => {
    const state = createQuestState(def);
    advanceQuests(state, def, { kind: 'spell-cast-at', name: 'Kobold' }, 3);
    expect(state.completed['magic-ward']).toBeUndefined();
  });
});

const FIXTURE: WorldData = {
  part: 1,
  levels: [
    { index: 0, name: 'Town', kind: 'town', links: { down: 1, up: null } },
    { index: 1, name: 'Dungeon', kind: 'mine', links: { down: null, up: 0 } },
  ],
  town: {
    rows: Array.from({ length: 32 }, () => '00'.repeat(32)),
    spawn: { x: 1, y: 1 },
    mineEntrance: { x: 1, y: 1 },
  },
  tiles: { '0': { walkable: false }, '1': { walkable: true }, '18': { walkable: true } },
  items: {},
  spells: {
    s527: { id: 's527', name: 'FIREBALL', tier: 4, baseMana: 5, target: 'enemy', effect: 'ball', element: 'fire' },
  },
  quests: [
    {
      id: 'q',
      title: 'Fixture Quest',
      boss: { level: 1, monster: 'Hrungnir, The Hill Giant Lord', guards: [{ name: 'Huge Ogre', count: 2 }] },
      victoryStoryText: 15,
      stages: [
        { id: 'intro', trigger: { kind: 'game-start' }, journalText: 'Begin.', storyTexts: [1] },
        { id: 'deep', trigger: { kind: 'level-reached', level: 1 }, journalText: 'Descended.', storyTexts: [2] },
        { id: 'home', trigger: { kind: 'town-entered', requires: 'deep' }, journalText: 'Returned.', storyTexts: [3] },
        { id: 'win', trigger: { kind: 'monster-killed', name: 'Hrungnir, The Hill Giant Lord' }, journalText: 'Won.', storyTexts: [10] },
      ],
    },
  ],
  story: {
    '1': 'Intro text %x.',
    '2': 'Deep text.',
    '3': 'Home text.',
    '10': 'Win text.',
    '15': 'Ending text.',
  },
};

function fixtureWorld() {
  // Dex 90 (to-hit +4), str 50 (no damage bonus) — pool 200.
  const player = createCharacter({ name: 'Hero', gender: 'female', strength: 50, intelligence: 20, constitution: 40, dexterity: 90, difficulty: 'intermediate' });
  const world = createWorld({ worldSeed: 7, data: FIXTURE, player });
  // Open a walkable town for movement tests.
  const town = world.levels.get(0)!;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) town.tiles[idx(x, y)] = TILE_FLOOR;
  }
  town.tiles[idx(1, 1)] = TILE_STAIRS_DOWN;
  return world;
}

describe('quest engine (world integration)', () => {
  it('createWorld fires game-start and queues the intro story', () => {
    const world = fixtureWorld();
    expect(world.questState).toBeDefined();
    expect(world.questState!.pending).toEqual([1]);
    expect(world.questState!.journal[0]?.text).toBe('Begin.');
  });

  it('DESCEND emits level-entered; ENTER_TOWN emits town-entered', () => {
    const world = fixtureWorld();
    world.questState!.pending.length = 0;
    dispatch(world, { type: 'DESCEND' });
    expect(world.questState!.completed['deep']).toBeDefined();
    dispatch(world, { type: 'ENTER_TOWN' });
    expect(world.questState!.completed['home']).toBeDefined();
    expect(world.questState!.pending).toEqual([2, 3]);
  });

  it('killing the boss by bump-attack completes the quest', () => {
    const world = fixtureWorld();
    dispatch(world, { type: 'DESCEND' });
    dispatch(world, { type: 'ENTER_TOWN' }); // completes 'home'
    world.current = 1; // back to the dungeon level for the fight
    const level = world.levels.get(1)!;
    const boss = [...level.entities.values()].find((e) => e.name === 'Hrungnir, The Hill Giant Lord');
    expect(boss).toBeDefined(); // boss placed by populateLevel
    boss!.monster!.hp = 1;
    burnUntilHit(world, 4, 8); // player to-hit +4 vs boss AC 8
    world.player.x = boss!.x;
    world.player.y = boss!.y - 1 >= 0 ? boss!.y - 1 : boss!.y + 1;
    dispatch(world, { type: 'MOVE', dx: 0, dy: Math.sign(boss!.y - world.player.y) });
    expect(level.entities.has(boss!.id)).toBe(false);
    expect(world.questState!.victory).toBe(true);
    expect(world.questState!.pending).toContain(10);
  });

  it('CAST at the boss emits spell-cast-at (fixture magic-ward semantics)', () => {
    const world = fixtureWorld();
    dispatch(world, { type: 'DESCEND' });
    const level = world.levels.get(1)!;
    const boss = [...level.entities.values()].find((e) => e.name === 'Hrungnir, The Hill Giant Lord')!;
    boss.monster!.hp = 1;
    world.player.knownSpells.push('s527');
    world.player.mana = 50;
    world.player.maxMana = 50;
    burnUntilHit(world, 4, 8); // spell attack roll +4 vs AC 8
    world.player.x = boss.x;
    world.player.y = boss.y - 1;
    // Point a straight-line path at the boss.
    for (let x = 2; x < 60; x++) {
      for (let y = 2; y < 60; y++) level.tiles[idx(x, y)] = TILE_FLOOR;
    }
    dispatch(world, {
      type: 'CAST',
      spellId: 's527',
      target: { x: boss.x, y: boss.y },
    });
    expect(world.questState?.completed['win']).toBeDefined();
  });
});

describe('real-data load', () => {
  it('loadWorldData carries quests + story from extracted data', () => {
    // game.ts wiring test lives in game.test.ts; here we pin the files.
    const raw = JSON.parse(readFileSync(new URL('../data/quests.json', import.meta.url), 'latin1')) as {
      quests: unknown[];
    };
    expect(raw.quests).toHaveLength(1);
    expect(Object.keys(storyJson.texts)).toHaveLength(15);
  });
});

describe('questBosses normalization (PART2-PLAN Task P2)', () => {
  it('flattens the legacy single boss and the additive bosses array in order', () => {
    const quests: QuestDef[] = [
      {
        id: 'q1',
        title: 'Q1',
        boss: { level: 11, monster: 'Hrungnir, The Hill Giant Lord', guards: [] },
        bosses: [
          { level: 16, monster: 'Utgardhalok, The Hill Giant King', guards: [] },
          { level: 25, monster: 'The Demon Lord Surtur', guards: [] },
        ],
        stages: [],
      },
      { id: 'q2', title: 'Q2', stages: [] },
    ];
    expect(questBosses(quests).map((b) => b.monster)).toEqual([
      'Hrungnir, The Hill Giant Lord',
      'Utgardhalok, The Hill Giant King',
      'The Demon Lord Surtur',
    ]);
  });

  it('rejects duplicate boss levels loudly', () => {
    const quests: QuestDef[] = [
      {
        id: 'q',
        title: 'Q',
        boss: { level: 16, monster: 'A', guards: [] },
        bosses: [{ level: 16, monster: 'B', guards: [] }],
        stages: [],
      },
    ];
    expect(() => questBosses(quests)).toThrow(/duplicate boss level/i);
  });

  it('C1 quests.json pins its boss roster exclusions', () => {
    const q = questsJson.quests[0] as QuestDef;
    expect(q.bossRosterExclusions).toEqual(['Hrungnir', 'Hrungnir, The Hill Giant Lord']);
  });
});

describe('part2 quest (PART2-PLAN Task P4)', () => {
  const p2 = part2QuestsJson.quests[0] as QuestDef;
  const rosterNames = new Set(part2MonstersJson.records.map((r: { name: string }) => r.name));

  it('has the 23 mapped stages with 8 required / 15 optional', () => {
    expect(p2.id).toBe('lifthransirs-bane');
    expect(p2.stages.map((s) => s.id)).toEqual([
      'arrival', 'keep-first', 'shade-warning', 'wolf-pack', 'bear-pack',
      'prisoner', 'prisoner-report', 'jarl-depth', 'jarl-deep', 'wizard',
      'utgardhalok-intro', 'utgardhalok-slain', 'rungnir-intro', 'rungnir-slain',
      'undead', 'thrym-intro', 'thrym-slain', 'thiassa-intro', 'thiassa-slain',
      'surtur-gate', 'surtur-taunt', 'surtur-banished', 'homecoming',
    ]);
    expect(p2.stages.filter((s) => !s.optional)).toHaveLength(8);
    expect(p2.stages.filter((s) => s.optional)).toHaveLength(15);
  });

  it('covers every part2 story id exactly once', () => {
    const storyKeys = new Set(Object.keys(part2StoryJson.texts));
    expect(storyKeys.size).toBe(26);
    const covered: number[] = [];
    for (const stage of p2.stages) {
      for (const id of stage.storyTexts ?? []) {
        expect(storyKeys.has(String(id)), `story id ${id}`).toBe(true);
        covered.push(id);
      }
    }
    expect([...covered].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 26 }, (_, i) => i + 1),
    );
    expect(storyKeys.has(String(p2.victoryStoryText))).toBe(true);
  });

  it('bosses sit on distinct levels with roster-backed monsters and guards', () => {
    const bosses = questBosses([p2]);
    expect(bosses.map((b) => b.level)).toEqual([16, 18, 20, 22, 25]);
    for (const boss of bosses) {
      expect(rosterNames.has(boss.monster), `boss ${boss.monster}`).toBe(true);
      for (const guard of boss.guards) {
        expect(rosterNames.has(guard.name), `guard ${guard.name}`).toBe(true);
      }
    }
    for (const name of p2.bossRosterExclusions ?? []) {
      expect(rosterNames.has(name), `exclusion ${name}`).toBe(true);
    }
    expect(p2.bossRosterExclusions).toHaveLength(10);
  });

  it('required-only progression reaches victory without any optional stage', () => {
    const state = createQuestState(p2);
    const events: QuestEvent[] = [
      { kind: 'game-start' },                    // arrival + keep-first
      { kind: 'town-entered' },                  // shade-warning (optional, fires)
      { kind: 'level-entered', level: 12 },      // prisoner
      { kind: 'town-entered' },                  // prisoner-report + jarl-depth cascade
      { kind: 'level-entered', level: 25 },      // surtur-gate
      { kind: 'monster-killed', name: 'The Demon Lord Surtur' }, // surtur-banished
      { kind: 'town-entered' },                  // homecoming → victory
    ];
    let turn = 0;
    for (const event of events) advanceQuests(state, p2, event, turn++);
    expect(state.completed['arrival']).toBe(0);
    expect(state.completed['jarl-depth']).toBe(3); // cascaded in the same town visit
    expect(state.completed['homecoming']).toBeDefined();
    expect(state.done).toBe(true);
    expect(state.victory).toBe(true);
    expect(state.pending).toEqual([1, 2, 3, 4, 5, 6, 7, 10, 22, 24, 25, 26]);
    expect(state.journal).toHaveLength(9); // 8 required + shade-warning
  });

  it('kings are optional: full clear including kings still needs the required chain', () => {
    const state = createQuestState(p2);
    const events: QuestEvent[] = [
      { kind: 'game-start' },
      { kind: 'level-entered', level: 5 },   // wolf-pack
      { kind: 'level-entered', level: 9 },   // bear-pack
      { kind: 'level-entered', level: 12 },  // prisoner
      { kind: 'town-entered' },              // shade-warning + prisoner-report + jarl-depth
      { kind: 'level-entered', level: 14 },  // jarl-deep
      { kind: 'level-entered', level: 16 },  // wizard + utgardhalok-intro
      { kind: 'monster-killed', name: 'Utgardhalok, The Hill Giant King' },
      { kind: 'level-entered', level: 18 },  // rungnir-intro + undead
      { kind: 'monster-killed', name: 'Rungnir, The Stone Giant King' },
      { kind: 'level-entered', level: 20 },  // thrym-intro
      { kind: 'monster-killed', name: 'Thrym, The Frost Giant King' },
      { kind: 'level-entered', level: 22 },  // thiassa-intro
      { kind: 'monster-killed', name: 'Thiassa, The Fire Giant King' },
      { kind: 'spell-cast-at', name: 'The Demon Lord Surtur' }, // surtur-taunt
      { kind: 'level-entered', level: 25 },  // surtur-gate
      { kind: 'monster-killed', name: 'The Demon Lord Surtur' },
    ];
    let turn = 0;
    for (const event of events) advanceQuests(state, p2, event, turn++);
    // Every optional stage fired, all required except homecoming.
    expect(state.completed['thiassa-slain']).toBeDefined();
    expect(state.completed['surtur-taunt']).toBeDefined();
    expect(state.victory).toBe(false); // never returned to town
    advanceQuests(state, p2, { kind: 'town-entered' }, turn);
    expect(state.victory).toBe(true);
    // Pending is chronological (event order), not sorted.
    expect(state.pending).toEqual([
      1, 2, 3, 4,        // arrival + keep-first
      8, 9,              // wolf-pack, bear-pack
      6, 5, 7, 10,       // prisoner, then town visit: shade-warning, report, jarl lore
      13,                // jarl-deep
      11, 14, 15,        // wizard, utgardhalok intro/slain
      16, 12, 17,        // rungnir intro, undead, rungnir slain
      18, 19,            // thrym intro/slain
      20, 21,            // thiassa intro/slain
      23, 22,            // taunt (cast before entering 25), surtur-gate
      24, 25, 26,        // banished, homecoming
    ]);
  });

  it('surtur-banished requires the actual boss kill; other kills do nothing', () => {
    const state = createQuestState(p2);
    advanceQuests(state, p2, { kind: 'monster-killed', name: 'Ice Devil' }, 1);
    expect(state.completed['surtur-banished']).toBeUndefined();
  });
});
