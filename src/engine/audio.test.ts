import { describe, expect, it } from 'vitest';
import { silentAudio } from './audio';

describe('silentAudio hook', () => {
  it('exposes a no-op playSfx that never throws', () => {
    expect(() => silentAudio.playSfx('hit')).not.toThrow();
    expect(() => silentAudio.playSfx('stairs')).not.toThrow();
  });
});
