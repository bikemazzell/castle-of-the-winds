/**
 * App shell: the top-level layout that owns the three screen regions
 * (HUD header, map viewport, bottom sheet) and tracks orientation.
 *
 * The shell is DOM-only and engine-agnostic; scenes mount into its regions.
 */

export interface Shell {
  /** Outer element carrying portrait/landscape classes. */
  el: HTMLElement;
  hudEl: HTMLElement;
  mapEl: HTMLElement;
  sheetEl: HTMLElement;
}

/** Build the shell inside `root` and return handles to its regions. */
export function createShell(root: HTMLElement): Shell {
  const el = document.createElement('div');
  el.className = 'cotw-shell portrait';

  const hudEl = document.createElement('header');
  hudEl.className = 'hud';

  const mapEl = document.createElement('main');
  mapEl.className = 'map';
  const canvas = document.createElement('canvas');
  mapEl.appendChild(canvas);

  const sheetEl = document.createElement('footer');
  sheetEl.className = 'sheet';

  el.append(hudEl, mapEl, sheetEl);
  root.appendChild(el);
  return { el, hudEl, mapEl, sheetEl };
}

/** Toggle portrait/landscape classes on the shell element. */
export function applyOrientation(el: HTMLElement, portrait: boolean): void {
  el.classList.toggle('portrait', portrait);
  el.classList.toggle('landscape', !portrait);
}

/**
 * Subscribe to orientation changes. Reports `true` for portrait.
 * Applies the CURRENT orientation immediately on subscribe (a launch already
 * in landscape must not wait for the first change event), and observes the
 * injected window when one is given. Returns an unsubscribe function.
 * Safe where matchMedia is unavailable.
 */
export function watchOrientation(
  onChange: (portrait: boolean) => void,
  win?: Window,
): () => void {
  const target: Window | undefined = win ?? (typeof window !== 'undefined' ? window : undefined);
  if (!target || typeof target.matchMedia !== 'function') {
    return () => {};
  }
  const query = target.matchMedia('(orientation: portrait)');
  const listener = (e: MediaQueryListEvent | { matches: boolean }): void => {
    onChange(e.matches);
  };
  query.addEventListener('change', listener);
  listener(query); // apply current state immediately
  return () => query.removeEventListener('change', listener);
}
