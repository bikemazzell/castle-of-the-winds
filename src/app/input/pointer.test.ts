// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMapPointer, type PointerOptions } from './pointer';

function pointerEvent(type: string, props: Partial<PointerEvent> = {}): Event {
  const e = new Event(type, { bubbles: true });
  Object.defineProperty(e, 'clientX', { value: props.clientX ?? 0, configurable: true });
  Object.defineProperty(e, 'clientY', { value: props.clientY ?? 0, configurable: true });
  Object.defineProperty(e, 'pointerId', { value: props.pointerId ?? 1, configurable: true });
  Object.defineProperty(e, 'pointerType', { value: props.pointerType ?? 'touch', configurable: true });
  Object.defineProperty(e, 'buttons', { value: props.buttons ?? 0, configurable: true });
  return e;
}

function setup(overrides: Partial<PointerOptions> = {}) {
  const surface = document.createElement('div');
  document.body.appendChild(surface);
  const onTap = vi.fn();
  const onHover = vi.fn();
  const opts: PointerOptions = {
    surface,
    screenToWorld: (px, py) => ({ x: Math.floor(px / 24), y: Math.floor(py / 24) }),
    onHover,
    onTap,
    isEnabled: () => true,
    ...overrides,
  };
  const pointer = createMapPointer(opts);
  return { surface, pointer, onTap, onHover };
}

