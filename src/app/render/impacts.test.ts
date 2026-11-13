import { expect, it } from 'vitest';
import { damageImpacts, createImpactStore } from './impacts';
const before = [{ id: 1, name: 'Orc', x: 4, y: 5, hp: 10, visible: true }];
it('emits only real visible damage and death, with the correct material', () => {
    expect(damageImpacts(before, [{ ...before[0]!, hp: 10 }], 0)).toHaveLength(0);
    expect(damageImpacts(before, [{ ...before[0]!, hp: 8 }], 0)).toHaveLength(1);
    expect(damageImpacts(before, [], 0)[0]?.fatal).toBe(true);
    expect(damageImpacts([{ ...before[0]!, visible: false }], [], 0)).toHaveLength(0);
    expect(damageImpacts([{ ...before[0]!, name: 'Skeleton' }], [], 0)[0]?.material).toBe('bone');
});
it('caps retained stains and clears all effects between worlds', () => {
    const store = createImpactStore();
    for (let i = 0; i < 200; i++)
        store.add(damageImpacts(before, [], i));
    expect(store.all().length).toBe(96);
    store.clear();
    expect(store.all()).toHaveLength(0);
});
it('expires spirit effects and never draws impacts in unknown cells', async () => {
    const { vi } = await import('vitest');
    const { drawImpacts } = await import('./impacts');
    const { cameraFor } = await import('./camera');
    const ctx = { fillStyle: '', globalAlpha: 1, drawImage: vi.fn(), fillRect: vi.fn() }, camera = cameraFor({ x: 4, y: 5 }, { width: 320, height: 320 }, 32);
    const impact = { x: 4, y: 5, start: 0, fatal: true, material: 'spirit' as const, seed: 1 }, known = new Uint8Array(4096).fill(1);
    drawImpacts(ctx, camera, [impact], known, known, 900, false);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    drawImpacts(ctx, camera, [{ ...impact, material: 'blood' }], new Uint8Array(4096), known, 100, false);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    drawImpacts(ctx, camera, [{ ...impact, material: 'bone' }], known, known, 900, true);
    expect(ctx.fillRect).toHaveBeenCalledTimes(9);
});

it('puts observed damage at the new position and does not expose unseen destinations',()=>{
 const after=[{...before[0]!,x:5,hp:8}];
 expect(damageImpacts(before,after,100)[0]?.x).toBe(5);
 expect(damageImpacts(before,[{...after[0]!,visible:false}],100)).toHaveLength(0);
});
