import { expect, it } from 'vitest';
import tiles from '../../data/tiles.json';
import { terrainPixels } from './terrain-art';

it('provides distinct new pixel art for every non-stair terrain', () => {
  const patterns = tiles.tiles.filter(t => !t.name.startsWith('stairs')).map(t => terrainPixels(t.sprite));
  expect(patterns.every(p => p.length > 5)).toBe(true);
  expect(new Set(patterns.map(p => JSON.stringify(p))).size).toBe(patterns.length);
  for (const pixels of patterns) for (const [x,y,w,h] of pixels) {
    expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
    expect(x+w).toBeLessThanOrEqual(32); expect(y+h).toBeLessThanOrEqual(32);
  }
});
it('rejects unknown terrain instead of hiding missing art', () => {
  expect(() => terrainPixels('missing')).toThrow('Unknown terrain');
});
