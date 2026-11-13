// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGameInput } from './input';
import { mapKey } from './keyboard';

function pointerEvent(type: string, props: Record<string, unknown> = {}): PointerEvent {
  const e = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v });
  return e;
}

function keyEvent(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true });
}

function setup() {
  document.body.innerHTML = '';
  const surface = document.createElement('div');
  document.body.append(surface);

  const onMove = vi.fn();
  const onCommand = vi.fn();
  const mapTap = vi.fn();
  const mapHover = vi.fn();
  const input = createGameInput({
    surface,
    keyboardTarget: window,
    screenToWorld: (px, py) => {
      const cell = { x: Math.floor(px / 32), y: Math.floor(py / 32) };
      return cell.x >= 0 && cell.x < 8 && cell.y >= 0 && cell.y < 8 ? cell : null;
    },
    onMove,
    onCommand,
    mapTap,
    mapHover,
  });
  return { surface, onMove, onCommand, mapTap, mapHover, input };
}

describe('game input', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('map taps route to mapTap with pointer type, never to onMove', () => {
    const { surface, mapTap, onMove } = setup();
    surface.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 64, clientY: 64 }),
    );
    surface.dispatchEvent(
      pointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 64, clientY: 64 }),
    );
    expect(mapTap).toHaveBeenCalledWith({ x: 2, y: 2 }, 'mouse');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('mouse hover routes to mapHover and touch moves never hover', () => {
    const { surface, mapHover } = setup();
    surface.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 64, clientY: 64, buttons: 0 }),
    );
    expect(mapHover).toHaveBeenCalledWith({ x: 2, y: 2 });
    surface.dispatchEvent(
      pointerEvent('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 64, clientY: 64, buttons: 0 }),
    );
    expect(mapHover).toHaveBeenCalledTimes(1);
  });

  it('off-map releases never tap', () => {
    const { surface, mapTap } = setup();
    surface.dispatchEvent(
      pointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 400, clientY: 64 }),
    );
    surface.dispatchEvent(
      pointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 400, clientY: 64 }),
    );
    expect(mapTap).not.toHaveBeenCalled();
  });

  it('drag beyond the threshold cancels tap recognition', () => {
    const { surface, mapTap } = setup();
    surface.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 64, clientY: 64 }));
    surface.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 20, clientY: 20 }));
    expect(mapTap).not.toHaveBeenCalled();
  });

  it('pointercancel mid-press never taps', () => {
    const { surface, mapTap } = setup();
    surface.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 64, clientY: 64 }));
    surface.dispatchEvent(pointerEvent('pointercancel', { pointerId: 1 }));
    surface.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 64, clientY: 64 }));
    expect(mapTap).not.toHaveBeenCalled();
  });

  it('input gate blocks taps when disabled mid-press', () => {
    const { surface, mapTap, input } = setup();
    surface.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 64, clientY: 64 }));
    input.setEnabled(false); // panel opened mid-press
    surface.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 64, clientY: 64 }));
    expect(mapTap).not.toHaveBeenCalled();
    input.setEnabled(true);
    surface.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, clientX: 64, clientY: 64 }));
    surface.dispatchEvent(pointerEvent('pointerup', { pointerId: 2, clientX: 64, clientY: 64 }));
    expect(mapTap).toHaveBeenCalledTimes(1);
  });

  it('keyboard maps arrows and cardinal numpad keys (Task 7: diagonals removed)', () => {
    const { onMove } = setup();
    window.dispatchEvent(keyEvent('ArrowRight'));
    expect(onMove).toHaveBeenCalledWith(1, 0);
    window.dispatchEvent(keyEvent('8'));
    expect(onMove).toHaveBeenCalledWith(0, -1);
    window.dispatchEvent(keyEvent('2'));
    expect(onMove).toHaveBeenCalledWith(0, 1);
    window.dispatchEvent(keyEvent('4'));
    expect(onMove).toHaveBeenCalledWith(-1, 0);
    window.dispatchEvent(keyEvent('6'));
    expect(onMove).toHaveBeenCalledWith(1, 0);
  });

  it('diagonal keys no longer move (CODE-QUALITY Task 7)', () => {
    const { onMove } = setup();
    for (const key of ['q', 'e', 'z', '1', '3', '7', '9']) {
      window.dispatchEvent(keyEvent(key));
    }
    expect(onMove).not.toHaveBeenCalled();
  });

  it('keyboard commands map to i/c/x/r/m/Esc/.', () => {
    const { onCommand } = setup();
    for (const [key, cmd] of [
      ['i', 'inventory'],
      ['c', 'cast'],
      ['x', 'search'],
      ['r', 'rest'],
      ['m', 'map'],
      ['Escape', 'menu'],
      ['.', 'wait'],
    ] as const) {
      window.dispatchEvent(keyEvent(key));
      expect(onCommand).toHaveBeenLastCalledWith(cmd);
    }
  });

  it('moves with WASD in either case without firing Search', () => {
    const { onMove, onCommand } = setup();
    for (const [key, dx, dy] of [['w', 0, -1], ['a', -1, 0], ['s', 0, 1], ['d', 1, 0]] as const) {
      for (const letter of [key, key.toUpperCase()]) {
        window.dispatchEvent(keyEvent(letter));
        expect(onMove).toHaveBeenLastCalledWith(dx, dy);
      }
    }
    expect(onMove).toHaveBeenCalledTimes(8);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('leaves modified browser shortcuts alone', () => {
    const { onMove } = setup();
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) {
      const event = new KeyboardEvent('keydown', {key: 'w', [modifier]: true, cancelable: true});
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(onMove).not.toHaveBeenCalled();
  });

  it('keyboard is ignored while an editable field has focus', () => {
    const { onMove } = setup();
    const inputEl = document.createElement('input');
    document.body.appendChild(inputEl);
    inputEl.dispatchEvent(keyEvent('ArrowRight'));
    inputEl.dispatchEvent(keyEvent('w'));
    expect(onMove).not.toHaveBeenCalled();
  });

  it('keyboard is ignored while input is disabled', () => {
    const { onMove, input } = setup();
    input.setEnabled(false);
    window.dispatchEvent(keyEvent('w'));
    window.dispatchEvent(keyEvent('ArrowRight'));
    expect(onMove).not.toHaveBeenCalled();
  });

  it('destroy removes all listeners', () => {
    const { surface, onMove, mapTap, input } = setup();
    input.destroy();
    window.dispatchEvent(keyEvent('ArrowRight'));
    surface.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 64, clientY: 64 }));
    surface.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 64, clientY: 64 }));
    expect(onMove).not.toHaveBeenCalled();
    expect(mapTap).not.toHaveBeenCalled();
  });
});

