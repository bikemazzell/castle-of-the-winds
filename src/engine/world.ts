import { fireWeapon } from './ranged';
import { interactEncounter, populateEncounters, scavengeNearby, tickEncounters } from './encounters';
/**
 * World + turn loop. The world object is mutable; dispatch() mutates and
 * returns it (documented deviation from a pure reducer — planes are typed
 * arrays and the save layer owns snapshotting, Task 2.6).
 *
 * Turn contract: invalid actions consume nothing and run no systems. Every
 * valid player action that consumes a turn runs systems in order:
 * status.tick → monsters.takeTurns.
 */

import { tickRegen } from './character';
import {
  createInventory,
  dropItem,
  equip,
  pickup,
  tickInventory,
  unequip,
  useItem,
} from './inventory';
import { applySpellEffect, hasStatus, spellEffectSystem, tickStatuses } from './effects';
import { playerAttack } from './combat';
import { monsterInSight, placeQuestBoss, populateLevel, takeMonsterTurns } from './monsters';
import { createQuestState, questEvent } from './quests';
import { disarmTrapAt, findDisarmTarget, placeTraps, triggerTrapAt } from './traps';
import { bumpSecretDoor, placeSecretDoors, searchAdjacent } from './doors';
import { canCast } from './spells';
import type { EquipSlot, Inventory } from './types';
import {
  TILE_FLOOR,
  TILE_STAIRS_DOWN,
  TILE_STAIRS_UP,
  TILE_WALL,
  generateLevelForWorld,
} from './dungeon';
import { computeFov, updateSeen } from './fov';
import { LEVEL_AREA, LEVEL_SIZE, createEmptyLevel, findStair, idx, type Level } from './map';

export { findStair } from './map';
import { MSLCG, levelGenSeed } from './rng';
import type {
  LevelNodeLite,
  LogEntry,
  Player,
  Systems,
  WorldData,
} from './types';

export type { Systems, WorldData } from './types';

/** APPROX: one turn = 10 seconds (manual cast times are in seconds). */
export const TURNS_PER_HOUR = 360;
/** APPROX per CHANGES.DOC v1.1: rest regenerates mana at 2 points/hour. */
export const REST_MANA_PER_HOUR = 2;
/** Manual 295: HP regenerates ~1 per minute -> 60 per rest hour. */
export const REST_HP_PER_HOUR = 60;
const REST_HOUR_CAP = 100;

export interface World {
  worldSeed: number;
  data: WorldData;
  levels: Map<number, Level>;
  /** Persistent per-level memory (seen bitmask). */
  seen: Map<number, Uint8Array>;
  /** FOV of the player on the current level (recomputed per turn). */
  visible: Uint8Array;
  current: number;
  player: Player;
  turn: number;
  /** Gameplay RNG — never used for level generation (Task 2.3 contract). */
  rng: MSLCG;
  log: LogEntry[];
  systems: Systems;
  restedHours: number;
  /** Player inventory (Task 3.2). */
  inventory: Inventory;
  /** Campaign quest state (Task 5.6). */
  questState?: import('./quests').QuestState;
}

export type Action =
  | { type: 'MOVE'; dx: number; dy: number }
  | { type: 'WAIT' }
  | { type: 'DESCEND' }
  | { type: 'ASCEND' }
  | { type: 'PICKUP'; defId: string; count?: number }
  | { type: 'DISCARD'; uid: string; count?: number }
  | { type: 'USE'; uid: string }
  | { type: 'EQUIP'; uid: string }
  | { type: 'UNEQUIP'; slot: EquipSlot }
  | { type: 'CAST'; spellId: string; target?: { x: number; y: number } }
  | { type: 'FIRE'; target: { x: number; y: number }; uid?: string }
  | { type: 'SEARCH' }
  | { type: 'INTERACT'; target: number | string }
  | { type: 'DISARM'; x?: number; y?: number }
  | { type: 'REST'; hours?: number }
  | { type: 'ENTER_TOWN' };

