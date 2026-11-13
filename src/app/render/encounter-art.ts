/** Original code-drawn inhabitants and dungeon objects. No recovered artwork. */
import { NPC_ROLES, PROP_KINDS, type NpcRole, type PropKind } from '../../engine/map';
import { PixelArt, pixelCanvas, type Pixel } from './pixel-art';
const CLOTH: Record<NpcRole, string> = { traveler: '#8b7656', adventurer: '#647d88', peddler: '#a27542', witch: '#78658c', wizard: '#536ca3', salvager: '#8d624a', shopkeeper: '#6a8b66', ghost: '#a9c9ca', critter: '#97897a' };
export function encounterPixels(role: NpcRole): Pixel[] {
    const a = new PixelArt(), color = CLOTH[role];
    if (role === 'critter') {
        a.line(5, 25, 11, 23, '#b89a91');
        a.block(12, 21, 10, 5, color);
        a.block(21, 20, 5, 4, color);
        a.rect(22, 19, 2, 2, '#c8b4a5');
        a.rect(25, 21, 1, 1, '#14181b');
        a.rect(14, 26, 2, 1, '#aa9781');
        return a.pixels;
    }
    if (role === 'ghost') {
        a.block(12, 5, 8, 8, '#cee3d7');
        a.rect(10, 14, 12, 9, color);
        a.rect(8, 16, 3, 6, '#779baf');
        a.rect(22, 16, 3, 6, '#779baf');
        a.rect(10, 23, 3, 5, '#779baf');
        a.rect(15, 23, 3, 7, '#779baf');
        a.rect(20, 23, 2, 4, '#779baf');
        a.rect(14, 8, 1, 2, '#384d6d');
        a.rect(18, 8, 1, 2, '#384d6d');
        return a.pixels;
    }
    // Long limbs and a small head keep the same adult proportions as the hero.
    a.block(12, 5, 7, 7, '#ccb18b');
    a.rect(11, 4, 9, 3, '#5d4a38');
    a.rect(17, 8, 1, 1, '#24252b');
    a.block(11, 13, 10, 10, color);
    a.block(8, 14, 2, 9, color);
    a.block(22, 14, 2, 9, color);
    a.rect(8, 23, 2, 2, '#ccb18b');
    a.rect(22, 23, 2, 2, '#ccb18b');
    a.rect(11, 22, 10, 2, '#443a35');
    a.block(12, 25, 3, 5, '#514c48');
    a.block(18, 25, 3, 5, '#514c48');
    if (role === 'traveler') {
        a.block(5, 13, 3, 8, '#8a653f');
        a.line(25, 12, 25, 29, '#a58a61');
    }
    if (role === 'adventurer') {
        a.block(12, 13, 8, 8, '#91a0a5');
        a.line(25, 13, 25, 27, '#bcc8cc');
        a.rect(23, 24, 5, 2, '#b7a45e');
    }
    if (role === 'peddler') {
        a.block(5, 17, 5, 9, '#876134');
        a.rect(5, 18, 5, 2, '#d0aa64');
        a.rect(10, 3, 12, 2, color);
    }
    if (role === 'witch') {
        a.rect(9, 5, 14, 2, '#453b59');
        a.rect(12, 2, 8, 3, '#453b59');
        a.rect(14, 0, 4, 2, '#453b59');
        a.block(23, 23, 4, 4, '#7ca279');
    }
    if (role === 'wizard') {
        a.rect(11, 4, 10, 2, color);
        a.rect(13, 2, 6, 2, color);
        a.rect(15, 0, 2, 2, color);
        a.line(26, 10, 26, 29, '#bc9c6b');
        a.block(25, 7, 3, 3, '#b8cfe3');
    }
    if (role === 'salvager') {
        a.rect(12, 8, 7, 2, '#4c3d30');
        a.rect(13, 8, 2, 1, '#d8bd79');
        a.block(23, 21, 5, 7, '#927654');
        a.line(25, 10, 25, 20, '#9b9e94');
    }
    if (role === 'shopkeeper') {
        a.rect(12, 16, 8, 9, '#d0c1a1');
        a.rect(12, 20, 8, 1, '#aa9e83');
        a.rect(12, 3, 8, 3, '#7c6a4b');
    }
    return a.pixels;
}
export function propPixels(kind: PropKind): Pixel[] {
    const a = new PixelArt();
    if (kind === 'treasure') {
        a.block(6, 17, 20, 11, '#84613c');
        a.block(7, 13, 18, 5, '#9b7449');
        a.rect(9, 14, 2, 14, '#b5a267');
        a.rect(21, 14, 2, 14, '#b5a267');
        a.block(15, 20, 3, 4, '#d0b867');
    }
    else if (kind === 'bones') {
        a.line(8, 25, 23, 18, '#c5b99a', 2);
        a.line(9, 18, 24, 26, '#c5b99a', 2);
        a.block(12, 12, 7, 7, '#d3c5a1');
        a.rect(13, 15, 2, 2, '#504b45');
        a.rect(17, 15, 2, 2, '#504b45');
    }
    else if (kind === 'rune') {
        a.block(7, 18, 19, 10, '#51546b');
        a.line(12, 20, 16, 25, '#97cbd3');
        a.line(16, 25, 22, 20, '#97cbd3');
        a.rect(16, 18, 1, 9, '#b7e0d7');
        a.rect(9, 14, 1, 2, '#7fb1c1');
        a.rect(24, 12, 1, 2, '#7fb1c1');
    }
    else if (kind === 'mushrooms') {
        for (const [x, y] of [[8, 24], [17, 21], [23, 26]]) {
            a.rect(x!, y!, 2, 5, '#beb6a2');
            a.block(x! - 2, y! - 2, 6, 3, '#849f99');
            a.rect(x!, y! - 2, 2, 1, '#d1d6b5');
        }
    }
    else if (kind === 'junk') {
        a.block(8, 20, 11, 8, '#7d7060');
        a.line(9, 19, 18, 28, '#b7a886');
        a.block(19, 23, 6, 4, '#796047');
        a.rect(21, 18, 2, 6, '#a5a094');
    }
    else {
        a.block(6, 24, 8, 4, '#777570');
        a.block(13, 20, 9, 7, '#8d8779');
        a.block(22, 25, 5, 4, '#666a6b');
        a.rect(15, 21, 4, 1, '#a5a08d');
    }
    return a.pixels;
}
export function loadEncounterSprites(): Record<string, HTMLCanvasElement> {
    return Object.fromEntries([
        ...NPC_ROLES.map(role => [`npc:${role}`, pixelCanvas(encounterPixels(role))] as const),
        ...PROP_KINDS.map(kind => [`prop:${kind}`, pixelCanvas(propPixels(kind))] as const),
    ]);
}
