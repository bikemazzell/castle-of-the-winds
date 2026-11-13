import { describe, it, expect } from 'vitest';
import {
  cameraFor,
  cameraForState,
  centerOnHero,
  computeTileSize,
  createCameraState,
  followIntoSafeRegion,
  DEFAULT_ZOOM_INDEX,
  ZOOM_STEPS,
  zoomBy,
} from './camera';

describe('computeTileSize', () => {
  it('scales from the shorter viewport dimension / 11', () => {
    expect(computeTileSize({ width: 412, height: 915 }, 1)).toBe(37);
    expect(computeTileSize({ width: 915, height: 412 }, 1)).toBe(37);
  });

  it('clamps to the 24px minimum on tiny viewports', () => {
    expect(computeTileSize({ width: 200, height: 300 }, 1)).toBe(24);
  });

  it('clamps to the 96px maximum on huge viewports', () => {
    expect(computeTileSize({ width: 2000, height: 1200 }, 1)).toBe(96);
  });

  it('snaps down to whole device pixels for fractional dpr', () => {
    // 37 css px at dpr 2.625 = 97.125 device px -> 97 -> 36.952... css px
    const tile = computeTileSize({ width: 412, height: 915 }, 2.625);
    expect(tile).toBeCloseTo(97 / 2.625, 10);
    // snapping must never cross back over the unsnapped size
    expect(tile).toBeLessThanOrEqual(37);
  });

  it('stays integral at integer dpr and ignores invalid dpr', () => {
    expect(computeTileSize({ width: 412, height: 915 }, 2)).toBe(37);
    expect(computeTileSize({ width: 412, height: 915 }, 0)).toBe(37);
    expect(computeTileSize({ width: 412, height: 915 }, Number.NaN)).toBe(37);
  });
});

describe('cameraFor', () => {
  // tile 32, viewport 320×640 -> 10 cols × 20 rows
  const vp = { width: 320, height: 640 };
  const tile = 32;

  it('centers on the player mid-map', () => {
    const cam = cameraFor({ x: 32, y: 32 }, vp, tile);
    expect(cam.cols).toBe(10);
    expect(cam.rows).toBe(20);
    expect(cam.originX).toBe(27);
    expect(cam.originY).toBe(22);
  });

  it('clamps at the top-left corner', () => {
    const cam = cameraFor({ x: 0, y: 0 }, vp, tile);
    expect(cam.originX).toBe(0);
    expect(cam.originY).toBe(0);
  });

  it('clamps at the bottom-right corner', () => {
    const cam = cameraFor({ x: 63, y: 63 }, vp, tile);
    expect(cam.originX).toBe(54);
    expect(cam.originY).toBe(44);
  });

  it('clamps each axis independently', () => {
    const cam = cameraFor({ x: 5, y: 60 }, vp, tile);
    expect(cam.originX).toBe(0);
    expect(cam.originY).toBe(44);
  });

  it('caps visible tiles to the 64×64 map and pins origin to 0', () => {
    // viewport wider than the whole map at min tile size
    const cam = cameraFor({ x: 32, y: 32 }, { width: 4000, height: 500 }, 24);
    expect(cam.cols).toBe(64);
    expect(cam.originX).toBe(0);
    expect(cam.rows).toBe(Math.ceil(500 / 24));
  });

  it('worldToScreen maps map cells to viewport pixels', () => {
    const cam = cameraFor({ x: 32, y: 32 }, vp, tile);
    expect(cam.worldToScreen(27, 22)).toEqual({ x: 0, y: 0 });
    expect(cam.worldToScreen(30, 25)).toEqual({ x: 3 * tile, y: 3 * tile });
  });
});

