/**
 * Part-1 → Part-2 character import (PART2-PLAN Task P7).
 *
 * The original game continues into Part 2 with your Part 1 character (order
 * info + manual). The port implements that as a save transformation:
 *
 *  1. Validate the source against the PART 1 bundle first — anything that
 *     cannot load as Part 1 is rejected with the validation error.
 *  2. Dead characters stay dead (hp 0 rejected explicitly).
 *  3. Known spells remap by NAME. Part-2 spell ids are slugs (`s-shield`),
 *     part-1 ids are string-table indices (`s323`) — the display name is the
 *     only reliable join. Every spell must map or the import fails loudly.
 *  4. The player (stats, pools, statuses, regen, xp, level, gold via
 *     inventory) and inventory carry verbatim; position resets to the Part 2
 *     town spawn; quests start fresh; a NEW world seed begins the campaign.
 *  5. The result is re-validated against the PART 2 bundle before it is
 *     accepted — no partially-transformed saves escape.
 *
 * The source save is never mutated (deserializeGame rebuilds from a clone).
 */
import { loadWorldData } from '../engine/game';
import { deserializeGame, serializeGame, type SaveFile } from '../engine/save';
import type { WorldData } from '../engine/types';
import { createWorld } from '../engine/world';

export interface ImportOptions {
  /** World seed for the new Part 2 campaign (tests pin this). */
  seed?: number;
  /** Override the source bundle (tests exercise the remap-failure path). */
  data1?: WorldData;
  /** Override the destination bundle. */
  data2?: WorldData;
  /** Fixed timestamp for deterministic saves (tests). */
  savedAt?: string;
}

export type ImportResult = { ok: true; save: SaveFile } | { ok: false; error: string };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function importPart1Character(source: unknown, options: ImportOptions = {}): ImportResult {
  const data1 = options.data1 ?? loadWorldData(1);
  const data2 = options.data2 ?? loadWorldData(2);

  // 1. The source must be a loadable PART 1 save.
  let src;
  try {
    src = deserializeGame(source, data1);
  } catch (err) {
    return { ok: false, error: `not a valid part 1 save: ${message(err)}` };
  }

  // 2. Dead characters cannot travel north.
  if (src.player.hp <= 0) {
    return { ok: false, error: 'dead characters cannot continue — load a living hero first' };
  }

  // 3. Remap every known spell by display name.
  const part2ByName = new Map(Object.values(data2.spells).map((def) => [def.name, def.id]));
  const knownSpells: string[] = [];
  for (const id of src.player.knownSpells) {
    const name = data1.spells[id]?.name ?? `unknown spell ${id}`;
    const mapped = part2ByName.get(name);
    if (mapped === undefined) {
      return { ok: false, error: `spell ${name} (${id}) has no part 2 equivalent` };
    }
    if (!knownSpells.includes(mapped)) knownSpells.push(mapped);
  }

  // 4. Build the Part 2 world: carried player + inventory, fresh quests,
  //    position forced to the town spawn, new seed.
  const player = structuredClone(src.player);
  player.knownSpells = knownSpells;
  const seed = options.seed ?? ((Date.now() >>> 0) || 1);
  const world2 = createWorld({ worldSeed: seed, player, data: data2 });
  world2.inventory = structuredClone(src.inventory);

  // 5. Serialize and re-validate against Part 2 before accepting.
  const save = serializeGame(world2, { savedAt: options.savedAt ?? new Date().toISOString() });
  try {
    deserializeGame(save, data2);
  } catch (err) {
    return { ok: false, error: `imported character failed part 2 validation: ${message(err)}` };
  }
  return { ok: true, save };
}
