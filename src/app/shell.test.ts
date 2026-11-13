// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createShell, applyOrientation, watchOrientation } from './shell';

describe('shell', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  it('builds hud / map / sheet regions inside a shell element', () => {
    const shell = createShell(root);
    expect(shell.el.classList.contains('cotw-shell')).toBe(true);
    expect(shell.hudEl.classList.contains('hud')).toBe(true);
    expect(shell.mapEl.classList.contains('map')).toBe(true);
    expect(shell.sheetEl.classList.contains('sheet')).toBe(true);
    expect(root.contains(shell.el)).toBe(true);
  });

  it('starts portrait with a canvas slot inside the map region', () => {
    const shell = createShell(root);
    expect(shell.el.classList.contains('portrait')).toBe(true);
    expect(shell.el.classList.contains('landscape')).toBe(false);
    expect(shell.mapEl.querySelector('canvas')).not.toBeNull();
  });

  it('applyOrientation toggles portrait/landscape classes', () => {
    const shell = createShell(root);
    applyOrientation(shell.el, false);
    expect(shell.el.classList.contains('landscape')).toBe(true);
    expect(shell.el.classList.contains('portrait')).toBe(false);
    applyOrientation(shell.el, true);
    expect(shell.el.classList.contains('portrait')).toBe(true);
  });

  it('watchOrientation wires matchMedia and reports changes', () => {
    const listeners: Array<(e: { matches: boolean }) => void> = [];
    vi.stubGlobal(
      'matchMedia',
      (query: string) => ({
        matches: query.includes('portrait'),
        addEventListener: (_t: string, cb: (e: { matches: boolean }) => void) => listeners.push(cb),
        removeEventListener: () => {},
      }),
    );
    const onOrientation = vi.fn();
    const stop = watchOrientation(onOrientation);
    expect(listeners.length).toBe(1);
    listeners[0]!({ matches: false });
    expect(onOrientation).toHaveBeenCalledWith(false);
    stop();
    vi.unstubAllGlobals();
  });

  it('watchOrientation is a no-op when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(() => watchOrientation(() => {})).not.toThrow();
    vi.unstubAllGlobals();
  });

  it('watchOrientation applies the current orientation immediately on subscribe', () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) => ({
        matches: !query.includes('portrait'), // device is landscape right now
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    );
    const onOrientation = vi.fn();
    watchOrientation(onOrientation);
    // Fired synchronously with the CURRENT state, before any change event.
    expect(onOrientation).toHaveBeenCalledTimes(1);
    expect(onOrientation).toHaveBeenCalledWith(false);
    vi.unstubAllGlobals();
  });

  it('watchOrientation observes the injected window when given', () => {
    const globalListeners: Array<(e: { matches: boolean }) => void> = [];
    vi.stubGlobal(
      'matchMedia',
      () => ({
        matches: true,
        addEventListener: (_t: string, cb: (e: { matches: boolean }) => void) => globalListeners.push(cb),
        removeEventListener: () => {},
      }),
    );
    const injectedListeners: Array<(e: { matches: boolean }) => void> = [];
    const fakeWin = {
      matchMedia: (query: string) => ({
        matches: query.includes('portrait'),
        addEventListener: (_t: string, cb: (e: { matches: boolean }) => void) => injectedListeners.push(cb),
        removeEventListener: () => {},
      }),
    };
    const onOrientation = vi.fn();
    watchOrientation(onOrientation, fakeWin as unknown as Window);
    // immediate apply came from the injected window's query
    expect(onOrientation).toHaveBeenCalledWith(true);
    injectedListeners[0]!({ matches: false });
    expect(onOrientation).toHaveBeenCalledWith(false);
    expect(globalListeners.length).toBe(0); // global window untouched
    vi.unstubAllGlobals();
  });
});
