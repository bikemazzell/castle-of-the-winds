import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  DEFAULT_ZOOM_INDEX,
  ZOOM_STEPS,
} from './camera';
import { createViewport, type Viewport } from './viewport';

let hero = { x: 32, y: 32 };
let frozen = false;
let nowMs = 1_000;
let onChange: Mock;
let viewport: Viewport;

function makeViewport(overrides?: {
  width?: number;
  height?: number;
  dpr?: number;
}): Viewport {
  const width = overrides?.width ?? 480;
  const height = overrides?.height ?? 640;
  const canvas = {
    clientWidth: width,
    clientHeight: height,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement;
  const mapEl = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLElement;
  return createViewport({
    canvas,
    mapEl,
    getHero: () => hero,
    isFrozen: () => frozen,
    now: () => nowMs,
    dpr: () => overrides?.dpr ?? 1,
    onChange,
    win: undefined,
  });
}

beforeEach(() => {
  hero = { x: 32, y: 32 };
  frozen = false;
  nowMs = 1_000;
  onChange = vi.fn();
  viewport = makeViewport();
});

afterEach(() => {
  viewport.destroy();
});

describe('viewport module (CODE-QUALITY Task 11c)', () => {
  it('starts at the default zoom and zoom() moves one ladder step at a time', () => {
    expect(viewport.state.zoomIndex).toBe(DEFAULT_ZOOM_INDEX);
    viewport.zoom(1);
    expect(viewport.state.zoomIndex).toBe(DEFAULT_ZOOM_INDEX + 1);
    viewport.zoom(-1);
    expect(viewport.state.zoomIndex).toBe(DEFAULT_ZOOM_INDEX);
    expect(onChange).toHaveBeenCalled();
  });

  it('clamps zoom at both ladder ends', () => {
    for (let i = 0; i < 10; i += 1) viewport.zoom(-1);
    expect(viewport.state.zoomIndex).toBe(0);
    for (let i = 0; i < 10; i += 1) viewport.zoom(1);
    expect(viewport.state.zoomIndex).toBe(ZOOM_STEPS.length - 1);
  });

  it('frameCamera computes a camera honoring zoom (tile size) and hero center', () => {
    const cam = viewport.frameCamera(false);
    expect(cam).not.toBeNull();
    // 480px wide viewport at 11 tiles (default) → tile 43, clamped ≥24.
    expect(cam!.tile).toBe(43);
    const cam2 = makeViewport().frameCamera(false)!;
    expect(cam2.originX + cam2.cols / 2).toBeGreaterThanOrEqual(hero.x);
  });

  it('pan shifts the camera center opposite the drag and reports via frameCamera', () => {
    const before = viewport.frameCamera(false)!;
    // Drag right by two tiles of pixels → center moves left by 2 tiles.
    viewport.pan(before.tile * 2, 0);
    const after = viewport.frameCamera(false)!;
    expect(after.originX).toBe(before.originX - 2);
    expect(onChange).toHaveBeenCalled();
  });

  it('pinch accumulates: one doubling fires exactly one zoom step', () => {
    const start = viewport.state.zoomIndex;
    viewport.pinch(2); // log2(2) = 1 → one step
    expect(viewport.state.zoomIndex).toBe(start + 1);
    viewport.pinch(1.05); // below threshold → no step
    expect(viewport.state.zoomIndex).toBe(start + 1);
  });

  it('pinch re-baselines after a quiet gap so drift does not accumulate', () => {
    const start = viewport.state.zoomIndex;
    // Two 1.5x adjustments separated by a long pause: each is ~0.58 of a
    // doubling — together they would cross one full step if they accumulated
    // across the gap. The re-baseline keeps them independent: no zoom.
    viewport.pinch(1.5);
    expect(viewport.state.zoomIndex).toBe(start);
    nowMs += 5_000; // beyond the session window
    viewport.pinch(1.5);
    expect(viewport.state.zoomIndex).toBe(start);
    // A full doubling still fires exactly one step, even right after the gap.
    viewport.pinch(2);
    expect(viewport.state.zoomIndex).toBe(start + 1);
  });

  it('recenter clears pan back to the hero', () => {
    const before = viewport.frameCamera(false)!;
    viewport.pan(before.tile * 3, before.tile * 3);
    viewport.recenter();
    const after = viewport.frameCamera(false)!;
    expect(viewport.state.panX).toBe(0);
    expect(viewport.state.panY).toBe(0);
    expect(after.originX).toBe(before.originX);
    expect(after.originY).toBe(before.originY);
  });

  it('applyPreferenceScale sets the zoom index relative to the default, clamped', () => {
    viewport.applyPreferenceScale(-1);
    expect(viewport.state.zoomIndex).toBe(DEFAULT_ZOOM_INDEX - 1);
    viewport.applyPreferenceScale(0);
    expect(viewport.state.zoomIndex).toBe(DEFAULT_ZOOM_INDEX);
    viewport.applyPreferenceScale(1);
    expect(viewport.state.zoomIndex).toBe(DEFAULT_ZOOM_INDEX + 1);
    viewport.applyPreferenceScale(-5);
    expect(viewport.state.zoomIndex).toBe(0);
    viewport.applyPreferenceScale(5);
    expect(viewport.state.zoomIndex).toBe(ZOOM_STEPS.length - 1);
  });

  it('screenToWorld round-trips the center of a world cell while a frame is live', () => {
    const cam = viewport.frameCamera(false)!;
    const wx = Math.floor(cam.originX) + 2;
    const wy = Math.floor(cam.originY) + 2;
    const cell = viewport.screenToWorld(
      (wx - cam.originX + 0.5) * cam.tile,
      (wy - cam.originY + 0.5) * cam.tile,
    );
    expect(cell).toEqual({ x: wx, y: wy });
  });

  it('screenToWorld falls back to a hero-centered window when no frame is live', () => {
    expect(viewport.lastCamera()).toBeNull();
    // Headless fallback: 11-tile window around the hero at tile 27 (300px/11).
    const cell = viewport.screenToWorld(27, 27);
    expect(cell).toEqual({ x: hero.x + 1 - 5, y: hero.y + 1 - 5 });
  });

  it('followIntoSafeRegion pulls a far-panned hero back unless frozen', () => {
    viewport.state.panX = -24; // center = hero.x - 24 → hero far outside center box
    viewport.state.panY = 0;
    const moved = viewport.frameCamera(false)!;
    expect(viewport.state.panX).toBeGreaterThan(-24); // follow shifted pan back
    // Frozen (targeting): no follow.
    viewport.state.panX = -24;
    frozen = true;
    const frozenCam = viewport.frameCamera(true)!;
    expect(viewport.state.panX).toBe(-24);
    expect(frozenCam.originX).toBeLessThan(moved.originX + 24);
  });

  it('invalidate clears the live camera and notifies', () => {
    viewport.frameCamera(false);
    expect(viewport.lastCamera()).not.toBeNull();
    viewport.invalidate();
    expect(viewport.lastCamera()).toBeNull();
    expect(onChange).toHaveBeenCalled();
  });
});

describe('steady camera follow',()=>{
 it('holds the view still for small steps inside the safe region',()=>{
  const before=viewport.frameCamera(false)!;hero={x:33,y:32};const after=viewport.frameCamera(false)!;
  expect(after.originX).toBe(before.originX);expect(after.originY).toBe(before.originY);
 });
 it('follows the displayed hero gradually at the safe edge and hit-tests the displayed map',()=>{
  const before=viewport.frameCamera(false)!;
  hero={x:35,y:32};viewport.frameCamera(false);
  hero={x:36,y:32};const a=viewport.frameCamera(false,{x:35.5,y:32})!;
  const b=viewport.frameCamera(false,{x:35.6,y:32})!;
  expect(b.originX-a.originX).toBeGreaterThan(0);expect(b.originX-a.originX).toBeLessThan(0.2);
  expect(b.originX).toBeGreaterThan(before.originX);
  const screen=b.worldToScreen(36,32);expect(viewport.screenToWorld(screen.x+b.tile/2,screen.y+b.tile/2)).toEqual({x:36,y:32});
 });
});