describe('map pointer input (UI plan Phase 2)', () => {
  let cleanups: Array<() => void> = [];

  function track(teardown: () => void): void {
    cleanups.push(teardown);
  }

  beforeEach(() => {
    cleanups = [];
  });

  afterEach(() => {
    for (const fn of cleanups) fn();
    document.body.innerHTML = '';
  });

  it('a press released within the drag threshold taps the world cell', () => {
    const { surface, onTap } = setup();
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 50, pointerId: 7 }));
    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 104, clientY: 47, pointerId: 7 }));
    expect(onTap).toHaveBeenCalledWith({ x: 4, y: 1 }, 'touch');
  });

  it('taps report their pointer type so touch and mouse semantics can differ', () => {
    const { surface, onTap } = setup();
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 50, pointerType: 'mouse' }));
    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 100, clientY: 50, pointerType: 'mouse' }));
    expect(onTap).toHaveBeenCalledWith({ x: 4, y: 2 }, 'mouse');
  });

  it('dragging beyond the threshold cancels recognition (no tap)', () => {
    const { surface, onTap } = setup();
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 50 }));
    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 130, clientY: 50 }));
    expect(onTap).not.toHaveBeenCalled();
  });

  it('a second pointer down cancels recognition for both pointers', () => {
    const { surface, onTap } = setup();
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 50, pointerId: 1 }));
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 200, clientY: 90, pointerId: 2 }));
    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 100, clientY: 50, pointerId: 1 }));
    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 200, clientY: 90, pointerId: 2 }));
    expect(onTap).not.toHaveBeenCalled();
  });

  it('pointercancel and lostpointercapture reset without tapping', () => {
    const a = setup();
    a.surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    a.surface.dispatchEvent(pointerEvent('pointercancel'));
    a.surface.dispatchEvent(pointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    expect(a.onTap).not.toHaveBeenCalled();
    const b = setup();
    b.surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    b.surface.dispatchEvent(pointerEvent('lostpointercapture'));
    b.surface.dispatchEvent(pointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    expect(b.onTap).not.toHaveBeenCalled();
  });

  it('an abort whose pointer id does not match ours still resets (e2e browser-assigned ids)', () => {
    // Real-world + e2e case: the abort event carries an id our bookkeeping
    // never saw (browser touch emulation assigns its own ids). The pending
    // tap must still die — unconditional reset on browser aborts.
    const { surface, onTap } = setup();
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10, pointerId: 10 }));
    surface.dispatchEvent(pointerEvent('pointercancel', { clientX: 0, clientY: 0, pointerId: 2 }));
    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 10, clientY: 10, pointerId: 10 }));
    expect(onTap).not.toHaveBeenCalled();
  });

  it('a press that starts or ends while disabled never taps', () => {
    let enabled = true;
    const { surface, onTap } = setup({ isEnabled: () => enabled });
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 })); // enabled
    enabled = false; // panel opened mid-press
    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    expect(onTap).not.toHaveBeenCalled();
    enabled = false; // disabled at start
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    enabled = true;
    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    expect(onTap).not.toHaveBeenCalled();
  });

  it('mouse pointermove without buttons hovers the cell; touch moves do not', () => {
    const { surface, onHover } = setup();
    surface.dispatchEvent(
      pointerEvent('pointermove', { clientX: 48, clientY: 24, pointerType: 'mouse', buttons: 0 }),
    );
    expect(onHover).toHaveBeenCalledWith({ x: 2, y: 1 });
    onHover.mockClear();
    surface.dispatchEvent(
      pointerEvent('pointermove', { clientX: 72, clientY: 24, pointerType: 'touch', buttons: 0 }),
    );
    expect(onHover).not.toHaveBeenCalled();
  });

  it('hover while disabled is ignored', () => {
    const { surface, onHover } = setup({ isEnabled: () => false });
    surface.dispatchEvent(
      pointerEvent('pointermove', { clientX: 48, clientY: 24, pointerType: 'mouse' }),
    );
    expect(onHover).not.toHaveBeenCalled();
  });

  it('pointerleave clears the hover preview', () => {
    const { surface, onHover } = setup();
    surface.dispatchEvent(
      pointerEvent('pointermove', { clientX: 48, clientY: 24, pointerType: 'mouse' }),
    );
    surface.dispatchEvent(pointerEvent('pointerleave', { pointerType: 'mouse' }));
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('a release converted to a null cell (off-map) never taps; hover reports null', () => {
    const { surface, onTap, onHover } = setup({
      screenToWorld: () => null,
    });
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    expect(onTap).not.toHaveBeenCalled();
    surface.dispatchEvent(
      pointerEvent('pointermove', { clientX: 10, clientY: 10, pointerType: 'mouse' }),
    );
    expect(onHover).toHaveBeenCalledWith(null);
  });

  it('window blur, resize and visibilitychange cancel a pending press', () => {
    const blurCase = setup();
    blurCase.surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    window.dispatchEvent(new Event('blur'));
    blurCase.surface.dispatchEvent(pointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    expect(blurCase.onTap).not.toHaveBeenCalled();

    const resizeCase = setup();
    resizeCase.surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    window.dispatchEvent(new Event('resize'));
    resizeCase.surface.dispatchEvent(pointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    expect(resizeCase.onTap).not.toHaveBeenCalled();

    const visCase = setup();
    visCase.surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    document.dispatchEvent(new Event('visibilitychange'));
    visCase.surface.dispatchEvent(pointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    expect(visCase.onTap).not.toHaveBeenCalled();
  });

  it('external cancel() resets recognition (panel transition)', () => {
    const { surface, pointer, onTap } = setup();
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    pointer.cancel();
    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    expect(onTap).not.toHaveBeenCalled();
  });

  it('destroy removes all listeners', () => {
    const { surface, pointer, onTap, onHover } = setup();
    track(pointer.destroy);
    pointer.destroy();
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 10, clientY: 10 }));
    surface.dispatchEvent(
      pointerEvent('pointermove', { clientX: 48, clientY: 24, pointerType: 'mouse' }),
    );
    expect(onTap).not.toHaveBeenCalled();
    expect(onHover).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('resize'));
  });
});

