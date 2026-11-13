import { describe, expect, it } from 'vitest';
import spellsFile from '../data/spells.json';
import { createEmptyLevel, idx, type Level } from './map';
import type { Player } from './types';
import { MSLCG } from './rng';
import { createCharacter } from './character';
import { TILE_STAIRS_UP, TILE_WALL, TILE_FLOOR } from './dungeon';
import {
  ballImpactArea,
  boltPath,
  canCast,
  loadSpellDefs,
  manaCostFor,
  rollDamage,
  runeOfReturnTarget,
  teleportDestination,
} from './spells';

const defs = loadSpellDefs(spellsFile);

function player(overrides: Partial<Player> = {}): Player {
  return {
    ...createCharacter({
      name: 'T',
      gender: 'male',
      strength: 50,
      intelligence: 50,
      constitution: 50,
      dexterity: 50,
      difficulty: 'intermediate',
    }),
    x: 5,
    y: 5,
    ...overrides,
  };
}

/** 64×64 fixture: open floor cross-section, wall column at x=40, up-stairs far corner. */
function fixtureLevel(): Level {
  const level = createEmptyLevel(1);
  for (let y = 10; y < 20; y++) {
    for (let x = 30; x < 50; x++) {
      level.tiles[idx(x, y)] = x === 40 ? TILE_WALL : TILE_FLOOR;
    }
  }
  level.tiles[idx(45, 18)] = TILE_STAIRS_UP;
  return level;
}

describe('loadSpellDefs (real spells.json)', () => {
  it('adapts all 34 spells with curated effect kinds', () => {
    expect(Object.keys(defs)).toHaveLength(34);
    for (const def of Object.values(defs)) {
      expect(def.effect, def.name).toBeTruthy();
    }
  });

  it('maps the offensive geometry spells with elements', () => {
    expect(defs['s510']!.effect).toBe('missile'); // MAGIC ARROW
    expect(defs['s522']!.effect).toBe('bolt'); // COLD BOLT
    expect(defs['s522']!.element).toBe('cold');
    expect(defs['s523']!.effect).toBe('bolt'); // LIGHTNING BOLT
    expect(defs['s523']!.element).toBe('lightning');
    expect(defs['s527']!.effect).toBe('ball'); // FIREBALL
    expect(defs['s527']!.element).toBe('fire');
    expect(defs['s525']!.effect).toBe('ball'); // COLD BALL
  });

  it('marks the four non-character spells as monster-only', () => {
    const ai = Object.values(defs).filter((d) => d.effect === 'monster_ai');
    expect(ai.map((d) => d.name).sort()).toEqual([
      'CLONE MONSTER',
      'CREATE TRAPS',
      'HASTE MONSTER',
      'TELEPORT AWAY',
    ]);
    for (const d of ai) expect(d.target).toBeNull();
  });

  it('carries tier and base mana (gaps as null)', () => {
    expect(defs['s510']!.tier).toBe(1);
    expect(defs['s510']!.baseMana).toBe(1);
    expect(defs['s527']!.baseMana).toBe(5);
    expect(defs['s817']!.tier).toBe(3); // SLEEP MONSTER
  });

  it('self-target spells include healing and buffs', () => {
    expect(defs['s512']!.target).toBe('self'); // HEAL MINOR WOUNDS
    expect(defs['s323']!.target).toBe('self'); // SHIELD
    expect(defs['s646']!.effect).toBe('resist'); // RESIST FIRE
  });
});

describe('canCast / manaCostFor', () => {
  it('requires the spell to be learned', () => {
    const p = player({ knownSpells: [] });
    const r = canCast(defs['s510']!, p);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/learn/i);
  });

  it('requires enough mana at the level-adjusted cost', () => {
    const p = player({ level: 1, mana: 1, knownSpells: ['s510'] });
    expect(canCast(defs['s510']!, p).ok).toBe(true);
    const poor = player({ level: 1, mana: 0, knownSpells: ['s510'] });
    const r = canCast(defs['s510']!, poor);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/mana/i);
  });

  it('monster-only spells are never castable by the player', () => {
    const p = player({ mana: 99, knownSpells: ['s819'] });
    expect(canCast(defs['s819']!, p).ok).toBe(false);
  });

  it('cost uses spellManaCost(tier vs level)', () => {
    const p = player({ level: 4 });
    expect(manaCostFor(defs['s527']!, p)).toBe(5); // Fireball t4 at level 4
    const low = player({ level: 1 });
    expect(manaCostFor(defs['s527']!, low)).toBe(8); // above level surcharge
  });
});

describe('bolt path geometry', () => {
  it('walks a straight line and stops at walls (impact tile included)', () => {
    const level = fixtureLevel();
    const path = boltPath(level, { x: 32, y: 15 }, { x: 48, y: 15 });
    // Wall column at x=40: last floor tile is x=39; impact shown at x=40.
    expect(path.at(-1)!.x).toBe(40);
    expect(path.every((p) => p.y === 15)).toBe(true);
    expect(path[0]!.x).toBe(33);
  });

  it('reaches an unobstructed target exactly', () => {
    const level = fixtureLevel();
    const path = boltPath(level, { x: 32, y: 15 }, { x: 36, y: 15 });
    expect(path.at(-1)!.x).toBe(36);
    expect(path).toHaveLength(4);
  });
});

describe('ball impact area (manual 481: 3x3, center takes most damage)', () => {
  it('covers the 3x3 block around the impact', () => {
    const level = fixtureLevel();
    const area = ballImpactArea(level, { x: 35, y: 15 });
    expect(area).toHaveLength(9);
    expect(area.filter((c) => c.centerDist === 0)).toHaveLength(1);
    expect(area.filter((c) => c.centerDist === 1)).toHaveLength(8);
  });

  it('clips at map bounds without crashing', () => {
    const level = fixtureLevel();
    const area = ballImpactArea(level, { x: 0, y: 0 });
    expect(area.length).toBe(4); // corner: 2x2
  });

  it('rollDamage centers hit hardest', () => {
    const rng = new MSLCG(123);
    let centerMax = 0;
    let edgeMin = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 200; i++) {
      centerMax = Math.max(centerMax, rollDamage('ball', 4, rng, 0));
      edgeMin = Math.min(edgeMin, rollDamage('ball', 4, rng, 1));
    }
    expect(centerMax).toBeGreaterThan(0);
    expect(centerMax).toBeGreaterThanOrEqual(edgeMin);
  });
});

describe('teleport + rune of return', () => {
  it('teleport lands on a walkable tile within the radius', () => {
    const level = fixtureLevel();
    const rng = new MSLCG(7);
    for (let i = 0; i < 20; i++) {
      const dest = teleportDestination(rng, level, { x: 35, y: 15 }, 5);
      const dx = Math.abs(dest.x - 35);
      const dy = Math.abs(dest.y - 15);
      expect(dx <= 5 && dy <= 5).toBe(true);
      expect(level.tiles[idx(dest.x, dest.y)]).not.toBe(TILE_WALL);
    }
  });

  it('rune of return targets the up stairs (shrine: stair coords)', () => {
    const level = fixtureLevel();
    expect(runeOfReturnTarget(level)).toEqual({ x: 45, y: 18 });
  });
});