export interface CreateWorldInit {
  worldSeed: number;
  data: WorldData;
  player: Omit<Player, 'x' | 'y'>;
  systems?: Systems;
  /** Gameplay RNG seed; defaults derived from worldSeed. */
  rngSeed?: number;
}

function defaultSystems(): Systems {
  return {
    monsters: { takeTurns: takeMonsterTurns },
    traps: { onTurn: () => {}, onPlayerEnter: triggerTrapAt },
    status: {
      tick: (w: unknown) => {
        const world = w as World;
        tickRegen(world.player, 1);
        tickStatuses(world.player, 1); // poison ticks, timed spell states
      },
      restHour: (w: unknown) => {
        const world = w as World;
        world.player.mana = Math.min(
          world.player.maxMana,
          world.player.mana + REST_MANA_PER_HOUR,
        );
        tickStatuses(world.player, TURNS_PER_HOUR); // statuses age while resting
      },
    },
    effects: spellEffectSystem(),
  };
}

function buildTownLevel(data: WorldData): Level {
  const level = createEmptyLevel(0);
  for (let y = 0; y < LEVEL_SIZE; y++) {
    const row = data.town.rows[y] ?? '';
    for (let x = 0; x < LEVEL_SIZE; x++) {
      const hex = row.slice(x * 2, x * 2 + 2);
      const tile = hex ? Number.parseInt(hex, 16) : TILE_WALL;
      if (!Number.isNaN(tile)) level.tiles[idx(x, y)] = tile;
    }
  }
  return level;
}

export function tileWalkable(data: WorldData, tile: number): boolean {
  return data.tiles[String(tile)]?.walkable ?? false;
}

export function createWorld(init: CreateWorldInit): World {
  const systems = init.systems ?? defaultSystems();
  const rngSeed = init.rngSeed ?? (init.worldSeed ^ 0x5eed) >>> 0;
  const world: World = {
    worldSeed: init.worldSeed,
    data: init.data,
    levels: new Map(),
    seen: new Map(),
    visible: new Uint8Array(LEVEL_AREA),
    current: 0,
    player: { ...init.player, x: init.data.town.spawn.x, y: init.data.town.spawn.y },
    turn: 0,
    rng: new MSLCG(rngSeed),
    log: [],
    systems,
    restedHours: 0,
    inventory: createInventory(),
  };
  world.levels.set(0, buildTownLevel(init.data));
  world.seen.set(0, new Uint8Array(LEVEL_AREA));
  populateEncounters(world, world.levels.get(0)!);
  refreshFov(world);
  const questDef = init.data.quests?.[0];
  if (questDef) {
    world.questState = createQuestState(questDef);
    questEvent(world, { kind: 'game-start' });
  }
  return world;
}

function nodeFor(world: World, index: number): LevelNodeLite {
  const node = world.data.levels.find((n) => n.index === index);
  if (!node) throw new RangeError(`no level node ${index} in world data`);
  return node;
}

/** Get (lazily generating) a level. Generation uses the dedicated gen seed. */
export function ensureLevel(world: World, index: number): Level {
  const existing = world.levels.get(index);
  if (existing) {
    // Early Part Two saves lack the return stairs added to floors 1–3.
    // Add a stair on an empty floor without regenerating explored levels.
    if (world.data.part === 2 && index >= 1 && index <= 3
      && nodeFor(world, index).links.up !== null && !findStair(existing, TILE_STAIRS_UP)) {
      const cell = existing.tiles.findIndex((tile, i) => tile === TILE_FLOOR
        && existing.occupancy[i] === 0 && !existing.traps?.some(trap => idx(trap.x, trap.y) === i));
      if (cell >= 0) existing.tiles[cell] = TILE_STAIRS_UP;
    }
    populateEncounters(world, existing);
    return existing;
  }
  if (index === 0) {
    const town = buildTownLevel(world.data);
    world.levels.set(0, town);
    populateEncounters(world, town);
    return town;
  }
  const node = nodeFor(world, index);
  const generated = generateLevelForWorld(world.worldSeed, index, {
    hasUpStair: node.links.up !== null,
    placeDoors: true,
  });
  world.levels.set(index, generated.level);
  if (!world.seen.has(index)) world.seen.set(index, new Uint8Array(LEVEL_AREA));
  populateLevel(world, generated.level, index);
  placeQuestBoss(world, generated.level, index);
  placeTraps(world, generated.level, index);
  placeSecretDoors(world, generated.level, index);
  populateEncounters(world, generated.level);
  return generated.level;
}

