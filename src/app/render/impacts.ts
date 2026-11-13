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
    maxHp?: number;
    level?: number;
    visible: boolean;
}
export interface Impact {
    x: number;
    y: number;
    start: number;
    fatal: boolean;
    material: ImpactMaterial;
    seed: number;
    kind?: 'trail';
}
export function damageImpacts(before: DamageActor[], after: DamageActor[], now: number): Impact[] {
    const result: Impact[] = [];
    for (const old of before) {
        const next = after.find(a => a.id === old.id);
        if (!old.visible || old.hp <= 0 || (next && (!next.visible || next.hp >= old.hp)))
            continue;
        result.push({ x: next?.x ?? old.x, y: next?.y ?? old.y, start: now, fatal: !next || next.hp <= 0, material: creatureAppearance(old.name).material, seed: (Math.imul(old.id + 1, 65537) ^ Math.floor(now) ^ old.hp) >>> 0 });
    }
    return result;
}
export function createImpactStore() {
    let items: Impact[] = [];
    return { add: (added: Impact[]): void => { items = [...items, ...added].slice(-96); }, all: (): Impact[] => items, clear: (): void => { items = []; } };
}
const COLORS: Record<ImpactMaterial, string> = { blood: '#a72f36', bone: '#c5bda1', spirit: '#a1b0cd', slime: '#749648', stone: '#969081', ember: '#d37c3f', ice: '#9dbec8', dust: '#a49979' };
/** Cosmetic hash: repeatable pixel placement without touching gameplay randomness. */
function scatter(seed: number, n: number): number {
    return (Math.imul(seed ^ Math.imul(n + 1, 374761393), 668265263) >>> 0) / 0x100000000;
}

export function drawImpacts(ctx: Ctx2D, camera: Camera, impacts: readonly Impact[], seen: Uint8Array, visible: Uint8Array, now: number, reduced: boolean): void {
    for (const impact of impacts) {
        const i = idx(impact.x, impact.y);
        if (!seen[i]) continue;
        const age = Math.max(0, now - impact.start);
        const ephemeral = impact.material === 'spirit' || impact.material === 'ember';
        if (ephemeral && (age >= 800 || !visible[i])) continue;
        const cell = camera.worldToScreen(impact.x, impact.y), t = camera.tile;
        const fluid = impact.material === 'blood' || impact.material === 'slime';
        const trail = impact.kind === 'trail';
        // Clip every particle to its observed tile, including at the edge of fog.
        const paint = (x: number, y: number, width: number, height: number): void => {
            const left = Math.max(cell.x, Math.round(x));
            const top = Math.max(cell.y, Math.round(y));
            const right = Math.min(cell.x + t, Math.round(x) + width);
            const bottom = Math.min(cell.y + t, Math.round(y) + height);
            if (right > left && bottom > top) ctx.fillRect(left, top, right - left, bottom - top);
        };
        ctx.fillStyle = COLORS[impact.material];
        if (!ephemeral) {
            const count = trail ? 6 : fluid ? (impact.fatal ? 26 : 14) : (impact.fatal ? 9 : 4);
            if (fluid && !trail) {
                ctx.fillStyle = impact.material === 'blood' ? '#652029' : '#4e642f';
                paint(cell.x + t * 0.32, cell.y + t * 0.64, Math.max(2, Math.round(t * (impact.fatal ? 0.35 : 0.22))), Math.max(2, Math.round(t * 0.12)));
            }
            for (let n = 0; n < count; n++) {
                const spread = trail ? 0.24 : 0.88;
                const x = cell.x + t * (0.5 + (scatter(impact.seed,n*2)-0.5)*spread);
                const y = cell.y + t * (trail ? 0.5 + scatter(impact.seed,n*2+1)*0.4 : 0.24 + scatter(impact.seed,n*2+1)*0.72);
                ctx.fillStyle = fluid && n % 4 === 0 ? (impact.material === 'blood' ? '#652029' : '#4e642f') : COLORS[impact.material];
                const width = Math.max(1, Math.round(t * (trail ? 1.5 : impact.fatal ? 3 : 2) / 32));
                paint(x,y,width,Math.max(1,Math.round(t * (fluid && !trail && n % 3 === 0 ? 2 : 1) / 32)));
            }
        }
        if (age < 600 && !reduced && visible[i] && !trail) {
            const progress = age / 600;
            const count = fluid ? (impact.fatal ? 28 : 20) : 7;
            ctx.fillStyle = COLORS[impact.material];
            for (let n = 0; n < count; n++) {
                const angle = n * 2.4 + impact.seed;
                const radius = progress * t * (fluid ? 0.65 : 0.33) * (0.45 + scatter(impact.seed,n)*0.55);
                const size = Math.max(1, Math.round(t * (fluid && n % 4 === 0 ? 2.5 : 1.5) / 32));
                paint(cell.x+t/2+Math.cos(angle)*radius,cell.y+t*0.6+Math.sin(angle)*radius-Math.sin(progress*Math.PI)*t*0.3,size,size);
            }
        }
    }
}

/** Small persistent drops from visible adjacent steps by wounded living actors. */
export function movementBlood(before: DamageActor[], after: DamageActor[], now: number): Impact[] {
    const result: Impact[] = [];
    for (const old of before) {
        const next = after.find(actor => actor.id === old.id);
        if (!next || !old.visible || !next.visible || old.hp <= 0 || next.hp <= 0 || old.level !== next.level) continue;
        if (!Number.isFinite(next.maxHp) || next.maxHp! <= 0 || next.hp > next.maxHp! / 2) continue;
        if (Math.max(Math.abs(next.x-old.x),Math.abs(next.y-old.y)) !== 1) continue;
        const material = old.id === 0 ? 'blood' : creatureAppearance(old.name).material;
        if (material !== 'blood' && material !== 'slime') continue;
        for (const actor of [old,next]) {
            result.push({x:actor.x,y:actor.y,start:now,fatal:false,material,seed:(Math.imul(old.id+1,65537)^Math.floor(now)^idx(actor.x,actor.y))>>>0,kind:'trail'});
        }
    }
    return result;
}
