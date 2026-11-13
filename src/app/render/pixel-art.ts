import { creatureAppearance, type CreatureAppearance } from './creature-catalog';
export type Pixel = readonly [
    number,
    number,
    number,
    number,
    string
];
const OUT = '#24252b', LIGHT = '#e3d4ad', SHADE = '#4a4542';
/** Small outlined pixel shapes shared by new presentation art. */
export class PixelArt {
    readonly pixels: Pixel[] = [];
    rect(x: number, y: number, w: number, h: number, c: string): void { this.pixels.push([Math.round(x), Math.round(y), Math.round(w), Math.round(h), c]); }
    block(x: number, y: number, w: number, h: number, c: string): void { this.rect(x - 1, y - 1, w + 2, h + 2, OUT); this.rect(x, y, w, h, c); if (w > 3 && h > 3) {
        this.rect(x, y, w, 1, 'rgba(255,240,196,0.2)');
        this.rect(x + w - 1, y + 1, 1, h - 1, 'rgba(0,0,0,0.22)');
        this.rect(x + 1, y + h - 1, w - 1, 1, 'rgba(0,0,0,0.18)');
    } }
    line(x: number, y: number, x2: number, y2: number, c: string, width = 1): void {
        const steps = Math.max(Math.abs(x2 - x), Math.abs(y2 - y));
        for (let s = 0; s <= steps; s++) {
            const t = steps ? s / steps : 0;
            this.rect(Math.round(x + (x2 - x) * t), Math.round(y + (y2 - y) * t), width, width, c);
        }
    }
    eye(x: number, y: number): void { this.rect(x, y, 2, 1, LIGHT); this.rect(x + 1, y, 1, 1, OUT); }
}
export function pixelCanvas(pixels: readonly Pixel[]): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (ctx)
        for (const [x, y, w, h, c] of pixels) {
            ctx.fillStyle = c;
            ctx.fillRect(x, y, w, h);
        }
    return canvas;
}
function humanoid(a: PixelArt, d: CreatureAppearance): void {
    const { family: f, color: c } = d;
    const large = ['ogre', 'giant', 'troll', 'boss'].includes(f);
    const head = large ? 6 : 8, body = large ? 9 : 8;
    if (f === 'vampire' || f === 'caster') {
        a.block(7, 12, 18, 16, f === 'vampire' ? '#763c50' : '#51436e');
        a.rect(11, 13, 10, 13, c);
    }
    a.block(11, head, 10, 8, c);
    a.block(16 - body / 2, head + 9, body, 9, c);
    a.block(large ? 6 : 9, head + 9, 3, 10, c);
    a.block(large ? 23 : 20, head + 9, 3, 10, c);
    a.block(11, 26, 4, 4, SHADE);
    a.block(18, 26, 4, 4, SHADE);
    a.eye(12, head + 3);
    a.eye(18, head + 3);
    a.rect(14, head + 7, 4, 1, OUT);
    a.rect(12, 23, 8, 2, SHADE);
    if (f === 'orc') {
        a.block(8, 8, 3, 3, c);
        a.block(21, 8, 3, 3, c);
        a.rect(12, 14, 2, 2, LIGHT);
        a.rect(19, 14, 2, 2, LIGHT);
    }
    if (f === 'goblin' || f === 'kobold') {
        a.line(8, 10, 3, 7, c, 2);
        a.line(22, 10, 27, 7, c, 2);
        a.rect(14, 11, 4, 3, '#bf995f');
    }
    if (f === 'skeleton') {
        a.rect(14, 12, 4, 2, OUT);
        for (let y = 18; y < 24; y += 2)
            a.rect(12, y, 8, 1, OUT);
        a.rect(16, 17, 1, 8, LIGHT);
    }
    if (f === 'corpse') {
        a.rect(12, 10, 2, 2, '#573f45');
        a.rect(13, 19, 3, 4, '#625647');
    }
    if (f === 'troll') {
        a.block(14, 10, 4, 5, '#a8aa75');
        a.rect(13, 2, 6, 3, SHADE);
    }
    if (f === 'caster') {
        a.block(10, 5, 12, 4, c);
        a.block(13, 2, 6, 3, c);
        a.line(26, 9, 26, 29, '#97774d', 2);
        a.block(25, 6, 3, 3, '#a8c8d5');
    }
    if (f === 'human' || f === 'vampire') {
        a.rect(11, 7, 10, 3, SHADE);
        a.line(26, 10, 26, 25, LIGHT, 2);
        a.rect(24, 24, 6, 1, '#b99c61');
    }
    if (f === 'statue') {
        a.rect(8, 28, 17, 3, '#727574');
        a.rect(12, 9, 2, 1, '#464b4d');
        a.rect(18, 9, 2, 1, '#464b4d');
        a.line(18, 17, 15, 22, SHADE);
    }
    if (f === 'hybrid') {
        a.block(10, 5, 3, 4, c);
        a.block(20, 5, 3, 4, c);
        a.block(13, 13, 6, 3, '#bfa78a');
        a.line(10, 24, 5, 28, c, 2);
    }
    if (f === 'demon') {
        a.line(11, 8, 6, 2, LIGHT, 2);
        a.line(21, 8, 26, 2, LIGHT, 2);
        a.rect(12, 10, 2, 1, '#ffcc69');
        a.rect(19, 10, 2, 1, '#ffcc69');
        a.line(21, 26, 28, 27, c, 2);
        a.line(28, 27, 29, 22, c, 2);
    }
    if (f === 'boss') {
        a.block(9, 2, 14, 4, '#a98847');
        a.rect(10, 0, 2, 3, LIGHT);
        a.rect(20, 0, 2, 3, LIGHT);
        a.block(25, 19, 5, 7, '#818894');
        a.rect(26, 23, 2, 8, '#8d6947');
    }
    if (d.rank > 1)
        a.rect(13, 20, 6, 2, LIGHT);
}
export function creaturePixels(name: string): Pixel[] {
    const d = creatureAppearance(name), a = new PixelArt(), c = d.color, f = d.family;
    if (['demon', 'orc', 'goblin', 'kobold', 'skeleton', 'corpse', 'ogre', 'troll', 'giant', 'caster', 'vampire', 'human', 'boss', 'statue', 'hybrid'].includes(f))
        humanoid(a, d);
    else if (f === 'scorpion' || f === 'spider' || f === 'ant') {
        const legs = f === 'spider' ? 4 : 3;
        for (let k = 0; k < legs; k++)
            for (const side of [-1, 1]) {
                a.line(16 + side * 5, 16 + k * 3, 16 + side * 11, 11 + k * 5, OUT, 2);
                a.line(16 + side * 5, 16 + k * 3, 16 + side * 11, 11 + k * 5, c);
            }
        a.block(12, 13, 8, 10, c);
        a.block(13, 9, 6, 5, c);
        a.eye(14, 10);
        a.eye(17, 10);
        if (f === 'scorpion') {
            a.block(6, 7, 4, 5, c);
            a.block(23, 7, 4, 5, c);
            a.line(17, 23, 23, 26, c, 3);
            a.line(23, 26, 27, 20, c, 3);
            a.line(27, 20, 26, 16, c, 2);
            a.rect(24, 15, 3, 2, LIGHT);
        }
        if (f === 'ant') {
            a.block(12, 23, 8, 6, c);
            a.line(13, 10, 10, 6, c);
            a.line(18, 10, 21, 6, c);
        }
        if (f === 'spider') {
            a.block(10, 19, 12, 10, c);
            a.rect(13, 22, 6, 2, '#c86a50');
        }
    }
    else if (f === 'snake' || f === 'creeper') {
        a.block(9, 22, 14, 5, c);
        a.block(7, 17, 6, 7, c);
        a.block(12, 16, 10, 4, c);
        a.block(20, 10, 5, 9, c);
        a.block(18, 7, 9, 5, c);
        a.eye(23, 8);
        a.line(26, 11, 29, 13, '#c96961');
        for (let x = 10; x < 24; x += 4)
            a.rect(x, 23, 2, 1, LIGHT);
        if (f === 'creeper')
            for (let x = 8; x < 25; x += 3) {
                a.line(x, 24, x - 2, 29, c);
                a.rect(x, 17, 1, 4, SHADE);
            }
    }
    else if (f === 'canine' || f === 'bear' || f === 'rodent' || f === 'lizard') {
        const bear = f === 'bear';
        a.block(bear ? 6 : 8, bear ? 13 : 17, bear ? 18 : 14, bear ? 12 : 7, c);
        a.block(19, 12, 8, 8, c);
        a.block(24, 16, 5, 4, c);
        a.eye(23, 14);
        a.rect(28, 17, 2, 2, OUT);
        a.block(8, 24, 3, 5, SHADE);
        a.block(20, 24, 3, 5, SHADE);
        a.block(19, 9, 3, 4, c);
        a.block(25, 10, 2, 3, c);
        a.line(8, 20, 3, 16, f === 'rodent' ? '#bc8d86' : c, 2);
        if (f === 'rodent') {
            a.block(18, 10, 5, 5, '#b8938a');
            a.line(4, 17, 2, 24, '#bc8d86');
        }
        if (f === 'lizard') {
            a.line(8, 23, 2, 28, c, 3);
            for (let x = 8; x < 21; x += 3)
                a.rect(x, 15, 1, 3, LIGHT);
        }
    }
    else if (f === 'dragon' || f === 'manticore' || f === 'bat') {
        const spread = f === 'bat' ? 12 : 10;
        for (let side = -1; side <= 1; side += 2) {
            a.line(16 + side * 3, 18, 16 + side * spread, 6, OUT, 3);
            for (let k = 0; k < 7; k++)
                a.line(16 + side * 4, 18, 16 + side * (spread - k), 7 + k, c, 2);
            a.line(16 + side * 4, 19, 16 + side * spread, 20, SHADE, 2);
        }
        a.block(12, 14, 8, 12, c);
        a.block(13, 8, 7, 8, c);
        a.eye(14, 11);
        a.eye(18, 11);
        a.block(10, 26, 5, 3, SHADE);
        a.block(18, 26, 5, 3, SHADE);
        if (f !== 'bat') {
            a.line(19, 24, 27, 28, c, 3);
            a.line(27, 28, 29, 22, c, 2);
            a.rect(14, 18, 4, 7, LIGHT);
            a.rect(12, 5, 2, 4, LIGHT);
            a.rect(20, 5, 2, 4, LIGHT);
        }
        if (f === 'dragon')
            for (let k = 0; k < d.rank; k++)
                a.rect(14 + k, 7 - (k % 2), 1, 2, LIGHT);
        if (f === 'manticore')
            a.block(11, 9, 11, 9, '#b38953');
    }
    else if (f === 'slime') {
        a.block(6, 23, 21, 6, c);
        a.block(9, 17, 15, 6, c);
        a.block(13, 13, 7, 4, c);
        a.rect(11, 19, 3, 2, '#c6de9c');
        a.eye(14, 24);
        a.eye(20, 24);
    }
    else if (f === 'spirit' || f === 'elemental') {
        a.block(11, 6, 11, 7, c);
        a.block(8, 13, 17, 10, c);
        a.block(11, 23, 11, 3, c);
        a.line(9, 22, 5, 28, c, 2);
        a.line(22, 22, 26, 27, c, 2);
        a.rect(13, 26, 3, 3, c);
        a.rect(19, 25, 2, 4, c);
        a.rect(12, 11, 3, 2, OUT);
        a.rect(18, 11, 3, 2, OUT);
        if (f === 'elemental') {
            a.rect(8, 7, 2, 4, c);
            a.rect(22, 3, 2, 5, c);
            a.rect(13, 2, 3, 3, LIGHT);
            a.rect(13, 18, 7, 2, LIGHT);
        }
    }
    else {
        a.block(10, 9, 12, 19, c);
        a.rect(14, 12, 4, 2, OUT);
        a.rect(17, 14, 2, 3, OUT);
        a.rect(15, 20, 2, 2, OUT);
    }
    const n = name.toLowerCase();
    if (/two headed/.test(n)) {
        a.block(6, 5, 8, 8, c); a.block(19, 5, 8, 8, c);
        a.eye(8, 8); a.eye(22, 8);
    }
    if (/spiked/.test(n)) for(let x=6;x<28;x+=5) a.line(x,18,x-2,14,LIGHT,2);
    if (/horned/.test(n)) {a.line(8,4,5,0,LIGHT,2);a.line(24,4,27,0,LIGHT,2);}
    if (/surtur/.test(n)) {
        a.block(25,10,3,18,'#c77a3e'); a.rect(26,10,1,14,'#ffe0a0');
        a.rect(10,19,12,6,'#373d43'); a.rect(13,20,6,2,'#d29953');
    }

    if (/wolf/.test(n) && f === 'canine') {
        a.block(19, 7, 2, 5, c);
        a.rect(21, 18, 5, 2, '#d4c7a6');
        a.rect(27, 19, 1, 2, LIGHT);
    }
    if (/wild dog/.test(n)) {
        a.rect(10, 18, 4, 3, SHADE);
        a.rect(19, 14, 3, 2, SHADE);
    }
    if (/viper/.test(n))
        for (let k = 0; k < 4; k++)
            a.rect(10 + k * 3, 23, 2, 2, OUT);
    if (/bear-man/.test(n)) {
        a.block(9, 4, 4, 4, c);
        a.block(20, 4, 4, 4, c);
        a.rect(13, 13, 6, 2, SHADE);
    }
    if (/wolf-man/.test(n)) {
        a.block(10, 2, 2, 6, c);
        a.block(21, 2, 2, 6, c);
        a.block(13, 12, 6, 4, '#b6ac8e');
    }
    if (/rat-man/.test(n)) {
        a.block(9, 5, 4, 4, '#b99b8d');
        a.line(10, 14, 5, 13, LIGHT);
        a.line(22, 14, 27, 13, LIGHT);
    }
    if (/bull-man/.test(n)) {
        a.line(10, 7, 5, 3, LIGHT, 2);
        a.line(22, 7, 27, 3, LIGHT, 2);
        a.rect(14, 15, 4, 2, '#b6985c');
    }
    if (/necromancer/.test(n)) {
        a.block(11, 5, 11, 4, '#4c435e');
        a.rect(14, 5, 5, 3, LIGHT);
        a.rect(15, 6, 1, 1, OUT);
        a.rect(17, 6, 1, 1, OUT);
        a.rect(26, 7, 1, 2, '#a9d995');
    }
    if (/evil warrior/.test(n)) {
        a.block(10, 4, 12, 5, '#83929b');
        a.block(10, 17, 11, 7, '#7b8990');
        a.rect(14, 18, 4, 1, LIGHT);
    }
    if (/bandit/.test(n)) {
        a.rect(11, 11, 10, 3, '#5d4546');
        a.rect(8, 8, 3, 2, '#8f5850');
    }
    if (/berserker/.test(n)) {
        a.rect(13, 17, 3, 6, OUT);
        a.block(25, 11, 5, 5, '#adb7b4');
    }
    if (/hobgoblin/.test(n)) {
        a.block(11, 5, 10, 3, '#9e8b70');
        a.rect(13, 18, 6, 4, '#887f6d');
    }
    if (/cave bear/.test(n)) {
        a.rect(8, 14, 5, 4, '#5d554b');
        a.rect(19, 12, 2, 5, '#c3ac87');
    }
    return a.pixels;
}
