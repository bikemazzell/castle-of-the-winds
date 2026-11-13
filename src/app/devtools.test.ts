// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createDevtools, type DevtoolsContext } from './devtools';
import type { World } from '../engine/world';
import { createWorld } from '../engine/world';
import { loadWorldData } from '../engine/game';
import { createCharacter } from '../engine/character';

function makeWorld(): World {
  const data = loadWorldData();
  return createWorld({ worldSeed: 7, data, player: createCharacter({ name: 'Probe', gender: 'female', strength: 50, intelligence: 50, constitution: 50, dexterity: 50, difficulty: 'intermediate' }) });
}

function makeCtx(overrides: Record<string, unknown> = {}): DevtoolsContext {
  const canvas = document.createElement('canvas');
  const world: World | null = (overrides.world as World | null | undefined) ?? null;
  const base: Record<string, unknown> = {
    canvas,
    town: () => ({ buildings: [], shops: {} }),
    now: () => 1000,
    dpr: () => 1,
    getWorld: () => world,
    isDead: () => false,
    isShowingStory: () => false,
    isVictoryActive: () => false,
    getCameraState: () => ({ zoomIndex: 1, panX: 0, panY: 0 }),
    dispatchAction: (): void => {},
    getAppliedCount: () => 0,
    mapTap: (): void => {},
    mapHover: (): void => {},
    getTravelState: () => ({ active: false, reason: null, remaining: 0, selected: null, hover: null, preview: 0, attack: null }),
    getTargetingState: () => ({ active: false, spellId: null, cell: null, notice: null }),
    getFlash: () => null,
    spawnReviewWorld: () => false,
    sync: (): void => {},
  };
  return { ...base, ...overrides } as unknown as DevtoolsContext;
}

