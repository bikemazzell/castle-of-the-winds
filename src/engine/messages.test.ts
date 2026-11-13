import { describe, expect, it } from 'vitest';

import messagesJson from '../data/part1/messages.json';
import { createMessageBook, formatMessage } from './messages';

describe('formatMessage (original %t/%i templating)', () => {
  it('replaces %t with the article phrase and each %i with the next argument', () => {
    expect(formatMessage("You crush %t%i's skull into jelly.", { t: 'the ', args: ['kobold'] })).toBe(
      "You crush the kobold's skull into jelly.",
    );
  });

  it('pops %i arguments in order (multiple %i)', () => {
    // Original: "The %i breathes %i!" → "The red dragon breathes fire!"
    expect(formatMessage('The %i breathes %i!', { args: ['red dragon', 'fire'] })).toBe(
      'The red dragon breathes fire!',
    );
    // Original: "%t%i %i you!" → "The kobold bites you!"
    expect(formatMessage('%t%i %i you!', { t: 'the ', args: ['kobold', 'bites'] })).toBe(
      'The kobold bites you!',
    );
  });

  it('capitalizes the first letter of the rendered sentence', () => {
    expect(formatMessage('%t%i is dead!', { t: 'the ', args: ['kobold'] })).toBe('The kobold is dead!');
    // Already-capitalized sentences stay untouched.
    expect(formatMessage('You hit %t%i!', { t: 'the ', args: ['kobold'] })).toBe('You hit the kobold!');
  });

  it('substitutes %d with the number and leaves exhausted %i empty', () => {
    expect(formatMessage('%t%i attacks you %d times and misses!', { t: 'the ', args: ['kobold'], d: 3 })).toBe(
      'The kobold attacks you 3 times and misses!',
    );
    // Exhausted argument list → empty string (trailing %i in original strings).
    expect(formatMessage('The %i hit %t%i!', { t: 'the ', args: ['fire ball'] })).toBe(
      'The fire ball hit the !',
    );
  });

  it('leaves unknown format codes untouched and collapses %% (original "%d%% / %d%%")', () => {
    expect(formatMessage('100%% sure %q stays', {})).toBe('100% sure %q stays');
    expect(formatMessage('%d%% / %d%%', { d: 75 })).toBe('75% / 75%');
  });
});

describe('MessageBook (messages.json)', () => {
  const book = createMessageBook(messagesJson.messages);

  it('exposes texts by id and resolves ids by exact text (byte-match)', () => {
    const id = book.idFor('The dragon breath hits %t%i!');
    expect(id).not.toBeNull();
    expect(book.text(id!)).toBe('The dragon breath hits %t%i!');
  });

  it('returns null for texts that are not original messages', () => {
    expect(book.idFor('This string is not in the game.')).toBeNull();
  });

  it('contains the combat message families combat.ts draws from', () => {
    for (const text of [
      "You crush %t%i's skull into jelly.",
      '%t%i is dead!',
      'You miss %t%i by a league!',
      '%t%i missed you!',
      'The %i hit the wall!',
      '%t%i resists the attack!',
    ]) {
      expect(book.idFor(text), text).not.toBeNull();
    }
  });

  it('every combat.ts pool string and verb is a verbatim original', async () => {
    const combat = await import('./combat');
    const pools = [
      combat.KILL_MESSAGES,
      combat.PLAYER_HIT_MESSAGES,
      combat.PLAYER_MISS_MESSAGES,
      combat.MONSTER_HIT_VERBS,
    ];
    for (const pool of pools) {
      for (const text of pool) {
        expect(book.idFor(text), text).not.toBeNull();
      }
    }
    for (const text of [
      'Killed by %y%i',
      'The %i breathes %i!',
      'The dragon breath hits %t%i!',
      'The %i hit %t%i!',
      'The %i misses %t%i!',
      '%t%i %i you!',
    ]) {
      expect(book.idFor(text), text).not.toBeNull();
    }
  });
});
