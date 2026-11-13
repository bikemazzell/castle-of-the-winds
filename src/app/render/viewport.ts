import {
  Camera,
  CameraState,
  type ViewportSize,
  DEFAULT_ZOOM_INDEX,
  ZOOM_STEPS,
  cameraForState,
  centerOnHero,
  computeTileSize,
  createCameraState,
  followIntoSafeRegion,
  zoomBy,
} from './camera';

/**
 * Viewport owns everything about HOW the map is viewed: the camera state
 * (zoom/pan), pointer-driven view controls (pan/pinch/wheel), the map-corner
 * zoom buttons, and the resize/dpr observers that keep the camera honest.
 *
 * It deliberately does NOT assemble the scene — the controller's draw()
 * asks frameCamera() for the current Camera and renders with it.
 *
 * PINCH SESSIONS: pinch scale factors only mean something relative to a
 * baseline. A new baseline is taken whenever pinch input resumes after a
 * quiet gap (PINCH_SESSION_MS), mirroring the Phase-4 controller logic.
 */

const PINCH_SESSION_MS = 400;

export interface ViewportOptions {
  canvas: HTMLCanvasElement;
  mapEl: HTMLElement;
  overlayEl?: HTMLElement;
  getViewport?: () => ViewportSize;
  getHero: () => { x: number; y: number } | null;
  isFrozen: () => boolean;
  now: () => number;
  dpr: () => number;
  onChange: () => void;
  win?: Window;
}

export interface Viewport {
  /** Shared camera state (devtools + preferences read/write this object). */
  state: CameraState;
  /** Compute the frame camera (follows hero unless frozen); null pre-world. */
  frameCamera(frozen: boolean, displayedHero?: {x:number;y:number}): Camera | null;
  /** The camera computed by the last frameCamera call, if still live. */
  lastCamera(): Camera | null;
  /** Map surface px → world cell using the live camera (hero-window fallback). */
  screenToWorld(px: number, py: number): { x: number; y: number } | null;
  zoom(dir: 1 | -1): void;
  recenter(): void;
  pan(dxPx: number, dyPx: number): void;
  pinch(scale: number): void;
  /** Preference-driven base zoom: 0 = default, -1 smaller, +1 larger. */
  applyPreferenceScale(mapScale: number): void;
  /** Drop the live camera (resize/rotation) and request a redraw. */
  invalidate(): void;
  /** Mount the +/−/⌖ overlay buttons into the map element. */
  mountControls(): void;
  /** Attach wheel/resize/ResizeObserver/dpr listeners. Pair with destroy(). */
  attachInput(): void;
  destroy(): void;
}

