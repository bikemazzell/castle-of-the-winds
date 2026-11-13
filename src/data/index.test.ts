// THE DATA GATE (Task 1.10): validates every extracted data file that the
// engine will consume. If this suite is green, Milestone 2 can build against
// src/data/** (and src/data/part2/**) without further checks.
import { describe, expect, it } from 'vitest';
import { terrainPixels } from '../app/render/terrain-art';
import { ITEMS_CONTRACT, MONSTERS_CONTRACT, SPELLS_CONTRACT, validateTableFile } from './table-contract';
import type { ItemsFile, MonstersFile, SpellsFile } from '../engine/types';
import items from './items.json';
import levels from './levels.json';
import manual from './manual.json';
import messages from './messages.json';
import monsters from './monsters.json';
import overworld from './overworld.json';
import part2Items from './part2/items.json';
import part2Levels from './part2/levels.json';
import part2Manifest from './part2/manifest.json';
import part2Messages from './part2/messages.json';
import part2Monsters from './part2/monsters.json';
import part2Shops from './part2/shops.json';
import part2Spells from './part2/spells.json';
import part2Story from './part2/story.json';
import part2Overworld from './part2/overworld.json';
import shops from './shops.json';
import spells from './spells.json';
import tiles from './tiles.json';
import xp from './xp.json';

const HEX64 = /^[0-9a-f]{64}$/;

describe('Part 1 tables (contract validation)', () => {
  it('items.json satisfies ITEMS_CONTRACT', () => {
    const result = validateTableFile(items as unknown as ItemsFile, ITEMS_CONTRACT);
    expect(result.ok, JSON.stringify(result.ok ? null : result.errors)).toBe(true);
  });

  it('monsters.json satisfies MONSTERS_CONTRACT', () => {
    const result = validateTableFile(monsters as unknown as MonstersFile, MONSTERS_CONTRACT);
    expect(result.ok, JSON.stringify(result.ok ? null : result.errors)).toBe(true);
  });

  it('spells.json satisfies SPELLS_CONTRACT', () => {
    const result = validateTableFile(spells as unknown as SpellsFile, SPELLS_CONTRACT);
    expect(result.ok, JSON.stringify(result.ok ? null : result.errors)).toBe(true);
  });

  it('all three carry verified provenance', () => {
    for (const file of [items, monsters, spells]) {
      expect(file.source.sha256).toMatch(HEX64);
      expect(file.source.decoderVersion).toMatch(/./);
    }
  });
});

describe('Part 1 level graph', () => {
  it('has 12 nodes: Crossroads + Mine 1-8 + Fortress 1-3', () => {
    expect(levels.levels).toHaveLength(12);
    expect(levels.levels[0]!.name).toBe('Crossroads');
    expect(levels.levels[1]!.name).toBe('The Mine, Level 1');
    expect(levels.levels[8]!.name).toBe('The Mine, Level 8');
    expect(levels.levels[9]!.name).toBe('The Fortress, Level 1');
    expect(levels.levels[11]!.name).toBe('The Fortress, Level 3');
  });

  it('town links into the mine; levels 1-3 have no up stair (shrine gating)', () => {
    expect(levels.levels[0]!.links.special).toEqual({ kind: 'town-entrance', to: 1 });
    for (let i = 1; i <= 11; i++) {
      const node = levels.levels[i]!;
      expect(node.index).toBe(i);
      expect(node.links.down).toBe(i < 11 ? i + 1 : null);
      expect(node.links.up).toBe(i >= 4 ? i - 1 : null);
      expect(node.upStair).toBe(i >= 4 ? 'generated' : null);
    }
    // walking down from level 1 reaches Hrungnir's Fortress Level 3
    let cur = levels.levels[1]!;
    while (cur.links.down !== null) cur = levels.levels[cur.links.down]!;
    expect(cur.index).toBe(11);
  });
});

