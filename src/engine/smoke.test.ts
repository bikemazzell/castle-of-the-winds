import { describe, expect, it } from 'vitest';

describe('toolchain smoke', () => {
  it('runs TypeScript with strict mode features active', () => {
    const xs: ReadonlyArray<number> = [1, 2, 3];
    const total = xs.reduce((a, b) => a + b, 0);
    expect(total).toBe(6);
  });
});