export function createViewport(opts: ViewportOptions): Viewport {
  const { canvas, mapEl, getHero, isFrozen, now, dpr, onChange, win } = opts;
  const state = createCameraState();
  let last: Camera | null = null;
  let previousHero: {x:number;y:number} | null = null;

  let pinchAccum = 0;
  let prevPinch = 1;
  let pinchAt = 0;

  let dprQuery: MediaQueryList | null = null;
  const onDprChange = (): void => {
    stopDprWatch();
    viewport.invalidate();
    watchDpr();
  };
  const watchDpr = (): void => {
    if (!win || typeof win.matchMedia !== 'function' || !win.devicePixelRatio) {
      return;
    }
    dprQuery = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`);
    dprQuery.addEventListener('change', onDprChange);
  };
  const stopDprWatch = (): void => {
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = null;
  };

  let resizeObserver: ResizeObserver | null = null;
  const onResize = (): void => {
    viewport.invalidate();
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (isFrozen()) return;
    viewport.zoom(e.deltaY < 0 ? 1 : -1);
  };

  const liveCamera = (): Camera | null => {
    const hero = getHero();
    if (!hero) return null;
    const cw = canvas.clientWidth;
    const chh = canvas.clientHeight;
    if (cw === 0 || chh === 0) return null;
    return cameraForState(
      state,
      hero,
      (opts.getViewport?.() ?? { width: cw, height: chh }),
      dpr(),
    );
  };

  const frameCamera = (frozen: boolean, displayedHero?: {x:number;y:number}): Camera | null => {
    const hero = displayedHero ?? getHero();
    if (!hero) {
      last = null;
      return null;
    }
    const cw = canvas.clientWidth;
    const chh = canvas.clientHeight;
    if (cw === 0 || chh === 0) {
      last = null;
      return null;
    }
    if (previousHero && !frozen) {
      const dx=hero.x-previousHero.x,dy=hero.y-previousHero.y;
      if (Math.abs(dx)+Math.abs(dy) <= 8) {state.panX-=dx;state.panY-=dy;}
      else {state.panX=0;state.panY=0;}
    }
    previousHero={...hero};
    let camera = cameraForState(state, hero, (opts.getViewport?.() ?? { width: cw, height: chh }), dpr(),64,true);
    if (!frozen && followIntoSafeRegion(state, camera, hero)) {
      camera = cameraForState(state, hero, (opts.getViewport?.() ?? { width: cw, height: chh }), dpr(),64,true);
    }
    const originX=Math.round(camera.originX*camera.tile*dpr())/(camera.tile*dpr());
    const originY=Math.round(camera.originY*camera.tile*dpr())/(camera.tile*dpr());
    camera={...camera,originX,originY,worldToScreen:(x,y)=>({x:Math.round((x-originX)*camera.tile*dpr())/dpr(),y:Math.round((y-originY)*camera.tile*dpr())/dpr()})};
    last = camera;
    return camera;
  };

  const viewport: Viewport = {
    state,
    frameCamera,
    lastCamera: () => last,
    screenToWorld: (px, py) => {
      if (last) {
        const x = Math.floor(last.originX + px / last.tile);
        const y = Math.floor(last.originY + py / last.tile);
        if (x < 0 || y < 0 || x >= 64 || y >= 64) return null;
        return { x, y };
      }
      // Headless fallback: an 11-tile window centered on the hero.
      const hero = getHero();
      if (!hero) return null;
      const tile = computeTileSize({ width: 300, height: 300 }, 1);
      const x = hero.x + Math.floor(px / tile) - 5;
      const y = hero.y + Math.floor(py / tile) - 5;
      if (x < 0 || y < 0 || x >= 64 || y >= 64) return null;
      return { x, y };
    },
    zoom(dir) {
      if (zoomBy(state, dir)) onChange();
    },
    recenter() {
      centerOnHero(state);
      previousHero=null;
      last=null;
      onChange();
    },
    pan(dxPx, dyPx) {
      if (isFrozen()) return;
      const cam = last ?? liveCamera();
      if (!cam) return;
      state.panX -= dxPx / cam.tile;
      state.panY -= dyPx / cam.tile;
      onChange();
    },
    pinch(scale) {
      if (isFrozen()) return;
      const t = now();
      if (t - pinchAt > PINCH_SESSION_MS) {
        pinchAccum = 0;
        prevPinch = 1;
      }
      pinchAt = t;
      if (prevPinch > 0) {
        pinchAccum += Math.log2(scale / prevPinch);
      }
      prevPinch = scale;
      while (pinchAccum >= 1) {
        zoomBy(state, 1);
        onChange();
        pinchAccum -= 1;
      }
      while (pinchAccum <= -1) {
        zoomBy(state, -1);
        onChange();
        pinchAccum += 1;
      }
    },
    applyPreferenceScale(mapScale) {
      const target = Math.min(
        ZOOM_STEPS.length - 1,
        Math.max(0, DEFAULT_ZOOM_INDEX + mapScale),
      );
      if (state.zoomIndex !== target) {
        state.zoomIndex = target;
        onChange();
      }
    },
    invalidate() {
      previousHero=null;
      last = null;
      onChange();
    },
    mountControls() {
      const wrap = document.createElement('div');
      wrap.className = 'map-controls';
      const mk = (
        action: string,
        symbol: string,
        label: string,
        fn: () => void,
      ): void => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.action = action;
        btn.textContent = symbol;
        btn.setAttribute('aria-label', label);
        btn.title = label;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          fn();
        });
        wrap.appendChild(btn);
      };
      mk('zoom-in', '+', 'Zoom in', () => viewport.zoom(1));
      mk('zoom-out', '\u2212', 'Zoom out', () => viewport.zoom(-1));
      mk('center-hero', '\u2301', 'Center on hero', () => viewport.recenter());      mapEl.appendChild(wrap);
    },
    attachInput() {
      canvas.addEventListener('wheel', onWheel, { passive: false });
      win?.addEventListener('resize', onResize);
      if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(() => onResize());
        resizeObserver.observe(mapEl);
        if (opts.overlayEl) resizeObserver.observe(opts.overlayEl);
      }
      watchDpr();
    },
    destroy() {
      canvas.removeEventListener('wheel', onWheel);
      win?.removeEventListener('resize', onResize);
      resizeObserver?.disconnect();
      resizeObserver = null;
      stopDprWatch();
      last = null;
    },
  };

  return viewport;
}
