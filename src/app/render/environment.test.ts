import { describe, expect, it } from 'vitest';
import { createEmptyLevel, idx } from '../../engine/map';
import { daylight, tileNoise, buildEnvironment } from './environment';
describe('presentation environment', () => {
    it('uses the saved game clock with a morning start and a daily cycle', () => {
        expect(daylight(0).hour).toBe(8);
        expect(daylight(12 * 360).hour).toBe(20);
        expect(daylight(24 * 360)).toEqual(daylight(0));
        expect(daylight(12 * 360).shade).toBeGreaterThan(daylight(0).shade);
    });
    it('uses stable coordinate noise without the engine random generator', () => {
        expect(tileNoise(42, 1, 4, 5)).toBe(tileNoise(42, 1, 4, 5));
        expect(tileNoise(42, 1, 4, 5)).not.toBe(tileNoise(43, 1, 4, 5));
    });
    it('places stable, spaced wall torches and leaves level data intact', () => {
        const level = createEmptyLevel(1);
        for (let y = 5; y < 20; y++)
            for (let x = 5; x < 20; x++)
                level.tiles[idx(x, y)] = 1;
        const before = level.tiles.slice();
        const a = buildEnvironment(level, 42);
        expect(a.torches.length).toBeGreaterThan(0);
        expect(a.torches.length).toBeLessThanOrEqual(32);
        expect(a.torches).toEqual(buildEnvironment(level, 42).torches);
        expect(level.tiles).toEqual(before);
        for (const t of a.torches) {
            expect(level.tiles[idx(t.x, t.y)]).toBe(0);
            expect(a.light[idx(t.floor.x, t.floor.y)]).toBeGreaterThan(0);
            expect(a.torches.filter(b => Math.hypot(t.x - b.x, t.y - b.y) < 5)).toHaveLength(1);
        }
    });
    it('does not illuminate sealed rooms through walls', () => {
        const level = createEmptyLevel(1);
        for (let y = 8; y < 14; y++)
            for (let x = 8; x < 14; x++)
                level.tiles[idx(x, y)] = 1;
        const env = buildEnvironment(level, 42);
        expect(env.light[idx(16, 10)]).toBe(0);
        expect(env.light[idx(10, 10)]).toBeGreaterThan(0);
    });
});
it('reuses lighting until the seed, level, or wall geometry changes', async () => {
    const { createEnvironmentCache } = await import('./environment');
    const cache = createEnvironmentCache(), level = createEmptyLevel(1);
    level.tiles[idx(8, 8)] = 1;
    const first = cache.get(level, 1);
    expect(cache.get(level, 1)).toBe(first);
    level.tiles[idx(9, 8)] = 1;
    expect(cache.get(level, 1)).not.toBe(first);
    const second = cache.get(level, 1);
    expect(cache.get(level, 2)).not.toBe(second);
    const third = cache.get(level, 2);
    cache.clear();
    expect(cache.get(level, 2)).not.toBe(third);
});
