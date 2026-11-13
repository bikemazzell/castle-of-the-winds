import { expect, it } from 'vitest';
import { chatterLine, CHATTER, npcChatterLine } from './chatter';
it('provides deterministic attributed lines in each context without random calls', () => {
    for (const context of ['combat', 'barter', 'search', 'idle'] as const) {
        expect(CHATTER[context].length).toBeGreaterThanOrEqual(10);
        expect(chatterLine(42, 8, context, 'Ada')).toBe(chatterLine(42, 8, context, 'Ada'));
        expect(chatterLine(42, 8, context, 'Ada')).toMatch(/^Ada: /);
        expect(chatterLine(42, 8, context)).not.toBe(chatterLine(42, 9, context));
    }
});

it('gives human roles distinct, deterministic dialogue without random calls', () => {
    const roles=['traveler','adventurer','peddler','witch','wizard','salvager','shopkeeper'] as const;
    const lines=roles.map(role=>npcChatterLine(42,8,role,'Ada'));
    expect(new Set(lines).size).toBe(roles.length);
    for(const role of roles){
        expect(npcChatterLine(42,8,role,'Ada')).toBe(npcChatterLine(42,8,role,'Ada'));
        expect(npcChatterLine(42,8,role,'Ada')).toMatch(/^Ada: /);
        expect(npcChatterLine(42,8,role,'Ada')).not.toBe(npcChatterLine(42,9,role,'Ada'));
    }
});
