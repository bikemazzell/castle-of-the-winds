/** A local integer mix selects cosmetic words without consuming any random stream. */
function mix(value: number): number {
  let bits = value | 0;
  bits = Math.imul(bits ^ (bits >>> 16), 0x45d9f3b);
  bits = Math.imul(bits ^ (bits >>> 16), 0x45d9f3b);
  return (bits ^ (bits >>> 16)) >>> 0;
}

function stumble(word: string, variant: number): string {
  if (variant % 3 === 1) {
    // Drawn-out vowels and a soft sibilant preserve the original word's letters.
    if (/[sS]/.test(word)) return word.replace(/[sS]/, letter => `${letter}h`);
    if (/[aeiou]/i.test(word)) return word.replace(/[aeiou]/i, letter => `${letter}${letter.toLowerCase()}`);
  }
  if (variant % 3 === 2 && word.length >= 4) {
    const split = Math.floor(word.length / 2);
    return `${word.slice(0, split)}-${word.slice(split)}`;
  }
  return `${word[0]}-${word}`;
}

/**
 * Current health controls speech clarity; healing automatically restores it.
 * Below 75%, 50%, and 25% HP, distort 18%, 40%, and 65% of spoken words.
 * Names, spacing, punctuation, and original word letters stay intact. The same
 * seed and sequence select nested word sets as health falls, without world RNG.
 */
export function garbleSpeech(line: string, hp: number, maxHp: number, seed: number, sequence: number): string {
  if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0) return line;
  const fraction = Math.max(0, hp) / maxHp;
  if (fraction >= 0.75) return line;
  const portion = fraction >= 0.5 ? 0.18 : fraction >= 0.25 ? 0.4 : 0.65;
  const colon = line.indexOf(': ');
  const prefix = colon < 0 ? '' : line.slice(0, colon + 2);
  const text = line.slice(prefix.length);
  const pattern = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
  const words = [...text.matchAll(pattern)];
  if (!words.length) return line;
  const safeSeed = Number.isFinite(seed) ? seed | 0 : 0;
  const safeSequence = Number.isFinite(sequence) ? sequence | 0 : 0;
  const key = mix(safeSeed ^ Math.imul(safeSequence, 0x9e3779b1));
  const ranked = words.map((_, index) => ({ index, rank: mix(key ^ Math.imul(index + 1, 0x85ebca6b)) }));
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  const selected = new Set(ranked.slice(0, Math.ceil(words.length * portion)).map(word => word.index));
  let index = 0;
  return prefix + text.replace(pattern, word => {
    const current = index++;
    return selected.has(current) ? stumble(word, mix(key ^ current)) : word;
  });
}
