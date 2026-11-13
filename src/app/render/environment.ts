import { idx, LEVEL_SIZE, type Level } from '../../engine/map';
import { hasLos } from '../../engine/fov';
/** Stateless presentation noise. Never consumes world RNG. */
export function tileNoise(seed: number, level: number, x: number, y: number): number {
    let n = (seed ^ Math.imul(level + 19, 374761393) ^ Math.imul(x + 7, 668265263) ^ Math.imul(y + 11, 1274126177)) >>> 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function daylight(turn: number): {
    hour: number;
    shade: number;
    color: string;
} {
    const hour = ((8 + turn / 360) % 24 + 24) % 24;
    const sun = Math.max(0, Math.sin((hour - 6) / 12 * Math.PI));
    const twilight = (hour >= 5 && hour < 8) || (hour > 17 && hour <= 20);
    return { hour, shade: 0.48 * (1 - sun), color: twilight ? '62,30,42' : '13,22,51' };
}
export interface Torch {
    x: number;
    y: number;
    floor: {
        x: number;
        y: number;
    };
    phase: number;
}
export interface Environment {
    torches: Torch[];
    light: Float32Array;
}
const DIRECTIONS = [[0, 1], [1, 0], [0, -1], [-1, 0]] as const;
export function buildEnvironment(level: Level, seed: number): Environment {
    const light = new Float32Array(LEVEL_SIZE * LEVEL_SIZE);
    const torches: Torch[] = [];
    if (level.index === 0)
        return { torches, light };
    const candidates: Torch[] = [];
    for (let y = 1; y < LEVEL_SIZE - 1; y++)
        for (let x = 1; x < LEVEL_SIZE - 1; x++) {
            if (level.tiles[idx(x, y)] !== 0)
                continue;
            const opening = DIRECTIONS.find(([dx, dy]) => level.tiles[idx(x + dx, y + dy)] === 1);
            if (opening)
                candidates.push({ x, y, floor: { x: x + opening[0], y: y + opening[1] }, phase: tileNoise(seed, level.index, x, y) });
        }
    candidates.sort((a, b) => a.phase - b.phase);
    for (const c of candidates) {
        if (torches.length === 32)
            break;
        if (torches.some(t => Math.hypot(t.x - c.x, t.y - c.y) < 5))
            continue;
        torches.push(c);
        const radius = 5;
        for (let y = Math.max(0, c.floor.y - radius); y <= Math.min(63, c.floor.y + radius); y++) {
            for (let x = Math.max(0, c.floor.x - radius); x <= Math.min(63, c.floor.x + radius); x++) {
                const distance = Math.hypot(x - c.floor.x, y - c.floor.y);
                if (distance > radius || !hasLos(level, c.floor, { x, y }))
                    continue;
                const i = idx(x, y);
                light[i] = Math.max(light[i]!, Math.max(0, 1 - distance / (radius + 0.5)));
            }
        }
    }
    return { torches, light };
}
export function createEnvironmentCache() {
    let cache: {
        level: Level;
        seed: number;
        tiles: Uint8Array;
        value: Environment;
    } | null = null;
    return {
        get(level: Level, seed: number): Environment {
            if (!cache || cache.level !== level || cache.seed !== seed || level.tiles.some((tile, i) => tile !== cache!.tiles[i])) {
                cache = { level, seed, tiles: level.tiles.slice(), value: buildEnvironment(level, seed) };
            }
            return cache.value;
        },
        clear(): void { cache = null; },
    };
}