describe('camera state: zoom, pan, center, follow (Phase 4)', () => {
  const VP = { width: 320, height: 640 }; // default zoom (11 tiles): tile 29, cols 11, rows 23

  it('defaults to the standard zoom with no pan', () => {
    const state = createCameraState();
    expect(state.zoomIndex).toBe(DEFAULT_ZOOM_INDEX);
    expect(ZOOM_STEPS[DEFAULT_ZOOM_INDEX]).toBe(11);
    expect(state.panX).toBe(0);
    expect(state.panY).toBe(0);
  });

  it('zoom steps are clamped at both ends', () => {
    const state = createCameraState();
    // zoom in until the end
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 10) changed = zoomBy(state, 1);
    expect(state.zoomIndex).toBe(ZOOM_STEPS.length - 1);
    expect(zoomBy(state, 1)).toBe(false);
    while (zoomBy(state, -1)) { /* rewind to zoomed-out end */ }
    expect(state.zoomIndex).toBe(0);
    expect(zoomBy(state, -1)).toBe(false);
  });

  it('zooming in grows the tile; zooming out shrinks it', () => {
    const state = createCameraState();
    const base = cameraForState(state, { x: 32, y: 32 }, VP, 1).tile;
    zoomBy(state, 1); // 8 tiles on the short axis -> larger tiles
    const inTile = cameraForState(state, { x: 32, y: 32 }, VP, 1).tile;
    expect(inTile).toBeGreaterThan(base);
    zoomBy(state, -1); // 11 -> 8 was index 2; step back to default then out
    zoomBy(state, -1); // 15 tiles -> smaller tiles
    const outTile = cameraForState(state, { x: 32, y: 32 }, VP, 1).tile;
    expect(outTile).toBeLessThan(base);
  });

  it('pan shifts the camera center off the hero, clamped to the map', () => {
    const state = createCameraState();
    state.panX = 4;
    const centered = cameraFor({ x: 32, y: 32 }, VP, cameraForState(createCameraState(), { x: 32, y: 32 }, VP, 1).tile);
    const panned = cameraForState(state, { x: 32, y: 32 }, VP, 1);
    expect(panned.originX).toBe(centered.originX + 4);
    // at the left map edge the same pan clamps to origin 0
    const edge = cameraForState(state, { x: 2, y: 2 }, VP, 1);
    expect(edge.originX).toBe(0);
    expect(edge.originY).toBe(0);
  });

  it('centerOnHero clears the pan and reports whether anything changed', () => {
    const state = createCameraState();
    expect(centerOnHero(state)).toBe(false);
    state.panX = 5;
    state.panY = -3;
    expect(centerOnHero(state)).toBe(true);
    expect(state.panX).toBe(0);
    expect(state.panY).toBe(0);
  });

  it('follow keeps only pans that hold the hero inside the central safe region', () => {
    const state = createCameraState();
    const hero = { x: 32, y: 32 };
    const settle = (): void => {
      // follow is called once per draw; integer-origin quantization can need
      // a second nudge to settle — iterate to fixation like the draw loop.
      for (let i = 0; i < 5; i++) {
        if (!followIntoSafeRegion(state, cameraForState(state, hero, VP, 1), hero)) break;
      }
    };
    state.panX = 3;
    state.panY = 6;
    expect(followIntoSafeRegion(state, cameraForState(state, hero, VP, 1), hero)).toBe(false);
    state.panX = 8; // hero would drift out of the safe box -> pulled back
    settle();
    let cam = cameraForState(state, hero, VP, 1);
    expect(Math.abs(hero.x - (cam.originX + cam.cols / 2))).toBeLessThanOrEqual(cam.cols * 0.3 + 0.5 + 1e-9);
    state.panY = -20;
    settle();
    cam = cameraForState(state, hero, VP, 1);
    expect(Math.abs(hero.y - (cam.originY + cam.rows / 2))).toBeLessThanOrEqual(cam.rows * 0.3 + 0.5 + 1e-9);
  });

  it('computeTileSize honors a custom short-axis tile count', () => {
    expect(computeTileSize({ width: 320, height: 640 }, 1, 8)).toBe(40);
    // avoid the MIN/MAX clamps: 800px short axis, 15 vs 11 vs 8 tiles
    const outTile = computeTileSize({ width: 800, height: 800 }, 1, 15);
    const base = computeTileSize({ width: 800, height: 800 }, 1, 11);
    const inTile = computeTileSize({ width: 800, height: 800 }, 1, 8);
    expect(outTile).toBeLessThan(base);
    expect(inTile).toBeGreaterThan(base);
  });
});

it('keeps the hero above floating controls even at the bottom map edge', () => {
  const viewport = {width:390, height:730, bottomInset:180};
  const camera = cameraForState(createCameraState(), {x:32,y:63}, viewport);
  const hero = camera.worldToScreen(32,63);
  expect(hero.y + camera.tile).toBeLessThanOrEqual(viewport.height - viewport.bottomInset);
  expect(camera.rows * camera.tile).toBeGreaterThanOrEqual(viewport.height);
});

it('frames complete edge tiles outside the zoom controls', () => {
  const viewport = {width:390,height:730,bottomInset:180,rightInset:64};
  const camera = cameraForState(createCameraState(),{x:63,y:0},viewport);
  expect(camera.worldToScreen(63,0).x + camera.tile).toBeLessThanOrEqual(326);
});
