import { CHATTER } from '../data/speech/chatter';
import { NPC_CHATTER } from '../data/speech/npcs';
import { speechIndex } from './speech';
export { CHATTER, NPC_CHATTER };
export type ChatterContext = keyof typeof CHATTER;
export type HumanNpcRole = Exclude<keyof typeof NPC_CHATTER, 'ghost' | 'critter'>;

/** Cosmetic dialogue never consumes combat randomness. */
export function chatterLine(seed: number, sequence: number, context: ChatterContext, speaker = 'You'): string {
    const lines = CHATTER[context];
    return `${speaker}: ${lines[speechIndex(lines.length, seed, sequence, `${context}:${speaker}`)]}`;
}

export function npcChatterLine(seed: number, sequence: number, role: keyof typeof NPC_CHATTER, speaker: string): string {
    const lines = NPC_CHATTER[role];
    return `${speaker}${role === 'critter' ? ' ' : ': '}${lines[speechIndex(lines.length, seed, sequence, role)]}`;
}
