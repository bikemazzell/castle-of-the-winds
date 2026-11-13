import { creatureAppearance, type ImpactMaterial } from './creature-catalog';
import type { Ctx2D } from './renderer';
import type { Camera } from './camera';
import { idx } from '../../engine/map';
export interface DamageActor {
    id: number;
    name: string;
    x: number;
    y: number;
    hp: number;
    visible: boolean;
}
export interface Impact {
    x: number;
    y: number;
    start: number;
    fatal: boolean;
    material: ImpactMaterial;
    seed: number;
}
export function damageImpacts(before: DamageActor[], after: DamageActor[], now: number): Impact[] {
    const result: Impact[] = [];
    for (const old of before) {
        const next = after.find(a => a.id === old.id);
        if (!old.visible || old.hp <= 0 || (next && (!next.visible || next.hp >= old.hp)))
            continue;
        result.push({ x: next?.x ?? old.x, y: next?.y ?? old.y, start: now, fatal: !next || next.hp <= 0, material: creatureAppearance(old.name).material, seed: old.id });
    }
    return result;
}
export function createImpactStore() {
    let items: Impact[] = [];
    return { add: (added: Impact[]): void => { items = [...items, ...added].slice(-96); }, all: (): Impact[] => items, clear: (): void => { items = []; } };
}
const COLORS: Record<ImpactMaterial, string> = { blood: '#8e3c3c', bone: '#c5bda1', spirit: '#a1b0cd', slime: '#749648', stone: '#969081', ember: '#d37c3f', ice: '#9dbec8', dust: '#a49979' };
export function drawImpacts(ctx: Ctx2D, camera: Camera, impacts: readonly Impact[], seen: Uint8Array, visible: Uint8Array, now: number, reduced: boolean): void {
    for (const impact of impacts) {
        const i = idx(impact.x, impact.y);
        if (!seen[i])
            continue;
        const age = Math.max(0, now - impact.start), ephemeral = impact.material === 'spirit' || impact.material === 'ember';
        if (ephemeral && age >= 800)
            continue;
        if (ephemeral && !visible[i])
            continue;
        const cell = camera.worldToScreen(impact.x, impact.y), t = camera.tile;
        ctx.fillStyle = COLORS[impact.material];
        if (!ephemeral) {
            const count = impact.fatal ? 9 : 4;
            for (let n = 0; n < count; n++) {
                const dx = ((impact.seed * 7 + n * 11) % 19 - 9) / 32, dy = ((impact.seed * 3 + n * 7) % 9 + 20) / 32;
                ctx.fillRect(Math.round(cell.x + t * (0.5 + dx)), Math.round(cell.y + t * dy), Math.max(1, Math.round(t * (impact.fatal ? 3 : 2) / 32)), Math.max(1, Math.round(t / 32)));
            }
        }
        if (age < 600 && !reduced && visible[i]) {
            const progress = age / 600;
            for (let n = 0; n < 7; n++) {
                const angle = n * 2.4 + impact.seed;
                const radius = progress * t * 0.33;
                ctx.fillRect(Math.round(cell.x + t / 2 + Math.cos(angle) * radius), Math.round(cell.y + t * 0.6 + Math.sin(angle) * radius - Math.sin(progress * Math.PI) * t * 0.2), Math.max(1, Math.round(t / 24)), Math.max(1, Math.round(t / 24)));
            }
        }
    }
}
