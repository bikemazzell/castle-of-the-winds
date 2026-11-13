/**
 * MSVC-compatible linear congruential generator (the `rand()` the original
 * Castle of the Winds linked against, per shrine reverse-engineering notes:
 * state = state * 214013 + 2531011, output = (state >>> 16) & 0x7FFF).
 *
 * Bit-exact reproduction matters: level layouts and gameplay rolls must match
 * what the original binary would have produced for the same seed.
 */
const MULT = 214013;
const ADD = 2531011;

export class MSLCG {
  private state: number;

  constructor(seed: number) {
    // Fold the seed into an unsigned 32-bit state.
    this.state = seed >>> 0;
  }

  /** Advance the generator; returns a 15-bit value like MSVC rand(). */
  next(): number {
    // Math.imul keeps the multiply exact in 32 bits; + ADD then >>> 0 wraps.
    this.state = (Math.imul(this.state, MULT) + ADD) >>> 0;
    return (this.state >>> 16) & 0x7fff;
  }

  /** Uniform integer in [0, n). n must be a positive integer. */
  rand(n: number): number {
    if (!Number.isInteger(n) || n <= 0) {
      throw new RangeError(`rand(n): n must be a positive integer, got ${n}`);
    }
    return this.next() % n;
  }

  /** Uniform integer in [min, max] inclusive. */
  randRange(min: number, max: number): number {
    if (max < min) throw new RangeError(`randRange(${min}, ${max})`);
    return min + this.rand(max - min + 1);
  }

  /** Current raw 32-bit state (for save games). */
  getState(): number {
    return this.state;
  }

  /** Restore a state previously captured with {@link getState}. */
  setState(state: number): void {
    this.state = state >>> 0;
  }
}

/** Derive the dedicated per-level generation seed from a world seed. */
export function levelGenSeed(worldSeed: number, levelIndex: number): number {
  // 32-bit fold of worldSeed * 7919 + levelIndex (dedicated generation RNG so
  // regeneration never depends on gameplay rolls).
  return (Math.imul(worldSeed, 7919) + levelIndex) >>> 0;
}
