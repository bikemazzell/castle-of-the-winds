/**
 * Keyboard input: cardinal movement keys (WASD, arrows, cardinal numpad) plus
 * command hotkeys. Diagonal keys were removed with the cardinal-alignment
 * work (CODE-QUALITY Task 7): the engine only accepts 4-directional steps,
 * and destination travel covers off-axis movement. Disabled while an
 * editable field has focus or the app-level input gate is closed (modal
 * open).
 */

import type { GameCommand } from './input';

export interface KeyMove {
  kind: 'move';
  dx: number;
  dy: number;
}
export interface KeyCommand {
  kind: 'command';
  cmd: GameCommand;
}
export type KeyAction = KeyMove | KeyCommand | null;

const MOVES: Record<string, [number, number]> = {
  w: [0, -1],
  a: [-1, 0],
  s: [0, 1],
  d: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  '2': [0, 1],
  '4': [-1, 0],
  '6': [1, 0],
  '8': [0, -1],
};

const COMMANDS: Record<string, GameCommand> = {
  i: 'inventory',
  c: 'cast',
  x: 'search',
  r: 'rest',
  m: 'map',
  Escape: 'menu',
  Enter: 'enter',
  '.': 'wait',
  '5': 'wait',
};

/** Pure key classification (unit-testable without events). */
export function mapKey(key: string): KeyAction {
  if (key.length === 1) key = key.toLowerCase();
  const move = MOVES[key];
  if (move) return { kind: 'move', dx: move[0], dy: move[1] };
  const cmd = COMMANDS[key];
  if (cmd) return { kind: 'command', cmd };
  return null;
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof (el as { tagName?: string }).tagName !== 'string') return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export interface KeyboardHandlers {
  onMove: (dx: number, dy: number) => void;
  onCommand: (cmd: GameCommand) => void;
  isEnabled: () => boolean;
}

export function createKeyboard(target: Window, handlers: KeyboardHandlers): { destroy(): void } {
  const onKeyDown = (e: Event): void => {
    if (!handlers.isEnabled()) return;
    if (isEditable(e.target)) return;
    const keyboardEvent = e as KeyboardEvent;
    if (keyboardEvent.ctrlKey || keyboardEvent.altKey || keyboardEvent.metaKey) return;
    // Enter and Space activate the focused control. They must not also spend
    // a game turn through the global keyboard handler.
    if ((keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ')
      && (keyboardEvent.target as Element | null)?.closest?.('button, a[href], summary')) return;
    const action = mapKey(keyboardEvent.key);
    if (!action) return;
    e.preventDefault();
    if (action.kind === 'move') handlers.onMove(action.dx, action.dy);
    else handlers.onCommand(action.cmd);
  };
  target.addEventListener('keydown', onKeyDown);
  return {
    destroy(): void {
      target.removeEventListener('keydown', onKeyDown);
    },
  };
}
