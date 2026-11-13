import { expect, it, vi } from 'vitest';
import { garbleSpeech } from './injured-speech';
import { MSLCG } from './rng';

const line = 'Sigrun the Bold: These stubborn bastards should respect the sharp sword before them!';
const words = (text: string) => text.slice(text.indexOf(': ') + 2).split(' ');
const changes = (text: string) => words(text).flatMap((word, index) => word !== words(line)[index] ? [index] : []);

it('changes more words as health falls and restores clarity when healed', () => {
  const slight = garbleSpeech(line, 74, 100, 42, 3);
  const wounded = garbleSpeech(line, 49, 100, 42, 3);
  const critical = garbleSpeech(line, 24, 100, 42, 3);
  expect(changes(slight).length).toBeGreaterThan(0);
  expect(changes(wounded).length).toBeGreaterThan(changes(slight).length);
  expect(changes(critical).length).toBeGreaterThan(changes(wounded).length);
  expect(changes(wounded)).toEqual(expect.arrayContaining(changes(slight)));
  expect(changes(critical)).toEqual(expect.arrayContaining(changes(wounded)));
  expect(garbleSpeech(line, 74, 100, 42, 3)).toBe(slight);
  expect(garbleSpeech(line, 100, 100, 42, 3)).toBe(line);
});

it('preserves speaker names and punctuation while producing recognizable syllables', () => {
  const result = garbleSpeech(line, 1, 100, 7, 9);
  expect(result).toMatch(/^Sigrun the Bold: /);
  expect(result).toMatch(/!$/);
  expect(result).not.toMatch(/[^A-Za-z :!'-]/);
  expect(words(result)).toHaveLength(words(line).length);
  for (const [index, word] of words(result).entries()) {
    const original = words(line)[index]!.replace(/[^a-z]/gi, '').toLowerCase();
    const spoken = word.replace(/[^a-z]/gi, '').toLowerCase();
    let cursor = 0;
    for (const letter of spoken) if (letter === original[cursor]) cursor++;
    expect(cursor).toBe(original.length);
  }
});

it('handles thresholds, short speech, missing prefixes, and invalid health safely', () => {
  for (const hp of [75, 100, 120]) expect(garbleSpeech(line, hp, 100, 1, 1)).toBe(line);
  for (const [hp, maxHp] of [[NaN, 100], [Infinity, 100], [1, NaN], [1, Infinity], [1, 0], [1, -1]]) {
    expect(garbleSpeech(line, hp!, maxHp!, 1, 1)).toBe(line);
  }
  expect(garbleSpeech('', 0, 100, 1, 1)).toBe('');
  expect(garbleSpeech('Ghost: ...', 0, 100, 1, 1)).toBe('Ghost: ...');
  expect(garbleSpeech('No!', 0, 100, 1, 1)).not.toBe('No!');
  expect(garbleSpeech(line, -10, 100, 1, 1)).toBe(garbleSpeech(line, 0, 100, 1, 1));
  expect(garbleSpeech(line, 10, 100, NaN, Infinity)).toBe(garbleSpeech(line, 10, 100, 0, 0));
});

it('is deterministic cosmetic text and consumes no gameplay or platform randomness', () => {
  const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('cosmetic RNG leak'); });
  const next = vi.spyOn(MSLCG.prototype, 'next').mockImplementation(() => { throw new Error('gameplay RNG leak'); });
  try {
    const variants = new Set<string>();
    for (let sequence = 0; sequence < 30; sequence++) {
      const result = garbleSpeech(line, 20, 100, 123, sequence);
      expect(result).toBe(garbleSpeech(line, 20, 100, 123, sequence));
      variants.add(result);
    }
    expect(variants.size).toBeGreaterThan(1);
    expect(random).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  } finally {
    random.mockRestore();
    next.mockRestore();
  }
});
