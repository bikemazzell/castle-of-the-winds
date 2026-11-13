import { describe, expect, it } from 'vitest';

import { MSLCG } from './rng';

describe('MSLCG (MSVC rand)', () => {
  it('matches the MSVC rand() known sequence for seed 1', () => {
    const rng = new MSLCG(1);
    const knowns = [
      41, 18467, 6334, 26500, 19169, 15724, 11478, 29358, 26962, 24464,
    ];
    expect(knowns.map(() => rng.next())).toEqual(knowns);
  });

  it('produces 15-bit outputs only', () => {
    const rng = new MSLCG(12345);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0x7fff);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('rand(n) stays in [0, n) and covers more than one value', () => {
    const rng = new MSLCG(7);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.rand(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
      seen.add(v);
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it('rand(1) is always 0', () => {
    const rng = new MSLCG(99);
    for (let i = 0; i < 100; i++) expect(rng.rand(1)).toBe(0);
  });

  it('wraps modulo 2^32 exactly (BigInt cross-check, seed 0xFFFFFFFF)', () => {
    const rng = new MSLCG(0xffffffff);
    let s = 0xffffffffn;
    for (let i = 0; i < 50; i++) {
      s = (s * 214013n + 2531011n) % 4294967296n;
      expect(rng.next()).toBe(Number((s >> 16n) & 0x7fffn));
    }
  });

  it('state is inspectable and restorable (for save games)', () => {
    const a = new MSLCG(42);
    a.next();
    a.next();
    const snapshot = a.getState();
    const expected = [a.next(), a.next(), a.next()];

    const b = new MSLCG(0);
    b.setState(snapshot);
    expect([b.next(), b.next(), b.next()]).toEqual(expected);
  });

  it('different seeds diverge', () => {
    const a = new MSLCG(1);
    const b = new MSLCG(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });
});
