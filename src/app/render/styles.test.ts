import { describe, expect, it } from 'vitest';
import { buildTileStyles, loadSprites, spriteNamesFor } from './styles';

describe('buildTileStyles', () => {
  it('maps tile bytes to sprite styles', () => {
    const tiles = [
      { id: 0, sprite: 'bm120' },
      { id: 1, sprite: 'bm124' },
      { id: 18, sprite: 'bm221' },
    ];
    const styles = buildTileStyles(tiles);
    expect(styles['0']?.sprite).toBe('bm120');
    expect(styles['1']?.sprite).toBe('bm124');
    expect(styles['18']?.sprite).toBe('bm221');
  });

  it('omits the sprite link for tiles without art', () => {
    const styles = buildTileStyles([{ id: 130 }, { id: 131, sprite: null }]);
    expect(styles['130']?.sprite).toBeNull();
    expect(styles['131']?.sprite).toBeNull();
  });

  it('collects unique sprite names for loading', () => {
    const names = spriteNamesFor([
      { id: 0, sprite: 'bm120' },
      { id: 1, sprite: 'bm124' },
      { id: 18, sprite: 'bm120' },
      { id: 130 },
    ]);
    expect(names).toEqual(['bm120', 'bm124']);
  });
});

describe('loadSprites', () => {
  it('loads each name via the injected image loader', async () => {
    const requested: string[] = [];
    const sprites = await loadSprites(['bm120', 'bm124'], (name) => {
      requested.push(name);
      return Promise.resolve(`img:${name}`);
    });
    expect(requested).toEqual(['bm120', 'bm124']);
    expect(sprites['bm120']).toBe('img:bm120');
    expect(sprites['bm124']).toBe('img:bm124');
  });

  it('skips names whose image fails to load (fallback colors render)', async () => {
    const sprites = await loadSprites(['bm120', 'bm999'], (name) =>
      name === 'bm999' ? Promise.reject(new Error('404')) : Promise.resolve(`img:${name}`),
    );
    expect(sprites['bm120']).toBe('img:bm120');
    expect(sprites['bm999']).toBeUndefined();
  });
});