/** First tile of the given byte on the level (stairs lookup), row-major. */
function refreshFov(world: World): void {
  const level = world.levels.get(world.current);
  if (!level) return;
  // Light spell: 3×3 hallway vision widens to 5×5 (manual: Light in a
  // hallway lights the 3x3 region around the target square — APPROX +1).
  const lit = hasStatus(world.player, 'light');
  world.visible = computeFov(level, { x: world.player.x, y: world.player.y }, {
    revealRadius: lit ? 2 : 1,
  });
  const seen = world.seen.get(world.current);
  if (seen) updateSeen(seen, world.visible);
}

function log(world: World, text: string): void {
  world.log.push({ turn: world.turn, text });
}

function currentLevel(world: World): Level {
  return ensureLevel(world, world.current);
}

/** Maximum retained log entries (Task 12: bounded memory; journal is separate). */
export const LOG_CAP = 500;

function endTurn(world: World): void {
  world.turn++;
  if (world.log.length > LOG_CAP) world.log = world.log.slice(-LOG_CAP);
  world.systems.status.tick(world);
  tickInventory(world.inventory, 1); // light-source fuel burn-down
  world.systems.monsters.takeTurns(world);
  tickEncounters(world);
  refreshFov(world);
}

function transitionTo(world: World, to: number, arrival: 'up' | 'down'): void {
  const level = ensureLevel(world, to);
  const target =
    arrival === 'up'
      ? (findStair(level, TILE_STAIRS_UP) ?? findStair(level, TILE_STAIRS_DOWN))
      : (findStair(level, TILE_STAIRS_DOWN) ?? findStair(level, TILE_STAIRS_UP));
  world.current = to;
  if (!world.seen.has(to)) world.seen.set(to, new Uint8Array(LEVEL_AREA));
  world.player.x = target?.x ?? 0;
  world.player.y = target?.y ?? 0;
}

