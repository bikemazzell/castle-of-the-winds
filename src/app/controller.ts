import { captureCombat } from '../engine/combat-feedback';
import type { ActionCue } from './render/action-feedback';
import { movementPosition, continueMovement, MOVE_DURATION_MS } from './render/movement';
import { createAmbient } from './render/ambient';
import { createEnvironmentCache, daylight } from './render/environment';
import { createHeroCache, heroAppearance } from './render/hero-art';
import { createImpactStore, damageImpacts, type DamageActor } from './render/impacts';
/**
 * Game controller: the glue between the engine (world/dispatch), the shell
 * (HUD/map/sheet), the canvas renderer, and the dialog suite. Owns the
 * running World, routes HUD/keyboard/d-pad commands to engine actions, and
 * runs post-action effects (death, level-up, town merchants, auto-stairs).
 */

import { dispatch, type Action, type World } from '../engine/world';
import { loadWorldData, newWorld } from '../engine/game';
import type { WorldData } from '../engine/types';
import type { CharacterInit } from '../engine/character';
import { equipmentStats, autoArrange } from '../engine/inventory';
import { TILE_STAIRS_DOWN, TILE_STAIRS_UP } from '../engine/dungeon';
import { idx, LEVEL_SIZE, type Level } from '../engine/map';
import { buyItem, sellItem, healPlayer, identifyItem } from '../engine/commerce';
import { hasStatus } from '../engine/effects';
import { attachDevtools } from './devtools';
import { createShell, watchOrientation, applyOrientation, type Shell } from './shell';
import { createHud, mountSheetControls, type Hud } from './ui/hud';
import { openModal, openModalCount, closeAllModals, openCharacterDialog } from './ui/dialogs';
import { createInventoryPanel, type InventoryPanel } from './ui/inventory';
import { createSpellbookPanel } from './ui/spellbook';
import { createMerchantPanel, type MerchantPanel, type ShopDef } from './ui/merchant';
import { openPreferencesDialog, openRestDialog } from './ui/options';
import { buildTabbedHelp, type ManualTopic } from './ui/help';
import { buildLogList } from './ui/logview';
import { importPart1Character } from './import';
import { openNewGameDialog, openDeathDialog, buildNewGameContent } from './ui/newgame';
import { showStoryTexts, showVictory, openJournalDialog } from './ui/story';
import {
  loadOnboarding,
  markStepDone,
  ONBOARDING_STEPS,
  resetOnboarding,
  showHintToast,
  skipAllHints,
} from './ui/onboarding';
import { openPauseScreen } from './ui/pause';
import { openDebugDialog } from './ui/debug';
import { createSaveManager, SaveSlotError, type SaveManager } from './saves/manager';
import { openSaveDialog } from './saves/ui';
import { openEditorDialog } from './editor/ui';
import { serializeGame, deserializeGame, type SaveFile } from '../engine/save';
import { ownFocus } from './ui/focus';
import { createGameInput, type GameInput } from './input/input';
import { createViewport, type Viewport } from './render/viewport';
import { createRenderer, renderFrame, type Renderer, type RenderStyles, type Ctx2D, type ActorMotion, type SceneInput } from './render/renderer';
import { buildTileStyles, loadSprites, spriteNamesFor, type TileDefLike } from './render/styles';
import { loadActorSprites } from './render/actor-art';
import { createTerrainArt } from './render/terrain-art';
import { loadTownShops, shopDoorAt, type TownShops } from './scenes/town';

import { findCardinalRoute, type Cell, type RouteWorld } from './navigation/path';
import { createTravelRunner, type TravelRunner } from './navigation/travel';
import { monsterInSight } from '../engine/monsters';
import { canCast, manaCostFor, ballImpactArea, boltPath, type SpellDefRuntime } from '../engine/spells';
import {
  loadFavoriteSpells,
  loadPreferences,
  savePreferences,
  toggleFavoriteSpell,
  type PreferenceStorage,
} from './prefs';
import tilesJson from '../data/tiles.json';
import manualJson from '../data/manual.json';
import part2ManualJson from '../data/part2/manual.json';

export interface ControllerDeps {
  root: HTMLElement;
  data: WorldData;
  town: TownShops;
  win?: Window;
  now?: () => number;
  loadTileSprites?: (tiles: TileDefLike[]) => Promise<Record<string, unknown>>;
  /** Test seam: overrides camera-based screen→world mapping. */
  screenToWorld?: (px: number, py: number) => { x: number; y: number };
  /** Save manager (slots + autosave + import/export). Defaults to localStorage. */
  saves?: SaveManager;
  /**
   * Part-2 save manager (PART2-PLAN Task P6). Injected by tests alongside
   * `saves`; production resolves both from localStorage with part-scoped keys.
   * Pass explicit `null` to simulate storage-unavailable for part 2.
   */
  savesPart2?: SaveManager | null;
  /** Preferences storage (favorite spells). Defaults to win.localStorage. */
  storage?: PreferenceStorage;
  /** Reduced-motion preference (UI plan Phase 6). Defaults to matchMedia. */
  reducedMotion?: () => boolean;
}

/** Brief cast feedback duration (UI plan Phase 6). Reduced motion skips it. */
export const FLASH_DURATION_MS = 400;

/** Cells a cast visually touches: ball → 3×3 area, bolt → flight path,
 * missile → the target cell, everything else → the caster's own cell. */
export function flashCellsFor(
  def: SpellDefRuntime,
  level: Level,
  from: { x: number; y: number },
  to?: { x: number; y: number },
): { x: number; y: number }[] {
  if (to) {
    if (def.effect === 'ball') {
      return ballImpactArea(level, to).map((c) => ({ x: c.x, y: c.y }));
    }
    if (def.effect === 'bolt') {
      return boltPath(level, from, to).map((c) => ({ x: c.x, y: c.y }));
    }
    if (def.effect === 'missile') {
      return [to];
    }
  }
  return [from];
}

export interface GameController {
  start(): void;
  newGame(): void;
  dispatchAction(action: Action): void;
  openMerchant(shop: ShopDef): void;
  getWorld(): World | null;
  isDead(): boolean;
  isInputEnabled(): boolean;
  destroy(): void;
}

/** Post-action world effects the UI reacts to (order: death wins). */
export function afterActionEffects(world: World, levelBefore: number): 'death' | 'level-up' | null {
  if (world.player.hp <= 0) return 'death';
  if (world.player.level > levelBefore) return 'level-up';
  return null;
}

interface TilesFileLike {
  tiles: TileDefLike[];
}

const TILE_DEFS: TileDefLike[] = (tilesJson as unknown as TilesFileLike).tiles;

async function defaultLoadTileSprites(tiles: TileDefLike[]): Promise<Record<string, unknown>> {
  const terrain = loadSprites(spriteNamesFor(tiles), name => Promise.resolve(createTerrainArt(name)));
  const [tilesLoaded, actors] = await Promise.all([
    terrain,
    loadActorSprites().catch((error: unknown) => {
      console.warn('[cotw] Actor art unavailable; using markers', error);
      return {};
    }),
  ]);
  return { ...tilesLoaded, ...actors };
}

/**
 * localStorage access can itself throw (browsers disable storage by policy in
 * some contexts). CODE-QUALITY F18: every read goes through this guard so the
 * controller falls back to its no-op shim instead of crashing at construction.
 */
