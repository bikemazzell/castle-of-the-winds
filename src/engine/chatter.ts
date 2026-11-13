/** Cosmetic dialogue is indexed from immutable inputs, never the combat RNG. */
export const CHATTER = {
    combat: [
        'I preferred you at a distance.', 'That dent was already there.', 'Please form a less violent line.',
        'My shield has filed a complaint.', 'A narrow escape counts as exercise.', 'I should have packed a longer sword.',
        'We can still call this a misunderstanding.', 'That was my second-best sleeve.', 'The bruises are developing character.',
        'I am charging extra for the stairs.', 'Who taught the skeleton footwork?', 'I miss enemies with office hours.',
    ],
    barter: [
        'Does the price include the ominous rattling?', 'I can pay in very specific regrets.', 'Almost new. Only buried once.',
        'The curse costs extra to remove.', 'That is a fine price for someone else.', 'I know a bargain when it bites me.',
        'Can we round down to affordable?', 'No refunds after prophecy.', 'I brought coins, not a kingdom.',
        'The receipt is also a small ward.', 'Locally sourced. Regrettably.', 'I accept gold and sincere overpayment.',
    ],
    search: [
        'Another rock. The collection grows.', 'Dust, with excellent provenance.', 'Someone hid the good dust.',
        'This wall is being evasive.', 'A bone of uncertain ownership.', 'The floor has pockets.',
        'Nothing here except a strong opinion about damp.', 'I have disturbed a historic cobweb.', 'That crack looks employed.',
        'Treasure would improve this corner.', 'At least the rubble is honest.', 'I found where the smell lives.',
    ],
    idle: [
        'The ceiling seems confident.', 'I wonder whether the rats pay rent.', 'Somewhere, a chair is going unused.',
        'My boots remember sunlight.', 'A draft with no obvious employer.', 'This is a lot of stairs for one legend.',
        'The silence has poor manners.', 'I should send the tavern a forwarding address.', 'Even the echoes sound tired.',
        'That mushroom is watching the other mushroom.', 'A quiet minute. I will keep it.', 'I could get used to not being bitten.',
    ],
} as const;
export type ChatterContext = keyof typeof CHATTER;
export function chatterLine(seed: number, turn: number, context: ChatterContext, speaker = 'You'): string {
    const lines = CHATTER[context];
    const offset = ((Math.imul(seed, 2654435761) >>> 0) + Math.max(0, Math.floor(turn))) % lines.length;
    return `${speaker}: ${lines[offset]}`;
}

/** Each human role has its own subject and voice, separate from player quips. */
export const NPC_CHATTER = {
    traveler: [
        'The north road is passable. The innkeeper is less forgiving.',
        'Dry socks are worth more than a prophecy by the third mile.',
        'I follow the milestones. They rarely argue.',
        'Take the road with birds on it. They know something.',
    ],
    adventurer: [
        'Check your straps before the stairs. I learned that loudly.',
        'A shield is cheaper than a replacement arm.',
        'I mark the way out before looking for the way down.',
        'Leave room in your pack for the things worth carrying home.',
    ],
    peddler: [
        'Everything fits in my pockets, including a modest profit.',
        'Fresh stock. I have only dropped it twice.',
        'Browse at your leisure. Buy before my feet get cold.',
        'A small purchase makes a long road shorter for both of us.',
    ],
    witch: [
        'That mushroom is harmless. Its neighbor is a poor listener.',
        'My kettle whistles before trouble. Today it has a sore throat.',
        'Roots keep their promises. People need reminding.',
        'Do not taste a leaf just because it looks pleased with itself.',
    ],
    wizard: [
        'The margin notes are the dangerous part of any spell.',
        'I filed my prophecy under pending. It seems content there.',
        'A little light saves a great deal of impressive guessing.',
        'Sleep is a valid answer to several magical questions.',
    ],
    salvager: [
        'A bent nail is still a nail with experience.',
        'Rust comes off. Bad workmanship takes longer.',
        'People abandon useful things when the screaming starts.',
        'If it rattles, check inside before you sell it by weight.',
    ],
    shopkeeper: [
        'I count the stock each evening. Some of it counts back.',
        'Tell me what you need. I know which shelf is least damp.',
        'The price includes advice. Whether you take it is up to you.',
        'Wipe your boots. The floor has survived enough adventures.',
    ],
} as const;
export type HumanNpcRole = keyof typeof NPC_CHATTER;
export function npcChatterLine(seed: number, turn: number, role: HumanNpcRole, speaker: string): string {
    const lines = NPC_CHATTER[role];
    const offset = ((Math.imul(seed, 2654435761) >>> 0) + Math.max(0, Math.floor(turn))) % lines.length;
    return `${speaker}: ${lines[offset]}`;
}