export function dispatch(world: World, action: Action): World {
  const level = currentLevel(world);

  switch (action.type) {
    case 'MOVE': {
      const { dx, dy } = action;
      // Accept one neighboring cell, rejecting malformed and multi-cell deltas.
      const isDelta = (v: number): boolean => Number.isInteger(v) && Math.abs(v) <= 1;
      if (!isDelta(dx) || !isDelta(dy) || (dx === 0 && dy === 0)) return world;
      const nx = world.player.x + dx;
      const ny = world.player.y + dy;
      if (nx < 0 || ny < 0 || nx >= LEVEL_SIZE || ny >= LEVEL_SIZE) return world;
      if (dx !== 0 && dy !== 0) {
        const flanks = [idx(nx, world.player.y), idx(world.player.x, ny)];
        if (flanks.some(i => !tileWalkable(world.data, level.tiles[i]!) || level.occupancy[i])) return world;
      }
      const ni = idx(nx, ny);
      const tile = level.tiles[ni]!;
      if (!tileWalkable(world.data, tile)) {
        // Secret-door bump search: a hit reveals the door and takes the turn;
        // a miss is indistinguishable from bumping any other wall.
        const bump = bumpSecretDoor(world, level, nx, ny);
        if (bump.revealed) endTurn(world);
        return world;
      }
      const occupant = level.occupancy[ni] ?? 0;
      if (occupant !== 0) {
        // Bump-attack monsters (classic CoTW); NPCs block movement.
        const entity = level.entities.get(occupant);
        if (entity?.kind === 'monster' && entity.monster) {
          playerAttack(world, occupant);
          endTurn(world);
        }
        return world;
      }
      world.player.x = nx;
      world.player.y = ny;
      const trapMsg = world.systems.traps.onPlayerEnter(world, nx, ny);
      if (trapMsg) log(world, trapMsg);
      endTurn(world);
      return world;
    }

    case 'FIRE': {
      const result = fireWeapon(world, action.target, action.uid);
      if (!result.ok) { log(world, result.message); return world; }
      endTurn(world);
      return world;
    }

    case 'WAIT': {
      endTurn(world);
      return world;
    }

    case 'INTERACT': {
      const result = interactEncounter(world, action.target);
      for (const message of result.messages) log(world, message);
      if (result.ok) endTurn(world);
      return world;
    }

    case 'SEARCH': {
      // Manual 'c': searches adjacent sites for traps and secret doors.
      searchAdjacent(world);
      const result = scavengeNearby(world);
      for (const message of result.messages) log(world, message);
      endTurn(world);
      return world;
    }

    case 'DISARM': {
      // Manual 'D': disarm an adjacent trap; failure may spring it.
      const target = findDisarmTarget(world, action.x, action.y);
      if (!target) {
        log(world, 'Nothing there to disarm!');
        return world;
      }
      const result = disarmTrapAt(world, target.x, target.y);
      log(world, result.message);
      if (result.sprungMessage) log(world, result.sprungMessage);
      endTurn(world);
      return world;
    }

    case 'DESCEND': {
      const node = nodeFor(world, world.current);
      const onStair = level.tiles[idx(world.player.x, world.player.y)] === TILE_STAIRS_DOWN;
      const to = node.links.down ?? node.links.special?.to ?? null;
      if (!onStair || to === null) return world;
      transitionTo(world, to, 'up');
      log(world, `You descend into ${nodeFor(world, to).name}.`);
      world.turn++;
      questEvent(world, { kind: 'level-entered', level: to });
      refreshFov(world);
      return world;
    }

    case 'ASCEND': {
      const node = nodeFor(world, world.current);
      const onStair = world.current !== 0
        && level.tiles[idx(world.player.x, world.player.y)] === TILE_STAIRS_UP;
      if (!onStair || node.links.up === null) return world;
      transitionTo(world, node.links.up, 'down');
      log(world, `You climb up to ${nodeFor(world, node.links.up).name}.`);
      world.turn++;
      questEvent(world, { kind: 'level-entered', level: node.links.up });
      if (node.links.up === 0) questEvent(world, { kind: 'town-entered' });
      refreshFov(world);
      return world;
    }

    case 'ENTER_TOWN': {
      // APPROX: Rune of Return teleports to the town spawn (shrine: spell
      // uses stair coordinates; town spawn used until M3 spell data lands).
      ensureLevel(world, 0);
      world.current = 0;
      world.player.x = world.data.town.spawn.x;
      world.player.y = world.data.town.spawn.y;
      log(world, 'A rune of return whisks you back to town.');
      world.turn++;
      questEvent(world, { kind: 'town-entered' });
      refreshFov(world);
      return world;
    }

    case 'REST': {
      // Rest until BOTH pools are recovered (UI plan Phase 7, A22): the
      // original port bailed out when mana was full even with hp missing.
      const needsRecovery =
        world.player.mana < world.player.maxMana || world.player.hp < world.player.maxHp;
      if (!needsRecovery) return world; // fully rested: no-op, no turn
      const cap = action.hours ?? REST_HOUR_CAP;
      // Requested hours must be a sane integer bound; anything else is a
      // silent no-op (Task 7) — callers that pass hours must pass clean ones.
      if (!Number.isInteger(cap) || cap < 1 || cap > REST_HOUR_CAP) return world;
      let rested = 0;
      let interrupted = false;
      let died = false;
      while (
        (world.player.mana < world.player.maxMana || world.player.hp < world.player.maxHp) &&
        rested < cap
      ) {
        // Manual: rest is interrupted when a monster comes into sight.
        if (monsterInSight(world)) {
          interrupted = true;
          break;
        }
        world.systems.status.restHour(world);
        // Statuses (poison) age during the rested hour and can kill; death
        // stops the rest IMMEDIATELY, before that hour's recovery applies.
        // The fatal hour itself still elapsed (statuses aged, mana ticked).
        if (world.player.hp <= 0) {
          died = true;
          rested++;
          break;
        }
        // Manual 295: resting regains HP at the natural rate (~1/minute).
        world.player.hp = Math.min(
          world.player.maxHp,
          world.player.hp + REST_HP_PER_HOUR,
        );
        rested++;
        if (rested > REST_HOUR_CAP * 10) break; // hard guard
      }
      world.restedHours += rested;
      world.turn += rested * TURNS_PER_HOUR;
      if (died) log(world, 'You die in your sleep.');
      else log(world, interrupted ? 'Your rest is interrupted!' : `You rest for ${rested} hour${rested === 1 ? '' : 's'}.`);
      refreshFov(world);
      return world;
    }

    case 'PICKUP': {
      try {
        const item = pickup(world.inventory, world.player, action.defId, world.data.items, action.count ?? 1);
        const def = world.data.items[action.defId]!;
        log(world, `You pick up ${def.name}${item.count > 1 ? ` (${item.count})` : ''}.`);
      } catch (err) {
        log(world, err instanceof Error ? err.message : 'You cannot pick that up.');
        return world; // rejected: no turn consumed
      }
      endTurn(world);
      return world;
    }

    case 'DISCARD': {
      // F21: destructive by design. A future world-item transfer is a
      // separate feature (placement/stacking/pickup/render/save migration)
      // and must not reuse this action.
      try {
        const item = world.inventory.pack.find((i) => i.uid === action.uid);
        const def = item ? world.data.items[item.defId] : undefined;
        const n = action.count;
        dropItem(world.inventory, action.uid, n);
        log(world, `You discard ${def?.name ?? 'an object'}${n && n > 1 ? ` (${n})` : ''}.`);
      } catch (err) {
        log(world, err instanceof Error ? err.message : 'You cannot discard that.');
        return world;
      }
      endTurn(world);
      return world;
    }

    case 'USE': {
      try {
        const effect = useItem(
          world.inventory,
          action.uid,
          world.data.items,
          world.systems.effects,
          world,
        );
        if (!effect) {
          log(world, 'Nothing happens.');
          endTurn(world);
      return world; // activate attempt still takes time
        }
        log(world, effect.message ?? 'Used.');
      } catch (err) {
        log(world, err instanceof Error ? err.message : 'You cannot use that.');
        return world;
      }
      endTurn(world);
      return world;
    }

    case 'EQUIP': {
      try {
        const { slot, item } = equip(
          world.inventory,
          world.player,
          action.uid,
          world.data.items,
          world.systems.effects,
        );
        log(world, `You ready ${world.data.items[item.defId]?.name ?? 'the item'} (${slot}).`);
      } catch (err) {
        log(world, err instanceof Error ? err.message : 'You cannot equip that.');
        return world;
      }
      endTurn(world);
      return world;
    }

    case 'UNEQUIP': {
      try {
        unequip(world.inventory, action.slot, world.systems.effects);
        log(world, 'You put it in your pack.');
      } catch (err) {
        log(world, err instanceof Error ? err.message : 'Nothing to remove.');
        return world;
      }
      endTurn(world);
      return world;
    }

    case 'CAST': {
      const def = world.data.spells[action.spellId];
      if (!def) {
        log(world, 'Unknown spell.');
        return world;
      }
      const check = canCast(def, world.player);
      if (!check.ok) {
        log(world, check.reason ?? 'You cannot cast that now.');
        return world;
      }
      const result = applySpellEffect(world, def, action.target);
      if (!result.ok) {
        log(world, result.message); // attack spells etc. — no mana, no turn
        return world;
      }
      world.player.mana -= check.cost ?? 0;
      log(world, result.message);
      endTurn(world);
      return world;
    }
  }
}

/** Dedicated generation seed accessor for cross-checks. */
export function generationSeedOf(world: World, levelIndex: number): number {
  return levelGenSeed(world.worldSeed, levelIndex);
}
