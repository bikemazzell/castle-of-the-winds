import type { Equipment, ItemDefRuntime } from '../../engine/types';
import { PixelArt, pixelCanvas, type Pixel } from './pixel-art';
export interface HeroAppearance {
    key: string;
    gender: string;
    weapon: string;
    armor: string;
    helm: boolean;
    shield: boolean;
    boots: boolean;
    gauntlets: boolean;
    bracers: boolean;
    cloak: boolean;
    ring1: boolean;
    ring2: boolean;
    amulet: boolean;
}
export function heroAppearance(gender: string, equipment: Equipment, defs: Record<string, ItemDefRuntime>): HeroAppearance {
    const names = Object.fromEntries(Object.entries(equipment).map(([slot, item]) => [slot, defs[item.defId]?.name.toLowerCase() ?? '']));
    const weaponName = names.weapon ?? '';
    const weapon = !weaponName ? 'none'
        : /quarterstaff/.test(weaponName) ? 'staff'
        : /morningstar/.test(weaponName) ? 'morningstar'
        : /flail/.test(weaponName) ? 'flail'
        : /axe/.test(weaponName) ? 'axe'
        : /hammer/.test(weaponName) ? 'hammer'
        : /club/.test(weaponName) ? 'club'
        : /mace/.test(weaponName) ? 'mace'
        : /spear|pike/.test(weaponName) ? 'spear'
        : /dagger|knife/.test(weaponName) ? 'dagger'
        : /broken/.test(weaponName) ? 'broken'
        : /two handed/.test(weaponName) ? 'greatsword' : 'sword';
    const armor = names.armor ? /plate/.test(names.armor) ? 'plate' : /chain|mail/.test(names.armor) ? 'mail' : 'leather' : 'none';
    return { key: JSON.stringify([gender, names]), gender, weapon, armor, helm: !!names.helm, shield: !!names.shield, boots: !!names.boots, gauntlets: !!names.gauntlets, bracers: !!names.bracers, cloak: !!names.cloak, ring1: !!names.ring1, ring2: !!names.ring2, amulet: !!names.amulet };
}
export function heroPixels(d: HeroAppearance): Pixel[] {
    const a = new PixelArt(), skin = '#dbb78a', hair = d.gender === 'female' ? '#ac693d' : '#6a4936', metal = '#b1bbc0', gold = '#d3b36b';
    if (d.cloak) {
        a.block(7, 12, 18, 17, '#66446d');
        a.rect(10, 14, 2, 13, '#8e6693');
    }
    a.block(12, 5, 9, 8, skin);
    a.rect(12, 4, 9, 3, hair);
    if (d.gender === 'female') {
        a.rect(10, 6, 3, 11, hair);
        a.rect(20, 6, 3, 11, hair);
    }
    else
        a.rect(13, 12, 6, 2, hair);
    a.eye(13, 9);
    a.eye(18, 9);
    const armor = d.armor === 'plate' ? metal : d.armor === 'mail' ? '#929c9b' : d.armor === 'leather' ? '#a58054' : '#65818d';
    a.block(11, 15, 11, 10, armor);
    a.block(7, 16, 3, 9, skin);
    a.block(23, 16, 3, 9, skin);
    a.block(11, 26, 4, 4, d.boots ? '#796048' : '#5a626c');
    a.block(18, 26, 4, 4, d.boots ? '#796048' : '#5a626c');
    a.rect(11, 23, 11, 2, '#5c4839');
    a.rect(16, 23, 2, 2, gold);
    if (d.armor === 'mail')
        for (let y = 16; y < 23; y += 2)
            for (let x = 12; x < 22; x += 2)
                a.rect(x + (y % 4 ? 0 : 1), y, 1, 1, '#d1d5c8');
    if (d.armor === 'plate') {
        a.rect(12, 16, 2, 6, '#e4e3cf');
        a.rect(17, 16, 1, 7, '#75858e');
        a.block(8, 14, 4, 3, metal);
        a.block(22, 14, 4, 3, metal);
    }
    if (d.helm) {
        a.block(11, 3, 11, 5, metal);
        a.rect(16, 4, 1, 6, gold);
    }
    if (d.gauntlets) {
        a.block(7, 22, 3, 3, metal);
        a.block(23, 22, 3, 3, metal);
    }
    if (d.bracers) {
        a.rect(7, 19, 3, 2, gold);
        a.rect(23, 19, 3, 2, gold);
    }
    if (d.amulet) {
        a.rect(15, 15, 4, 1, gold);
        a.rect(16, 16, 2, 2, '#83c1bb');
    }
    if (d.ring1)
        a.rect(7, 24, 1, 1, gold);
    if (d.ring2)
        a.rect(25, 24, 1, 1, gold);
    if (d.shield) {
        a.block(3, 17, 7, 9, '#a48b61');
        a.rect(6, 18, 1, 7, metal);
        a.rect(4, 21, 5, 1, metal);
    }
    if (d.weapon !== 'none') {
        a.block(26, 20, 1, 8, '#8c6949');
        if (d.weapon === 'staff') {
            a.block(26,3,2,27,'#9c8059');a.rect(26,6,2,2,gold);a.rect(26,25,2,2,gold);
        } else if (d.weapon === 'flail') {
            a.rect(26,12,1,11,'#967653');a.line(26,12,30,17,metal);a.block(28,17,3,4,metal);
        } else if (d.weapon === 'morningstar') {
            a.block(24,11,5,5,metal);a.rect(26,9,1,2,metal);a.rect(22,13,2,1,metal);a.rect(29,13,2,1,metal);
        } else if (d.weapon === 'club') {
            a.block(25,10,3,14,'#a38660');a.rect(25,11,1,6,'#c2a77b');
        } else if (d.weapon === 'hammer') {
            a.block(23,10,7,4,metal);a.rect(26,14,1,10,'#957149');
        } else if (d.weapon === 'greatsword') {
            a.block(26,3,2,20,metal);a.rect(23,23,7,1,gold);
        } else if (d.weapon === 'broken') {
            a.block(26,17,1,5,metal);a.rect(27,16,1,2,metal);a.rect(24,22,5,1,gold);
        } else if (d.weapon === 'axe') {
            a.block(23, 10, 7, 6, metal);
            a.rect(26, 10, 1, 12, '#8c6949');
        }
        else if (d.weapon === 'mace') {
            a.block(24, 11, 5, 5, metal);
            a.rect(26, 12, 1, 2, '#e5e5ce');
        }
        else if (d.weapon === 'spear') {
            a.rect(26, 6, 1, 18, '#b5976a');
            a.block(25, 4, 3, 5, metal);
        }
        else {
            a.block(26, d.weapon === 'dagger' ? 16 : 7, 1, d.weapon === 'dagger' ? 6 : 15, metal);
            a.rect(24, 22, 5, 1, gold);
        }
    }
    return a.pixels;
}
export function createHeroCache(): (appearance: HeroAppearance) => HTMLCanvasElement {
    const cache = new Map<string, HTMLCanvasElement>();
    return appearance => {
        let image = cache.get(appearance.key);
        if (!image) {
            image = pixelCanvas(heroPixels(appearance));
            if (cache.size >= 64)
                cache.delete(cache.keys().next().value!);
            cache.set(appearance.key, image);
        }
        return image;
    };
}
