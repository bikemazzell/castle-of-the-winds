/**
 * Destination input for the map surface (UI plan Phase 2): taps select/
 * confirm destinations, mouse hovers preview cells. Recognition is
 * deliberate about interruption — drags, extra pointers, browser aborts
 * (pointercancel/lostpointercapture), panel transitions (gate), window
 * blur/resize/rotation and tab hiding all cancel a pending press, and
 * actions only ever evaluate on release.
 */

export interface Cell {
  x: number;
  y: number;
}

export interface PointerOptions {
  /** Element that receives map presses (the canvas surface only). */
  surface: HTMLElement;
  /** Pixel → world cell; null when the pixel lies outside the map window. */
  screenToWorld: (px: number, py: number) => Cell | null;
  /** Mouse hover preview (null clears); touch moves never fire this. */
  onHover: (cell: Cell | null) => void;
  /** Confirmed tap on a world cell (within drag threshold, still enabled). */
  onTap: (cell: Cell, pointerType: string) => void;
  /** Input gate — false while a blocking panel owns interaction. */
  isEnabled: () => boolean;
  /** Single-pointer drag (camera pan): pixel delta since the last event. */
  onDrag?: (dxPx: number, dyPx: number) => void;
  /** Two-pointer pinch (camera zoom): distance ratio vs the pinch baseline. */
  onPinch?: (scale: number) => void;
  /** Movement beyond this pixel distance is a drag/pan, not a tap. */
  dragThresholdPx?: number;
  win?: Window;
}

export interface MapPointer {
  /** Reset any pending recognition (panel transition, travel abort…). */
  cancel: () => void;
  destroy: () => void;
}

export function createMapPointer(opts: PointerOptions): MapPointer {
  const { surface, screenToWorld, onHover, onTap, isEnabled, onDrag, onPinch } = opts;
  const threshold = opts.dragThresholdPx ?? 10;
  const win = opts.win ?? (typeof window === 'undefined' ? null : window);

  interface Pending {
    id: number;
    x: number;
    y: number;
  }
  let pending: Pending | null = null;
  /** Currently-down pointers (id -> last position). */
  const active = new Map<number, { x: number; y: number }>();
  /** Non-null once the pending press exceeded the drag threshold. */
  let dragging: { id: number; x: number; y: number } | null = null;
  /** Pinch session: distance between the two pointers at session start. */
  let pinchStart: number | null = null;

  function drop(id: number): void {
    active.delete(id);
    if (pending !== null && pending.id === id) pending = null;
    if (dragging !== null && dragging.id === id) dragging = null;
    if (active.size < 2) pinchStart = null;
  }

  function cancel(): void {
    pending = null;
    dragging = null;
    pinchStart = null;
    active.clear();
  }

  const onPointerDown = (e: Event): void => {
    const pe = e as PointerEvent;
    if (!isEnabled()) return;
    const id = typeof pe.pointerId === 'number' ? pe.pointerId : 0;
    active.set(id, { x: pe.clientX, y: pe.clientY });
    if (active.size === 1) {
      // First finger: a tap candidate until proven a drag or joined.
      pending = { id, x: pe.clientX, y: pe.clientY };
      return;
    }
    // A second finger means pinch/zoom — never a destination.
    pending = null;
    dragging = null;
    if (active.size === 2) {
      const [a, b] = [...active.values()];
      pinchStart = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    } else {
      pinchStart = null; // 3+ fingers: inert
    }
  };

  const onPointerUp = (e: Event): void => {
    const pe = e as PointerEvent;
    const id = typeof pe.pointerId === 'number' ? pe.pointerId : 0;
    const wasPending = pending !== null && pending.id === id;
    const start = pending;
    drop(id);
    if (!wasPending || start === null) return;
    if (!isEnabled()) return; // panel opened mid-press
    if (Math.hypot(pe.clientX - start.x, pe.clientY - start.y) > threshold) return; // drag
    const cell = screenToWorld(pe.clientX, pe.clientY);
    if (!cell) return; // off-map
    onTap(cell, typeof pe.pointerType === 'string' ? pe.pointerType : 'touch');
  };

  /**
   * pointercancel/lostpointercapture are browser aborts — always reset the
   * whole recognition state. Unconditional on purpose: synthetic and some
   * real aborts carry pointer ids we cannot correlate with our own bookkeeping
   * (e2e touch emulation assigns its own ids), and an abort semantically ends
   * the touch session anyway.
   */
  const onPointerAbort = (): void => {
    cancel();
  };

  const onPointerMove = (e: Event): void => {
    const pe = e as PointerEvent;
    if (!isEnabled()) return;
    // Mouse hover only: no buttons held, nothing down.
    if (pe.pointerType === 'mouse' && pe.buttons === 0 && active.size === 0) {
      onHover(screenToWorld(pe.clientX, pe.clientY));
      return;
    }
    const id = typeof pe.pointerId === 'number' ? pe.pointerId : 0;
    if (!active.has(id)) return;
    active.set(id, { x: pe.clientX, y: pe.clientY });

    if (pinchStart !== null && active.size === 2 && onPinch) {
      const [a, b] = [...active.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinchStart > 0 && dist > 0) onPinch(dist / pinchStart);
      return;
    }

    if (pending !== null && pending.id === id) {
      const d = Math.hypot(pe.clientX - pending.x, pe.clientY - pending.y);
      if (d > threshold && onDrag) {
        // Threshold crossing reports the full press-to-here delta first.
        dragging = { id, x: pe.clientX, y: pe.clientY };
        const dx = pe.clientX - pending.x;
        const dy = pe.clientY - pending.y;
        pending = null;
        onDrag(dx, dy);
      }
      return;
    }
    if (dragging !== null && dragging.id === id && onDrag) {
      const dx = pe.clientX - dragging.x;
      const dy = pe.clientY - dragging.y;
      dragging.x = pe.clientX;
      dragging.y = pe.clientY;
      onDrag(dx, dy);
    }
  };

  const onPointerLeave = (): void => {
    if (!isEnabled()) return;
    onHover(null);
  };

  const onWindowCancel = (): void => cancel();

  const onOutsideRelease = (event: Event): void => { if (event.target !== surface) cancel(); };

  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointerup', onPointerUp);
  surface.addEventListener('pointercancel', onPointerAbort);
  surface.addEventListener('lostpointercapture', onPointerAbort);
  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerleave', onPointerLeave);
  if (win) {
    win.addEventListener('pointerup', onOutsideRelease);
    win.addEventListener('pointercancel', onOutsideRelease);
    win.addEventListener('blur', onWindowCancel);
    win.addEventListener('resize', onWindowCancel);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onWindowCancel);
  }

  return {
    cancel,
    destroy(): void {
      cancel();
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointerup', onPointerUp);
      surface.removeEventListener('pointercancel', onPointerAbort);
      surface.removeEventListener('lostpointercapture', onPointerAbort);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerleave', onPointerLeave);
      if (win) {
        win.removeEventListener('pointerup', onOutsideRelease);
        win.removeEventListener('pointercancel', onOutsideRelease);
        win.removeEventListener('blur', onWindowCancel);
        win.removeEventListener('resize', onWindowCancel);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onWindowCancel);
      }
    },
  };
}
