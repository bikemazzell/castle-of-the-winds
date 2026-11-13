/**
 * Game input facade: composes destination pointer input (map taps + mouse
 * hover) and the keyboard. Targeting can allow pointers without movement keys.
 * Dialogs close both gates with setEnabled(false). A pointer release never
 * fires a tap if the gate closed during the press.
 */

import { createKeyboard } from './keyboard';
import { createMapPointer, type MapPointer } from './pointer';

export type GameCommand =
  | 'fire'
  | 'interact'
  | 'character'
  | 'inventory'
  | 'cast'
  | 'search'
  | 'rest'
  | 'map'
  | 'menu'
  | 'wait'
  | 'enter';

export interface GameInputOptions {
  /** Map surface receiving pointer events (the canvas element). */
  surface: HTMLElement;
  /** Viewport pixels → world cell; null when off-map. */
  screenToWorld: (px: number, py: number) => { x: number; y: number } | null;
  keyboardTarget?: Window;
  /** Keyboard steps (arrows/numpad). */
  onMove: (dx: number, dy: number) => void;
  onCommand: (cmd: GameCommand) => void;
  /** Destination input (UI plan Phase 2): every evaluated map tap. */
  mapTap: (cell: { x: number; y: number }, pointerType: string) => void;
  /** Mouse hover preview; null clears. */
  mapHover?: (cell: { x: number; y: number } | null) => void;
  /** Camera pan (UI plan Phase 4): single-pointer drag, pixel deltas. */
  mapDrag?: (dxPx: number, dyPx: number) => void;
  /** Camera zoom (UI plan Phase 4): two-pointer pinch, distance ratio. */
  mapPinch?: (scale: number) => void;
}

export interface GameInput {
  setEnabled: (enabled: boolean, pointerEnabled?: boolean) => void;
  isEnabled: () => boolean;
  destroy: () => void;
}

export function createGameInput(opts: GameInputOptions): GameInput {
  let enabled = true;
  let pointerEnabled = true;

  const parts: Array<{ destroy: () => void }> = [];
  const pointer: MapPointer = createMapPointer({
    surface: opts.surface,
    screenToWorld: opts.screenToWorld,
    onHover: (cell) => (opts.mapHover ? opts.mapHover(cell) : undefined),
    onTap: (cell, pointerType) => opts.mapTap(cell, pointerType),
    onDrag: (dx, dy) => (opts.mapDrag ? opts.mapDrag(dx, dy) : undefined),
    onPinch: (scale) => (opts.mapPinch ? opts.mapPinch(scale) : undefined),
    isEnabled: () => pointerEnabled,
  });
  parts.push(pointer);

  const target = opts.keyboardTarget ?? (typeof window === 'undefined' ? null : window);
  if (target) {
    parts.push(
      createKeyboard(target, {
        onMove: opts.onMove,
        onCommand: opts.onCommand,
        isEnabled: () => enabled,
      }),
    );
  }

  return {
    setEnabled(value: boolean, allowPointer = value): void {
      enabled = value;
      pointerEnabled = allowPointer;
      if (!allowPointer) pointer.cancel();
    },
    isEnabled(): boolean {
      return enabled;
    },
    destroy(): void {
      for (const part of parts) part.destroy();
    },
  };
}
