import { expect, it } from 'vitest';
import monsters from '../../data/monsters.json';
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
