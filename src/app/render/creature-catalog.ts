/** New presentation descriptors, not recovered original icon assignments. */
export type CreatureFamily = 'unknown' | 'demon' | 'rodent' | 'snake' | 'orc' | 'goblin' | 'kobold' | 'skeleton' | 'ant' | 'canine' | 'spider' | 'creeper' | 'ogre' | 'corpse' | 'lizard' | 'dragon' | 'bat' | 'spirit' | 'scorpion' | 'slime' | 'troll' | 'giant' | 'manticore' | 'caster' | 'vampire' | 'human' | 'boss' | 'bear' | 'elemental' | 'statue' | 'hybrid';
export type ImpactMaterial = 'blood' | 'bone' | 'spirit' | 'slime' | 'stone' | 'ember' | 'ice' | 'dust';
export interface CreatureAppearance {
    family: CreatureFamily;
    color: string;
    rank: number;
    material: ImpactMaterial;
    idle: 'breathe' | 'float' | 'pulse' | 'wings';
}
const RULES: readonly [
    RegExp,
    CreatureFamily,
    string
][] = [
    [/surtur/, 'demon', '#bc6244'], [/devil|fiend/, 'demon', '#986775'],
    [/utgardhalok/, 'boss', '#a28d60'], [/rungnir/, 'boss', '#939a96'], [/thrym/, 'boss', '#8ab6c8'], [/thiassa/, 'boss', '#c8784b'],
    [/hrungnir/, 'boss', '#a79b82'], [/dragon/, 'dragon', '#b65042'], [/manticore/, 'manticore', '#b98b4f'],
    [/rat-man|wolf-man|bear-man|bull-man/, 'hybrid', '#8d7960'], [/scorpion/, 'scorpion', '#be9856'], [/spider/, 'spider', '#827269'],
    [/creeper/, 'creeper', '#9b9c56'], [/snake|viper/, 'snake', '#6fa45d'], [/rat/, 'rodent', '#9b8776'],
    [/goblin/, 'goblin', '#81985b'], [/kobold/, 'kobold', '#ac814e'], [/orc/, 'orc', '#7b9a71'],
    [/skeleton/, 'skeleton', '#c9c2a2'], [/corpse|wight/, 'corpse', '#899579'], [/\bant\b/, 'ant', '#ab614a'],
    [/wolf|dog/, 'canine', '#9b9b91'], [/bear/, 'bear', '#987556'], [/lizard/, 'lizard', '#719555'],
    [/bat/, 'bat', '#9983aa'], [/ghost|spectre|wraith|shadow/, 'spirit', '#a7b7c6'],
    [/glob|slime/, 'slime', '#76b176'], [/ogre/, 'ogre', '#ae9176'], [/troll/, 'troll', '#7b9465'],
    [/giant/, 'giant', '#a2947a'], [/elemental/, 'elemental', '#bb9a70'], [/statue/, 'statue', '#9c9d95'],
    [/necromancer|wizard/, 'caster', '#8d70b2'], [/vampire/, 'vampire', '#ac7b90'],
    [/thief|bandit|warrior|berserker/, 'human', '#a88a67'],
];
export function creatureAppearance(name: string): CreatureAppearance {
    const n = name.toLowerCase();
    // Specific matches precede generic words: "giant ant" must not become a giant.
    const match = RULES.find(([pattern]) => pattern.test(n));
    const family = match?.[1] ?? 'unknown';
    let color = match?.[2] ?? '#b8a99c';
    if (/red|fire|magma/.test(n))
        color = '#c26849';
    else if (/blue|frost|ice/.test(n))
        color = '#7ea9c5';
    else if (/water elemental/.test(n))
        color = '#659bb3';
    else if (/air elemental/.test(n))
        color = '#b3c6c8';
    else if (/white|pale|marble/.test(n))
        color = '#d1d0bb';
    else if (/green/.test(n))
        color = '#699965';
    else if (/bronze/.test(n))
        color = '#b78d50';
    else if (/iron|dark|abyss/.test(n))
        color = '#777f91';
    else if (/wooden|brown/.test(n))
        color = '#94704c';
    const rank = /ancient/.test(n) ? 5 : /very old/.test(n) ? 4 : /old/.test(n) ? 3 : /young adult/.test(n) ? 1 : /young/.test(n) ? 0 : /adult/.test(n) ? 2 : /lord|castle|abyss|fighter|cave/.test(n) ? 2 : 1;
    let material: ImpactMaterial = 'blood';
    if (family === 'skeleton')
        material = 'bone';
    if (family === 'spirit')
        material = 'spirit';
    if (family === 'slime' || family === 'creeper')
        material = 'slime';
    if (family === 'statue')
        material = 'stone';
    if (family === 'elemental')
        material = /magma|fire/.test(n) ? 'ember' : /ice/.test(n) ? 'ice' : 'dust';
    return { family, color, rank, material, idle: family === 'spirit' || family === 'elemental' ? 'float' : family === 'slime' ? 'pulse' : family === 'bat' ? 'wings' : 'breathe' };
}
