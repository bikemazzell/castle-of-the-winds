import { expect, it, vi } from 'vitest';
import { renderFrame, type SceneInput } from './renderer';
import { createEmptyLevel, idx } from '../../engine/map';
import { cameraFor } from './camera';
const scene = (): SceneInput => ({ level: createEmptyLevel(0), seen: new Uint8Array(4096).fill(1), visible: new Uint8Array(4096).fill(1), player: { x: 5, y: 5 } });
const context = () => ({ fillStyle: '', globalAlpha: 1, fillRect: vi.fn(), drawImage: vi.fn() });
it('animates a stationary hero without changing world position', () => {
    const s = scene(), hero = {}, cam = cameraFor(s.player, { width: 320, height: 320 }, 32), a = context(), b = context();
    renderFrame(a, cam, { ...s, visual: { seed: 42, turn: 0, now: 0, reduced: false, hero } }, { tiles: {}, sprites: {} });
    renderFrame(b, cam, { ...s, visual: { seed: 42, turn: 0, now: 800, reduced: false, hero } }, { tiles: {}, sprites: {} });
    expect(a.drawImage.mock.calls).not.toEqual(b.drawImage.mock.calls);
    expect(s.player).toEqual({ x: 5, y: 5 });
});
it('keeps unknown terrain black and hidden actors absent with visual effects', () => {
    const s = scene();
    s.seen.fill(0);
    s.visible.fill(0);
    s.visible[idx(5, 5)] = 1;
    const ctx = context(), enemy = {};
    renderFrame(ctx, cameraFor(s.player, { width: 320, height: 320 }, 32), { ...s, entities: [{ id: 1, name: 'Orc', kind: 'monster', x: 6, y: 5 }], visual: { seed: 42, turn: 4320, now: 800, reduced: false } }, { tiles: {}, sprites: { 'creature:orc': enemy } });
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalledTimes(2); // black background plus fallback hero
});