describe('mapKey', () => {
  it('classifies movement, commands and unknowns purely (Task 7: cardinals only)', () => {
    expect(mapKey('ArrowUp')).toEqual({ kind: 'move', dx: 0, dy: -1 });
    expect(mapKey('ArrowLeft')).toEqual({ kind: 'move', dx: -1, dy: 0 });
    expect(mapKey('.')).toEqual({ kind: 'command', cmd: 'wait' });
    expect(mapKey('Enter')).toEqual({ kind: 'command', cmd: 'enter' });
    expect(mapKey('?')).toBeNull();
  });

  it('diagonal keys return null after cardinal alignment (Task 7)', () => {
    for (const key of ['q', 'e', 'z', '1', '3', '7', '9']) {
      expect(mapKey(key)).toBeNull();
    }
  });
});

it('allows pointer targeting while movement keys stay disabled', () => {
  const { surface, mapTap, onMove, onCommand, input } = setup();
  input.setEnabled(false, true);
  expect(input.isEnabled()).toBe(false);
  window.dispatchEvent(keyEvent('w'));
  window.dispatchEvent(keyEvent('Enter'));
  surface.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 64, clientY: 64 }));
  surface.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 64, clientY: 64 }));
  expect(mapTap).toHaveBeenCalledWith({ x: 2, y: 2 }, 'touch');
  expect(onMove).not.toHaveBeenCalled();
  expect(onCommand).not.toHaveBeenCalled();
  surface.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, clientX: 64, clientY: 64 }));
  input.setEnabled(false, false);
  input.setEnabled(false, true);
  surface.dispatchEvent(pointerEvent('pointerup', { pointerId: 2, clientX: 64, clientY: 64 }));
  expect(mapTap).toHaveBeenCalledTimes(1);
  input.destroy();
});

it('leaves native Enter and Space activation on controls to the browser', () => {
  const { onCommand, input } = setup();
  for (const markup of ['<button><span>History</span></button>', '<a href="#help"><span>Help</span></a>', '<details><summary><span>Attributes</span></summary></details>']) {
    const host = document.createElement('div');
    host.innerHTML = markup;
    document.body.append(host);
    for (const key of ['Enter', ' ']) {
      const event = keyEvent(key);
      host.querySelector('span')!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
  }
  expect(onCommand).not.toHaveBeenCalled();
  window.dispatchEvent(keyEvent('Enter'));
  expect(onCommand).toHaveBeenCalledWith('enter');
  input.destroy();
});
