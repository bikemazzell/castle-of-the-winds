import type { World } from './world';

/** Trigger conditions recognized by the quest engine (data-driven). */
export type QuestTrigger =
  | { kind: 'game-start' }
  | { kind: 'level-reached'; level: number }
  | { kind: 'town-entered'; requires?: string }
  | { kind: 'spell-cast-at'; name: string }
  | { kind: 'monster-killed'; name: string };

export interface QuestStage {
  id: string;
  trigger: QuestTrigger;
  journalText: string;
  /** Story resource ids (see src/data/part1/story.json) to queue for display. */
  storyTexts?: number[];
  optional?: boolean;
}

export interface QuestBoss {
  level: number;
  monster: string;
  guards: { name: string; count: number }[];
}

export interface QuestDef {
  id: string;
  title: string;
  boss?: QuestBoss;
  /** Additional bosses (Part 2 multi-boss quests); normalized with `boss`. */
  bosses?: QuestBoss[];
  /** Exact monster names never chosen for random spawns (both forms of every
   *  quest-boss identity). Explicit list — never derived by substring. */
  bossRosterExclusions?: string[];
  victoryStoryText?: number;
  stages: QuestStage[];
}

/**
 * All quest bosses across quests (`boss` + `bosses`, flattened in order).
 * THE single normalization every consumer uses (placement, boss-level dragon
 * suppression, spawn exclusion). Rejects duplicate boss levels loudly — two
 * bosses on one level would race for placement.
 */
export function questBosses(quests: QuestDef[]): QuestBoss[] {
  const all: QuestBoss[] = [];
  const seen = new Map<number, string>();
  for (const q of quests) {
    for (const b of [q.boss, ...(q.bosses ?? [])]) {
      if (!b) continue;
      const existing = seen.get(b.level);
      if (existing !== undefined) {
        throw new Error(
          `duplicate boss level ${b.level}: ${existing} and ${b.monster} (quest ${q.id})`,
        );
      }
      seen.set(b.level, b.monster);
      all.push(b);
    }
  }
  return all;
}

export interface QuestsFile {
  version: number;
  source: { note?: string; exe?: string; sha256?: string };
  quests: QuestDef[];
  gaps: unknown[];
}

export interface JournalEntry {
  turn: number;
  questId: string;
  text: string;
}

/** Runtime quest state — fully serializable (persisted in saves). */
export interface QuestState {
  questId: string;
  /** stageId -> turn completed. */
  completed: Record<string, number>;
  done: boolean;
  victory: boolean;
  journal: JournalEntry[];
  /** Story text ids queued for display; UI drains these. */
  pending: number[];
  /** Set once the ending screen has been shown (guards re-display). */
  endingShown?: boolean;
}

export type QuestEvent =
  | { kind: 'game-start' }
  | { kind: 'level-entered'; level: number }
  | { kind: 'town-entered' }
  | { kind: 'spell-cast-at'; name: string }
  | { kind: 'monster-killed'; name: string };

function triggerMatches(
  stage: QuestStage,
  event: QuestEvent,
  state: QuestState,
): boolean {
  const t = stage.trigger;
  switch (t.kind) {
    case 'game-start':
      return event.kind === 'game-start';
    case 'level-reached':
      return event.kind === 'level-entered' && event.level === t.level;
    case 'town-entered':
      if (event.kind !== 'town-entered') return false;
      return t.requires === undefined || state.completed[t.requires] !== undefined;
    case 'spell-cast-at':
      return event.kind === 'spell-cast-at' && event.name === t.name;
    case 'monster-killed':
      return event.kind === 'monster-killed' && event.name === t.name;
  }
}

export function createQuestState(def: QuestDef): QuestState {
  return {
    questId: def.id,
    completed: {},
    done: false,
    victory: false,
    journal: [],
    pending: [],
  };
}

/**
 * Advance quest state with a game event. Completes any stage whose trigger
 * matches (each stage completes at most once), appends journal entries and
 * queues story texts in stage order. Sets done/victory when every
 * non-optional stage is complete.
 */
export function advanceQuests(state: QuestState, def: QuestDef, event: QuestEvent, turn: number): void {
  if (state.done) return;
  for (const stage of def.stages) {
    if (state.completed[stage.id] !== undefined) continue;
    if (!triggerMatches(stage, event, state)) continue;
    state.completed[stage.id] = turn;
    state.journal.push({ turn, questId: def.id, text: stage.journalText });
    if (stage.storyTexts) state.pending.push(...stage.storyTexts);
  }
  const required = def.stages.filter((s) => !s.optional);
  if (required.every((s) => state.completed[s.id] !== undefined)) {
    state.done = true;
    state.victory = true;
  }
}

/** Emit a quest event into the world's quest state (no-op without quests). */
export function questEvent(world: World, event: QuestEvent): void {
  if (!world.questState) return;
  const def = world.data.quests?.find((q) => q.id === world.questState?.questId);
  if (!def) return;
  advanceQuests(world.questState, def, event, world.turn);
}

export function isVictory(world: World): boolean {
  return world.questState?.victory === true;
}