describe('Part 1 overworld (Crossroads)', () => {
  const tileById = new Map(tiles.tiles.map((t) => [t.id, t]));
  const rows: number[][] = overworld.rows.map((row: string) =>
    (row.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
  );

  it('is 32x32 of known tile ids', () => {
    expect(overworld.width).toBe(32);
    expect(overworld.height).toBe(32);
    expect(rows).toHaveLength(32);
    const known = new Set(tiles.tiles.map((t) => t.id));
    for (const row of rows) {
      expect(row).toHaveLength(32);
      for (const id of row) expect(known.has(id), `unknown tile id ${id.toString(16)}`).toBe(true);
    }
  });

  it('keeps the original mine stair and a walkable spawn', () => {
    expect(rows[2]![15]).toBe(0x12); // original Mine entrance byte
    expect(rows[overworld.spawn.y]![overworld.spawn.x]).toBe(0x81); // road
  });

  it('can walk from spawn to every shop door and the mine stair', () => {
    const walkable = (id: number) => tileById.get(id)?.walkable === true;
    const seen = new Set<string>();
    const queue: Array<[number, number]> = [[overworld.spawn.x, overworld.spawn.y]];
    while (queue.length > 0) {
      const [x, y] = queue.shift()!;
      const key = `${x},${y}`;
      if (seen.has(key) || x < 0 || y < 0 || x >= 32 || y >= 32) continue;
      if (!walkable(rows[y]![x]!)) continue;
      seen.add(key);
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    for (const building of overworld.buildings) {
      expect(seen.has(`${building.door.x},${building.door.y}`), building.name).toBe(true);
    }
    expect(seen.has('15,2')).toBe(true); // mine stair
  });
});

describe('Part 1 cross-file references', () => {
  it('every non-stair tile has new procedural art', () => {
    for (const tile of tiles.tiles.filter(t => !t.name.startsWith('stairs'))) {
      expect(terrainPixels(tile.sprite).length, tile.name).toBeGreaterThan(5);
    }
  });

  it('every shop stock id and building shopId resolves', () => {
    const itemIds = new Set(items.records.map((r) => r.id));
    const shopIds = new Set(shops.shops.map((s) => s.id));
    for (const shop of shops.shops) {
      for (const id of shop.stock) expect(itemIds.has(id), `${shop.id} stock ${id}`).toBe(true);
    }
    for (const building of overworld.buildings) {
      expect(shopIds.has(building.shopId), building.shopId).toBe(true);
    }
    expect(shops.shops).toHaveLength(8);
    expect(overworld.buildings).toHaveLength(8);
  });

  it('xp curve is a 25-entry non-decreasing table', () => {
    expect(xp.thresholds).toHaveLength(25);
    expect(xp.thresholds[1]).toBe(0);
    for (let i = 2; i < xp.thresholds.length; i++) {
      expect(xp.thresholds[i]!).toBeGreaterThan(xp.thresholds[i - 1]!);
    }
  });

  it('messages.json carries provenance and 900+ messages', () => {
    expect(messages.source.sha256).toMatch(HEX64);
    expect(Object.keys(messages.messages).length).toBeGreaterThanOrEqual(900);
  });

  it('manual.json has 100+ topics', () => {
    expect(manual.topics.length).toBeGreaterThanOrEqual(100);
  });
});

describe('Part 2 dry-run bundle', () => {
  it('tables satisfy their contracts', () => {
    expect(validateTableFile(part2Items as unknown as ItemsFile, ITEMS_CONTRACT).ok).toBe(true);
    expect(validateTableFile(part2Monsters as unknown as MonstersFile, MONSTERS_CONTRACT).ok).toBe(true);
    expect(validateTableFile(part2Spells as unknown as SpellsFile, SPELLS_CONTRACT).ok).toBe(true);
  });

  it('counts meet or beat the Part-1 equivalents', () => {
    expect(Object.keys(part2Messages.messages).length).toBeGreaterThanOrEqual(
      Object.keys(messages.messages).length,
    );
    expect(part2Manifest.counts.topics).toBeGreaterThanOrEqual(manual.topics.length);
    expect(part2Manifest.counts.items).toBeGreaterThanOrEqual(items.records.length);
    expect(part2Manifest.counts.monsters).toBeGreaterThanOrEqual(monsters.records.length);
    expect(part2Manifest.counts.spells).toBeGreaterThanOrEqual(spells.records.length);
    expect(part2Manifest.counts.levels).toBeGreaterThanOrEqual(levels.levels.length);
  });

  it('icons scanned at Part-1 scale without asset writes', () => {
    expect(part2Manifest.icons.candidates).toBeGreaterThanOrEqual(491);
    expect(part2Manifest.icons.unique).toBeGreaterThanOrEqual(430);
    expect(part2Manifest.icons.allSize32).toBe(true);
  });

  it('level graph is Crossroads + 25 castle levels ending at the throne room', () => {
    expect(part2Levels.levels).toHaveLength(26);
    expect(part2Levels.levels.filter((l) => l.kind === 'castle')).toHaveLength(25);
    expect(part2Levels.levels[0]!.links.special).toEqual({ kind: 'town-entrance', to: 1 });
    expect(part2Levels.levels[25]!.links.down).toBeNull();
    let cur = part2Levels.levels[1]!;
    while (cur.links.down !== null) cur = part2Levels.levels[cur.links.down]!;
    expect(cur.index).toBe(25);
  });

  it('roster swaps Part-1 bosses for Part-2 bosses', () => {
    const names = new Set(part2Monsters.records.map((r) => r.name));
    expect(names.has('Hrungnir, The Hill Giant Lord')).toBe(false);
    expect(names.has('Surtur')).toBe(true);
    expect(names.has('The Demon Lord Surtur')).toBe(true);
  });

  it('manifest is hash-bound to the shipped CASTLE2 binaries', () => {
    expect(part2Manifest.source.sha256).toBe(
      'a056ac0947c967a26e6c5ece67893b7f6562611ef08736f87ab1d96c2d05da2e',
    );
    expect(part2Manifest.source.md5).toBe('00a949e0674d46f5f2872c92e5029347');
  });
});

describe('campaign data (Task 5.6)', () => {
  it('story.json has 15 texts hash-bound to CASTLE1.EXE', async () => {
    const story = (await import('./story.json')).default as {
      source: { sha256: string };
      texts: Record<string, string>;
    };
    expect(Object.keys(story.texts)).toHaveLength(15);
    expect(story.source.sha256).toBe(
      'e90d202717882449196cc087bc2231d2c94a17a553c4b5dfa4c91ed4c718c3b0',
    );
    expect(story.texts['15']).toContain('Here ends Part One');
  });

  it('quests.json quest covers the Part 1 arc and validates against levels + monsters', async () => {
    const quests = (await import('./quests.json')).default as {
      quests: {
        title: string;
        boss: { level: number; monster: string; guards: { name: string; count: number }[] };
        victoryStoryText: number;
        stages: { id: string; trigger: { kind: string; level?: number; name?: string }; optional?: boolean }[];
      }[];
      gaps: unknown[];
    };
    expect(quests.quests).toHaveLength(1);
    const q = quests.quests[0]!;    expect(q.title).toBe('A Question of Vengeance');
    expect(q.stages.map((s) => s.id)).toEqual([
      'intro', 'mine-bottom', 'homecoming', 'fortress', 'chests', 'confrontation', 'magic-ward', 'victory',
    ]);
    // Stage levels exist in the level graph.
    const levelIndexes = new Set(levels.levels.map((l) => l.index));
    for (const s of q.stages) {
      if (s.trigger.kind === 'level-reached') expect(levelIndexes.has(s.trigger.level!)).toBe(true);
    }
    // Boss + guards exist in the monster roster.
    const names = new Set(monsters.records.map((r) => r.name));
    expect(names.has(q.boss.monster)).toBe(true);
    for (const g of q.boss.guards) expect(names.has(g.name)).toBe(true);
    // Boss level is the deepest node.
    const deepest = Math.max(...levels.levels.map((l) => l.index));
    expect(q.boss.level).toBe(deepest);
    expect(quests.gaps.length).toBeGreaterThan(0); // honest about APPROX triggers
  });
});

describe('part2 world data (PART2-PLAN Task P1)', () => {
  it('ships all 26 castle story texts, hash-bound, with verified anchors', () => {
    const ids = Object.keys(part2Story.texts).map(Number).sort((a, b) => a - b);
    expect(ids).toHaveLength(26);
    expect(ids[0]).toBe(1);
    expect(ids[25]).toBe(26);
    for (let i = 1; i <= 26; i++) {
      expect(ids[i - 1]).toBe(i); // contiguous
    }
    expect(part2Story.source.sha256).toBe(
      'a056ac0947c967a26e6c5ece67893b7f6562611ef08736f87ab1d96c2d05da2e',
    );
    expect(part2Story.texts['1']).toMatch(/amulet/i);
    expect(part2Story.texts['24']).toMatch(/Surtur/);
    expect(part2Story.texts['26']).toMatch(/Helm/);
  });

  it('part2 overworld is a valid town grid with the castle entrance and nine shops', () => {
    expect(part2Overworld.width).toBe(32);
    expect(part2Overworld.height).toBe(32);
    expect(part2Overworld.rows).toHaveLength(32);
    for (const row of part2Overworld.rows) expect(row).toMatch(/^[0-9a-f]{64}$/);
    const at = (x: number, y: number): string => part2Overworld.rows[y]!.slice(x * 2, x * 2 + 2);
    expect(at(part2Overworld.mineEntrance.x, part2Overworld.mineEntrance.y)).toBe('12');
    expect(at(part2Overworld.spawn.x, part2Overworld.spawn.y)).toBe('81');
    expect(part2Overworld.buildings).toHaveLength(9);
    for (const b of part2Overworld.buildings) {
      expect(at(b.door.x, b.door.y)).toBe('85');
    }
  });

  it('part2 shops pair with the overworld buildings and stock only known items', () => {
    const itemIds = new Set(items.records.map((r) => r.id));
    expect(new Set(part2Shops.shops.map((s) => s.id))).toEqual(
      new Set(part2Overworld.buildings.map((b) => b.shopId)),
    );
    const alchemy = part2Shops.shops.find((s) => s.id === 'ingrid');
    expect(alchemy?.kind).toBe('alchemy');
    for (const shop of part2Shops.shops) {
      for (const itemId of shop.stock) {
        expect(itemIds.has(itemId), `${shop.id} stocks unknown ${itemId}`).toBe(true);
      }
    }
  });
});
