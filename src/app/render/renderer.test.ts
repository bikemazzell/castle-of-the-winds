import { describe, it, expect, vi } from 'vitest';
import { createEmptyLevel, idx, type Level } from '../../engine/map';
import { cameraFor, type Camera } from './camera';
import { createRenderer, renderFrame, type Ctx2D } from './renderer';

interface DrawImageCall {
  img: unknown;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface FillCall {
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

class FakeCtx implements Ctx2D {
  fillStyle = '#000';
  globalAlpha = 1;
  readonly fills: FillCall[] = [];
  readonly images: DrawImageCall[] = [];
  fillRect(x: number, y: number, w: number, h: number): void {
    this.fills.push({ color: this.fillStyle, x, y, w, h });
  }
  drawImage(img: unknown, x: number, y: number, w: number, h: number): void {
    this.images.push({ img, x, y, w, h });
  }
}

const TILE = 32;
const VP = { width: 320, height: 640 }; // 10 cols × 20 rows

const fakeFloor = { tag: 'floor' };
const fakeWall = { tag: 'wall' };

function fixtureLevel(): Level {
  const level = createEmptyLevel(1);
  for (let i = 0; i < level.tiles.length; i++) level.tiles[i] = 1; // floor everywhere
  return level;
}

const STYLES = {
  tiles: {
    '1': { sprite: 'bm124' },
    '0': { sprite: 'bm120' },
    '18': { sprite: null as string | null },
  },
  sprites: { bm124: fakeFloor, bm120: fakeWall } as Record<string, unknown>,
};

function allSeen(): Uint8Array {
  return new Uint8Array(4096).fill(1);
}

describe('renderFrame', () => {
  it('draws seen tiles via their sprite at camera-mapped positions', () => {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    renderFrame(ctx, camera, { level, seen: allSeen(), visible: allSeen(), player: { x: 5, y: 10 } }, STYLES);
    // cell (2,3) is inside the viewport
    const cell = camera.worldToScreen(2, 3);
    expect(ctx.images).toContainEqual({ img: fakeFloor, x: cell.x, y: cell.y, w: TILE, h: TILE });
  });

  it('never draws unseen cells', () => {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    const seen = new Uint8Array(4096); // nothing seen
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    renderFrame(ctx, camera, { level, seen, visible: seen, player: { x: 5, y: 10 } }, STYLES);
    expect(ctx.images.length).toBe(0);
    // only the initial black background fill + the always-drawn player marker
    expect(ctx.fills.length).toBe(2);
  });

  it('dims remembered-but-not-visible cells with an overlay', () => {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    const seen = allSeen();
    const visible = new Uint8Array(4096);
    visible[idx(5, 10)] = 1; // only the player cell currently lit
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    renderFrame(ctx, camera, { level, seen, visible, player: { x: 5, y: 10 } }, STYLES);
    const dim = camera.worldToScreen(2, 3);
    expect(ctx.fills).toContainEqual({ color: 'rgba(4,2,10,0.86)', x: dim.x, y: dim.y, w: TILE, h: TILE });
  });

  it('falls back to a fill for tiles with no sprite mapping', () => {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    level.tiles[idx(2, 3)] = 18; // stairs with sprite: null
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    renderFrame(ctx, camera, { level, seen: allSeen(), visible: allSeen(), player: { x: 5, y: 10 } }, STYLES);
    const cell = camera.worldToScreen(2, 3);
    expect(ctx.fills).toContainEqual({ color: '#3a3450', x: cell.x, y: cell.y, w: TILE, h: TILE });
  });

  it('draws entity markers on visible cells', () => {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    const entities = [
      { id: 1, kind: 'monster' as const, name: 'Kobold', x: 6, y: 10 },
      { id: 2, kind: 'npc' as const, name: 'Snorri', x: 4, y: 9 },
      { id: 3, kind: 'monster' as const, name: 'Hidden Orc', x: 40, y: 40 },
    ];
    const seen = allSeen();
    seen[idx(40, 40)] = 0; // third monster unseen
    renderFrame(ctx, camera, { level, seen, visible: seen, player: { x: 5, y: 10 }, entities }, STYLES);
    const monsterCell = camera.worldToScreen(6, 10);
    const inset = TILE * 0.2;
    const size = TILE * 0.6;
    expect(ctx.fills).toContainEqual({ color: '#e05656', x: monsterCell.x + inset, y: monsterCell.y + inset, w: size, h: size });
    const npcCell = camera.worldToScreen(4, 9);
    expect(ctx.fills).toContainEqual({ color: '#7bd88f', x: npcCell.x + inset, y: npcCell.y + inset, w: size, h: size });
    // unseen monster never drawn
    const farCell = camera.worldToScreen(40, 40);
    expect(ctx.fills.some((f) => f.x === farCell.x + inset && f.y === farCell.y + inset)).toBe(false);
  });

  it('never draws actors on remembered-but-not-visible cells (A08)', () => {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    const entities = [
      { id: 1, kind: 'monster' as const, name: 'Kobold', x: 6, y: 10 }, // visible
      { id: 2, kind: 'monster' as const, name: 'Ghost', x: 7, y: 10 }, // remembered only
      { id: 3, kind: 'npc' as const, name: 'Old Snorri', x: 7, y: 11 }, // remembered only
    ];
    const seen = allSeen();
    const visible = new Uint8Array(4096);
    visible[idx(5, 10)] = 1;
    visible[idx(6, 10)] = 1;
    renderFrame(ctx, camera, { level, seen, visible, player: { x: 5, y: 10 }, entities }, STYLES);
    // visible monster drawn
    const monsterCell = camera.worldToScreen(6, 10);
    expect(ctx.fills.some((f) => f.x === monsterCell.x + TILE * 0.2 && f.y === monsterCell.y + TILE * 0.2)).toBe(true);
    // remembered-only actors never drawn (terrain renders without them)
    for (const c of [{ x: 7, y: 10 }, { x: 7, y: 11 }]) {
      const cell = camera.worldToScreen(c.x, c.y);
      expect(ctx.fills.some((f) => f.x === cell.x + TILE * 0.2 && f.y === cell.y + TILE * 0.2)).toBe(false);
    }
  });

  it('still draws ground items on remembered cells (static knowledge)', () => {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    const seen = allSeen();
    const visible = new Uint8Array(4096);
    visible[idx(5, 10)] = 1;
    renderFrame(
      ctx,
      camera,
      { level, seen, visible, player: { x: 5, y: 10 }, groundItems: [{ x: 7, y: 12 }] },
      STYLES,
    );
    const cell = camera.worldToScreen(7, 12);
    const inset = TILE * 0.3;
    expect(ctx.fills).toContainEqual({ color: '#c9a86a', x: cell.x + inset, y: cell.y + inset, w: TILE * 0.4, h: TILE * 0.4 });
  });

  it('always draws the player marker', () => {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    const seen = new Uint8Array(4096);
    renderFrame(ctx, camera, { level, seen, visible: seen, player: { x: 5, y: 10 } }, STYLES);
    const cell = camera.worldToScreen(5, 10);
    const inset = TILE * 0.2;
    expect(ctx.fills).toContainEqual({ color: '#ffd76a', x: cell.x + inset, y: cell.y + inset, w: TILE * 0.6, h: TILE * 0.6 });
  });

  it('draws ground item markers on seen cells', () => {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    renderFrame(
      ctx,
      camera,
      { level, seen: allSeen(), visible: allSeen(), player: { x: 5, y: 10 }, groundItems: [{ x: 7, y: 12 }] },
      STYLES,
    );
    const cell = camera.worldToScreen(7, 12);
    const inset = TILE * 0.3;
    expect(ctx.fills).toContainEqual({ color: '#c9a86a', x: cell.x + inset, y: cell.y + inset, w: TILE * 0.4, h: TILE * 0.4 });
  });
});

describe('monster sensing — Detect Monsters (Task 4)', () => {
  const SENSE_INSET = TILE * 0.3;
  const SENSE_SIZE = TILE * 0.4;

  function senseScene(sense: boolean): { ctx: FakeCtx; camera: Camera } {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    const entities = [
      { id: 1, kind: 'monster' as const, name: 'Kobold', x: 6, y: 10 }, // visible
      { id: 2, kind: 'monster' as const, name: 'Sensed Ghost', x: 7, y: 10 }, // seen, not visible
    ];
    const seen = allSeen();
    const visible = new Uint8Array(4096);
    visible[idx(5, 10)] = 1;
    visible[idx(6, 10)] = 1;
    renderFrame(ctx, camera, { level, seen, visible, player: { x: 5, y: 10 }, entities, sense }, STYLES);
    return { ctx, camera };
  }

  it('sense=true marks seen-but-unseen monsters with a distinct dim marker', () => {
    const { ctx, camera } = senseScene(true);
    const cell = camera.worldToScreen(7, 10);
    expect(ctx.fills).toContainEqual({ color: '#9a5b5b', x: cell.x + SENSE_INSET, y: cell.y + SENSE_INSET, w: SENSE_SIZE, h: SENSE_SIZE });
    // the visible monster keeps its normal marker
    const visibleCell = camera.worldToScreen(6, 10);
    expect(ctx.fills.some((f) => f.x === visibleCell.x + TILE * 0.2 && f.color === '#e05656')).toBe(true);
  });

  it('sense=false leaves remembered-but-unseen monsters hidden (A08 unchanged)', () => {
    const { ctx, camera } = senseScene(false);
    const cell = camera.worldToScreen(7, 10);
    expect(ctx.fills.some((f) => f.x === cell.x + SENSE_INSET && f.y === cell.y + SENSE_INSET)).toBe(false);
  });
});

describe('route overlay visuals (UI plan Phase 4)', () => {
  const TINT = 'rgba(216,181,109,0.3)';
  const ringCount = (ctx: FakeCtx, color: string, x: number, y: number): number => {
    const cell = cameraFor({ x: 5, y: 10 }, VP, TILE).worldToScreen(x, y);
    return ctx.fills.filter(
      (f) =>
        f.color === color &&
        f.x >= cell.x - 0.5 && f.x <= cell.x + TILE + 0.5 &&
        f.y >= cell.y - 0.5 && f.y <= cell.y + TILE + 0.5,
    ).length;
  };

  it('tints route cells and never tints unseen cells', () => {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    const seen = allSeen();
    seen[idx(3, 3)] = 0; // second route cell is unexplored
    renderFrame(ctx, camera, {
      level, seen, visible: allSeen(), player: { x: 5, y: 10 },
      overlay: { route: [{ x: 2, y: 3 }, { x: 3, y: 3 }] },
    }, STYLES);
    const a = camera.worldToScreen(2, 3);
    expect(ctx.fills).toContainEqual({ color: TINT, x: a.x, y: a.y, w: TILE, h: TILE });
    const b = camera.worldToScreen(3, 3);
    expect(ctx.fills.some((f) => f.color === TINT && f.x === b.x && f.y === b.y)).toBe(false);
  });

  it('rings the destination in accent, the selection in ink, the attack in danger', () => {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    renderFrame(ctx, camera, {
      level, seen: allSeen(), visible: allSeen(), player: { x: 5, y: 10 },
      overlay: { destination: { x: 2, y: 3 }, selected: { x: 2, y: 3 }, attack: { x: 6, y: 10 } },
    }, STYLES);
    expect(ringCount(ctx, '#d8b56d', 2, 3)).toBe(4); // destination ring = 4 border rects
    expect(ringCount(ctx, '#f1e8d6', 2, 3)).toBe(4); // selection ring
    expect(ringCount(ctx, '#ef7b78', 6, 10)).toBe(4); // attack ring
  });

  it('rings unseen cells only through the seen guard — destination on fog is skipped', () => {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    const seen = allSeen();
    seen[idx(2, 3)] = 0;
    renderFrame(ctx, camera, {
      level, seen, visible: allSeen(), player: { x: 5, y: 10 },
      overlay: { destination: { x: 2, y: 3 } },
    }, STYLES);
    expect(ringCount(ctx, '#d8b56d', 2, 3)).toBe(0);
  });

  it('draws nothing extra when no overlay is given', () => {
    const ctxBase = new FakeCtx();
    const ctxOverlay = new FakeCtx();
    const level = fixtureLevel();
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    const base = { level, seen: allSeen(), visible: allSeen(), player: { x: 5, y: 10 } } as const;
    renderFrame(ctxBase, camera, base, STYLES);
    renderFrame(ctxOverlay, camera, { ...base, overlay: {} }, STYLES);
    expect(ctxOverlay.fills.length).toBe(ctxBase.fills.length);
    expect(ctxOverlay.images.length).toBe(ctxBase.images.length);
  });
});

describe('targeting overlay (UI plan Phase 6)', () => {
  const TARGET_TINT = 'rgba(132,183,242,0.10)';
  const TARGET_RING = '#84b7f2'; // mana
  const ringCount = (ctx: FakeCtx, color: string, x: number, y: number): number => {
    const cell = cameraFor({ x: 5, y: 10 }, VP, TILE).worldToScreen(x, y);
    return ctx.fills.filter(
      (f) =>
        f.color === color &&
        f.x >= cell.x - 0.5 && f.x <= cell.x + TILE + 0.5 &&
        f.y >= cell.y - 0.5 && f.y <= cell.y + TILE + 0.5,
    ).length;
  };

  it('tints currently visible cells as valid targets and rings the selection', () => {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    const seen = allSeen();
    const visible = new Uint8Array(4096);
    visible[idx(5, 10)] = 1; // player cell
    visible[idx(6, 10)] = 1; // adjacent
    renderFrame(ctx, camera, {
      level, seen, visible, player: { x: 5, y: 10 },
      overlay: { targeting: { cell: { x: 6, y: 10 } } },
    }, STYLES);

    // Valid-cell tint covers the two visible cells only (not remembered fog).
    const visCell = camera.worldToScreen(6, 10);
    expect(ctx.fills).toContainEqual({ color: TARGET_TINT, x: visCell.x, y: visCell.y, w: TILE, h: TILE });
    const fogCell = camera.worldToScreen(7, 12);
    expect(ctx.fills.some((f) => f.color === TARGET_TINT && f.x === fogCell.x && f.y === fogCell.y)).toBe(false);
    // Selection ring in mana blue.
    expect(ringCount(ctx, TARGET_RING, 6, 10)).toBe(4);
  });

  it('skips the selection ring on unseen cells', () => {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    const seen = allSeen();
    seen[idx(6, 10)] = 0;
    renderFrame(ctx, camera, {
      level, seen, visible: allSeen(), player: { x: 5, y: 10 },
      overlay: { targeting: { cell: { x: 6, y: 10 } } },
    }, STYLES);
    expect(ringCount(ctx, TARGET_RING, 6, 10)).toBe(0);
  });
});

describe('cast flash overlay (UI plan Phase 6)', () => {
  it('fills each affected cell with the flash color at the given alpha', () => {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    const cells = [
      { x: 5, y: 10 },
      { x: 6, y: 10 },
      { x: 5, y: 11 },
    ];
    const FLASH = 'rgba(216,181,109,0.55)';
    let curStyle = '';
    let curAlpha = 1;
    let alphaAtFlash: number | null = null;
    const probe: Ctx2D = {
      get fillStyle(): string { return curStyle; },
      set fillStyle(v: string) { curStyle = v; },
      get globalAlpha(): number { return curAlpha; },
      set globalAlpha(v: number) { curAlpha = v; },
      fillRect(x: number, y: number, w: number, h: number): void {
        if (curStyle === FLASH) alphaAtFlash = curAlpha;
        ctx.fillStyle = curStyle;
        ctx.fillRect(x, y, w, h);
      },
      drawImage(img: unknown, x: number, y: number, w: number, h: number): void {
        ctx.drawImage(img, x, y, w, h);
      },
    };
    renderFrame(probe, camera, {
      level, seen: allSeen(), visible: allSeen(), player: { x: 5, y: 10 },
      overlay: { flash: { cells, alpha: 0.42, color: FLASH } },
    }, STYLES);
    for (const c of cells) {
      const s = camera.worldToScreen(c.x, c.y);
      const hit = ctx.fills.find(
        (f) => f.color === FLASH && f.x === s.x && f.y === s.y,
      );
      expect(hit).toBeDefined();
    }
    expect(alphaAtFlash).toBeCloseTo(0.42);
  });

  it('skips flash cells that are not seen (never reveal fog)', () => {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    const seen = allSeen();
    seen[idx(6, 10)] = 0;
    const FLASH = 'rgba(216,181,109,0.55)';
    renderFrame(ctx, camera, {
      level, seen, visible: allSeen(), player: { x: 5, y: 10 },
      overlay: { flash: { cells: [{ x: 5, y: 10 }, { x: 6, y: 10 }], alpha: 0.5, color: FLASH } },
    }, STYLES);
    const lit = camera.worldToScreen(5, 10);
    const fog = camera.worldToScreen(6, 10);
    expect(ctx.fills.some((f) => f.color === FLASH && f.x === lit.x && f.y === lit.y)).toBe(true);
    expect(ctx.fills.some((f) => f.color === FLASH && f.x === fog.x && f.y === fog.y)).toBe(false);
  });
});

describe('createRenderer loop', () => {
  it('redraws only when dirty and stops cleanly', () => {
    const draws = vi.fn();
    let scheduled: (() => void) | undefined;
    const handles: number[] = [];
    let nextHandle = 1;
    const cancelled: number[] = [];
    const schedule = (cb: () => void): number => {
      scheduled = cb;
      const h = nextHandle++;
      handles.push(h);
      return h;
    };
    const cancel = (h: number): void => {
      cancelled.push(h);
    };

    const renderer = createRenderer(draws, schedule, cancel);
    renderer.start();
    expect(typeof scheduled).toBe('function');

    const tick = scheduled!;
    tick(); // dirty at start -> draw
    expect(draws).toHaveBeenCalledTimes(1);
    tick(); // clean -> no draw
    expect(draws).toHaveBeenCalledTimes(1);

    renderer.markDirty();
    tick();
    expect(draws).toHaveBeenCalledTimes(2);

    // F24: after the pump ran there is no pending frame — stop cancels
    // nothing. Cancelling only happens when a pump is actually pending.
    renderer.stop();
    expect(cancelled).toHaveLength(0);
    renderer.start();
    renderer.markDirty();
    renderer.stop();
    expect(cancelled).toContain(handles[handles.length - 1]!);
  });

  it('exposes renderOnce for synchronous draws', () => {
    const draws = vi.fn();
    const renderer = createRenderer(draws, () => 0, () => {});
    renderer.renderOnce();
    expect(draws).toHaveBeenCalledTimes(1);
  });
});

describe('only-when-dirty scheduling (F24, Task 12)', () => {
  const makeLoop = () => {
    const draws = vi.fn();
    const pending: Array<{ h: number; cb: () => void }> = [];
    const handles: number[] = [];
    const cancelled: number[] = [];
    let nextHandle = 1;
    const schedule = (cb: () => void): number => {
      const h = nextHandle++;
      handles.push(h);
      pending.push({ h, cb });
      return h;
    };
    const cancel = (h: number): void => {
      cancelled.push(h);
      const i = pending.findIndex((e) => e.h === h);
      if (i >= 0) pending.splice(i, 1); // real cancelAnimationFrame removes the callback
    };
    const runPending = (): void => {
      const e = pending.shift();
      if (e) e.cb();
    };
    const renderer = createRenderer(draws, schedule, cancel);
    return { draws, pending, handles, cancelled, renderer, runPending };
  };

  it('schedules no frames while idle after the initial draw', () => {
    const loop = makeLoop();
    loop.renderer.start();
    expect(loop.handles).toHaveLength(1);
    loop.runPending(); // initial dirty draw
    expect(loop.draws).toHaveBeenCalledTimes(1);
    // Clean and running: the loop must NOT keep scheduling frames.
    expect(loop.handles).toHaveLength(1);
    expect(loop.pending).toHaveLength(0);
    loop.renderer.stop();
  });

  it('coalesces repeated markDirty into a single draw', () => {
    const loop = makeLoop();
    loop.renderer.start();
    loop.runPending(); // initial draw (handle 1)
    loop.renderer.markDirty();
    loop.renderer.markDirty();
    loop.renderer.markDirty();
    expect(loop.handles).toHaveLength(2); // exactly one pump scheduled
    loop.runPending();
    expect(loop.draws).toHaveBeenCalledTimes(2);
    expect(loop.handles).toHaveLength(2);
    expect(loop.pending).toHaveLength(0);
    loop.renderer.stop();
  });

  it('dirtiness raised during drawing chains exactly one more frame', () => {
    let chain = true;
    const pending: Array<() => void> = [];
    const handles: number[] = [];
    let nextHandle = 1;
    const rendererRef: { markDirty(): void } = { markDirty: () => {} };
    const spyDraws = vi.fn(() => {
      if (chain) {
        chain = false;
        rendererRef.markDirty(); // reentrant: scene changed mid-draw
      }
    });
    const renderer = createRenderer(
      spyDraws,
      (cb) => {
        pending.push(cb);
        const h = nextHandle++;
        handles.push(h);
        return h;
      },
      () => {},
    );
    rendererRef.markDirty = () => renderer.markDirty();
    renderer.start();
    expect(handles).toHaveLength(1);
    pending.shift()!(); // draw #1 marks dirty reentrantly -> chains one frame
    expect(handles).toHaveLength(2);
    pending.shift()!(); // draw #2 settles
    expect(spyDraws).toHaveBeenCalledTimes(2);
    expect(handles).toHaveLength(2);
    expect(pending).toHaveLength(0);
    renderer.stop();
  });

  it('stop cancels the pending pump and a restart reschedules it', () => {
    const loop = makeLoop();
    loop.renderer.start();
    loop.runPending();
    loop.renderer.markDirty();
    expect(loop.pending).toHaveLength(1);
    loop.renderer.stop();
    expect(loop.cancelled).toContain(loop.handles[loop.handles.length - 1]!);
    loop.renderer.start(); // dirty flag survived the stop
    expect(loop.pending).toHaveLength(1);
    loop.runPending();
    expect(loop.draws).toHaveBeenCalledTimes(2);
    loop.renderer.stop();
  });
});
describe('bounded visual effects', () => {
  it('keeps redraw requests made inside draw for the next frame', () => {
    let tick: (() => void) | undefined;
    let draws = 0;
    const renderer = createRenderer(() => {
      draws++;
      if (draws < 3) renderer.markDirty();
    }, cb => { tick = cb; return 1; }, () => {});
    renderer.start();
    tick!(); tick!(); tick!(); tick!();
    expect(draws).toBe(3);
    renderer.stop();
  });

  it('darkens distant remembered terrain more than memory beside the light', () => {
    const ctx = new FakeCtx();
    const level = fixtureLevel();
    const visible = new Uint8Array(4096);
    visible[idx(5, 10)] = 1;
    const camera = cameraFor({ x: 5, y: 10 }, VP, TILE);
    renderFrame(ctx, camera, {level, seen: allSeen(), visible, player: {x:5,y:10}}, STYLES);
    const fogAlpha = (x: number, y: number): number => {
      const cell = camera.worldToScreen(x,y);
      const fill = ctx.fills.find(f => f.x===cell.x && f.y===cell.y && f.color.startsWith('rgba(4,2,10,'));
      return Number(fill?.color.match(/,([\d.]+)\)$/)?.[1]);
    };
    expect(fogAlpha(6,10)).toBeLessThan(fogAlpha(8,10));
    expect(fogAlpha(8,10)).toBeLessThan(fogAlpha(2,3));
  });

  it('interpolates a visible step and returns exactly to the destination', () => {
    const hero = {tag:'hero'};
    const level = fixtureLevel();
    const camera = cameraFor({x:5,y:10}, VP, TILE);
    const styles = {...STYLES, sprites:{...STYLES.sprites, 'actor:hero':hero}};
    const draw = (progress: number, seen = allSeen()) => {
      const ctx = new FakeCtx();
      renderFrame(ctx, camera, {level, seen, visible:seen, player:{x:5,y:10},
        animation:{player:{kind:'move',from:{x:4,y:10},progress}}}, styles);
      return ctx.images.find(i => i.img===hero)!;
    };
    const cell=camera.worldToScreen(5,10);
    expect(draw(0.5).x).toBeLessThan(cell.x);
    expect(draw(0.5).x).toBeGreaterThan(cell.x-TILE);
    expect(draw(1)).toEqual({img:hero,x:cell.x,y:cell.y,w:TILE,h:TILE});
    const hidden=allSeen();hidden[idx(4,10)]=0;
    expect(draw(0.5,hidden).x).toBe(cell.x);
  });

  it('draws spell sparks only inside explored affected cells and restores alpha', () => {
    const ctx=new FakeCtx();const level=fixtureLevel();
    const camera=cameraFor({x:5,y:10},VP,TILE);const seen=allSeen();seen[idx(6,10)]=0;
    renderFrame(ctx,camera,{level,seen,visible:seen,player:{x:5,y:10},overlay:{flash:{cells:[{x:5,y:10},{x:6,y:10}],alpha:0.5}}},STYLES);
    const cell=camera.worldToScreen(5,10);
    const sparks=ctx.fills.filter(f=>f.color==='#fff0bd');
    expect(sparks.length).toBeGreaterThan(0);
    expect(sparks.every(f=>f.x>=cell.x&&f.x+f.w<=cell.x+TILE&&f.y>=cell.y&&f.y+f.h<=cell.y+TILE)).toBe(true);
    expect(ctx.globalAlpha).toBe(1);
  });
});

it('animates a visible attack and hit without moving the authoritative player', () => {
  const hero = {tag:'hero'};
  const level=fixtureLevel();const camera=cameraFor({x:5,y:10},VP,TILE);
  const player={x:5,y:10};const cell=camera.worldToScreen(player.x,player.y);
  const styles={...STYLES,sprites:{...STYLES.sprites,'actor:hero':hero}};
  const attack=new FakeCtx();
  renderFrame(attack,camera,{level,seen:allSeen(),visible:allSeen(),player,
    animation:{player:{kind:'attack',direction:{x:1,y:0},progress:0.5}}},styles);
  expect(attack.images.find(i=>i.img===hero)!.x).toBeGreaterThan(cell.x);
  const hit=new FakeCtx();
  renderFrame(hit,camera,{level,seen:allSeen(),visible:allSeen(),player,
    animation:{player:{kind:'hit',progress:0.125}}},styles);
  expect(hit.images.find(i=>i.img===hero)!.x).not.toBe(cell.x);
  expect(player).toEqual({x:5,y:10});
  const still=new FakeCtx();
  renderFrame(still,camera,{level,seen:allSeen(),visible:allSeen(),player},styles);
  expect(still.images.find(i=>i.img===hero)).toEqual({img:hero,x:cell.x,y:cell.y,w:TILE,h:TILE});
});

describe('expansion map art', () => {
  it('draws discoveries only on seen cells and dims exhausted or remembered discoveries', () => {
    const level=fixtureLevel(); const camera=cameraFor({x:5,y:10},VP,TILE);
    level.props=[
      {id:'fresh',kind:'treasure',x:5,y:10,exhausted:false},
      {id:'spent',kind:'junk',x:6,y:10,exhausted:true},
      {id:'remembered',kind:'bones',x:7,y:10,exhausted:false},
      {id:'unknown',kind:'rune',x:8,y:10,exhausted:false},
    ];
    const seen=allSeen(), visible=allSeen();seen[idx(8,10)]=0;visible[idx(7,10)]=0;visible[idx(8,10)]=0;
    const images=Object.fromEntries(['treasure','junk','bones','rune'].map(kind=>[`prop:${kind}`,{kind}]));
    const ctx=new FakeCtx(); const alphaAtDraw=new Map<unknown,number>();
    const draw=ctx.drawImage.bind(ctx);
    ctx.drawImage=(image,x,y,w,h)=>{alphaAtDraw.set(image,ctx.globalAlpha);draw(image,x,y,w,h);};
    renderFrame(ctx,camera,{level,seen,visible,player:{x:5,y:10}},{...STYLES,sprites:{...STYLES.sprites,...images}});
    expect(alphaAtDraw.has(images['prop:treasure'])).toBe(true);
    expect(alphaAtDraw.get(images['prop:junk'])).toBeLessThan(alphaAtDraw.get(images['prop:treasure'])!);
    expect(alphaAtDraw.has(images['prop:bones'])).toBe(true);
    const remembered=camera.worldToScreen(7,10);
    expect(ctx.fills.some(f=>f.x===remembered.x&&f.y===remembered.y&&f.color.startsWith('rgba(4,2,10,'))).toBe(true);
    expect(alphaAtDraw.has(images['prop:rune'])).toBe(false);
    expect(ctx.globalAlpha).toBe(1);
  });
  it('interpolates visible diagonal steps on both axes but never animates teleports', () => {
    const hero={tag:'hero'};const level=fixtureLevel();const camera=cameraFor({x:5,y:10},VP,TILE);
    const cell=camera.worldToScreen(5,10), styles={...STYLES,sprites:{...STYLES.sprites,'actor:hero':hero}};
    const draw=(from:{x:number;y:number},progress:number)=>{
      const ctx=new FakeCtx();renderFrame(ctx,camera,{level,seen:allSeen(),visible:allSeen(),player:{x:5,y:10},
        animation:{player:{kind:'move',from,progress}}},styles);
      return ctx.images.find(i=>i.img===hero)!;
    };
    const moving=draw({x:4,y:9},0.5);
    expect(moving.x).toBeLessThan(cell.x);expect(moving.y).toBeLessThan(cell.y);
    expect(moving.x).toBeGreaterThan(cell.x-TILE);expect(moving.y).toBeGreaterThan(cell.y-TILE);
    expect(draw({x:4,y:9},1)).toMatchObject(cell);
    expect(draw({x:3,y:8},0.5)).toMatchObject(cell);
  });
  it('adds a gentle hallucination tint only to visible known terrain', () => {
    const level=fixtureLevel(),camera=cameraFor({x:5,y:10},VP,TILE);
    const seen=allSeen(),visible=new Uint8Array(4096);visible[idx(5,10)]=1;
    const tint='rgba(154,115,212,0.08)';
    const draw=(hallucinating:boolean)=>{
      const ctx=new FakeCtx();renderFrame(ctx,camera,{level,seen,visible,player:{x:5,y:10},
        visual:{seed:42,turn:1,now:0,reduced:true,hallucinating}},STYLES);return ctx;
    };
    expect(draw(false).fills.filter(f=>f.color===tint)).toHaveLength(0);
    const tinted=draw(true).fills.filter(f=>f.color===tint),cell=camera.worldToScreen(5,10);
    expect(tinted).toEqual([{color:tint,x:cell.x,y:cell.y,w:TILE,h:TILE}]);
    expect(visible[idx(6,10)]).toBe(0);
  });
});

it('moves a gold projectile across visible cells and hides it behind fog', () => {
  const level=fixtureLevel(), camera=cameraFor({x:5,y:10},VP,TILE);
  const seen=allSeen(),visible=allSeen();
  const draw=(progress:number)=>{
    const ctx=new FakeCtx();renderFrame(ctx,camera,{level,seen,visible,player:{x:5,y:10},
      overlay:{projectile:{from:{x:5,y:10},to:{x:9,y:10},progress}}},STYLES);
    return ctx.fills.filter(f=>f.color==='#ffeab2'||f.color==='#c99d4e');
  };
  const first=draw(0), middle=draw(0.5), last=draw(1);
  expect(first.length).toBeGreaterThan(0);expect(middle.length).toBeGreaterThan(0);
  expect(middle[0]!.x).toBeGreaterThan(first[0]!.x);expect(last[0]!.x).toBeGreaterThan(middle[0]!.x);
  visible[idx(7,10)]=0;
  expect(draw(0.5)).toHaveLength(0);
  // At a tile boundary, the trail must stay inside visible cells.
  for(const pixel of draw(0.375)){
    const hidden=camera.worldToScreen(7,10);
    expect(pixel.x+pixel.w<=hidden.x || pixel.x>=hidden.x+TILE).toBe(true);
  }
  expect(draw(Number.NaN)).toHaveLength(0);
});
