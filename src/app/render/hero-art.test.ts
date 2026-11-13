import { expect, it } from 'vitest';
import { heroAppearance } from './hero-art';
import type { Equipment, ItemDefRuntime } from '../../engine/types';
const defs: Record<string, ItemDefRuntime> = {
    axe: { id: 'axe', name: 'Battle Axe', kind: 'weapon', slot: 'weapon', stackable: false, consumable: false },
    plate: { id: 'plate', name: 'Plate Armor', kind: 'armor', slot: 'armor', stackable: false, consumable: false },
};
it('uses equipped definitions and removes art on unequip', () => {
    const equipment: Equipment = { weapon: { uid: '1', defId: 'axe', count: 1 }, armor: { uid: '2', defId: 'plate', count: 1 } };
    expect(heroAppearance('male', equipment, defs).weapon).toBe('axe');
    expect(heroAppearance('male', equipment, defs).armor).toBe('plate');
    expect(heroAppearance('male', {}, defs).weapon).toBe('none');
    expect(heroAppearance('male', {}, defs).key).not.toBe(heroAppearance('male', equipment, defs).key);
});
it('keeps gender and actual equipped layers in the composite key', () => {
    expect(heroAppearance('female', {}, defs).key).not.toBe(heroAppearance('male', {}, defs).key);
    expect(heroAppearance('male', { helm: { uid: '1', defId: 'missing', count: 1 } }, defs).helm).toBe(false);
});
it('reuses composites and evicts old entries instead of growing without bound', async () => {
    const { vi } = await import('vitest');
    const createElement = vi.fn(() => ({ width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect: () => { } }) }));
    vi.stubGlobal('document', { createElement });
    try {
        const { createHeroCache } = await import('./hero-art');
        const get = createHeroCache(), appearance = heroAppearance('male', {}, defs);
        const first = get(appearance);
        expect(get(appearance)).toBe(first);
        expect(createElement).toHaveBeenCalledTimes(1);
        for (let i = 0; i < 65; i++)
            get({ ...appearance, key: String(i) });
        expect(get(appearance)).not.toBe(first);
    }
    finally {
        vi.unstubAllGlobals();
    }
});

it.each([['Quarterstaff','staff'],['Flail','flail'],['Morningstar','morningstar']])('represents equipped %s as %s',(name,weapon)=>{
 const item:ItemDefRuntime={id:'item',name,kind:'weapon',slot:'weapon',stackable:false,consumable:false};
 expect(heroAppearance('female',{weapon:{uid:'1',defId:'item',count:1}},{item}).weapon).toBe(weapon);
});

it.each(['male', 'female'])('shows bare lower legs until boots are equipped (%s)', async gender => {
    const { heroPixels } = await import('./hero-art');
    const bare = heroPixels(heroAppearance(gender, {}, defs));
    const bootDef: ItemDefRuntime = { id: 'boots', name: 'Leather Boots', kind: 'armor', slot: 'boots', stackable: false, consumable: false };
    const booted = heroPixels(heroAppearance(gender, { boots: { uid: 'b', defId: 'boots', count: 1 } }, { ...defs, boots: bootDef }));
    const at = (pixels: typeof bare, x: number, y: number): string | undefined => pixels.filter(([px, py, w, h]) => x >= px && x < px + w && y >= py && y < py + h).at(-1)?.[4];
    expect(at(bare, 12, 27)).not.toBe(at(booted, 12, 27));
    expect(at(bare, 12, 27)).toBe(at(bare, 12, 25));
    // Unequipped bodies have bare skin, not a default shirt and trousers.
    expect(bare.some(([, , , , color]) => color === '#65818d' || color === '#5a626c')).toBe(false);
});


it('changes pixels and cache keys for underwear and helmet colors', async () => {
  const {heroPixels} = await import('./hero-art');
  const blue = heroAppearance('female', {}, defs);
  const red = heroAppearance('female', {}, defs, 'red');
  expect(red.key).not.toBe(blue.key);
  expect(heroPixels(red)).not.toEqual(heroPixels(blue));
  const equipment: Equipment = {helm:{uid:'helm',defId:'plate',count:1}};
  const silver = heroAppearance('male', equipment, defs);
  equipment.helm!.color = 'gold';
  const gold = heroAppearance('male', equipment, defs);
  expect(gold.key).not.toBe(silver.key);
  expect(heroPixels(gold)).not.toEqual(heroPixels(silver));
});

it('draws distinct equipped silhouettes for the expansion weapons', async () => {
  const {heroPixels} = await import('./hero-art');
  const variants = [
    ['Short Bow','bow'], ['Crossbow','crossbow'], ['Hand Cannon','hand-cannon'],
    ['Whip','whip'], ['Salvaged Bone Club','bone-club'], ['Club','club'], ['Sword','sword'],
  ] as const;
  const pixels = variants.map(([name, weapon]) => {
    const item:ItemDefRuntime={id:'test',name,kind:'weapon',slot:'weapon',stackable:false,consumable:false};
    const appearance=heroAppearance('female',{weapon:{uid:'weapon',defId:'test',count:1}},{test:item});
    expect(appearance.weapon).toBe(weapon);
    const image=heroPixels(appearance);
    for (const [x,y,w,h] of image) {
      expect(x).toBeGreaterThanOrEqual(0);expect(y).toBeGreaterThanOrEqual(0);
      expect(x+w).toBeLessThanOrEqual(32);expect(y+h).toBeLessThanOrEqual(32);
    }
    return JSON.stringify(image);
  });
  expect(new Set(pixels).size).toBe(variants.length);
});
