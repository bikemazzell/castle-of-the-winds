import type { Ctx2D } from './renderer';
import { idx, type Level } from '../../engine/map';
import { daylight, tileNoise, type Environment } from './environment';
import type { TownBuilding } from '../scenes/town';
export interface EnvironmentTile {
    tileKind: number;
    x: number;
    y: number;
    sx: number;
    sy: number;
    tile: number;
    seed: number;
    level: Level;
    now: number;
    reduced: boolean;
    visible: boolean;
    environment?: Environment;
    buildings?: TownBuilding[];
    turn?: number;
}
const SHOP_STYLES: Record<string, {
    wall: string;
    door: string;
    sign: number;
}> = {
    snorri: { wall: '#766e88', door: '#8263a5', sign: 1 }, bank: { wall: '#9c9276', door: '#b69249', sign: 2 },
    sverting: { wall: '#71848b', door: '#527b8c', sign: 3 }, bjorn: { wall: '#937366', door: '#a8573e', sign: 4 },
    gunnhild: { wall: '#858e6a', door: '#638556', sign: 5 }, myrkjartan: { wall: '#7f7298', door: '#9866a0', sign: 6 },
    church: { wall: '#b1ac94', door: '#7e8c9e', sign: 7 }, olaf: { wall: '#8d816b', door: '#917047', sign: 8 },
};
export function shopStyle(id: string) { return SHOP_STYLES[id] ?? { wall: '#8b887b', door: '#8e7052', sign: 0 }; }
export function drawEnvironmentTile(ctx: Ctx2D, v: EnvironmentTile): void {
    const { tileKind: k, x, y, seed, level } = v;
    const noise = tileNoise(seed, level.index, x, y), variant = Math.floor(noise * 8);
    const time = v.reduced || !v.visible ? 0 : v.now;
    const wave = Math.sin(time / 470 + noise * 10);
    const r = (px: number, py: number, w: number, h: number, color: string): void => {
        ctx.fillStyle = color;
        ctx.fillRect(v.sx + Math.round(px * v.tile / 32), v.sy + Math.round(py * v.tile / 32), Math.max(1, Math.round(w * v.tile / 32)), Math.max(1, Math.round(h * v.tile / 32)));
    };
    if ([0, 1, 128, 129, 131].includes(k)) {
        r(0, 0, 32, 32, `rgba(${variant % 2 ? '19,25,24' : '178,158,103'},${0.025 + noise * 0.075})`);
        if (k === 0 && variant < 4) {
            r(7 + variant, 4, 1, 8, '#444645');
            r(8 + variant, 11, 3, 1, '#444645');
            r(10 + variant, 12, 1, 5, '#444645');
        }
        if (k === 1 || k === 129) {
            r(4 + variant * 2, 9, 3, 1, '#817c68');
            r(19, 22 - variant, 2, 1, '#4f5147');
        }
    }
    if (k === 128) {
        const sway = Math.round(wave);
        for (let i = 0; i < 1 + variant % 3; i++) {
            const detail = tileNoise(seed + i * 73, level.index, x, y), bx = 5 + i * 9 + Math.floor(detail * 3), by = 12 + Math.floor(detail * 16);
            r(bx, by - 3, 1, 4, '#82985e');
            r(bx + sway, by - 6, 1, 3, '#91a569');
            r(bx - 2 + sway, by - 4, 1, 3, '#718a50');
        }
    }
    if (k === 131) {
        r(14, 19, 5, 11, '#493f30');
        r(15, 21, 1, 8, '#786449');
        const sway = Math.round(wave);
        r(4 + sway, 9, 25, 12, '#233d2c');
        r(7 + sway, 5, 20, 15, '#385238');
        r(11 + sway, 2, 12, 19, '#47623d');
        r(8 + sway, 9, 7, 3, '#66804b');
        r(17 + sway, 5, 5, 2, '#71894f');
        r(18 + sway, 15, 6, 2, '#597642');
    }
    if (k === 130) {
        r(0, 0, 32, 32, '#315769');
        const shift = Math.round(wave * 2);
        r(5 + shift, 8, 12, 1, '#87aaa7');
        r(17 - shift, 22, 10, 1, '#6d9496');
    }
    const building = level.index === 0 ? v.buildings?.find(b => x >= b.rect.x && x < b.rect.x + b.rect.w && y >= b.rect.y && y < b.rect.y + b.rect.h) : undefined;
    if (building) {
        const style = shopStyle(building.shopId);
        if (k === 0) {
            r(0, 0, 32, 3, style.wall);
            r(0, 15, 32, 2, style.wall);
            r((variant % 3) * 8, 3, 2, 12, style.wall);
        }
        if (x === building.door.x && y === building.door.y) {
            r(3, 1, 26, 31, '#302e2b');
            r(6, 4, 20, 28, style.door);
            r(8, 6, 1, 24, '#d0b78b');
            r(14, 6, 1, 24, '#564b45');
            r(23, 19, 2, 2, '#e4cb83');
            r(9, 5, 13, 8, '#342d32');
            // Eight distinct sign patterns, readable independently of door color.
            for (let bit = 0; bit < 4; bit++)
                if (style.sign & (1 << bit))
                    r(11 + bit * 3, 7, 2, 4, '#e1d0a3');
        }
    }
    if (v.visible) {
        if (level.index === 0) {
            const day = daylight(v.turn ?? 0);
            r(0, 0, 32, 32, `rgba(${day.color},${day.shade.toFixed(3)})`);
        }
        else {
            const strength = v.environment?.light[idx(x, y)] ?? 0;
            const flicker = v.reduced ? 1 : 0.96 + Math.sin(time / 190 + x * 0.4 + y) * 0.04;
            r(0, 0, 32, 32, `rgba(8,12,23,${(0.36 - strength * 0.32 * flicker).toFixed(3)})`);
            if (strength > 0)
                r(0, 0, 32, 32, `rgba(238,150,61,${(strength * 0.12 * flicker).toFixed(3)})`);
        }
    }
    const torch = v.environment?.torches.find(t => t.x === x && t.y === y);
    if (torch) {
        r(14, 17, 4, 11, '#3c3028');
        r(13, 18, 6, 2, '#aaa18b');
        if (v.visible) {
            const flick = Math.round(Math.sin(time / 140 + torch.phase * 10));
            r(13, 10 + flick, 6, 9 - flick, '#b65c30');
            r(14, 8 - flick, 4, 10 + flick, '#edaa48');
            r(15, 13, 2, 5, '#fff0ac');
        }
    }
}
