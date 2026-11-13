/**
 * Tile-style + sprite plumbing for the canvas renderer: turns the extracted
 * tiles.json sprite links into RenderStyles, and loads the raw PNG art
 * through an injectable image loader (tests pass fakes; the app uses Image).
 */

import type { RenderStyles, TileStyle } from './renderer';

export interface TileDefLike {
  id: number;
  sprite?: string | null;
}

/** tile byte (decimal string) -> { sprite } mapping for renderFrame. */
export function buildTileStyles(tiles: TileDefLike[]): RenderStyles['tiles'] {
  const styles: Record<string, TileStyle> = {};
  for (const tile of tiles) styles[String(tile.id)] = { sprite: tile.sprite ?? null };
  return styles;
}

/** Unique sprite names referenced by the tile set (load order preserved). */
export function spriteNamesFor(tiles: TileDefLike[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const tile of tiles) {
    if (!tile.sprite || seen.has(tile.sprite)) continue;
    seen.add(tile.sprite);
    names.push(tile.sprite);
  }
  return names;
}

/**
 * Load sprites by name. Individual failures are skipped (the renderer falls
 * back to flat colors for tiles without art) — a missing asset must never
 * take the game down.
 */
export async function loadSprites(
  names: string[],
  loadImg: (name: string) => Promise<unknown>,
): Promise<Record<string, unknown>> {
  const sprites: Record<string, unknown> = {};
  await Promise.all(
    names.map(async (name) => {
      try {
        sprites[name] = await loadImg(name);
      } catch {
        // skipped: fallback color renders instead
      }
    }),
  );
  return sprites;
}
