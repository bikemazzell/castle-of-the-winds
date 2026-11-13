import type { Level, NpcRole } from './map';
import { levelGenSeed, MSLCG } from './rng';
import type { World } from './world';

const GIVEN_NAMES = [
    'Mara', 'Orrin', 'Pella', 'Brindle', 'Fenn', 'Tavi', 'Ada', 'Bram',
    'Cora', 'Della', 'Edric', 'Flora', 'Galen', 'Hester', 'Ivo', 'Jora',
    'Kelda', 'Larkin', 'Merrit', 'Nessa', 'Oswin', 'Petra', 'Quill', 'Runa',
    'Sella', 'Tobin', 'Una', 'Vera', 'Willa', 'Yarrow', 'Zella', 'Ansel',
] as const;
const FAMILY_NAMES = [
    'Alder', 'Bell', 'Cress', 'Dale', 'Elm', 'Finch', 'Grove', 'Hale',
    'Ives', 'Kettle', 'Lark', 'Moss', 'Nettle', 'Oak', 'Pike', 'Reed',
    'Sedge', 'Thorne', 'Vale', 'Wren', 'Yew', 'Brook', 'Flint', 'Hearth',
    'Ash', 'Barley', 'Copper', 'Dew', 'Field', 'Glen', 'Hill', 'Marsh',
] as const;
const TITLES: Record<NpcRole, string> = {
    traveler: 'Wayfarer', adventurer: 'Adventurer', peddler: 'Peddler',
    witch: 'Witch', wizard: 'Wizard', salvager: 'Salvager',
    shopkeeper: 'Shopkeeper', ghost: 'Ghost', critter: 'Cellar Mouse',
};

/** Names use a separate cosmetic stream and live in the saved entity record. */
export function proceduralNpcName(world: World, level: Level, id: number, role: NpcRole): string {
    const used = new Set<string>();
    // Include the supplied floor even when its caller has not added it to the world yet.
    for (const floor of new Set([...world.levels.values(), level])) {
        for (const entity of floor.entities.values()) used.add(entity.name.toLowerCase());
    }
    const rng = new MSLCG(levelGenSeed(world.worldSeed, level.index) ^ Math.imul(id, 0x45d9f3b) ^ 0x6e616d65);
    const combinations = GIVEN_NAMES.length * FAMILY_NAMES.length;
    const start = rng.rand(combinations);
    for (let attempt = 0; ; attempt++) {
        const choice = (start + attempt) % combinations;
        const given = GIVEN_NAMES[choice % GIVEN_NAMES.length]!;
        const family = FAMILY_NAMES[Math.floor(choice / GIVEN_NAMES.length)]!;
        const generation = Math.floor(attempt / combinations);
        const suffix = generation ? ` ${generation + 1}` : '';
        const name = `${given} ${family}${suffix} the ${TITLES[role]}`;
        if (!used.has(name.toLowerCase())) return name;
    }
}
