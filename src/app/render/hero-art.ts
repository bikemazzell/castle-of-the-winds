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
    // Newly drawn 32px figures: small heads and long limbs, like early Windows RPG art.
    const a = new PixelArt();
    const female = d.gender === 'female';
    const ink = '#24252b', skin = '#e2ce96', light = '#fff0be', shade = '#9d875b';
    const hair = female ? '#b64728' : '#93662f', metal = '#b1bbc0', gold = '#d3b36b';
    const blue = '#39469b';
    if (d.cloak) {
        a.block(9, 10, 14, 19, '#564168');
        a.rect(10, 13, 2, 14, '#79618b');
    }
    // Bare legs and flat feet. The separated knees avoid the old squat silhouette.
    a.rect(11, 22, 5, 9, ink);
    a.rect(18, 22, 5, 9, ink);
    a.rect(12, 23, 3, 7, skin);
    a.rect(19, 23, 3, 7, skin);
    a.rect(14, 24, 1, 5, shade);
    a.rect(21, 24, 1, 5, shade);
    a.rect(10, 29, 5, 2, ink);
    a.rect(18, 29, 6, 2, ink);
    a.rect(10, 29, 4, 1, light);
    a.rect(19, 29, 5, 1, light);
    // Sloping shoulders, chest, and waist, rather than a rectangular tunic.
    a.rect(12, 9, 8, 2, ink);
    a.rect(10, 11, 12, 6, ink);
    a.rect(12, 16, 9, 7, ink);
    a.rect(12, 10, 8, 2, skin);
    a.rect(11, 12, 10, 4, skin);
    a.rect(13, 16, 7, 6, skin);
    a.rect(12, 12, 2, 3, light);
    a.rect(19, 12, 2, 4, shade);
    a.rect(19, 17, 1, 4, shade);
    a.rect(16, 19, 1, 1, shade);
    // One arm hangs crookedly; the other bends up to the weapon grip.
    a.line(10, 12, 7, 17, ink, 3);
    a.line(7, 17, 9, 22, ink, 3);
    a.line(10, 12, 8, 17, skin, 2);
    a.line(8, 17, 10, 21, skin, 2);
    a.line(21, 12, 23, 18, ink, 3);
    a.line(23, 18, 27, 17, ink, 3);
    a.line(21, 12, 24, 18, skin, 2);
    a.line(24, 18, 27, 17, light, 2);
    // Plain briefs. Female base clothing also has a simple blue top.
    a.rect(12, 21, 9, 2, blue);
    a.rect(13, 23, 7, 1, blue);
    a.rect(15, 24, 3, 1, blue);
    a.rect(12, 21, 9, 1, '#8d9ad3');
    if (female) {
        a.rect(12, 11, 1, 4, blue);
        a.rect(19, 11, 1, 4, blue);
        a.rect(11, 14, 10, 2, blue);
        a.rect(12, 14, 3, 1, '#8d9ad3');
        a.rect(17, 14, 3, 1, '#8d9ad3');
    } else {
        a.rect(13, 15, 2, 1, shade);
        a.rect(17, 15, 2, 1, shade);
    }
    // Five-pixel face, one-pixel features: no large eyes or oversized head.
    a.rect(14, 2, 5, 1, ink);
    a.rect(13, 3, 7, 4, ink);
    a.rect(14, 7, 5, 2, ink);
    a.rect(14, 3, 5, 4, skin);
    a.rect(15, 7, 3, 3, skin);
    a.rect(14, 3, 5, 1, hair);
    a.rect(14, 4, 1, 2, light);
    a.rect(15, 5, 1, 1, ink);
    a.rect(18, 5, 1, 1, ink);
    a.rect(17, 6, 1, 1, light);
    a.rect(16, 8, 2, 1, shade);
    if (female) {
        a.rect(13, 2, 6, 2, hair);
        a.rect(12, 4, 2, 6, hair);
        a.rect(19, 3, 2, 8, hair);
        a.rect(12, 9, 2, 3, '#793326');
        a.rect(20, 7, 1, 4, '#793326');
    }
    if (d.armor !== 'none') {
        const armor = d.armor === 'plate' ? metal : d.armor === 'mail' ? '#929c9b' : '#a58054';
        a.rect(11, 11, 10, 5, armor);
        a.rect(12, 16, 9, 6, armor);
        a.rect(12, 21, 9, 1, '#5c4839');
        a.rect(16, 21, 2, 1, gold);
        if (d.armor === 'mail') {
            for (let y = 12; y < 21; y += 2)
                for (let x = 12; x < 20; x += 2)
                    a.rect(x + (y % 4 ? 0 : 1), y, 1, 1, '#d1d5c8');
        }
        if (d.armor === 'plate') {
            a.rect(12, 12, 2, 7, '#e4e3cf');
            a.rect(17, 12, 1, 8, '#75858e');
            a.block(9, 11, 3, 3, metal);
            a.block(21, 11, 3, 3, metal);
        }
    }
    if (d.boots) {
        a.rect(11, 26, 5, 5, ink);
        a.rect(18, 26, 6, 5, ink);
        a.rect(12, 26, 3, 4, '#796048');
        a.rect(19, 26, 3, 4, '#796048');
        a.rect(11, 29, 4, 1, '#ad8c60');
        a.rect(19, 29, 5, 1, '#ad8c60');
    }
    if (d.helm) {
        a.block(13, 2, 7, 3, metal);
        a.rect(16, 2, 1, 4, gold);
    }
    if (d.gauntlets) {
        a.rect(9, 20, 3, 3, metal);
        a.rect(26, 17, 3, 2, metal);
    }
    if (d.bracers) {
        a.rect(7, 18, 3, 2, gold);
        a.rect(23, 17, 2, 2, gold);
    }
    if (d.amulet) {
        a.rect(15, 11, 4, 1, gold);
        a.rect(16, 12, 2, 2, '#83c1bb');
    }
    if (d.ring1) a.rect(10, 22, 1, 1, gold);
    if (d.ring2) a.rect(27, 18, 1, 1, gold);
    if (d.shield) {
        a.block(4, 16, 6, 9, '#a48b61');
        a.rect(6, 17, 1, 7, metal);
        a.rect(5, 20, 4, 1, metal);
    }
    if (d.weapon !== 'none') {
        a.rect(26, 17, 2, 7, '#8c6949');
        switch (d.weapon) {
            case 'staff':
                a.block(26, 3, 2, 27, '#9c8059');
                a.rect(26, 6, 2, 2, gold);
                break;
            case 'flail':
                a.rect(26, 12, 1, 8, '#967653');
                a.line(26, 12, 30, 15, metal);
                a.block(28, 15, 3, 4, metal);
                break;
            case 'morningstar':
                a.block(24, 9, 5, 5, metal);
                a.rect(26, 7, 1, 2, metal);
                a.rect(22, 11, 2, 1, metal);
                a.rect(29, 11, 2, 1, metal);
                a.rect(26, 14, 2, 3, '#8c6949');
                break;
            case 'club':
                a.block(25, 8, 3, 13, '#a38660');
                a.rect(25, 9, 1, 6, '#c2a77b');
                break;
            case 'hammer':
                a.block(23, 8, 7, 4, metal);
                a.rect(26, 12, 2, 5, '#957149');
                break;
            case 'axe':
                a.block(23, 7, 7, 6, metal);
                a.rect(26, 7, 2, 12, '#8c6949');
                break;
            case 'mace':
                a.block(24, 8, 5, 5, metal);
                a.rect(26, 9, 1, 2, '#e5e5ce');
                a.rect(26, 13, 2, 4, '#8c6949');
                break;
            case 'spear':
                a.rect(26, 6, 2, 23, '#b5976a');
                a.block(25, 3, 3, 5, metal);
                break;
            default: {
                const tip = d.weapon === 'dagger' ? 11 : d.weapon === 'broken' ? 13 : d.weapon === 'greatsword' ? 2 : 5;
                a.block(26, tip, d.weapon === 'greatsword' ? 2 : 1, 16 - tip, metal);
                a.rect(24, 16, 6, 1, gold);
            }
        }
        a.rect(26, 17, 2, 2, d.gauntlets ? metal : skin);
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
