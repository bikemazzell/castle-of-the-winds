// @vitest-environment jsdom
/**
 * Browser-test hooks for Castle of the Winds (e2e runners + ui-review).
 *
 * Extracted from the controller (CODE-QUALITY Task 11) so the hook surface is
 * one typed, shared interface instead of ad-hoc closures. The hooks stay
 * attached in production-preview acceptance too: the e2e suites verify the
 * REAL built bundle (see tools/e2e/run-smoke.ts preview mode), so the drivers
 * cannot be compiled out without breaking that gate. They expose nothing the
 * page cannot already do — read-only telemetry plus scripted drivers.
 */

import { ensureLevel, type Action, type World } from '../engine/world';
import { pickup, equip as equipItem } from '../engine/inventory';
import { findStair, idx, LEVEL_SIZE, type Level } from '../engine/map';
import { questBosses, questEvent } from '../engine/quests';
import { cameraForState, type CameraState, type ViewportSize, type Camera } from './render/camera';
import type { Cell } from './navigation/path';
import type { TownShops } from './scenes/town';
/** Frame-time probe mirrored onto `window.__cotwPerf`. */
export interface PerfProbe {
  frames: number;
  totalMs: number;
  maxMs: number;
}

/** Everything the hooks need from the live controller (property-signature style). */
export interface DevtoolsContext {
  readonly canvas: HTMLCanvasElement;
  readonly town: () => TownShops;
  readonly now: () => number;
  readonly dpr: () => number;
  readonly getWorld: () => World | null;
  readonly isDead: () => boolean;
  readonly isShowingStory: () => boolean;
  readonly isVictoryActive: () => boolean;
  /** Null before the controller's start() creates the viewport. */
  readonly getViewport?: () => ViewportSize;
  readonly getFrameCamera?: () => Camera | null;
  readonly getMotion?: () => { active: boolean; kind: string | null; entities: number };
  readonly getCameraState: () => CameraState | null;
  readonly dispatchAction: (a: Action) => void;
  readonly getAppliedCount: () => number;
  readonly mapTap: (cell: Cell, pointerType: string) => void;
  readonly mapHover: (cell: Cell | null) => void;
  readonly getTravelState: () => {
    active: boolean;
    reason: string | null;
    remaining: number;
    selected: Cell | null;
    hover: Cell | null;
    preview: number;
    attack: Cell | null;
  };
  readonly getTargetingState: () => {
    active: boolean;
    spellId: string | null;
    cell: Cell | null;
    notice: string | null;
  };
  readonly getFlash: () => { cells: { x: number; y: number }[]; start: number; durationMs: number } | null;
  /** Spawn the standard review character on a fixed seed; true when a world exists after. */
  readonly spawnReviewWorld: (seed: number) => boolean;
  readonly sync: () => void;
}

/** The `window.__cotw` hook surface — one shared, typed interface for browser tests. */
export interface CotwHooks {
  turn(): number;
  position(): { x: number; y: number; level: number } | null;
  hp(): number;
  mana(): number;
  isDead(): boolean;
  perfReset(): void;
  dispatch(a: Action): void;
  appliedCount(): number;
  walkable(x: number, y: number, avoidNpcs?: boolean): boolean;
  levelSize(): number;
  stair(kind: 'down' | 'up'): { x: number; y: number } | null;
  boss(): { x: number; y: number; name: string; hp: number } | null;
  entities(): { x: number; y: number; name: string; hp: number }[];
  shopDoors(): { shopId: string; x: number; y: number }[];
  camera(): { tile: number; originX: number; originY: number; zoomIndex: number; panX: number; panY: number } | null;
  log(): string[];
  travel: {
    tap(cell: { x: number; y: number }, pointerType?: string): void;
    hover(cell: { x: number; y: number } | null): void;
    state(): {
      active: boolean;
      reason: string | null;
      remaining: number;
      selected: { x: number; y: number } | null;
      hover: { x: number; y: number } | null;
      preview: number;
      attack: { x: number; y: number } | null;
    };
  };
  targeting(): { active: boolean; spellId: string | null; cell: { x: number; y: number } | null; notice: string | null };
  motion(): { active: boolean; kind: string | null; entities: number };
  flash(): { active: boolean; cells: number; remainingMs: number };
  newGame(seed: number): boolean;
  scene(name: string): { ok: boolean; detail?: string };
}

function currentLevel(w: World | null): Level | null {
  return w ? (w.levels.get(w.current) ?? null) : null;
}