function safeLocalStorage(win: Window | undefined): Storage | null {
  try {
    return win?.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createGameController(deps: ControllerDeps): GameController {
  const win = deps.win ?? (typeof window !== 'undefined' ? window : undefined);
  const doc = win?.document;
  if (!doc) throw new Error('game controller needs a DOM (pass win)');

  const shell: Shell = createShell(deps.root);
  let hud: Hud;
  const canvas = shell.mapEl.querySelector('canvas') as HTMLCanvasElement;
  let world: World | null = null;
  let dead = false;
  /** Spell targeting session (UI plan Phase 6): null when inactive. */
  let targeting: { spellId: string; name: string; cost: number } | null = null;
  let targetCell: Cell | null = null;
  let targetNotice: string | null = null;
  let targetBarEl: HTMLElement | null = null;
  let input: GameInput | null = null;
  let renderer: Renderer | null = null;
  /** Set by destroy(): late async callbacks (art loads) check this. */
  let destroyed = false;
  /** Viewport owns camera state + view controls (zoom/pan/pinch/wheel,
   *  map buttons, resize + dpr watching). Created in start() with the shell. */
  let camViewport: Viewport | null = null;
  let turnMotion: { start: number; level: number; player?: ActorMotion; entities: Map<number, ActorMotion> } | null = null;
  const TURN_MOTION_MS = MOVE_DURATION_MS;
  let actionFeedback:{start:number;cues:ActionCue[]}|null=null;
  const interactFeedback=():void=>{if(world&&!prefersReducedMotion()){actionFeedback={start:(deps.now??Date.now)(),cues:[{kind:'interact',at:{x:world.player.x,y:world.player.y}}]};renderer?.markDirty();}};
  let stopOrientation: (() => void) | null = null;
  let titleEl: HTMLElement | null = null;
  let showingStory = false;
  /** The victory overlay is up (input + dispatches blocked until title/new). */
  let victoryActive = false;
  /** Progress not present in any save slot (drives pause/quit truthfulness). */
  let dirtySinceSave = true;
  let debugRevealMap = false;
  /** Favorite spells (quick slots, UI plan Phase 6) — browser preference. */
  const prefsStorage: PreferenceStorage =
    // NOTE: fall back through the controller's `win` (global window in the
    // browser), NOT deps.win — production passes neither win nor storage, and
    // reading deps.win directly silently swapped in the no-op shim (favorites,
    // preferences and onboarding never persisted; text scale never applied).
    deps.storage ?? (safeLocalStorage(win) ?? {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
  let favoriteSpells = loadFavoriteSpells(prefsStorage);
  /** Working preferences (UI plan Phase 7): text size, map scale, motion, safe confirm. */
  let preferences = loadPreferences(prefsStorage);
  /** Brief cast feedback (UI plan Phase 6): affected cells + fade window. */
  let flash: { cells: { x: number; y: number }[]; start: number; durationMs: number } | null = null;
  /** Onboarding hints (UI plan Phase 7): shown once after a fresh game's story. */
  let hintsPending = false;
  let hintEl: HTMLElement | null = null;
  const removeHint = (): void => {
    hintEl?.remove();
    hintEl = null;
  };
  const showHintsFrom = (index: number): void => {
    removeHint();
    const steps = ONBOARDING_STEPS;
    if (index >= steps.length) return;
    const step = steps[index]!;
    hintEl = showHintToast({
      step,
      index,
      total: steps.length,
      onAdvance: () => {
        markStepDone(prefsStorage, step.id);
        showHintsFrom(index + 1);
      },
      onSkipAll: () => {
        skipAllHints(prefsStorage);
        removeHint();
      },
    });
    deps.root.appendChild(hintEl);
  };
  const maybeStartHints = (): void => {
    if (!hintsPending) return;
    hintsPending = false;
    const state = loadOnboarding(prefsStorage);
    if (state.skipped) return;
    const firstUndone = ONBOARDING_STEPS.findIndex((s) => !state.done.includes(s.id));
    if (firstUndone < 0) return;
    showHintsFrom(firstUndone);
  };

  const prefersReducedMotion = (): boolean => {
    if (deps.reducedMotion) return deps.reducedMotion();
    if (preferences.reduceMotion === 'on') return true;
    if (preferences.reduceMotion === 'off') return false;
    return win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  };

  /** Apply the working preferences immediately (UI plan Phase 7 task 7.5). */
  const applyPreferences = (): void => {
    if (win?.document) {
      win.document.documentElement.style.setProperty('--text-scale', String(preferences.textScale));
    }
    // camViewport is null before start(); start() re-applies after creation.
    camViewport?.applyPreferenceScale(preferences.mapScale);
  };
  applyPreferences();

  // --- e2e hooks: typed module (src/app/devtools.ts) — one shared interface ---
  const devtools = attachDevtools(win, {
    canvas,
    town: () => townFor(world?.data.part ?? titlePart),
    now: () => (deps.now ?? Date.now)(),
    dpr: () => win?.devicePixelRatio ?? 1,
    getWorld: () => world,
    isDead: () => dead,
    isShowingStory: () => showingStory,
    isVictoryActive: () => victoryActive,
    getCameraState: () => camViewport?.state ?? null,
    getFrameCamera: () => camViewport?.lastCamera() ?? null,
    dispatchAction: (a) => dispatchAction(a),
    getAppliedCount: () => appliedCount,
    mapTap: (cell, pointerType) => handleMapTap(cell, pointerType),
    mapHover: (cell) => handleMapHover(cell),
    getTravelState: () => ({
      active: travelRunner?.state.active ?? false,
      reason: travelRunner?.state.reason ?? null,
      remaining: travelRunner?.state.remaining.length ?? 0,
      selected: selectedCell,
      hover: hoverCell,
      preview: previewSteps?.length ?? 0,
      attack: pendingAttack,
    }),
    getTargetingState: () => ({
      active: targeting !== null,
      spellId: targeting?.spellId ?? null,
      cell: targetCell,
      notice: targetNotice,
    }),
    getViewport: () => mapViewport(canvas.clientWidth, canvas.clientHeight),
    getMotion: () => ({
      active: !!turnMotion && !prefersReducedMotion() && (deps.now ?? Date.now)() - turnMotion.start < TURN_MOTION_MS,
      kind: turnMotion?.player?.kind ?? null,
      entities: turnMotion?.entities.size ?? 0,
    }),
    getFlash: () => flash,
    spawnReviewWorld: (seed) => {
      spawnWorld(
        {
          name: 'Review',
          gender: 'female',
          strength: 50,
          intelligence: 50,
          constitution: 50,
          dexterity: 50,
          difficulty: 'intermediate',
        },
        seed,
      );
      return world !== null;
    },
    sync: () => sync(),
  });
  const perf = devtools.perf;

  const savesFor = (part: 1 | 2): SaveManager | null => {
    const cachedManager = saveManagers.get(part);
    if (cachedManager !== undefined) return cachedManager ?? null;
    let manager: SaveManager | null = null;
    if (part === 1 && deps.saves) {
      manager = deps.saves;
    } else if (part === 2 && deps.savesPart2 !== undefined) {
      manager = deps.savesPart2 ?? null;
    } else {
      const ls = safeLocalStorage(win);
      if (ls) {
        manager = createSaveManager({
          storage: ls,
          part,
          validate: (parsed) => {
            try {
              // PART2-PLAN Task P5: resolve the bundle by the SAVE's
              // meta.part, never by the controller's loaded bundle.
              const filePart =
                (parsed as { meta?: { part?: unknown } }).meta?.part === 2 ? 2 : 1;
              deserializeGame(parsed, loadWorldData(filePart));
            } catch (err) {
              throw new SaveSlotError(err instanceof Error ? err.message : 'invalid save data');
            }
          },
        });
      }
    }
    saveManagers.set(part, manager);
    return manager;
  };
  const saveManagers = new Map<1 | 2, SaveManager | null>();
  /** Which part's title screen is showing (PART2-PLAN Task P6). */
  let titlePart: 1 | 2 = 1;
  /**
   * The data bundle for a part. Part 1 honors injected `deps.data` (tests pass
   * small synthetic bundles); part 2 always loads the real extracted bundle.
   */
  const bundleFor = (part: 1 | 2): WorldData => (part === 1 ? deps.data : loadWorldData(2));
  /** Editor dialogs edit a SAVE — hand them that save's part bundle. */
  const dataForSave = (file: SaveFile): WorldData =>
    file.meta?.part === 2 && deps.data.part !== 2 ? loadWorldData(2) : deps.data;
  /** Town shops per part, same injection rule as the data bundle. */
  const townFor = (part: 1 | 2): TownShops =>
    part === 1 ? deps.town : loadTownShops(2);
  /** The active saves manager: the played world's part, else the title's. */
  let saves: SaveManager | null = savesFor(1);

  const serializeNow = (): SaveFile => {
    const w = world;
    if (!w) throw new Error('no world to save');
    return serializeGame(w, {
      savedAt: new Date((deps.now ?? Date.now)()).toISOString(),
    });
  };

  const autosaveNow = (): void => {
    const w = world;
    if (!saves || !w || dead) return;
    try {
      saves.autosave(serializeNow());
      dirtySinceSave = false;
    } catch (err) {
      w.log.push({ turn: w.turn, text: `Autosave failed: ${err instanceof Error ? err.message : 'storage error'}` });
      sync();
    }
  };

  const openSaveMenu = (mode: 'save' | 'load'): void => {
    if (!saves) return;
    const mgr = saves;
    closeAllModals();
    openSaveDialog({
      mode,
      manager: mgr,
      levelName: index =>
        (world?.data ?? bundleFor(titlePart)).levels.find(level => level.index === index)?.name
        ?? `Level ${index}`,
      onSave: (slot) => {
        const w = world;
        if (!w || dead) return;
        try {
          mgr.saveToSlot(slot, serializeNow());
          dirtySinceSave = false;
          w.log.push({ turn: w.turn, text: 'Game saved.' });
        } catch (err) {
          w.log.push({
            turn: w.turn,
            text: `Save failed: ${err instanceof Error ? err.message : 'storage error'}`,
          });
        }
        sync();
        closeAllModals();
      },
      onLoad: (file) => loadGame(file),
      onImport: (file) => loadGame(file, false),
      onEdit: (slot) => {
        let file: SaveFile;
        try {
          file = mgr.loadSlot(slot);
        } catch (err) {
          world?.log.push({
            turn: world.turn,
            text: `Edit failed: ${err instanceof Error ? err.message : 'storage error'}`,
          });
          sync();
          return;
        }
        closeAllModals();
        openEditorDialog({
          save: file,
          data: dataForSave(file),
          onApply: (edited) => {
            try {
              if (slot === 'auto') mgr.autosave(edited);
              else mgr.saveToSlot(slot, edited);
              const w = world;
              w?.log.push({ turn: w.turn, text: 'Save updated.' });
            } catch (err) {
              const w = world;
              w?.log.push({
                turn: w.turn,
                text: `Edit failed: ${err instanceof Error ? err.message : 'storage error'}`,
              });
            }
            sync();
            closeAllModals();
          },
        });
      },
    });
  };

  const loadGame = (file: SaveFile, hasStoredCopy = true): void => {
    let rebuilt: World;
    hintsPending = false; // loading never replays onboarding (UI plan Phase 7)
    removeHint();
    try {
      // PART2-PLAN Task P5: the save names its bundle; resolve before rebuild.
      const part = file.meta?.part === 2 ? 2 : 1;
      rebuilt = deserializeGame(file, loadWorldData(part));
    } catch (err) {
      // Storage-level validation normally catches this; keep the game intact.
      const w = world;
      w?.log.push({
        turn: w.turn,
        text: `Load failed: ${err instanceof Error ? err.message : 'invalid save data'}`,
      });
      sync();
      return;
    }
    // Cancel every pending command of the OLD world before replacing it —
    // travel, targeting, selections (Task 5).
    cancelPendingCommands('load');
    victoryActive = false;
    showingStory = false;
    closeAllModals();
    world = rebuilt;
    // The loaded world names its campaign: switch the saves manager so any
    // subsequent save writes into that part's key space (Task P6).
    saves = savesFor(rebuilt.data.part);
    camViewport?.recenter(); // loaded game: camera sits on the hero (Phase 4)
    dirtySinceSave = !hasStoredCopy; // imports and edited copies still need saving
    dead = false;
    titleEl?.remove();
    titleEl = null;
    ensureInputRenderer();
    if (!world.log.length) {
      world.log.push({ turn: 0, text: `Welcome back, ${world.player.name}.` });
    }
    sync();
    drainQuestStories();
    refreshGate();
    if (world.player.hp <= 0) onDeath();
  };

  /**
   * THE single interface-state owner (Task 5): every screen the game can be
   * on, derived — never stored separately. Input permission, HUD/keyboard
   * routing, and debug dispatches all consult this.
   */
  type ControllerPhase = 'title' | 'dead' | 'story' | 'victory' | 'targeting' | 'playing';
  const phase = (): ControllerPhase => {
    if (world === null) return 'title';
    if (dead) return 'dead';
    if (showingStory) return 'story';
    if (victoryActive) return 'victory';
    if (targeting) return 'targeting';
    return 'playing';
  };

  const styles: RenderStyles = {
    tiles: buildTileStyles(TILE_DEFS),
    sprites: {},
  };

  const ambient = createAmbient(() => renderer?.markDirty());
  const heroImage = createHeroCache();
  const impacts = createImpactStore();
  const environmentCache = createEnvironmentCache();
  const refreshGate = (): void => {
    const unobstructed = openModalCount() === 0;
    ambient.setActive(!!renderer && !destroyed && !doc.hidden && phase() === 'playing' && unobstructed && !prefersReducedMotion());
    input?.setEnabled(phase() === 'playing' && unobstructed, (phase() === 'playing' || phase() === 'targeting') && unobstructed);
  };

  const motionMedia = win?.matchMedia?.('(prefers-reduced-motion: reduce)');
  const onMotionPreference = ():void => {refreshGate();renderer?.markDirty();};
  motionMedia?.addEventListener?.('change',onMotionPreference);

  const levelName = (w: World): string => {
    const name = w.data.levels.find((n) => n.index === w.current)?.name ?? `Level ${w.current}`;
    if (w.current !== 0) return name;
    const hour = daylight(w.turn).hour;
    return `${name} · ${String(Math.floor(hour)).padStart(2,'0')}:${String(Math.floor((hour%1)*60)).padStart(2,'0')}`;
  };

  const sync = (): void => {
    const w = world;
    if (!w || !hud) return;
    hud.update(
      {
        name: w.player.name,
        hp: w.player.hp,
        maxHp: w.player.maxHp,
        mana: w.player.mana,
        maxMana: w.player.maxMana,
        gold: w.inventory.gold,
        level: w.player.level,
        place: levelName(w),
        statuses: [...w.player.statuses.map(s => s.kind.replaceAll('_', ' '))],
        slots: favoriteSpells.map((id) => {
          const def = w.data.spells[id];
          if (!def) {
            return { spellId: id, label: id, cost: 0, castable: false, reason: 'unknown spell' };
          }
          if (!w.player.knownSpells.includes(id)) {
            return { spellId: id, label: def.name, cost: 0, castable: false, reason: 'not learned' };
          }
          const check = canCast(def, w.player);
          return {
            spellId: id,
            label: def.name,
            cost: manaCostFor(def, w.player),
            castable: check.ok,
            reason: check.ok ? undefined : (check.reason ?? 'unavailable'),
          };
        }),
      },
      w.log,
    );
    renderer?.markDirty();
  };

  // ---- dialog openers (rebuild views, engine owns state) ----

  const openCharacter = (): void => {
    const w = world;
    if (!w) return;
    openCharacterDialog({
      player: w.player,
      thresholds: w.data.xpThresholds,
      derived: equipmentStats(w.inventory, w.data.items, w.player),
    });
  };

  const openInventory = (): void => {
    const w = world;
    if (!w || dead) return;
    // The panel refreshes IN PLACE after actions: selection, filters, and
    // scroll survive (A13) — no close/reopen churn. If the player dies
    // mid-action, close the inventory so the death dialog stands alone
    // (plan §8 + UI plan Phase 1).
    let panel: InventoryPanel | null = null;
    const afterAction = (): void => {
      const cur = world;
      if (!cur) return;
      if (dead) {
        inventoryHandle.close();
        return;
      }
      panel?.refresh(cur.inventory, equipmentStats(cur.inventory, cur.data.items, cur.player));
      sync();
    };
    panel = createInventoryPanel({
      inv: w.inventory,
      defs: w.data.items,
      player: w.player,
      derived: equipmentStats(w.inventory, w.data.items, w.player),
      actions: {
        onEquip: (uid) => { dispatchAction({ type: 'EQUIP', uid }); afterAction(); },
        onUnequip: (slot) => { dispatchAction({ type: 'UNEQUIP', slot }); afterAction(); },
        onUse: (uid) => { dispatchAction({ type: 'USE', uid }); afterAction(); },
        onDiscard: (uid) => { dispatchAction({ type: 'DISCARD', uid }); afterAction(); },
        onAutoArrange: () => { autoArrange(w.inventory, w.data.items); dirtySinceSave = true; afterAction(); },
      },
    });
    const inventoryHandle = openModal({ title: 'Inventory', content: panel.el, className: 'dialog-inventory' });
  };

  const beginCast = (spellId: string): void => {
    const w = world;
    if (!w || dead) return;
    const def = w.data.spells[spellId];
    if (!def) return;
    if (def.target === 'enemy') {
      closeAllModals();
      startTargeting(spellId, def.name);
      return;
    }
    closeAllModals();
    dispatchAction({ type: 'CAST', spellId });
  };

  const openSpellbook = (): void => {
    const w = world;
    if (!w || dead) return;
    // Panel pattern (A13): favorite toggles refresh in place; casts close
    // the modal via beginCast.
    const refresh = (): void => {
      const cur = world;
      if (!cur) return;
      panel.refresh({
        player: cur.player,
        spells: cur.data.spells,
        favorites: favoriteSpells,
        actions: { onCast: beginCast, onToggleFavorite },
      });
    };
    const onToggleFavorite = (spellId: string): void => {
      favoriteSpells = toggleFavoriteSpell(prefsStorage, spellId);
      refresh();
      sync();
    };
    const panel = createSpellbookPanel({
      player: w.player,
      spells: w.data.spells,
      favorites: favoriteSpells,
      actions: { onCast: beginCast, onToggleFavorite },
    });
    openModal({ title: 'Spellbook', content: panel.el, className: 'dialog-spellbook' });
  };

  /** Cast from a HUD quick slot (favorite spell). */
  const castFromFavoriteSlot = (index: number): void => {
    const w = world;
    if (!w || dead) return;
    const id = favoriteSpells[index];
    if (!id) return;
    const def = w.data.spells[id];
    if (!def) return;
    if (!w.player.knownSpells.includes(id)) return;
    beginCast(id);
  };

  const openRest = (): void => {
    const w = world;
    if (!w || dead) return;
    openRestDialog({
      hpMissing: w.player.maxHp - w.player.hp,
      manaMissing: w.player.maxMana - w.player.mana,
      onRest: () => { closeAllModals(); dispatchAction({ type: 'REST' }); },
    });
  };

  const openMap = (): void => {
    const w = world;
    if (!w) return;
    const level = w.levels.get(w.current);
    const seen = w.seen.get(w.current);
    const content = doc.createElement('div');
    if (!level || !seen) {
      content.textContent = 'No map for this level yet.';
    } else {
      const mini = doc.createElement('canvas');
      mini.className = 'minimap';
      mini.width = LEVEL_SIZE * 4;
      mini.height = LEVEL_SIZE * 4;
      mini.dataset.minimap = '';
      content.appendChild(mini);
      const ctx = mini.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#0d0917';
        ctx.fillRect(0, 0, mini.width, mini.height);
        for (let y = 0; y < LEVEL_SIZE; y++) {
          for (let x = 0; x < LEVEL_SIZE; x++) {
            const i = idx(x, y);
            if (!debugRevealMap && !seen[i]) continue;
            const t = level.tiles[i] ?? 0;
            ctx.fillStyle =
              t === TILE_STAIRS_DOWN || t === TILE_STAIRS_UP
                ? '#c9a86a'
                : debugRevealMap || w.visible[i]
                  ? '#6a5a9a'
                  : '#3a3450';
            ctx.fillRect(x * 4, y * 4, 4, 4);
          }
        }
        ctx.fillStyle = '#ffd76a';
        ctx.fillRect(w.player.x * 4, w.player.y * 4, 4, 4);
      } else {
        const note = doc.createElement('p');
        note.textContent = 'Map rendering needs a canvas.';
        content.appendChild(note);
      }
    }
    const legend = doc.createElement('p');
    legend.className = 'map-legend';
    legend.textContent = 'Gold: you and known stairs. Purple: explored terrain. Dark areas are unexplored. This map is for viewing.';
    content.append(legend);
    openModal({ title: `Map — ${levelName(w)}`, content });
  };

  /** Pause screen (UI plan §4 / Phase 3): Esc or the Pause button. */
  const openPause = (): void => {
    const w = world;
    if (!w || dead) return;
    openPauseScreen({
      summary: {
        name: w.player.name,
        level: w.player.level,
        place: levelName(w),
        hp: w.player.hp,
        maxHp: w.player.maxHp,
        mana: w.player.mana,
        maxMana: w.player.maxMana,
        unsaved: dirtySinceSave,
      },
      onResume: () => refreshGate(),
      onSaveLoad: () => openSaveLoadChooser(),
      onSettings: () => openOptions(),
      onHelp: () => openHelp(),
      onDebug: () => openDebugDialog({
        revealMap: debugRevealMap,
        onReveal: (enabled) => {
          debugRevealMap = enabled;
          renderer?.markDirty();
        },
        onEdit: (initialTab) => {
          const snapshot = serializeNow();
          openEditorDialog({
            save: snapshot,
            data: dataForSave(snapshot),
            title: 'Debug editor',
            initialTab,
            onApply: (edited) => {
              loadGame(edited, false);
              dirtySinceSave = true;
            },
          });
        },
      }),
      onQuit: () => quitToTitle(),
    });
  };

  /** Save / Load subflow of the pause screen; editing is Advanced. */
  const openSaveLoadChooser = (): void => {
    const content = doc.createElement('div');
    content.className = 'menu-list';
    const rows: Array<[string, string, () => void]> = [];
    if (world && !dead) {
      rows.push(['Save…', 'save', () => { closeAllModals(); openSaveMenu('save'); }]);
    }
    rows.push(['Load…', 'load', () => { closeAllModals(); openSaveMenu('load'); }]);
    if (world && !dead) {
      rows.push(['Edit Save… (advanced)', 'edit-save', () => {
        closeAllModals();
        const snapshot = serializeNow();
        openEditorDialog({
          save: snapshot,
          data: dataForSave(snapshot),
          onApply: (edited) => loadGame(edited, false),
        });
      }]);
    }
    for (const [label, action, fn] of rows) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.dataset.action = action;
      btn.addEventListener('click', fn);
      content.appendChild(btn);
    }
    openModal({ title: 'Save / Load', content });
  };

  /** Gameplay command dock panel (UI plan §4: Actions). */
  const openActionsPanel = (): void => {
    if (!world || dead) return;
    const content = doc.createElement('div');
    content.className = 'menu-list';
    const rows: Array<[string, string, () => void]> = [
      ['Search · 1 turn (X)', 'search', () => { closeAllModals(); dispatchAction({ type: 'SEARCH' }); }],
      ['Rest · time passes', 'rest', () => { closeAllModals(); openRest(); }],
      ['Journal', 'journal', () => { closeAllModals(); openJournalDialog(world?.questState?.journal ?? []); }],
    ];
    for (const [label, action, fn] of rows) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.dataset.action = action;
      btn.addEventListener('click', fn);
      content.appendChild(btn);
    }
    openModal({ title: 'Actions', content });
  };

  /** Expanded message log (A16: the sheet shows only the latest line). */
  const openLog = (): void => {
    const w = world;
    if (!w) return;
    openModal({ title: 'Message Log', content: buildLogList(w.log.slice(-100)) });
  };

  /** Quit to Title with unsaved-progress + save-failure handling. */
  const toTitle = (): void => {
    closeAllModals();
    cancelPendingCommands('quit');
    victoryActive = false;
    showingStory = false;
    world = null;
    dead = false;
    dirtySinceSave = false;
    // Back on the title: the selected part's slots drive Continue/Load.
    saves = savesFor(titlePart);
    titleEl?.remove();
    titleEl = null;
    hud?.update(
      { name: '', hp: 0, maxHp: 0, mana: 0, maxMana: 0, gold: 0, level: 0, place: '' },
      [],
    );
    mountTitle();
    refreshGate();
  };

  /** Best-effort file download of the current game state (quit flow). */
  const downloadCurrentSave = (): void => {
    const w = world;
    if (!w || !win) return;
    const slug = w.player.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'save';
    try {
      const blob = new Blob([JSON.stringify(serializeNow(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = `${slug}.cotwsave.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      /* export is best-effort; the game keeps running either way */
    }
  };

  const quitToTitle = (): void => {
    const w = world;
    if (!w || !dirtySinceSave) {
      toTitle();
      return;
    }
    const content = doc.createElement('div');
    content.className = 'menu-list';
    const note = doc.createElement('p');
    note.textContent = 'You have unsaved progress.';
    content.appendChild(note);

    const saveAndQuit = doc.createElement('button');
    saveAndQuit.type = 'button';
    saveAndQuit.textContent = 'Save and Quit';
    saveAndQuit.dataset.action = 'quit-save';
    saveAndQuit.addEventListener('click', () => {
      try {
        if (!saves) throw new Error('no storage available');
        saves.autosave(serializeNow());
        dirtySinceSave = false;
        toTitle();
      } catch (err) {
        // Plan §4: stay in the game, show the error, offer Export.
        const w2 = world;
        content.textContent = '';
        const msg = doc.createElement('p');
        msg.className = 'quit-error';
        msg.textContent =
          `Save failed: ${err instanceof Error ? err.message : 'storage error'}. ` +
          'Your game is still running.';
        content.appendChild(msg);
        if (w2) {
          const exportBtn = doc.createElement('button');
          exportBtn.type = 'button';
          exportBtn.textContent = 'Export Save File';
          exportBtn.dataset.action = 'quit-export';
          exportBtn.addEventListener('click', downloadCurrentSave);
          content.appendChild(exportBtn);
        }
        const stay = doc.createElement('button');
        stay.type = 'button';
        stay.textContent = 'Stay in Game';
        stay.dataset.action = 'quit-stay';
        stay.addEventListener('click', () => closeAllModals());
        content.appendChild(stay);
      }
    });
    content.appendChild(saveAndQuit);

    const quitWithout = doc.createElement('button');
    quitWithout.type = 'button';
    quitWithout.textContent = 'Quit Without Saving';
    quitWithout.dataset.action = 'quit-without';
    quitWithout.addEventListener('click', () => toTitle());
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.dataset.action = 'quit-cancel';
    cancel.addEventListener('click', () => { closeAllModals(); openPause(); });
    content.append(quitWithout, cancel);
    openModal({ title: 'Quit to Title', content });
  };

  const openOptions = (): void => {
    openPreferencesDialog({
      prefs: preferences,
      onChange: (next) => {
        preferences = next;
        savePreferences(prefsStorage, next);
        applyPreferences();
        refreshGate();
        renderer?.markDirty();
      },
    });
  };

  const openHelp = (): void => {
    const manual = (world?.data.part ?? titlePart) === 2 ? part2ManualJson : manualJson;
    const topics = (manual as unknown as { topics: ManualTopic[] }).topics;
    // Modern landing (UI plan Phase 7): controls + FAQ first, manual as a tab.
    const help = buildTabbedHelp(topics);
    const handle = openModal({ title: 'Help', content: help.el, className: 'dialog-help' });
    // Onboarding replay entry (UI plan Phase 7): one button under the content.
    const body = handle.el.querySelector('.dialog-body');
    if (body) {
      const replay = document.createElement('button');
      replay.type = 'button';
      replay.className = 'help-replay';
      replay.dataset.action = 'replay-hints';
      replay.textContent = 'Replay intro hints';
      replay.addEventListener('click', () => {
        resetOnboarding(prefsStorage);
        closeAllModals();
        showHintsFrom(0);
      });
      body.appendChild(replay);
    }
  };

  /**
   * Death and victory cancel every pending command so neither screen can
   * leave hidden movement or a half-finished cast active (UI plan Phase 7).
   */
  const cancelPendingCommands = (reason: string): void => {
    turnMotion = null;
    actionFeedback=null;
    impacts.clear();
    environmentCache.clear();
    flash = null;
    travelRunner?.stop(reason);
    endTargeting();
    selectedCell = null;
    previewSteps = null;
    pendingAttack = null;
    renderer?.markDirty();
  };

  const onDeath = (): void => {
    const w = world;
    if (!w) return;
    dead = true;
    cancelPendingCommands('you died');
    refreshGate();
    const killedBy =
      [...w.log].reverse().find((e) => e.text.startsWith('Killed by'))?.text.slice('Killed by '.length)
        ?? 'your wounds';
    const recentEvents = w.log
      .map((e) => e.text)
      .filter((text) => !text.startsWith('Killed by'))
      .slice(-5);
    openDeathDialog({
      name: w.player.name,
      killedBy,
      level: w.player.level,
      turns: w.turn,
      gold: w.inventory.gold,
      recentEvents,
      onNewGame: () => { closeAllModals(); newGame(); },
      onLoad: () => { closeAllModals(); openSaveMenu('load'); },
    });
  };

  const onLevelUp = (): void => {
    const w = world;
    if (!w) return;
    const content = doc.createElement('div');
    const head = doc.createElement('p');
    head.textContent = `You have reached level ${w.player.level}!`;
    const pools = doc.createElement('p');
    pools.textContent = `HP ${w.player.hp}/${w.player.maxHp} — Mana ${w.player.mana}/${w.player.maxMana}`;
    content.append(head, pools);
    openModal({ title: 'Level Up', content });
  };

  const startTargeting = (spellId: string, name: string): void => {
    const w = world;
    if (!w) return;
    endTargeting(); // safety: never two targeting sessions
    travelRunner?.stop('spell targeting');
    const def = w.data.spells[spellId];
    targeting = { spellId, name, cost: def ? manaCostFor(def, w.player) : 0 };
    targetCell = null;
    targetNotice = null;
    buildTargetBar();
    document.addEventListener('keydown', onTargetingKey, true);
    refreshGate();
    renderer?.markDirty();
  };

  /** One deliberate confirmation: dispatch the cast and leave targeting. */
  const confirmTargeting = (): void => {
    if (!targeting || !targetCell) return;
    const { spellId } = targeting;
    const target = { x: targetCell.x, y: targetCell.y };
    endTargeting();
    dispatchAction({ type: 'CAST', spellId, target });
  };

  const endTargeting = (): void => {
    document.removeEventListener('keydown', onTargetingKey, true);
    const wasTargeting = targetBarEl !== null;
    targetBarEl?.remove();
    targetBarEl = null;
    shell.sheetEl.classList.remove('is-targeting');
    if (wasTargeting) shell.sheetEl.querySelector<HTMLButtonElement>('.dock [data-action="cast"]')?.focus();
    targeting = null;
    targetCell = null;
    targetNotice = null;
    refreshGate();
    renderer?.markDirty();
  };

  const setTargetNotice = (text: string | null): void => {
    targetNotice = text;
    if (targetBarEl) {
      const notice = targetBarEl.querySelector('[data-field="target-notice"]');
      if (notice) notice.textContent = text ?? 'Select a visible target.';
    }
  };

  /** Persistent targeting bar (A14): spell, live notice, Cast, Cancel. */
  const buildTargetBar = (): void => {
    if (!targeting) return;
    const bar = doc.createElement('div');
    bar.className = 'target-bar';
    const spell = doc.createElement('span');
    spell.dataset.field = 'target-spell';
    spell.className = 'target-spell-name';
    spell.textContent = `${targeting.name} (${targeting.cost} mana)`;
    const notice = doc.createElement('span');
    notice.dataset.field = 'target-notice';
    notice.className = 'target-notice';
    notice.textContent = targetNotice ?? 'Select a visible target.';
    const cast = doc.createElement('button');
    cast.type = 'button';
    cast.dataset.action = 'cast-target';
    cast.textContent = 'Cast';
    cast.disabled = targetCell === null;
    cast.addEventListener('click', () => confirmTargeting());
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.dataset.action = 'cancel-target';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => endTargeting());
    bar.append(spell, notice, cast, cancel);
    (shell.sheetEl.querySelector('.action-cluster') ?? shell.sheetEl).appendChild(bar);
    shell.sheetEl.classList.add('is-targeting');
    targetBarEl = bar;
    cancel.focus();
  };

  /** Keyboard targeting (UI plan §8): cycle visible foes, Enter casts. */
  const onTargetingKey = (e: KeyboardEvent): void => {
    if (!targeting || openModalCount() > 0) return;
    if ((e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement)?.closest?.('button, a[href], summary, input, select, textarea')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      endTargeting();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      confirmTargeting();
      return;
    }
    const cycles = e.key === 'Tab' || e.key === 'ArrowRight' || e.key === 'ArrowDown'
      ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        ? -1
        : 0;
    if (cycles === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const w = world;
    if (!w) return;
    const level = w.levels.get(w.current);
    if (!level) return;
    const foes = [...level.entities.values()]
      .filter((en) => en.kind === 'monster' && w.visible[idx(en.x, en.y)] === 1)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    if (foes.length === 0) {
      setTargetNotice('No visible targets.');
      return;
    }
    const at = targetCell ? foes.findIndex((f) => f.x === targetCell!.x && f.y === targetCell!.y) : -1;
    const next = foes[(at + cycles + foes.length) % foes.length]!;
    targetCell = { x: next.x, y: next.y };
    if (camViewport) {
      camViewport.state.panX = next.x - w.player.x;
      camViewport.state.panY = next.y - w.player.y;
    }
    setTargetNotice(`Target: ${next.name}`);
    const castBtn = targetBarEl?.querySelector<HTMLButtonElement>('[data-action="cast-target"]');
    if (castBtn) castBtn.disabled = false;
    renderer?.markDirty();
  };

  /** Map taps while targeting: select, re-tap or Cast confirms (Phase 6). */
  const handleTargetingTap = (cell: Cell): void => {
    const w = world;
    if (!w || !targeting) return;
    if (w.visible[idx(cell.x, cell.y)] !== 1) {
      // Invalid target: explain, spend nothing (acceptance).
      setTargetNotice('You cannot target what you cannot see.');
      return;
    }
    if (targetCell && targetCell.x === cell.x && targetCell.y === cell.y) {
      confirmTargeting();
      return;
    }
    targetCell = { x: cell.x, y: cell.y };
    setTargetNotice(null);
    const castBtn = targetBarEl?.querySelector<HTMLButtonElement>('[data-action="cast-target"]');
    if (castBtn) castBtn.disabled = false;
    renderer?.markDirty();
  };

  /** Ending screen once, after any queued cutscenes have played. */
  const maybeShowVictory = (): void => {
    const w = world;
    if (!w || dead) return;
    const state = w.questState;
    if (!state?.victory || state.endingShown) return;
    state.endingShown = true;
    victoryActive = true;
    cancelPendingCommands('victory');
    const def = w.data.quests?.find((q) => q.id === state.questId);
    const endingId = def?.victoryStoryText;
    const endingText = endingId !== undefined ? (w.data.story?.[String(endingId)] ?? '') : '';
    const overlay = showVictory(
      deps.root,
      {
        name: w.player.name,
        level: w.player.level,
        turns: w.turn,
        gold: w.inventory.gold,
        experience: w.player.experience,
      },
      endingText,
      {
        gender: w.player.gender,
        onNewGame: () => newGame(),
        onSave: () => autosaveNow(),
        onJournal: () => {
          // The ending waits behind the journal and returns when it closes.
          overlay.style.display = 'none';
          openJournalDialog(state.journal, { onClose: () => { overlay.style.display = ''; } });
        },
        onReturnToTitle: () => toTitle(),
      },
    );
  };

  /** Play queued quest cutscenes (story texts), then the ending if won. */
  const drainQuestStories = (): void => {
    const w = world;
    if (!w || dead || showingStory) return;
    const state = w.questState;
    if (!state || state.pending.length === 0) {
      maybeShowVictory();
      return;
    }
    const ids = state.pending.splice(0, state.pending.length);
    const texts = ids.map((id) => w.data.story?.[String(id)] ?? '');
    showingStory = true;
    refreshGate();
    showStoryTexts(deps.root, texts, {
      gender: w.player.gender,
      onDone: () => {
        showingStory = false;
        maybeShowVictory();
        maybeStartHints();
        refreshGate();
      },
    });
  };

  /**
   * Explicit interaction at the hero's own tile (Phase 2 task 6): stairs
   * descend/ascend and shop doors open only on deliberate confirmation
   * (own-cell tap or Enter) — never automatically on arrival.
   */
  const interactHere = (): boolean => {
    const w = world;
    const level = w?.levels.get(w.current);
    if (!w || dead || !level) return false;
    const t = level.tiles[idx(w.player.x, w.player.y)] ?? 0;
    if (t === TILE_STAIRS_DOWN) {
      dispatchAction({ type: 'DESCEND' });
      return true;
    }
    if (t === TILE_STAIRS_UP && w.current > 0) {
      dispatchAction({ type: 'ASCEND' });
      return true;
    }
    if (w.current === 0) {
      const shop = shopDoorAt(townFor(w.data.part), w.player.x, w.player.y);
      if (shop) {
        interactFeedback();
        openMerchant(shop);
        return true;
      }
    }
    return false;
  };

  const afterAction = (_action: Action, levelBefore: number): void => {
    const w = world;
    if (!w) return;
    const effect = afterActionEffects(w, levelBefore);
    if (effect === 'death') { onDeath(); return; }
    if (effect === 'level-up') onLevelUp();
    // Deliberate transitions only (Phase 2 task 6): stairs and shop doors
    // require an explicit own-cell tap / Enter — no auto-stairs, no auto-open.
  };

  // e2e observability: increments for every action the engine actually applied.
  let appliedCount = 0;
  const dispatchAction = (action: Action): void => {
    const w = world;
    if (!w || dead) return;
    const levelBefore = w.player.level;
    const currentBefore = w.current;
    const manaBefore = w.player.mana;
    const hpBefore = w.player.hp;
    const before = { x: w.player.x, y: w.player.y };
    const beforeEntities = new Map([...w.levels.get(w.current)?.entities.values() ?? []]
      .filter(e => !!w.visible[idx(e.x, e.y)])
      .map(e => [e.id, { x:e.x, y:e.y, hp:e.monster?.hp }]));
    const bumped = action.type === 'MOVE' && [...beforeEntities.values()]
      .some(e => e.x === before.x + action.dx && e.y === before.y + action.dy);
    const damageSnapshot = ():DamageActor[] => [
      {id:0,name:'hero',x:w.player.x,y:w.player.y,hp:w.player.hp,visible:true},
      ...[...w.levels.get(w.current)?.entities.values() ?? []].filter(e=>e.monster).map(e=>({id:e.id,name:e.name,x:e.x,y:e.y,hp:e.monster!.hp,visible:!!w.visible[idx(e.x,e.y)]})),
    ];
    const damageBefore = damageSnapshot();
    const previousMotion=turnMotion;
    const previousProgress=previousMotion?((deps.now??Date.now)()-previousMotion.start)/TURN_MOTION_MS:1;
    const turnBefore=w.turn;
    const combat=captureCombat(w,()=>dispatch(w,action)).events;
    const cues:ActionCue[]=combat.filter(cue=>(cue.attacker.id===0||beforeEntities.has(cue.attacker.id))&&(cue.target.id===0||beforeEntities.has(cue.target.id))).map(cue=>({kind:'attack',from:{x:cue.attacker.x,y:cue.attacker.y},at:{x:cue.target.x,y:cue.target.y},hit:cue.hit}));
    if(cues.length&&!prefersReducedMotion())actionFeedback={start:(deps.now??Date.now)(),cues};
    else if(w.turn!==turnBefore&&['SEARCH','USE','EQUIP','UNEQUIP','PICKUP'].includes(action.type))interactFeedback();
    if (currentBefore === w.current && preferences.blood !== false) impacts.add(damageImpacts(damageBefore,damageSnapshot(),(deps.now??Date.now)()));
    turnMotion = null;
    if (!prefersReducedMotion() && currentBefore === w.current) {
      let player: ActorMotion | undefined;
      if (before.x !== w.player.x || before.y !== w.player.y) player = continueMovement(previousMotion?.player,previousProgress,before,w.player);
      else if (action.type === 'MOVE' && bumped) player = {kind:'attack', progress:0, direction:{x:action.dx,y:action.dy}};
      else if (w.player.hp < hpBefore) player = {kind:'hit', progress:0};
      const entities = new Map<number, ActorMotion>();
      for (const e of w.levels.get(w.current)?.entities.values() ?? []) {
        const old = beforeEntities.get(e.id);
        if (!old || !w.visible[idx(e.x,e.y)]) continue;
        if (old.x !== e.x || old.y !== e.y) entities.set(e.id, continueMovement(previousMotion?.entities.get(e.id),previousProgress,old,e));
        else if (old.hp !== undefined && e.monster && e.monster.hp < old.hp) entities.set(e.id, {kind:'hit', progress:0});
      }
      for(const cue of combat){
        if(cue.attacker.id===0)continue;
        if(!beforeEntities.has(cue.attacker.id)||!w.visible[idx(cue.attacker.x,cue.attacker.y)])continue;
        entities.set(cue.attacker.id,{kind:'attack',progress:0,direction:{x:cue.target.x-cue.attacker.x,y:cue.target.y-cue.attacker.y}});
      }
      if (player || entities.size) turnMotion = {start:(deps.now ?? Date.now)(),level:w.current,player,entities};
    }
    appliedCount++;
    dirtySinceSave = true;
    if (action.type === 'CAST' && w.player.mana < manaBefore) {
      // The cast resolved: give brief cell feedback (UI plan Phase 6).
      const durationMs = prefersReducedMotion() ? 0 : FLASH_DURATION_MS;
      const def = w.data.spells[action.spellId];
      const level = w.levels.get(w.current);
      if (durationMs > 0 && def && level) {
        flash = {
          cells: flashCellsFor(def, level, { x: w.player.x, y: w.player.y }, action.target),
          start: (deps.now ?? Date.now)(),
          durationMs,
        };
      } else {
        flash = null;
      }
      renderer?.markDirty();
    }
    afterAction(action, levelBefore);
    // Urgent events only (UI plan §382): damage, death, level-up reach the
    // assertive region; routine movement never rewrites the live region.
    if (dead) hud?.announce('You have died.');
    else if (w.player.hp < hpBefore) hud?.announce(`Hit points ${w.player.hp} of ${w.player.maxHp}.`);
    else if (w.player.level > levelBefore) hud?.announce(`You reached level ${w.player.level}.`);
    if (w.current !== currentBefore) {
      impacts.clear();
      flash = null;
      turnMotion = null;
      interactFeedback();
      autosaveNow(); // stairs transitions
      camViewport?.recenter(); // fresh level: recenter the camera (Phase 4)
    }
    sync();
    drainQuestStories();
    refreshGate();
  };

  // ---- destination travel (UI plan Phase 2) ----

  let travelRunner: TravelRunner | null = null;
  let travelTimer: number | undefined;
  let selectedCell: Cell | null = null;
  let hoverCell: Cell | null = null;
  let pendingAttack: Cell | null = null;
  let previewSteps: Cell[] | null = null;
  let hpAtStep = 0;
  const TRAVEL_STEP_MS = 150;

  const clearTravelTimer = (): void => {
    if (travelTimer !== undefined && win) win.clearTimeout(travelTimer);
    travelTimer = undefined;
  };

  /** Route planning sees only discovered terrain + visible occupants. */
  const routeWorld = (): RouteWorld | null => {
    const w = world;
    const level = w?.levels.get(w.current);
    const seen = w?.seen.get(w.current);
    if (!w || !level || !seen) return null;
    return {
      size: LEVEL_SIZE,
      known: (x, y) => (seen[idx(x, y)] ?? 0) !== 0,
      walkable: (x, y) => w.data.tiles[String(level.tiles[idx(x, y)] ?? 0)]?.walkable ?? false,
      hazardous: (x, y) =>
        (level.traps ?? []).some((t) => t.known && t.x === x && t.y === y),
      occupied: (x, y) => {
        if ((w.visible[idx(x, y)] ?? 0) === 0) return false; // never hidden knowledge
        for (const e of level.entities.values()) {
          if (e.kind === 'monster' && e.x === x && e.y === y) return true;
        }
        return false;
      },
    };
  };

  /** Interaction boundaries that need an explicit final action (Phase 2 task 6). */
  const boundaryReason = (cell: Cell): string | null => {
    const w = world;
    const level = w?.levels.get(w.current);
    if (!w || !level) return null;
    const t = level.tiles[idx(cell.x, cell.y)] ?? 0;
    if (t === TILE_STAIRS_DOWN) return 'stairs lead down';
    if (t === TILE_STAIRS_UP && w.current > 0) return 'stairs lead up';
    if (w.current === 0) {
      const shop = shopDoorAt(townFor(w.data.part), cell.x, cell.y);
      if (shop) return `the ${shop.name} door`;
    }
    const trap = (level.traps ?? []).find((tr) => tr.known && tr.x === cell.x && tr.y === cell.y);
    if (trap) return 'a known trap';
    return null;
  };

  const visibleMonsterAt = (cell: Cell): string | null => {
    const level = world?.levels.get(world.current);
    if (!level) return null;
    for (const e of level.entities.values()) {
      if (e.kind === 'monster' && e.x === cell.x && e.y === cell.y) return e.name;
    }
    return null;
  };

  const scheduleTravelTick = (): void => {
    clearTravelTimer();
    if (!travelRunner?.state.active) return;
    travelTimer = win?.setTimeout(() => {
      const runner = travelRunner;
      if (!runner) return;
      runner.tick();
      if (runner.state.active) scheduleTravelTick();
    }, TRAVEL_STEP_MS);
  };

  const startTravel = (steps: Cell[], attack: Cell | null): void => {
    const w = world;
    if (!w || dead || !travelRunner) return;
    pendingAttack = attack;
    hpAtStep = w.player.hp;
    const started = travelRunner.start(steps);
    if (!started) {
      pendingAttack = null;
      sync();
      return; // refusal reason already surfaced via onStopped
    }
    scheduleTravelTick();
  };

  const travelHost = {
    hostileVisible(): boolean {
      return world ? monsterInSight(world) : false;
    },
    boundaryAhead(cell: Cell): string | null {
      return boundaryReason(cell);
    },
    stopCheck(): string | null {
      if (dead) return 'you died';
      if (openModalCount() > 0) return 'a panel opened';
      if (world && world.player.hp < hpAtStep) return 'you took damage';
      if (travelHost.hostileVisible()) return 'an enemy came into view';
      return null;
    },
    step(cell: Cell): 'moved' | 'blocked' {
      const w = world;
      if (!w) return 'blocked';
      hpAtStep = w.player.hp; // damage during THIS step halts the NEXT one
      dispatchAction({ type: 'MOVE', dx: cell.x - w.player.x, dy: cell.y - w.player.y });
      const now = world;
      if (!now || dead) return 'moved'; // death mid-step: stopCheck handles it
      return now.player.x === cell.x && now.player.y === cell.y ? 'moved' : 'blocked';
    },
    onStopped(reason: string, remaining: number): void {
      if (reason === 'arrived') {
        const at = pendingAttack;
        if (at && world && !dead) {
          dispatchAction({
            type: 'MOVE',
            dx: Math.sign(at.x - world.player.x),
            dy: Math.sign(at.y - world.player.y),
          }); // final deliberate bump attack
        }
      } else {
        const text =
          reason === 'hostile visible'
            ? 'Travel: an enemy is visible.'
            : `Travel stopped: ${reason}${remaining > 0 ? ` (${remaining} step${remaining === 1 ? '' : 's'} not taken)` : ''}.`;
        world?.log.push({ turn: world.turn, text });
      }
      pendingAttack = null;
      selectedCell = null;
      previewSteps = null;
      clearTravelTimer();
      sync();
      refreshGate();
    },
  };
  travelRunner = createTravelRunner(travelHost);

  /** Map tap: select→confirm (touch), hover→click starts (mouse). */
  const handleMapTap = (cell: Cell, pointerType: string): void => {
    const w = world;
    if (!w || dead) return;
    if (targeting) {
      // Spell targeting owns map taps (UI plan Phase 6): select then confirm.
      handleTargetingTap(cell);
      return;
    }
    if (travelRunner?.state.active) travelRunner.stop('new map interaction');
    if (cell.x === w.player.x && cell.y === w.player.y) {
      selectedCell = null; // own-cell tap clears the selection…
      previewSteps = null;
      if (interactHere()) return; // …or confirms stairs / a shop door (task 6)
      sync();
      return;
    }
    const rw = routeWorld();
    if (!rw) return;
    const route = findCardinalRoute(rw, { x: w.player.x, y: w.player.y }, cell);
    if (!route) return;
    if (route.blocked) {
      selectedCell = null;
      pendingAttack = null;
      previewSteps = null;
      const text =
        route.blocked === 'unknown'
          ? 'You have not explored that area yet.'
          : route.blocked === 'wall'
            ? 'There is a wall in the way.'
            : route.blocked === 'self'
              ? 'You are already there.'
              : route.blocked === 'no-adjacent-cell'
                ? 'You cannot reach that monster.'
                : 'There is no route there.';
      w.log.push({ turn: w.turn, text });
      sync();
      return;
    }
    // Safe confirmation (UI plan Phase 7): mouse travel uses the touch-style
    // select→confirm flow when the preference is on.
    const isTouch = pointerType !== 'mouse' || preferences.safeConfirmation;
    const alreadySelected =
      selectedCell !== null && selectedCell.x === cell.x && selectedCell.y === cell.y;
    if (route.attack) {
      if (isTouch && !alreadySelected) {
        selectedCell = cell;
        pendingAttack = route.attack;
        previewSteps = route.steps;
        const name = visibleMonsterAt(route.attack);
        w.log.push({ turn: w.turn, text: name ? `You target the ${name}.` : 'You take aim.' });
        sync();
        return;
      }
      selectedCell = null;
      previewSteps = null;
      if (route.steps.length === 0) {
        const at = route.attack;
        dispatchAction({
          type: 'MOVE',
          dx: Math.sign(at.x - w.player.x),
          dy: Math.sign(at.y - w.player.y),
        });
        return;
      }
      startTravel(route.steps, route.attack);
      return;
    }
    const boundary = boundaryReason(cell);
    if (boundary && route.steps.length === 1) {
      // Adjacent interaction boundary: the confirmed final step performs
      // step + transition in one deliberate action (task 6). Touch confirms
      // via the select→second-tap flow; mouse acts on the click directly.
      if (isTouch && !alreadySelected) {
        selectedCell = cell;
        pendingAttack = null;
        previewSteps = route.steps;
        w.log.push({ turn: w.turn, text: `Route: 1 step — ${boundary} ahead.` });
        sync();
        return;
      }
      selectedCell = null;
      previewSteps = null;
      dispatchAction({
        type: 'MOVE',
        dx: Math.sign(cell.x - w.player.x),
        dy: Math.sign(cell.y - w.player.y),
      });
      if (!dead && world && world.player.x === cell.x && world.player.y === cell.y) {
        interactHere(); // stairs / shop door; known traps just get stepped on
      }
      return;
    }
    if (route.steps.length === 1 && !boundary) {
      selectedCell = null; // adjacent ordinary floor: one immediate step
      previewSteps = null;
      dispatchAction({
        type: 'MOVE',
        dx: Math.sign(cell.x - w.player.x),
        dy: Math.sign(cell.y - w.player.y),
      });
      return;
    }
    if (isTouch && !alreadySelected) {
      selectedCell = cell;
      pendingAttack = null;
      previewSteps = route.steps;
      w.log.push({
        turn: w.turn,
        text: boundary
          ? `Route: ${route.steps.length} steps — ${boundary} ahead.`
          : `Route: ${route.steps.length} steps.`,
      });
      sync();
      return;
    }
    selectedCell = null;
    previewSteps = null;
    startTravel(route.steps, null);
  };

  /**
   * Mouse hover: preview the route to the hovered cell (plan: hover previews,
   * click starts). Touch never hovers. No game-state changes, no turn.
   */
  const handleMapHover = (cell: Cell | null): void => {
    hoverCell = cell;
    const w = world;
    if (!w || dead) {
      previewSteps = null;
      return;
    }
    // Don't clobber an explicit selection or a live travel queue.
    if (selectedCell || travelRunner?.state.active) {
      renderer?.markDirty();
      return;
    }
    if (!cell || (cell.x === w.player.x && cell.y === w.player.y)) {
      previewSteps = null;
      renderer?.markDirty();
      return;
    }
    const rw = routeWorld();
    if (!rw) return;
    const route = findCardinalRoute(rw, { x: w.player.x, y: w.player.y }, cell);
    previewSteps = route && !route.blocked ? route.steps : null;
    renderer?.markDirty();
  };

  const routeCommand = (cmd: string): void => {
    // One permission rule for every command source (HUD buttons, keyboard,
    // test commands): only the playing phase with no panel open may act.
    if (openModalCount() > 0 || world === null || dead || showingStory || victoryActive) return;
    if (cmd.startsWith('slot-')) {
      castFromFavoriteSlot(Number(cmd.slice('slot-'.length)));
      return;
    }
    switch (cmd) {
      case 'character': openCharacter(); break;
      case 'inventory': openInventory(); break;
      case 'cast': openSpellbook(); break;
      case 'search': dispatchAction({ type: 'SEARCH' }); break;
      case 'rest': openRest(); break;
      case 'map': openMap(); break;
      case 'menu': // keyboard Esc: stop travel first; a second Esc pauses (UI plan §4)
        if (travelRunner?.state.active) {
          travelRunner.stop('new map interaction');
          return;
        }
        openPause();
        break;
      case 'pause': openPause(); break;
      case 'wait': dispatchAction({ type: 'WAIT' }); break;
      case 'enter': interactHere(); break;
      case 'log': openLog(); break;
      case 'actions': openActionsPanel(); break;
      default: break;
    }
  };

  const screenToWorld = (px: number, py: number): { x: number; y: number } => {
    if (deps.screenToWorld) return deps.screenToWorld(px, py);
    const rect = canvas.getBoundingClientRect();
    const cam = camViewport?.lastCamera() ?? null;
    if (cam) {
      return {
        x: Math.floor(cam.originX + (px - rect.left) / cam.tile),
        y: Math.floor(cam.originY + (py - rect.top) / cam.tile),
      };
    }
    // Headless fallback lives in the viewport module (hero-centered window).
    const cell = camViewport?.screenToWorld(px - rect.left, py - rect.top);
    return cell ?? { x: 0, y: 0 };
  };

  const mapViewport = (width: number, height: number): { width: number; height: number; bottomInset: number; rightInset: number } => {
    const map = shell.mapEl.getBoundingClientRect();
    const controls = shell.sheetEl.getBoundingClientRect();
    const overlap = controls.height > 0 ? Math.max(0, map.bottom - controls.top) : 0;
    return { width, height, rightInset: targeting ? 0 : 64, bottomInset: Math.min(overlap + (overlap ? 12 : 0), Math.max(0, height - 48)) };
  };

  const draw = (): void => {
    const w = world;
    if (!w) return;
    const cw = canvas.clientWidth;
    const chh = canvas.clientHeight;
    if (!cw || !chh) return;
    const dpr = win?.devicePixelRatio ?? 1;
    const bw = Math.round(cw * dpr);
    const bh = Math.round(chh * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Draw in CSS pixels; the transform maps them onto the full dpr-scaled
    // backing store (F06). Pixel art must never smooth; clear the whole
    // viewport each frame so no stale pixels survive at the edges.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, chh);
    const level = w.levels.get(w.current);
    const seen = w.seen.get(w.current);
    if (!level || !seen) return;
    const inspect = shell.mapEl.querySelector<HTMLElement>('.map-inspect');
    if (inspect) {
      const cell = targetCell ?? pendingAttack ?? selectedCell ?? hoverCell;
      const actor = cell && w.visible[idx(cell.x, cell.y)]
        ? [...level.entities.values()].find(e => e.x === cell.x && e.y === cell.y) : undefined;
      const tile = cell && seen[idx(cell.x, cell.y)] ? level.tiles[idx(cell.x, cell.y)] : undefined;
      const stairs = tile === TILE_STAIRS_UP ? 'Stairs up' : tile === TILE_STAIRS_DOWN ? 'Stairs down' : '';
      inspect.textContent = actor ? `${actor.name} · ${actor.kind === 'monster' ? 'Enemy' : 'Character'}` : stairs;
      inspect.hidden = !inspect.textContent;
    }
    const hero = { x: w.player.x, y: w.player.y };
    // Viewport owns camera state; frameCamera applies safe-region follow
    // (frozen while target picking so the view stays put — Phase 4).

    // Route/selection overlay: preview the selected route, or the live travel
    // queue while moving (UI plan Phase 4). Spell targeting overlays its own
    // selection + valid-cell tint (Phase 6).
    const travelState = travelRunner?.state;
    const targetingOverlay = targeting
      ? { targeting: { cell: targetCell ?? undefined } }
      : undefined;
    const routeOverlay =
      selectedCell || pendingAttack || (travelState?.active ?? false)
        ? {
            selected: selectedCell ?? undefined,
            route: travelState?.active
              ? travelState.remaining
              : (previewSteps ?? undefined),
            destination: travelState?.active
              ? travelState.remaining[travelState.remaining.length - 1]
              : (selectedCell ?? undefined),
            attack: pendingAttack ?? undefined,
          }
        : undefined;
    const base = targetingOverlay ?? routeOverlay;
    // Cast feedback fades over FLASH_DURATION_MS; keep dirty while animating.
    let flashOverlay: { cells: { x: number; y: number }[]; alpha: number } | undefined;
    if (prefersReducedMotion()) flash = null;
    if (flash) {
      const elapsed = (deps.now ?? Date.now)() - flash.start;
      if (elapsed >= flash.durationMs) {
        flash = null;
      } else {
        flashOverlay = { cells: flash.cells, alpha: 1 - elapsed / flash.durationMs };
        renderer?.markDirty();
      }
    }
    let animation: SceneInput['animation'];
    if (turnMotion) {
      const progress = ((deps.now ?? Date.now)() - turnMotion.start) / TURN_MOTION_MS;
      if (progress >= 1 || turnMotion.level !== w.current || prefersReducedMotion()) turnMotion = null;
      else {
        animation = {
          player: turnMotion.player ? {...turnMotion.player,progress} : undefined,
          entities: new Map([...turnMotion.entities].map(([id, effect]) => [id, {...effect,progress}])),
        };
        renderer?.markDirty();
      }
    }
    const camera = camViewport?.frameCamera(targeting !== null, movementPosition(hero,animation?.player)) ?? null;
    if (!camera) return;
    let feedback: {cues:ActionCue[];progress:number}|undefined;
    if(actionFeedback){const progress=((deps.now??Date.now)()-actionFeedback.start)/280;if(progress>=1||prefersReducedMotion())actionFeedback=null;else {feedback={cues:actionFeedback.cues,progress};renderer?.markDirty();}}
    const overlay = { ...(base ?? {}), flash: flashOverlay, feedback };
    renderFrame(ctx as unknown as Ctx2D, camera, {
      level,
      seen,
      visible: w.visible,
      player: hero,
      playerGender: w.player.gender,
      visual: {seed:w.worldSeed,turn:w.turn,now:(deps.now??Date.now)(),reduced:prefersReducedMotion(),
        environment:environmentCache.get(level,w.worldSeed),buildings:townFor(w.data.part).buildings,
        hero:heroImage(heroAppearance(w.player.gender,w.inventory.equipment,w.data.items)),
        impacts:preferences.blood === false ? [] : impacts.all()},
      animation,
      revealMap: debugRevealMap,
      entities: [...level.entities.values()],
      // Detect Monsters: sensed markers are distinct from live visibility.
      sense: hasStatus(w.player, 'detect_monsters'),
      overlay,
    }, styles);
  };

  const loadArt = (): void => {
    const loader = deps.loadTileSprites ?? defaultLoadTileSprites;
    loader(TILE_DEFS)
      .then((sprites) => {
        // Late-callback guard (Task 3): art resolving after destroy() must
        // not resurrect rendering state on a torn-down controller.
        if (destroyed) return;
        Object.assign(styles.sprites, sprites);
        renderer?.markDirty();
      })
      .catch(() => { /* fallback colors stay active */ });
  };

  /**
   * Create the shared input + renderer once; reused by new games and loads.
   * Art loads exactly once per controller session (F16): a cold Continue —
   * before any New Game — gets the same tile art as a fresh game.
   */
  const ensureInputRenderer = (): void => {
    if (!input) {
      input = createGameInput({
        surface: canvas,
        screenToWorld: screenToWorld,
        keyboardTarget: win,
        onMove: (dx, dy) => dispatchAction({ type: 'MOVE', dx, dy }),
        onCommand: (cmd) => routeCommand(cmd),
        mapTap: (cell, pointerType) => handleMapTap(cell, pointerType),
        mapHover: (cell) => handleMapHover(cell),
        mapDrag: (dx, dy) => camViewport?.pan(dx, dy),
        mapPinch: (scale) => camViewport?.pinch(scale),
      });
      loadArt();
    }
    if (!renderer && typeof win?.requestAnimationFrame === 'function') {
      let lastFrame = 0;
      renderer = createRenderer(
        draw,
        (cb) =>
          win.requestAnimationFrame((t: number) => {
            if (lastFrame > 0 && t >= lastFrame) {
              const dt = t - lastFrame;
              perf.frames += 1;
              perf.totalMs += dt;
              if (dt > perf.maxMs) perf.maxMs = dt;
            }
            lastFrame = t;
            cb();
          }),
        (h) => win.cancelAnimationFrame(h),
      );
      renderer.start();
      refreshGate();
    }
  };

  const spawnWorld = (init: CharacterInit, seedOverride?: number): void => {
    const seed = seedOverride ?? (((deps.now ?? Date.now)() >>> 0) || 1);
    // Cancel every pending command of the PREVIOUS world (may be null/title).
    cancelPendingCommands('new game');
    victoryActive = false;
    showingStory = false;
    world = newWorld({ worldSeed: seed, player: init, data: bundleFor(titlePart) });
    // The active saves manager follows the world's part (PART2-PLAN Task P6):
    // autosaves and manual saves land in the played campaign's key space.
    saves = savesFor(world.data.part);
    dirtySinceSave = true; // nothing saved yet
    dead = false;
    titleEl?.remove();
    titleEl = null;
    hintsPending = true; // onboarding fires after the opening story drains
    removeHint();
    if (!world.log.length) {
      world.log.push({ turn: 0, text: `Welcome to Crossroads, ${world.player.name}.` });
    }
    ensureInputRenderer();
    sync();
    drainQuestStories(); // opening cutscene on a fresh world
    refreshGate();
  };

  const newGame = (): void => {
    if (titlePart !== 2) {
      openNewGameDialog({
        onBegin: (init) => { closeAllModals(); spawnWorld(init); },
      });
      return;
    }
    // Part 2: the wizard also offers continuing with a Part 1 character
    // (PART2-PLAN Task P7). The wizard content element is kept so a failed
    // import can return to it with the reason shown and inputs preserved.
    const content = buildNewGameContent({
      onBegin: (init) => { closeAllModals(); spawnWorld(init); },
      onImportP1: () => {
        const mgr = savesFor(1);
        if (!mgr) return;
        const importCharacter = (file: SaveFile): void => {
          const seed = ((deps.now ?? Date.now)() >>> 0) || 1;
          const result = importPart1Character(file, { seed });
          if (result.ok) {
            closeAllModals();
            loadGame(result.save, false);
            return;
          }
          closeAllModals();
          openModal({ title: 'New Game', content });
          const errEl = content.querySelector<HTMLElement>('[data-field="import-error"]');
          if (errEl) errEl.textContent = result.error;
        };
        openSaveDialog({ mode: 'load', manager: mgr, onLoad: importCharacter, onImport: importCharacter });
      },
    });
    openModal({ title: 'New Game', content });
  };

  const openMerchant = (shop: ShopDef): void => {
    const w = world;
    if (!w || dead) return;
    // Panel refreshes IN PLACE after transactions (A13/A23): selection and
    // tab survive; failures return an inline reason instead of a silent
    // no-op; quotes and gold changes share one calculation.
    let panel: MerchantPanel | null = null;
    const afterAction = (): void => {
      dirtySinceSave = true;
      const cur = world;
      if (!cur) return;
      if (dead) {
        merchantHandle.close();
        return;
      }
      panel?.refresh({ inv: cur.inventory, player: cur.player, gold: cur.inventory.gold });
      sync();
    };
    panel = createMerchantPanel({
      shop,
      defs: w.data.items,
      inv: w.inventory,
      player: w.player,
      gold: w.inventory.gold,
      actions: {
        onBuy: (defId: string): string | void => {
          const cur = world!;
          const result = buyItem(cur, defId); // quote === transaction (A23), reject-before-mutate (Task 6)
          if (!result.ok) return result.reason;
          afterAction();
        },
        onSell: (uid: string): string | void => {
          const cur = world!;
          const result = sellItem(cur, uid, undefined, shop.kind === 'junk' ? 'junk' : 'store');
          if (!result.ok) return result.reason;
          afterAction();
        },
        onIdentify: (uid: string): string | void => {
          const cur = world!;
          const result = identifyItem(cur, uid); // free + honest: engine has no unidentified state (Task 6)
          if (!result.ok) return result.reason;
          cur.log.push({ turn: cur.turn, text: result.message ?? 'Nothing hidden found.' });
          afterAction();
        },
        onHeal: (): string | void => {
          const cur = world!;
          const result = healPlayer(cur);
          if (!result.ok) return result.reason;
          cur.log.push({ turn: cur.turn, text: result.message ?? 'The priests heal your wounds.' });
          afterAction();
        },
      },
    });
    const merchantHandle = openModal({ title: shop.name, content: panel.el, className: 'dialog-merchant' });
  };

  const mountTitle = (): void => {
    // The title reflects the currently selected part (PART2-PLAN Task P6):
    // saves, Continue, New Game, and the level names all come from the
    // selected part's bundle and save manager.
    saves = savesFor(titlePart);
    const bundle = bundleFor(titlePart);
    const t = doc.createElement('div');
    t.className = 'title-overlay';
    const h1 = doc.createElement('h1');
    h1.textContent = 'Castle of the Winds';
    const sub = doc.createElement('p');
    sub.textContent =
      titlePart === 1 ? 'A Question of Vengeance — Part One' : 'Lifthransir’s Bane — Part Two';
    // Part picker: two rows, selected one highlighted.
    const parts = doc.createElement('div');
    parts.className = 'title-parts';
    const partBtn = (p: 1 | 2, label: string): HTMLButtonElement => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.dataset.part = String(p);
      b.className = 'title-part';
      b.textContent = label;
      if (titlePart === p) b.classList.add('active');
      b.setAttribute('aria-pressed', String(titlePart === p));
      b.addEventListener('click', () => {
        if (titlePart === p) return;
        titlePart = p;
        titleEl?.remove();
        titleEl = null;
        mountTitle();
      });
      return b;
    };
    parts.append(
      partBtn(1, 'Part 1 — A Question of Vengeance'),
      partBtn(2, 'Part 2 — Lifthransir’s Bane'),
    );
    const row = doc.createElement('div');
    row.className = 'title-buttons';
    // Truthful Continue (UI plan Phase 7): loads the most recent valid save
    // directly, with character, location, and save time shown up front.
    const contBtn = doc.createElement('button');
    contBtn.type = 'button';
    contBtn.dataset.action = 'continue';
    const recent = saves !== null ? saves.mostRecentSlot() : null;
    if (recent !== null && saves !== null) {
      const info = saves.slotInfo(recent);
      const place =
        info.current !== undefined
          ? (bundle.levels[info.current]?.name ?? 'Unknown')
          : 'Unknown';
      const ts = info.savedAt !== undefined ? Date.parse(info.savedAt) : Number.NaN;
      const clock = Number.isNaN(ts)
        ? ''
        : ` · ${new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const name = info.name ?? 'Unknown hero';
      const level = info.level !== undefined ? ` · Lv ${info.level}` : '';
      const prefix = titlePart === 2 ? 'Part 2 — ' : '';
      contBtn.textContent = `Continue — ${prefix}${name}${level} · ${place}${clock}`;
      contBtn.addEventListener('click', () => {
        if (saves === null || recent === null) return;
        try {
          loadGame(saves.loadSlot(recent));
        } catch {
          // Fall back to the slot list; it flags empty/corrupt slots.
          openSaveMenu('load');
        }
      });
    } else {
      contBtn.textContent = 'Continue';
      contBtn.disabled = true;
      contBtn.title = 'No saved games yet';
    }
    const newBtn = doc.createElement('button');
    newBtn.type = 'button';
    newBtn.textContent = 'New Game';
    newBtn.dataset.action = 'new-game';
    newBtn.addEventListener('click', () => newGame());
    const loadBtn = doc.createElement('button');
    loadBtn.type = 'button';
    loadBtn.textContent = 'Load Game…';
    loadBtn.dataset.action = 'load-game';
    loadBtn.disabled = saves === null;
    if (saves) loadBtn.addEventListener('click', () => openSaveMenu('load'));
    const settingsBtn = doc.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.textContent = 'Settings';
    settingsBtn.dataset.action = 'settings';
    settingsBtn.addEventListener('click', () => openOptions());
    const helpBtn = doc.createElement('button');
    helpBtn.type = 'button';
    helpBtn.textContent = 'Help';
    helpBtn.dataset.action = 'help';
    helpBtn.addEventListener('click', () => openHelp());
    row.append(contBtn, newBtn, loadBtn, settingsBtn, helpBtn);
    t.append(h1, sub, parts, row);
    deps.root.appendChild(t);
    titleEl = t;
    ownFocus(t, contBtn.disabled ? newBtn : contBtn);
  };

  const onModalEvent = (): void => {
    // A blocking panel interrupts travel immediately (UI plan Phase 2).
    if (openModalCount() > 0 && travelRunner?.state.active) travelRunner.stop('a panel opened');
    refreshGate();
  };

  const onVisibility = (): void => {
    refreshGate();
    if (doc.hidden) {
      actionFeedback=null;
      renderer?.stop();
      turnMotion = null;
      flash = null;
      if (travelRunner?.state.active) travelRunner.stop('the game lost focus');
      autosaveNow();
    } else { renderer?.markDirty(); renderer?.start(); }
  };

  // A04: rotation/resize/dpr changes are observed by the viewport module
  // (attachInput); it invalidates the live camera and calls back here so the
  // canvas + camera recompute BEFORE the next map input converts coordinates.

  const controller: GameController = {
    start(): void {
      hud = createHud(shell.hudEl, {
        onAction: (action) => routeCommand(action),
      });
      hud.update(
        { name: 'Castle of the Winds', hp: 0, maxHp: 0, mana: 0, maxMana: 0, gold: 0, level: 0, place: 'Crossroads' },
        [],
      );
      mountSheetControls(hud, shell.sheetEl);
      // Viewport owns camera state + view controls (Task 11c). Preferences
      // applied at construction could not reach it before creation — re-apply.
      camViewport = createViewport({
        canvas,
        mapEl: shell.mapEl,
        overlayEl: shell.sheetEl,
        getViewport: () => mapViewport(canvas.clientWidth, canvas.clientHeight),
        getHero: () => (world ? { x: world.player.x, y: world.player.y } : null),
        isFrozen: () => targeting !== null,
        now: () => (deps.now ?? Date.now)(),
        dpr: () => win?.devicePixelRatio ?? 1,
        onChange: () => {
          draw();
          renderer?.markDirty();
        },
        win,
      });
      camViewport.mountControls();
      const inspect = doc.createElement('div');
      inspect.className = 'map-inspect';
      inspect.hidden = true;
      shell.mapEl.append(inspect);
      camViewport.attachInput();
      applyPreferences();
      stopOrientation = watchOrientation((portrait) => applyOrientation(shell.el, portrait), win);
      win?.addEventListener('cotw:modal', onModalEvent);
      doc.addEventListener('visibilitychange', onVisibility);
      mountTitle();
    },

    newGame,

    dispatchAction,

    openMerchant,

    getWorld(): World | null {
      return world;
    },

    isDead(): boolean {
      return dead;
    },

    isInputEnabled(): boolean {
      return input?.isEnabled() ?? false;
    },

    destroy(): void {
      destroyed = true;
      ambient.destroy();
      motionMedia?.removeEventListener?.('change',onMotionPreference);
      impacts.clear();
      stopOrientation?.();
      stopOrientation = null;
      camViewport?.destroy();
      camViewport = null;
      clearTravelTimer();
      travelRunner?.stop('destroyed');
      travelRunner = null;
      input?.destroy();
      input = null;
      renderer?.stop();
      renderer = null;
      endTargeting();
      removeHint();
      hintsPending = false;
      win?.removeEventListener('cotw:modal', onModalEvent);
      doc.removeEventListener('visibilitychange', onVisibility);
      // Close every owned overlay BEFORE wiping the DOM: the dialogs module
      // keeps a handle stack — wiping the DOM alone would leak stack entries
      // into the next controller mounted on this page (Task 5).
      closeAllModals();
      showingStory = false;
      victoryActive = false;
      dead = false;
      // Debug globals belong to this controller instance only.
      devtools.detach();
      deps.root.innerHTML = '';
      world = null;
    },
  };

  return controller;
}
