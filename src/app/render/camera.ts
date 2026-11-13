/**
 * Pure camera math for the map viewport: centered on the player, clamped to
 * the 64×64 level bounds, with a device-pixel-snapped tile size so sprites
 * stay crisp on fractional-dpr phones.
 */

export interface ViewportSize {
  width: number;
  height: number;
  /** Space covered by floating controls at the bottom. */
  bottomInset?: number;
  rightInset?: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Camera {
  /** Tile size in CSS pixels (device-pixel snapped). */
  tile: number;
  /** Visible columns / rows (may overshoot viewport by <1 tile). */
  cols: number;
  rows: number;
  /** Unobstructed rows used for framing and follow. */
  safeRows?: number;
  safeCols?: number;
  /** Map-tile coordinate of the top-left visible cell. */
  originX: number;
  originY: number;
  /** Map a world tile to viewport pixel position (top-left of cell). */
  worldToScreen(x: number, y: number): { x: number; y: number };
}

export const MIN_TILE = 24;
export const MAX_TILE = 96;
/** Nominal tiles visible along the shorter axis (readable on phones). */
export const TILES_ON_SHORT_AXIS = 11;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Tile size: shorter viewport dimension / tilesOnShortAxis, clamped to
 * [24, 96], then rounded DOWN to a whole number of device pixels so a sprite
 * never spans a fractional physical pixel (blurry nearest-neighbor upscale).
 */
export function computeTileSize(viewport: ViewportSize, dpr = 1, tilesOnShortAxis = TILES_ON_SHORT_AXIS): number {
  const raw = Math.floor(Math.min(viewport.width, viewport.height) / tilesOnShortAxis);
  const clamped = clamp(raw, MIN_TILE, MAX_TILE);
  if (!Number.isFinite(dpr) || dpr <= 0) return clamped;
  return Math.max(1, Math.floor(clamped * dpr)) / dpr;
}

/** Centered, bounds-clamped camera for a 64×64 level. */
export function cameraFor(
  center: Point,
  viewport: ViewportSize,
  tile: number,
  mapTiles = 64,
  continuous = false,
): Camera {
  const cols = Math.min(mapTiles, Math.ceil(viewport.width / tile));
  const rows = Math.min(mapTiles, Math.ceil(viewport.height / tile));
  const safeCols = Math.max(1, Math.min(cols, Math.floor((viewport.width - (viewport.rightInset ?? 0)) / tile)));
  const maxX = Math.max(0, mapTiles - safeCols);
  const safeRows = Math.max(1, Math.min(rows, Math.floor((viewport.height - (viewport.bottomInset ?? 0)) / tile)));
  const maxY = Math.max(0, mapTiles - safeRows);
  const quantize = continuous ? (v: number):number => v : Math.floor;
  const originX = clamp(quantize(center.x - safeCols / 2), 0, maxX);
  const originY = clamp(quantize(center.y - safeRows / 2), 0, maxY);
  return {
    tile,
    cols,
    rows,
    safeRows,
    safeCols,
    originX,
    originY,
    worldToScreen(x: number, y: number) {
      return { x: (x - originX) * tile, y: (y - originY) * tile };
    },
  };
}

// ---------------------------------------------------------------------------
// Camera state: zoom steps + user pan + lazy follow (UI plan Phase 4).
// ---------------------------------------------------------------------------

/** Short-axis tile counts per zoom step, zoomed-out to zoomed-in. */
export const ZOOM_STEPS = [15, 11, 8, 6] as const;
export const DEFAULT_ZOOM_INDEX = 1;

/**
 * Persistent camera intent: which zoom step is active and how far the camera
 * center is panned off the hero, in tiles. Pan is a live offset: the camera
 * centers on hero + pan every frame; walking pulls pan back lazily once the
 * hero would leave the central safe region (followIntoSafeRegion).
 */
export interface CameraState {
  zoomIndex: number;
  panX: number;
  panY: number;
}

/** Fraction of the viewport span the hero may occupy before the camera follows. */
const SAFE_REGION = 0.3; // central 60% box -> ±30% from center

export function createCameraState(): CameraState {
  return { zoomIndex: DEFAULT_ZOOM_INDEX, panX: 0, panY: 0 };
}

/** Step zoom in (+1) or out (-1); returns whether the index changed. */
export function zoomBy(state: CameraState, dir: 1 | -1): boolean {
  const next = clamp(state.zoomIndex + dir, 0, ZOOM_STEPS.length - 1);
  if (next === state.zoomIndex) return false;
  state.zoomIndex = next;
  return true;
}

/** Drop the pan so the camera sits exactly on the hero; reports changes. */
export function centerOnHero(state: CameraState): boolean {
  if (state.panX === 0 && state.panY === 0) return false;
  state.panX = 0;
  state.panY = 0;
  return true;
}

/** Camera for the current state: centered on hero + pan, bounds-clamped. */
export function cameraForState(
  state: CameraState,
  hero: Point,
  viewport: ViewportSize,
  dpr = 1,
  mapTiles = 64,
  continuous = false,
): Camera {
  const tile = computeTileSize(viewport, dpr, ZOOM_STEPS[state.zoomIndex]);
  return cameraFor(
    { x: hero.x + state.panX, y: hero.y + state.panY },
    viewport,
    tile,
    mapTiles,
    continuous,
  );
}

/**
 * Lazy follow: clamp the pan so the hero stays inside the central safe region
 * of the given camera. Pan within the box is preserved (the user's framed
 * view survives small movements); pan that would let the hero drift out is
 * pulled back minimally. Returns whether the pan changed (caller redraws).
 */
export function followIntoSafeRegion(state: CameraState, camera: Camera, hero: Point): boolean {
  const maxPanX = (camera.safeCols ?? camera.cols) * SAFE_REGION;
  const maxPanY = (camera.safeRows ?? camera.rows) * SAFE_REGION;
  // Hero's ACTUAL offset from the view center (includes map-edge clamping,
  // where the simple identity heroOffset === -pan no longer holds).
  const heroOffX = hero.x - (camera.originX + (camera.safeCols ?? camera.cols) / 2);
  const heroOffY = hero.y - (camera.originY + (camera.safeRows ?? camera.rows) / 2);
  // Pull the camera center just far enough to bring the hero back into the box.
  // shift = hero-offset delta; the camera CENTER moves by -shift, and pan
  // (center - hero) follows the center.
  const shiftX = clamp(heroOffX, -maxPanX, maxPanX) - heroOffX;
  const shiftY = clamp(heroOffY, -maxPanY, maxPanY) - heroOffY;
  if (shiftX === 0 && shiftY === 0) return false;
  state.panX -= shiftX;
  state.panY -= shiftY;
  return true;
}
