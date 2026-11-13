import { expect, it, vi } from 'vitest';
import { createAmbient, idlePose } from './ambient';
it('schedules at 12 Hz only when enabled and cancels cleanly', () => {
    vi.useFakeTimers();
    const draw = vi.fn();
    const ambient = createAmbient(draw);
    ambient.setActive(true);
    ambient.setActive(true);
    vi.advanceTimersByTime(1000);
    expect(draw.mock.calls.length).toBeGreaterThanOrEqual(11);
    expect(draw.mock.calls.length).toBeLessThanOrEqual(12);
    ambient.setActive(false);
    const count = draw.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(draw).toHaveBeenCalledTimes(count);
    ambient.setActive(true);
    ambient.destroy();
    vi.advanceTimersByTime(1000);
    expect(draw).toHaveBeenCalledTimes(count);
    vi.useRealTimers();
});
it('animates idle poses with distinct phases and a fixed reduced motion pose', () => {
    expect(idlePose('breathe', 0, 1, false)).not.toEqual(idlePose('breathe', 800, 1, false));
    expect(idlePose('breathe', 800, 1, false)).not.toEqual(idlePose('breathe', 800, 2, false));
    expect(idlePose('float', 0, 1, true)).toEqual(idlePose('float', 800, 1, true));
});
