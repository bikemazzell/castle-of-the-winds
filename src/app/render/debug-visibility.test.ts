import { expect, it, vi } from 'vitest';
import { createEmptyLevel } from '../../engine/map';
import { cameraFor } from './camera';
import { renderFrame } from './renderer';
it('reveals all terrain and actors without changing exploration, then restores fog', () => {
  const level = createEmptyLevel(1), seen = new Uint8Array(4096), visible = new Uint8Array(4096);
  const floor = {}, enemy = {};
  const scene = {level, seen, visible, player: {x: 1, y: 1}, entities: [{id: 1, kind: 'monster' as const, name: 'Giant Rat', x: 2, y: 2}]};
  const ctx = {fillStyle: '', globalAlpha: 1, fillRect: vi.fn(), drawImage: vi.fn()};
  const camera = cameraFor(scene.player, {width: 128, height: 128}, 32);
  const styles = {tiles: {'0': {sprite: 'floor'}}, sprites: {floor, 'creature:giant rat': enemy}};
  renderFrame(ctx, camera, {...scene, revealMap: true}, styles);
  expect(ctx.drawImage.mock.calls.filter(c => c[0] === floor)).toHaveLength(16);
  expect(ctx.drawImage.mock.calls.filter(c => c[0] === enemy)).toHaveLength(1);
  expect(seen.some(Boolean)).toBe(false); expect(visible.some(Boolean)).toBe(false);
  ctx.drawImage.mockClear();
  renderFrame(ctx, camera, scene, styles);
  expect(ctx.drawImage).not.toHaveBeenCalled();
});
