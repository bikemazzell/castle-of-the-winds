import { CURSE_LINES } from '../data/speech/curses';
import { speechIndex } from './speech';
export { CURSE_LINES };
export type CurseContext = keyof typeof CURSE_LINES;

/** Optional dialogue never advances world time or consumes game randomness. */
export function curseLine(seed: number, sequence: number, context: CurseContext, speaker: string): string {
    const lines = CURSE_LINES[context];
    return `${speaker}: ${lines[speechIndex(lines.length, seed, sequence, context)]}`;
}
