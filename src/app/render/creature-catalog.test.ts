import { expect, it } from 'vitest';
import monsters from '../../data/part1/monsters.json';
import { creatureAppearance } from './creature-catalog';
it('assigns every shipped Part One monster without using the unknown fallback', () => {
    for (const { name } of monsters.records)
        expect(creatureAppearance(name).family, name).not.toBe('unknown');
});
it('distinguishes unrelated creatures and dragon palettes', () => {
    expect(new Set(['Orc', 'Giant Scorpion', 'Giant Trapdoor Spider', 'Gray Wolf'].map(n => creatureAppearance(n).family)).size).toBe(4);
    expect(creatureAppearance('Ancient Red Dragon').color).not.toBe(creatureAppearance('Ancient Blue Dragon').color);
    expect(creatureAppearance('Ancient Red Dragon').rank).toBeGreaterThan(creatureAppearance('Young Red Dragon').rank);
    expect(creatureAppearance('Hrungnir').family).toBe('boss');
    expect(creatureAppearance('not a monster').family).toBe('unknown');
});
it('uses creature-specific remains instead of blood for everything', () => {
    expect(creatureAppearance('Skeleton').material).toBe('bone');
    expect(creatureAppearance('Eerie Ghost').material).toBe('spirit');
    expect(creatureAppearance('Slime').material).toBe('slime');
    expect(creatureAppearance('Animated Iron Statue').material).toBe('stone');
});
it.each([['Giant Bat', 'bat'], ['Fire Giant', 'giant'], ['Animated Iron Statue', 'statue'], ['Magma Elemental', 'elemental'], ['Giant Red Ant', 'ant']])('recognizes %s as %s', (name, family) => { expect(creatureAppearance(name).family).toBe(family); });
it('gives different species within a family distinct artwork', async () => {
    const { creaturePixels } = await import('./pixel-art');
    for (const [a, b] of [['Dog', 'Gray Wolf'], ['Rat-Man', 'Bull-Man'], ['Wizard', 'Necromancer'], ['Bandit', 'Evil Warrior']]) {
        expect(creaturePixels(a!)).not.toEqual(creaturePixels(b!));
    }
});
it('keeps all new sprite primitives on the pixel grid', async () => {
    const { creaturePixels } = await import('./pixel-art');
    for (const { name } of monsters.records)
        for (const p of creaturePixels(name))
            for (const n of p.slice(0, 4))
                expect(Number.isInteger(n)).toBe(true);
});
it('gives every Part Two monster and boss a known appearance', async () => {
    const {default: part2} = await import('../../data/part2/monsters.json');
    for (const {name} of part2.records) expect(creatureAppearance(name).family,name).not.toBe('unknown');
});
it('distinguishes Part Two demons, kings, and the two-headed giant', async () => {
    const {creaturePixels} = await import('./pixel-art');
    const names=['The Demon Lord Surtur','Utgardhalok, The Hill Giant King','Rungnir, The Stone Giant King','Thrym, The Frost Giant King','Thiassa, The Fire Giant King','Spiked Devil','Horned Devil','Ice Devil','Abyss Fiend','Two Headed Giant'];
    expect(new Set(names.map(n=>JSON.stringify(creaturePixels(n)))).size).toBe(names.length);
});

it('sizes small animals, insects, humanoids, and large creatures with larger bosses', () => {
    const scale = (name: string) => creatureAppearance(name).scale;
    expect(scale('Cellar Mouse')).toBe(0.35);
    expect(scale('Giant Rat')).toBe(0.5);
    expect(scale('Giant Red Ant')).toBeLessThan(scale('Evil Warrior'));
    expect(scale('Evil Warrior')).toBeLessThan(scale('Fire Giant'));
    expect(scale('Young Red Dragon')).toBeLessThan(scale('Ancient Red Dragon'));
    expect(scale('Ancient Red Dragon')).toBe(1);
    for (const { name } of monsters.records) {
        expect(scale(name)).toBeGreaterThan(0);
        if (creatureAppearance(name).family !== 'boss') expect(scale(name)).toBeLessThanOrEqual(1);
    }
});

it('makes Hrungnir four to five times the painted height of an ordinary warrior', async () => {
    const { creaturePixels } = await import('./pixel-art');
    const height = (name: string) => {
        const pixels = creaturePixels(name);
        return (Math.min(32, Math.max(...pixels.map(p => p[1] + p[3]))) - Math.max(0, Math.min(...pixels.map(p => p[1])))) * creatureAppearance(name).scale;
    };
    expect(height('Hrungnir') / height('Evil Warrior')).toBeGreaterThanOrEqual(4);
    expect(height('Hrungnir') / height('Evil Warrior')).toBeLessThanOrEqual(5);
    expect(creatureAppearance('The Demon Lord Surtur').scale).toBeGreaterThan(3);
    for (const name of ['Utgardhalok', 'Rungnir', 'Thrym', 'Thiassa']) expect(creatureAppearance(name).scale).toBeGreaterThan(2);
});