describe('devtools context contract (CODE-QUALITY Task 11)', () => {
  it('reports null-world telemetry defaults without a world', () => {
    const hooks = createDevtools(makeCtx()).hooks;
    expect(hooks.turn()).toBe(-1);
    expect(hooks.hp()).toBe(-1);
    expect(hooks.position()).toBeNull();
    expect(hooks.log()).toEqual([]);
    expect(hooks.boss()).toBeNull();
    expect(hooks.entities()).toEqual([]);
    expect(hooks.camera()).toBeNull();
  });

  it('gates dispatch on story, victory, and death', () => {
    const gates = ['isDead', 'isShowingStory', 'isVictoryActive'] as const;
    for (const gate of gates) {
      const seen: string[] = [];
      const ctx = makeCtx({ world: makeWorld(), [gate]: () => true, dispatchAction: (a: { type: string }): void => { seen.push(a.type); } });
      createDevtools(ctx).hooks.dispatch({ type: 'WAIT' });
      expect(seen).toEqual([]);
    }
  });

  it('boss() finds quest bosses declared via the additive bosses[] array (PART2-PLAN)', () => {
    const w = makeWorld();
    const level = w.levels.get(w.current);
    expect(level).toBeDefined();
    const lv = level!;
    const monster = { hp: 240, maxHp: 240, stats: { maxHp: 240, ac: 12, toHit: 12, damage: { count: 3, sides: 10, bonus: 8 }, speed: 1, xp: 6000 } };
    lv.entities.set(1, { id: 1, kind: 'monster', name: 'The Demon Lord Surtur', x: 6, y: 38, monster });
    lv.occupancy[6 + 38 * 64] = 1;
    w.data.quests = [
      {
        id: 'q2',
        title: 'Test',
        stages: [],
        bosses: [{ level: w.current, monster: 'The Demon Lord Surtur', guards: [] }],
      },
    ];
    const hooks = createDevtools(makeCtx({ world: w })).hooks;
    expect(hooks.boss()).toEqual({ x: 6, y: 38, name: 'The Demon Lord Surtur', hp: 240 });
  });

  it('forwards dispatch to the controller when playable', () => {
    const seen: string[] = [];
    const ctx = makeCtx({ world: makeWorld(), dispatchAction: (a: { type: string }): void => { seen.push(a.type); } });
    createDevtools(ctx).hooks.dispatch({ type: 'WAIT' });
    expect(seen).toEqual(['WAIT']);
  });

  it('delegates stair lookup to findStair (deduped row-major first match)', () => {
    const w = makeWorld();
    const hooks = createDevtools(makeCtx({ world: w })).hooks;
    // Town level exists with the mine stair at a known fixed coordinate.
    expect(hooks.stair('down')).toEqual({ x: 15, y: 2 });
    expect(hooks.stair('up')).toBeNull();
  });

  it('computes camera geometry from the live camera state and canvas size', () => {
    const w = makeWorld();
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 480, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 640, configurable: true });
    const hooks = createDevtools(
      makeCtx({ world: w, canvas, getCameraState: () => ({ zoomIndex: 1, panX: 0, panY: 0 }) }),
    ).hooks;
    const cam = hooks.camera();
    expect(cam).not.toBeNull();
    expect(cam!.zoomIndex).toBe(1);
    expect(cam!.tile).toBeGreaterThan(0);
  });

  it('flash math reflects remaining time and expiry', () => {
    let now = 1000;
    const ctx = makeCtx({ world: makeWorld(), now: () => now, getFlash: () => ({ cells: [{ x: 1, y: 1 }], start: 1000, durationMs: 400 }) });
    const hooks = createDevtools(ctx).hooks;
    expect(hooks.flash()).toEqual({ active: true, cells: 1, remainingMs: 400 });
    now = 1300;
    expect(hooks.flash().remainingMs).toBe(100);
    expect(hooks.flash().active).toBe(true);
    now = 1500;
    expect(hooks.flash().active).toBe(false);
  });

  it('passthrough accessors forward travel, targeting, shop doors, and applied count', () => {
    const w = makeWorld();
    const taps: string[] = [];
    const ctx = makeCtx({
      world: w,
      getAppliedCount: () => 42,
      mapTap: (_cell: { x: number; y: number }, pointerType: string): void => {
        taps.push(pointerType);
      },
      getTravelState: () => ({ active: true, reason: 'stairs lead down', remaining: 2, selected: { x: 1, y: 2 }, hover: null, preview: 3, attack: null }),
      getTargetingState: () => ({ active: true, spellId: 's527', cell: { x: 4, y: 4 }, notice: null }),
      town: () => ({ buildings: [{ shopId: 'snorri', name: 'Snorri', door: { x: 6, y: 7 }, rect: { x: 0, y: 0, w: 1, h: 1 } }], shops: {} }),
    });
    const hooks = createDevtools(ctx).hooks;
    expect(hooks.appliedCount()).toBe(42);
    hooks.travel.tap({ x: 1, y: 1 });
    hooks.travel.tap({ x: 1, y: 1 }, 'mouse');
    expect(taps).toEqual(['touch', 'mouse']);
    expect(hooks.travel.state().remaining).toBe(2);
    expect(hooks.targeting().spellId).toBe('s527');
    expect(hooks.shopDoors()).toEqual([{ shopId: 'snorri', x: 6, y: 7 }]);
  });
});
it('keeps the targeting fixture spell IDs valid in Part Two',async()=>{
 const {serializeGame,deserializeGame}=await import('../engine/save');
 const w=makeWorld();w.data=loadWorldData(2);delete w.questState;
 const hooks=createDevtools(makeCtx({world:w})).hooks;
 expect(hooks.scene('targeting').ok).toBe(true);
 expect(w.player.knownSpells.every(id=>!!w.data.spells[id])).toBe(true);
 expect(()=>deserializeGame(serializeGame(w),w.data)).not.toThrow();
});

it('campaign routes can exclude neutral blockers while still approaching monsters', () => {
  const world = makeWorld();
  const level = world.levels.get(world.current)!;
  level.tiles[4 + 3 * 64] = 1;
  level.entities.set(230, { id: 230, kind: 'npc', name: 'Traveler', x: 4, y: 3, npc: { role: 'traveler', stock: [], giftClaimed: true } });
  level.occupancy[4 + 3 * 64] = 230;
  const hooks = createDevtools(makeCtx({ world })).hooks;
  expect(hooks.walkable(4, 3)).toBe(true);
  expect(hooks.walkable(4, 3, true)).toBe(false);
  level.entities.set(230, { id: 230, kind: 'monster', name: 'Rat', x: 4, y: 3 });
  expect(hooks.walkable(4, 3, true)).toBe(true);
});