/** Build the hook surface from a controller context (plus its frame probe). */
export function createDevtools(ctx: DevtoolsContext): { hooks: CotwHooks; perf: PerfProbe } {
  const perf: PerfProbe = { frames: 0, totalMs: 0, maxMs: 0 };
  const hooks: CotwHooks = {
    turn: (): number => ctx.getWorld()?.turn ?? -1,
    position: (): { x: number; y: number; level: number } | null => {
      const w = ctx.getWorld();
      return w ? { x: w.player.x, y: w.player.y, level: w.current } : null;
    },
    hp: (): number => ctx.getWorld()?.player.hp ?? -1,
    mana: (): number => ctx.getWorld()?.player.mana ?? -1,
    isDead: (): boolean => ctx.isDead(),
    perfReset: (): void => {
      perf.frames = 0;
      perf.totalMs = 0;
      perf.maxMs = 0;
    },
    /** Drive the engine exactly like the keyboard/dpad would (e2e campaigns). */
    dispatch: (a: Action): void => {
      if (ctx.getWorld() === null || ctx.isDead() || ctx.isShowingStory() || ctx.isVictoryActive()) return;
      ctx.dispatchAction(a);
    },
    /** Monotonic count of applied actions (e2e verifies dispatches actually ran). */
    appliedCount: (): number => ctx.getAppliedCount(),
    /** Terrain oracle; campaign routes can exclude NPCs but still bump-attack monsters. */
    walkable: (x: number, y: number, avoidNpcs = false): boolean => {
      const w = ctx.getWorld();
      const level = currentLevel(w);
      if (!w || !level || x < 0 || y < 0 || x >= LEVEL_SIZE || y >= LEVEL_SIZE) return false;
      const tile = level.tiles[idx(x, y)] ?? 0;
      if (avoidNpcs && level.entities.get(level.occupancy[idx(x, y)]!)?.kind === 'npc') return false;
      return w.data.tiles[String(tile)]?.walkable ?? false;
    },
    levelSize: (): number => LEVEL_SIZE,
    /** First stairs of a kind on the current level, or null. */
    stair: (kind: 'down' | 'up'): { x: number; y: number } | null => {
      const w = ctx.getWorld();
      const level = currentLevel(w);
      if (!w || !level) return null;
      return findStair(level, kind === 'down' ? 0x12 : 0x13);
    },
    /** Quest boss entity on the current level (name/hp for fight telemetry). */
    boss: (): { x: number; y: number; name: string; hp: number } | null => {
      const w = ctx.getWorld();
      const level = currentLevel(w);
      if (!w || !level) return null;
      const bossNames = new Set(questBosses(w.data.quests ?? []).map((b) => b.monster));
      for (const e of level.entities.values()) {
        if (e.kind === 'monster' && e.monster && bossNames.has(e.name)) {
          return { x: e.x, y: e.y, name: e.name, hp: e.monster.hp };
        }
      }
      return null;
    },
    /** Monsters on the current level (telemetry). */
    entities: (): { x: number; y: number; name: string; hp: number }[] => {
      const w = ctx.getWorld();
      const level = currentLevel(w);
      if (!w || !level) return [];
      const out: { x: number; y: number; name: string; hp: number }[] = [];
      for (const e of level.entities.values()) {
        if (e.kind === 'monster' && e.monster) out.push({ x: e.x, y: e.y, name: e.name, hp: e.monster.hp });
      }
      return out;
    },
    /** Town shop-door coordinates (campaign errands). */
    shopDoors: (): { shopId: string; x: number; y: number }[] =>
      ctx.town().buildings.map((b) => ({ shopId: b.shopId, x: b.door.x, y: b.door.y })),
    /** Current camera geometry from live state (zoom/pan aware; null pre-world or unsized). */
    camera: (): { tile: number; originX: number; originY: number; zoomIndex: number; panX: number; panY: number } | null => {
      const w = ctx.getWorld();
      if (!w) return null;
      const cw = ctx.canvas.clientWidth;
      const chh = ctx.canvas.clientHeight;
      if (!cw || !chh) return null;
      const state = ctx.getCameraState();
      if (!state) return null;
      const cam = ctx.getFrameCamera?.() ?? cameraForState(state, { x: w.player.x, y: w.player.y }, (ctx.getViewport?.() ?? { width: cw, height: chh }), ctx.dpr());
      return { tile: cam.tile, originX: cam.originX, originY: cam.originY, zoomIndex: state.zoomIndex, panX: state.panX, panY: state.panY };
    },
    /** Message-log texts (newest last). */
    log: (): string[] => {
      const w = ctx.getWorld();
      return w ? w.log.map((e) => e.text) : [];
    },
    travel: {
      tap: (cell: { x: number; y: number }, pointerType = 'touch'): void => ctx.mapTap(cell, pointerType),
      hover: (cell: { x: number; y: number } | null): void => ctx.mapHover(cell),
      state: () => ctx.getTravelState(),
    },
    targeting: () => ctx.getTargetingState(),
    motion: () => ctx.getMotion?.() ?? { active: false, kind: null, entities: 0 },
    flash: (): { active: boolean; cells: number; remainingMs: number } => {
      const f = ctx.getFlash();
      if (!f) return { active: false, cells: 0, remainingMs: 0 };
      const elapsed = ctx.now() - f.start;
      return {
        active: elapsed < f.durationMs,
        cells: f.cells.length,
        remainingMs: Math.max(0, f.durationMs - elapsed),
      };
    },
    /** UI-review fixture: spawn the standard review character on a FIXED seed. */
    newGame: (seed: number): boolean => ctx.spawnReviewWorld(seed >>> 0),
    /** UI-review fixture scenes: mutate live state for reproducible captures. */
    scene: (name: string): { ok: boolean; detail?: string } => {
      const w = ctx.getWorld();
      if (!w) return { ok: false, detail: 'no world' };
      switch (name) {
        case 'low-health':
          w.player.hp = 3;
          ctx.sync();
          return { ok: true };
        case 'full-pack': {
          const adds: [string, number][] = [
            ['i-long-sword', 1], ['i-leather-armor', 1], ['i-potion', 5],
            ['i-dagger', 1], ['i-club', 1], ['i-spear', 1], ['i-mace', 1], ['i-axe', 1],
          ];
          for (const [defId, count] of adds) {
            try {
              pickup(w.inventory, w.player, defId, w.data.items, count);
            } catch {
              // carry cap reached — fixture tolerates partial packs
            }
          }
          const sword = w.inventory.pack.find((i) => i.defId === 'i-long-sword');
          const armor = w.inventory.pack.find((i) => i.defId === 'i-leather-armor');
          if (sword) equipItem(w.inventory, w.player, sword.uid, w.data.items);
          if (armor) equipItem(w.inventory, w.player, armor.uid, w.data.items);
          ctx.sync();
          return { ok: w.inventory.pack.length >= 6 };
        }
        case 'combat': {
          const level = ensureLevel(w, 1);
          const DIRS8: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
          let placed = false;
          for (const e of level.entities.values()) {
            if (e.kind !== 'monster' || !e.monster) continue;
            for (const [dx, dy] of DIRS8) {
              const x = e.x + dx;
              const y = e.y + dy;
              if (x < 0 || y < 0 || x >= LEVEL_SIZE || y >= LEVEL_SIZE) continue;
              const tile = level.tiles[idx(x, y)] ?? 0;
              const occ = level.occupancy[idx(x, y)] ?? 0;
              if (!w.data.tiles[String(tile)]?.walkable || occ !== 0) continue;
              w.current = 1;
              w.player.x = x;
              w.player.y = y;
              e.monster.alert = true;
              placed = true;
              break;
            }
            if (placed) break;
          }
          if (!placed) return { ok: false, detail: 'no monster with a free neighbor' };
          ctx.dispatchAction({ type: 'WAIT' }); // recompute FOV + let the fight begin
          return { ok: true };
        }
        case 'targeting': {
          const fireball = Object.values(w.data.spells).find(spell => spell.name === 'FIREBALL');
          if (!fireball) return {ok:false,detail:'FIREBALL unavailable in this campaign'};
          if (!w.player.knownSpells.includes(fireball.id)) w.player.knownSpells.push(fireball.id);
          w.player.maxMana = Math.max(w.player.maxMana, 30);
          w.player.mana = w.player.maxMana; // FIREBALL costs 8 at level 1
          ctx.sync();
          return { ok: true };
        }
        case 'shop': {
          const doors = ctx.town().buildings.map((b) => b.door);
          const level = w.levels.get(0);
          if (!level) return { ok: false, detail: 'no town level' };
          const DIRS4: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
          for (const d of doors) {
            for (const [dx, dy] of DIRS4) {
              const x = d.x + dx;
              const y = d.y + dy;
              const tile = level.tiles[idx(x, y)] ?? 0;
              if (!w.data.tiles[String(tile)]?.walkable) continue;
              w.player.x = x;
              w.player.y = y;
              ctx.dispatchAction({ type: 'WAIT' }); // refresh FOV for the new position
              return { ok: true };
            }
          }
          return { ok: false, detail: 'no door with a walkable neighbor' };
        }
        case 'death':
          w.player.hp = 0;
          ctx.sync();
          return { ok: true };
        case 'victory': {
          questEvent(w, { kind: 'level-entered', level: 8 });
          questEvent(w, { kind: 'town-entered' });
          questEvent(w, { kind: 'level-entered', level: 9 });
          questEvent(w, { kind: 'level-entered', level: 10 });
          questEvent(w, { kind: 'level-entered', level: 11 });
          questEvent(w, { kind: 'monster-killed', name: 'Hrungnir, The Hill Giant Lord' });
          return { ok: w.questState?.victory === true };
        }
        default:
          return { ok: false, detail: `unknown scene ${name}` };
      }
    },
  };
  return { hooks, perf };
}

/** Attach the hooks + perf probe to `window.__cotw` / `window.__cotwPerf`. */
export function attachDevtools(
  win: Window | undefined,
  ctx: DevtoolsContext,
): { hooks: CotwHooks; perf: PerfProbe; detach: () => void } {
  const { hooks, perf } = createDevtools(ctx);
  const target = win as unknown as Record<string, unknown> | undefined;
  if (target) {
    target.__cotw = hooks;
    target.__cotwPerf = perf;
  }
  const detach = (): void => {
    if (!target) return;
    try {
      delete target.__cotw;
      delete target.__cotwPerf;
    } catch {
      // best-effort cleanup only
    }
  };
  return { hooks, perf, detach };
}
