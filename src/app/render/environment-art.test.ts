import { expect, it, vi } from 'vitest';
import { drawEnvironmentTile, shopStyle } from './environment-art';
import { createEmptyLevel } from '../../engine/map';
const context = () => ({ fillStyle: '', globalAlpha: 1, drawImage: vi.fn(), fillRect: vi.fn() });
it('makes stores distinct by palette and sign, not color alone', () => {
    const a = shopStyle('snorri'), b = shopStyle('bank');
    expect(a).not.toEqual(b);
    expect(a.sign).not.toBe(b.sign);
});
it('keeps terrain variation fixed and animates grass tips', () => {
    const a = context(), b = context(), c = context();
    const input = { tileKind: 128, x: 8, y: 8, sx: 0, sy: 0, tile: 32, seed: 42, level: createEmptyLevel(0), now: 0, reduced: false, visible: true };
    drawEnvironmentTile(a, input);
    drawEnvironmentTile(b, { ...input, now: 800 });
    drawEnvironmentTile(c, input);
    expect(a.fillRect.mock.calls.length).toBeGreaterThan(0);
    expect(a.fillRect.mock.calls).toEqual(c.fillRect.mock.calls);
    expect(a.fillRect.mock.calls).not.toEqual(b.fillRect.mock.calls);
    const d = context(), e = context();
    drawEnvironmentTile(d, { ...input, reduced: true });
    drawEnvironmentTile(e, { ...input, now: 800, reduced: true });
    expect(d.fillRect.mock.calls).toEqual(e.fillRect.mock.calls);
});