describe('map pointer camera gestures: drag pan + pinch zoom (UI plan Phase 4)', () => {
  function setupGesture(overrides: Partial<PointerOptions> = {}) {
    const onDrag = vi.fn();
    const onPinch = vi.fn();
    const { surface, pointer, onTap, onHover } = setup({ onDrag, onPinch, ...overrides });
    return { surface, pointer, onTap, onHover, onDrag, onPinch };
  }

  it('drag beyond threshold pans (deltas reported) and never taps', () => {
    const { surface, onTap, onDrag } = setupGesture();
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
    surface.dispatchEvent(pointerEvent('pointermove', { clientX: 115, clientY: 100, pointerId: 1, buttons: 1 }));
    surface.dispatchEvent(pointerEvent('pointermove', { clientX: 130, clientY: 112, pointerId: 1, buttons: 1 }));
    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 130, clientY: 112, pointerId: 1 }));
    expect(onDrag).toHaveBeenCalledTimes(2);
    const first = onDrag.mock.calls[0]! as unknown as [number, number];
    const second = onDrag.mock.calls[1]! as unknown as [number, number];
    expect(first[0]).toBe(15);
    expect(second[0]).toBe(15);
    expect(second[1]).toBe(12);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('micro-movement within the threshold still taps', () => {
    const { surface, onTap, onDrag } = setupGesture();
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
    surface.dispatchEvent(pointerEvent('pointermove', { clientX: 104, clientY: 103, pointerId: 1, buttons: 1 }));
    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 104, clientY: 103, pointerId: 1 }));
    expect(onDrag).not.toHaveBeenCalled();
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('two-finger pinch reports the distance ratio and never taps', () => {
    const { surface, onTap, onPinch } = setupGesture();
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 200, clientY: 100, pointerId: 2 }));
    // baseline distance 100 (measured at the second down); spread to 150
    surface.dispatchEvent(pointerEvent('pointermove', { clientX: 75, clientY: 100, pointerId: 1, buttons: 1 }));
    expect(onPinch).toHaveBeenCalledTimes(1);
    surface.dispatchEvent(pointerEvent('pointermove', { clientX: 225, clientY: 100, pointerId: 2, buttons: 1 }));
    const ratio = (onPinch.mock.calls.at(-1) as unknown as [number] | undefined)?.[0];
    expect(ratio).toBeCloseTo(1.5, 5);
    expect(onTap).not.toHaveBeenCalled();
    // lifting both fingers fires nothing further
    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 225, clientY: 100, pointerId: 2 }));
    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 75, clientY: 100, pointerId: 1 }));
    expect(onPinch).toHaveBeenCalledTimes(2);
  });

  it('survivor of a pinch is not a tap candidate', () => {
    const { surface, onTap } = setupGesture();
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 200, clientY: 100, pointerId: 2 }));
    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 200, clientY: 100, pointerId: 2 }));
    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 100, clientY: 100, pointerId: 1 }));
    expect(onTap).not.toHaveBeenCalled();
  });

  it('pointercancel mid-drag stops pan events', () => {
    const { surface, onDrag } = setupGesture();
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
    surface.dispatchEvent(pointerEvent('pointermove', { clientX: 120, clientY: 100, pointerId: 1, buttons: 1 }));
    surface.dispatchEvent(pointerEvent('pointercancel', { clientX: 120, clientY: 100, pointerId: 1 }));
    surface.dispatchEvent(pointerEvent('pointermove', { clientX: 160, clientY: 100, pointerId: 1, buttons: 1 }));
    expect(onDrag).toHaveBeenCalledTimes(1);
  });

  it('mouse drag pans instead of hovering', () => {
    const { surface, onDrag, onHover } = setupGesture();
    surface.dispatchEvent(pointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, pointerType: 'mouse', buttons: 1 }));
    surface.dispatchEvent(pointerEvent('pointermove', { clientX: 125, clientY: 100, pointerId: 1, pointerType: 'mouse', buttons: 1 }));
    expect(onDrag).toHaveBeenCalledTimes(1);
    expect(onHover).not.toHaveBeenCalled();
  });
});
it('ends a drag when the pointer is released outside the map',()=>{
 const onDrag=vi.fn();const {surface,pointer,onTap}=setup({onDrag,win:window});
 surface.dispatchEvent(pointerEvent('pointerdown',{clientX:10,clientY:10,pointerType:'mouse',buttons:1}));
 surface.dispatchEvent(pointerEvent('pointermove',{clientX:30,clientY:10,pointerType:'mouse',buttons:1}));
 window.dispatchEvent(pointerEvent('pointerup',{clientX:100,clientY:10,pointerType:'mouse',buttons:0}));
 surface.dispatchEvent(pointerEvent('pointermove',{clientX:60,clientY:10,pointerType:'mouse',buttons:0}));
 expect(onDrag).toHaveBeenCalledTimes(1);expect(onTap).not.toHaveBeenCalled();pointer.destroy();
});
