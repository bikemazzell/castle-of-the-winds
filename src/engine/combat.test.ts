import { describe, expect, it } from 'vitest';

/** Every pool entry rendered for the named monster (pool strings are templates). */
function formatted(pool: readonly string[], monsterName: string): string[] {
  return pool.map((t) => formatMessage(t, { t: 'the ', args: [monsterName.toLowerCase()] }));
}

import { createCharacter } from './character';
import {
  KILL_MESSAGES,
  MONSTER_HIT_VERBS,
  PLAYER_HIT_MESSAGES,
  PLAYER_MISS_MESSAGES,
  lootFor,
  monsterAttack,
  monsterBreath,
  monsterCombatStats,
  resolveMelee,
  resolveSpellAttack,
  spawnMonsterState,
  type Combatant,
} from './combat';
import { formatMessage } from './messages';
import { MSLCG } from './rng';
import { createWorld, dispatch, type WorldData } from './world';

/** 32×32 synthetic town with a 5-wide open floor (x 3..7, y 2..6). */
function combatWorldData(): WorldData {
  const rows: string[] = [];
  for (let y = 0; y < 32; y++) rows.push('00'.repeat(32));
  for (let y = 2; y <= 6; y++) {
    rows[y] = `${'00'.repeat(3)}${'01'.repeat(5)}${'00'.repeat(24)}`;
  }
  return {
    part: 1,
    levels: [
      {
        index: 0,
        name: 'Town',
        kind: 'town',
        links: { down: null, up: null, special: null },
      },
    ],
    town: { rows, spawn: { x: 3, y: 3 }, mineEntrance: { x: 3, y: 3 } },
    tiles: { 0: { walkable: false }, 1: { walkable: true } },
    items: {
      'i-long-sword': {
        id: 'i-long-sword',
        name: 'Long Sword',
        kind: 'weapon',
        weightGrams: 1500,
        weaponClass: 8,
        slot: 'weapon',
        stackable: false,
        consumable: false,
      },
    },
    spells: {
      's-fireball': {
        id: 's-fireball',
        name: 'FIREBALL',
        tier: 4,
        baseMana: 5,
        target: 'enemy',
        effect: 'ball',
        element: 'fire',
      },
      's-cold-bolt': {
        id: 's-cold-bolt',
        name: 'COLD BOLT',
        tier: 2,
        baseMana: 2,
        target: 'enemy',
        effect: 'bolt',
        element: 'cold',
      },
      's-lightning-bolt': {
        id: 's-lightning-bolt',
        name: 'LIGHTNING BOLT',
        tier: 1,
        baseMana: 3,
        target: 'enemy',
        effect: 'bolt',
        element: 'lightning',
      },
    },
  };
}

function player(overrides: Record<string, unknown> = {}) {
  return { ...createCharacter({
    name: 'Test', gender: 'female', strength: 50, intelligence: 50,
    constitution: 50, dexterity: 50, difficulty: 'intermediate',
  }), ...overrides };
}

function worldWith(seed = 1, playerOverrides: Record<string, unknown> = {}) {
  const w = createWorld({ worldSeed: seed, data: combatWorldData(), player: player(playerOverrides) });
  w.rng = new MSLCG(seed);
  return w;
}

/** Find a seed whose first d20 roll (rand(20)+1) clears `threshold`. */
function seedWhereFirstRollAtLeast(threshold: number, toHit: number): number {
  for (let s = 1; s < 500; s++) {
    const roll = new MSLCG(s).rand(20) + 1;
    if (roll + toHit >= threshold) return s;
  }
  throw new Error('no seed found');
}

const FIGHTER: Combatant = {
  name: 'fighter',
  toHit: 0,
  damage: { count: 1, sides: 8, bonus: 0 },
  ac: 0,
};

describe('resolveMelee (pure, seeded)', () => {
  it('seed 1 rolls 2 → misses ac 10 defender and reports an original miss string', () => {
    const rng = new MSLCG(1);
    const result = resolveMelee(FIGHTER, { name: 'kobold', ac: 10, hp: 10 }, rng);
    expect(result.roll).toBe(2); // first LCG output 41 → 41 % 20 + 1
    expect(result.hit).toBe(false);
    expect(result.damage).toBe(0);
    expect(result.killed).toBe(false);
    expect(formatted(PLAYER_MISS_MESSAGES, 'kobold')).toContain(result.message);
  });

  it('hits when roll + toHit ≥ 10 + ac, damage = dice + bonus, kill at hp ≤ damage', () => {
    // ac −8 → threshold 2 → seed-1 roll 2 hits; second roll 18467 % 8 = 3 → die 4.
    const rng = new MSLCG(1);
    const result = resolveMelee(FIGHTER, { name: 'kobold', ac: -8, hp: 4 }, rng);
    expect(result.hit).toBe(true);
    expect(result.damage).toBe(4);
    expect(result.killed).toBe(true);
    expect(formatted(KILL_MESSAGES, 'kobold')).toContain(result.message);
  });

  it('a solid hit that does not kill reports from the hit pool', () => {
    const rng = new MSLCG(1);
    const result = resolveMelee(FIGHTER, { name: 'kobold', ac: -8, hp: 100 }, rng);
    expect(result.hit).toBe(true);
    expect(result.killed).toBe(false);
    expect(formatted(PLAYER_HIT_MESSAGES, 'kobold')).toContain(result.message);
  });
});

describe('monsterCombatStats (APPROX name-tier heuristics)', () => {
  it('vermin are weak, xp ≥ 5', () => {
    const rat = monsterCombatStats('Giant Rat');
    expect(rat.maxHp).toBeLessThanOrEqual(8);
    expect(rat.xp).toBeGreaterThanOrEqual(5);
    expect(rat.breath).toBeUndefined();
  });

  it('common dungeon tier sits between vermin and dragons', () => {
    const kobold = monsterCombatStats('Kobold');
    const wolf = monsterCombatStats('Gray Wolf');
    const ogre = monsterCombatStats('Huge Ogre');
    expect(kobold.maxHp).toBeLessThan(wolf.maxHp);
    expect(wolf.maxHp).toBeLessThan(ogre.maxHp);
    expect(kobold.xp).toBeLessThan(ogre.xp);
  });

  it('dragons breathe — element from color, power scales with age qualifier', () => {
    const young = monsterCombatStats('Young Red Dragon');
    const ancient = monsterCombatStats('Ancient Red Dragon');
    expect(ancient.breath?.element).toBe('fire');
    expect(monsterCombatStats('Blue Dragon').breath?.element).toBe('lightning');
    expect(monsterCombatStats('White Dragon').breath?.element).toBe('cold');
    expect(monsterCombatStats('Green Dragon').breath?.element).toBe('poison_gas');
    expect(ancient.maxHp).toBeGreaterThan(young.maxHp);
    expect(ancient.xp).toBeGreaterThanOrEqual(300);
  });

  it('colored dragons match the age ladder (color word between age and dragon)', () => {
    // Regression (campaign run 7): "Adult Red Dragon" fell through the age
    // ladder to the generic 60 hp/xp-250 tier → depth 4 → eligible on Mine
    // level 7, where a level-8 champion could not survive its breath.
    expect(monsterCombatStats('Adult Red Dragon').xp).toBe(320);
    expect(monsterCombatStats('Very Old Red Dragon').xp).toBe(690); // 600 × 1.15 age multiplier
    expect(monsterCombatStats('Old Blue Dragon').xp).toBe(450);
    expect(monsterCombatStats('Ancient Green Dragon').xp).toBe(1170); // 900 × 1.3
    // "Young Adult Blue Dragon" contains "Adult Blue Dragon" — the young-adult
    // tier must win (checked before adult in the first-match ladder).
    expect(monsterCombatStats('Young Adult Blue Dragon').xp).toBe(135); // 180 × 0.75
    expect(monsterCombatStats('Young White Dragon').xp).toBe(65); // 90 × 0.75
  });

  it('giants, trolls and undead hold the heavy tiers; Hrungnir is a boss', () => {
    expect(monsterCombatStats('Hill Giant').maxHp).toBeGreaterThanOrEqual(40);
    expect(monsterCombatStats('Gruesome Troll').maxHp).toBeGreaterThanOrEqual(35);
    expect(monsterCombatStats('Walking Corpse').maxHp).toBeGreaterThanOrEqual(15);
    const boss = monsterCombatStats('Hrungnir, The Hill Giant Lord');
    expect(boss.maxHp).toBeGreaterThanOrEqual(90);
    expect(boss.xp).toBeGreaterThanOrEqual(1000);
  });

  it('spawnMonsterState starts at full hp', () => {
    const state = spawnMonsterState('Kobold');
    expect(state.hp).toBe(state.maxHp);
    expect(state.maxHp).toBe(monsterCombatStats('Kobold').maxHp);
  });
});

describe('playerAttack (world integration, seeded)', () => {
  it('bump-attacking via MOVE consumes a turn and applies exactly the rolled damage', () => {
    const koboldStats = monsterCombatStats('Kobold');
    const threshold = 10 + koboldStats.ac;
    const seed = seedWhereFirstRollAtLeast(threshold, 0);

    const w = worldWith(seed);
    const level = w.levels.get(0)!;
    const hp = 1000;
    level.entities.set(7, {
      id: 7, kind: 'monster', name: 'Kobold', x: 4, y: 3,
      monster: { hp, maxHp: hp, stats: koboldStats },
    });
    level.occupancy[4 + 3 * 64] = 7;

    // Parallel RNG computes the expected outcome with the same consumption order.
    const expected = resolveMelee(
      {
        name: 'You',
        toHit: 0,
        damage: { count: 1, sides: 2, bonus: 0 }, // fists: weaponClass 0 → d2
        ac: 0,
      },
      { name: 'Kobold', ac: koboldStats.ac, hp },
      new MSLCG(seed),
    );
    expect(expected.hit).toBe(true);

    const turns = w.turn;
    dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });

    expect(w.turn).toBe(turns + 1);
    expect(w.player.x).toBe(3); // never stepped into the monster
    const entity = w.levels.get(0)!.entities.get(7)!;
    expect(entity.monster!.hp).toBe(hp - expected.damage);
    expect(w.log.at(-1)!.text).toBe(expected.message);
    expect(w.log.at(-1)!.text.toLowerCase()).toContain('kobold');
  });

  it('a miss still consumes the turn and keeps the monster untouched', () => {
    const koboldStats = monsterCombatStats('Kobold');
    const w = worldWith(1); // first roll 2 < 10 + kobold ac
    const level = w.levels.get(0)!;
    level.entities.set(7, {
      id: 7, kind: 'monster', name: 'Kobold', x: 4, y: 3,
      monster: { hp: 10, maxHp: 10, stats: koboldStats },
    });
    level.occupancy[4 + 3 * 64] = 7;

    dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });

    expect(w.turn).toBe(1);
    expect(w.levels.get(0)!.entities.get(7)!.monster!.hp).toBe(10);
    expect(w.log.at(-1)!.text).toMatch(/kobold/i);
  });

  it('killing a monster removes it, awards its xp and loot gold', () => {
    const ratStats = monsterCombatStats('Giant Rat');
    const threshold = 10 + ratStats.ac;
    const seed = seedWhereFirstRollAtLeast(threshold, 0);

    const w = worldWith(seed);
    const level = w.levels.get(0)!;
    level.entities.set(7, {
      id: 7, kind: 'monster', name: 'Giant Rat', x: 4, y: 3,
      monster: { hp: 1, maxHp: 1, stats: ratStats },
    });
    level.occupancy[4 + 3 * 64] = 7;

    // Expected loot via parallel consumption: roll → damage die → kill message → loot.
    const parallel = new MSLCG(seed);
    const expected = resolveMelee(
      { name: 'You', toHit: 0, damage: { count: 1, sides: 2, bonus: 0 }, ac: 0 },
      { name: 'Giant Rat', ac: ratStats.ac, hp: 1 },
      parallel,
    );
    expect(expected.killed).toBe(true);
    const expectedGold = lootFor(ratStats, parallel);

    const xpBefore = w.player.experience;
    const goldBefore = w.inventory.gold;
    dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });

    expect(w.levels.get(0)!.entities.has(7)).toBe(false);
    expect(level.occupancy[4 + 3 * 64]).toBe(0);
    expect(w.player.experience).toBe(xpBefore + ratStats.xp);
    expect(w.inventory.gold).toBe(goldBefore + expectedGold);
  });

  it('monsters blocking movement are attackable, npcs are not', () => {
    const w = worldWith(1);
    const level = w.levels.get(0)!;
    level.entities.set(8, {
      id: 8, kind: 'npc', name: 'Snorri the Sage', x: 4, y: 3,
    });
    level.occupancy[4 + 3 * 64] = 8;
    dispatch(w, { type: 'MOVE', dx: 1, dy: 0 });
    expect(w.turn).toBe(0); // no attack, no move, no turn
    expect(level.entities.has(8)).toBe(true);
  });
});

describe('monsterAttack + breath (vs player)', () => {
  it('a missed attack reports the original "%t%i missed you!" string', () => {
    const w = worldWith(1); // first roll 2 + kobold toHit < 10 + player AV 0
    const level = w.levels.get(0)!;
    level.entities.set(7, {
      id: 7, kind: 'monster', name: 'Kobold', x: 4, y: 3,
      monster: spawnMonsterState('Kobold'),
    });
    level.occupancy[4 + 3 * 64] = 7;

    const result = monsterAttack(w, 7);
    expect(result.hit).toBe(false);
    expect(w.player.hp).toBe(w.player.maxHp);
    expect(w.log.at(-1)!.text).toBe('The kobold missed you!');
  });

  it('titled bosses never double the article mid-sentence (PART2-PLAN P8)', () => {
    const surtur = monsterCombatStats('The Demon Lord Surtur');
    const threshold = 10 + 0;
    const seed = seedWhereFirstRollAtLeast(threshold, surtur.toHit);

    const w = worldWith(seed, { hp: 1, maxHp: 400 }); // survive the hit
    const level = w.levels.get(0)!;
    level.entities.set(7, {
      id: 7, kind: 'monster', name: 'The Demon Lord Surtur', x: 4, y: 3,
      monster: { hp: 240, maxHp: 240, stats: surtur },
    });
    level.occupancy[4 + 3 * 64] = 7;

    monsterAttack(w, 7);
    const text = w.log.at(-1)!.text;
    expect(text).not.toMatch(/the the/i);
    expect(text).toMatch(/killed by a demon lord surtur/i);
  });

  it('a hit damages the player and a lethal one flags death', () => {
    const giantStats = monsterCombatStats('Hill Giant');
    const threshold = 10 + 0; // player AV 0 (dex 50, no armor)
    const seed = seedWhereFirstRollAtLeast(threshold, giantStats.toHit);

    const w = worldWith(seed, { hp: 1, maxHp: 20 });
    const level = w.levels.get(0)!;
    level.entities.set(7, {
      id: 7, kind: 'monster', name: 'Hill Giant', x: 4, y: 3,
      monster: { hp: 40, maxHp: 40, stats: giantStats },
    });
    level.occupancy[4 + 3 * 64] = 7;

    const result = monsterAttack(w, 7);
    expect(result.hit).toBe(true);
    expect(result.killed).toBe(true);
    expect(w.player.hp).toBe(0);
    expect(MONSTER_HIT_VERBS.length).toBeGreaterThan(0);
  });

  it('dragon breath hits with element damage; resist halves it', () => {
    // Force the breath chance roll (rand(4) === 0) by seed search.
    let breathSeed = -1;
    for (let s = 1; s < 500; s++) {
      if (new MSLCG(s).rand(4) === 0) { breathSeed = s; break; }
    }
    expect(breathSeed).toBeGreaterThan(0);

    const w = worldWith(breathSeed, { hp: 100, maxHp: 100 });
    const level = w.levels.get(0)!;
    const stats = monsterCombatStats('Adult Red Dragon');
    level.entities.set(9, {
      id: 9, kind: 'monster', name: 'Adult Red Dragon', x: 5, y: 3,
      monster: { hp: 80, maxHp: 80, stats },
    });
    level.occupancy[5 + 3 * 64] = 9;

    // Parallel expected damage: chance roll → dice.
    const parallel = new MSLCG(breathSeed);
    parallel.rand(4);
    let expected = 0;
    for (let i = 0; i < stats.breath!.dieSides; i++) expected += parallel.rand(6) + 1;

    const r1 = monsterBreath(w, 9);
    expect(r1.breathed).toBe(true);
    expect(w.player.hp).toBe(100 - expected);
    expect(w.log.some((e) => e.text === 'The dragon breath hits you!')).toBe(true);
    expect(w.log.some((e) => e.text === 'The adult red dragon breathes fire!')).toBe(true);

    // With resist fire the same breath deals half (floored).
    const w2 = worldWith(breathSeed, { hp: 100, maxHp: 100 });
    w2.player.statuses.push({ kind: 'resist_fire', remainingTurns: 100 });
    const level2 = w2.levels.get(0)!;
    level2.entities.set(9, {
      id: 9, kind: 'monster', name: 'Adult Red Dragon', x: 5, y: 3,
      monster: { hp: 80, maxHp: 80, stats },
    });
    level2.occupancy[5 + 3 * 64] = 9;
    const r2 = monsterBreath(w2, 9);
    expect(r2.breathed).toBe(true);
    expect(w2.player.hp).toBe(100 - Math.floor(expected / 2));
  });

  it('no breath ability → no breath', () => {
    const w = worldWith(1);
    const level = w.levels.get(0)!;
    level.entities.set(7, {
      id: 7, kind: 'monster', name: 'Kobold', x: 4, y: 3,
      monster: spawnMonsterState('Kobold'),
    });
    const r = monsterBreath(w, 7);
    expect(r.breathed).toBe(false);
  });
});

describe('resolveSpellAttack (attack spells land)', () => {
  function worldWithKobold(hp: number, x: number, y: number) {
    const w = worldWith(1);
    const level = w.levels.get(0)!;
    const stats = monsterCombatStats('Kobold');
    level.entities.set(7, { id: 7, kind: 'monster', name: 'Kobold', x, y, monster: { hp, maxHp: hp, stats } });
    level.occupancy[x + y * 64] = 7;
    return { w, stats };
  }

  it('fireball in the 3×3 area rolls per-target damage with original messages', () => {
    const { w } = worldWithKobold(1000, 4, 3);
    const parallel = new MSLCG(1);
    const stats = monsterCombatStats('Kobold');
    const roll = parallel.rand(20) + 1; // attack roll
    const hit = roll + 0 >= 10 + stats.ac;
    let expectedDamage = 0;
    if (hit) {
      for (let i = 0; i < 4; i++) expectedDamage += parallel.rand(10) + 1; // ball tier 4
    }

    const result = resolveSpellAttack(w, w.data.spells['s-fireball']!, { x: 4, y: 3 });
    expect(result.resolved).toBe(true);
    const entity = w.levels.get(0)!.entities.get(7)!;
    expect(entity.monster!.hp).toBe(1000 - (hit ? expectedDamage : 0));
    const last = w.log.at(-1)!.text;
    if (hit) {
      expect(last).toBe('The fireball hit the kobold!');
    } else {
      expect(last).toBe('The fireball misses the kobold!');
    }
  });

  it('bolt spells stop at the first monster on the line', () => {
    const { w } = worldWithKobold(1000, 5, 3);
    const result = resolveSpellAttack(w, w.data.spells['s-cold-bolt']!, { x: 8, y: 3 });
    expect(result.resolved).toBe(true);
    expect(w.log.at(-1)!.text.toLowerCase()).toContain('cold bolt');
    expect(w.log.at(-1)!.text.toLowerCase()).toContain('kobold');
  });

  it('a bolt that reaches a wall reports the original wall message', () => {
    const w = worldWith(1);
    const level = w.levels.get(0)!;
    // Wall at x=6, y=3 (row 3 currently open 3..7).
    const row = level.tiles;
    row[6 + 3 * 64] = 0;
    const result = resolveSpellAttack(w, w.data.spells['s-cold-bolt']!, { x: 8, y: 3 });
    expect(result.resolved).toBe(true);
    expect(w.log.at(-1)!.text).toBe('The cold bolt hit the wall!');
  });
});

describe('part2 boss tiers + elemental weakness (PART2-PLAN Task P3)', () => {
  function worldWithBoss(
    seed: number,
    stats: import('./types').MonsterCombatStats,
    hp: number,
    x: number,
    y: number,
  ) {
    // DEX 90 → toHit +4, so seeded hits vs Surtur's ac 12 are findable.
    const w = worldWith(seed, { dexterity: 90 });
    const level = w.levels.get(0)!;
    level.entities.set(7, {
      id: 7, kind: 'monster', name: 'The Demon Lord Surtur', x, y,
      monster: { hp, maxHp: hp, stats },
    });
    level.occupancy[x + y * 64] = 7;
    return { w };
  }

  it('Surtur names hit the Surtur tier, not the generic demon-lord tier', () => {
    for (const name of ['Surtur', 'The Demon Lord Surtur']) {
      const stats = monsterCombatStats(name);
      expect(stats.maxHp).toBe(240);
      expect(stats.ac).toBe(12);
      expect(stats.xp).toBe(6000);
      expect(stats.vulnerableElement).toBe('lightning');
      expect(stats.immuneElement).toBe('fire');
    }
  });

  it('titled giant kings outrank the generic giant-king tier', () => {
    const names = [
      'Thrym, The Frost Giant King',
      'Utgardhalok, The Hill Giant King',
      'Rungnir, The Stone Giant King',
      'Thiassa, The Fire Giant King',
    ];
    for (const name of names) {
      const stats = monsterCombatStats(name);
      // Tier 150 × the /giant/ size multiplier 1.2 (same rule that makes
      // Hrungnir 110 → 132); xp scales with hp → 1500 × 1.2 = 1800.
      expect(stats.maxHp).toBe(180);
      expect(stats.xp).toBe(1800);
    }
  });

  it('two headed giants are their own tier above ordinary giants', () => {
    expect(monsterCombatStats('Two Headed Giant').maxHp).toBe(84); // 70 × 1.2
    expect(monsterCombatStats('Fire Giant').maxHp).toBe(60); // 50 × 1.2
  });

  it('an element-immune boss takes zero spell damage and shrugs it off', () => {
    const stats = monsterCombatStats('The Demon Lord Surtur');
    const seed = seedWhereFirstRollAtLeast(10 + stats.ac, 4); // dex 90 → toHit +4
    const { w } = worldWithBoss(seed, stats, 1000, 4, 3);
    const result = resolveSpellAttack(w, w.data.spells['s-fireball']!, { x: 4, y: 3 });
    expect(result.resolved).toBe(true);
    expect(result.hitCount).toBe(1); // the spell connected
    expect(w.levels.get(0)!.entities.get(7)!.monster!.hp).toBe(1000); // immune → 0 damage
    expect(w.log.at(-1)!.text).toBe('The Demon Lord Surtur shrugs off the fire!');
  });

  it('a vulnerable element tears into the boss for ceil(×1.5)', () => {
    const stats = monsterCombatStats('The Demon Lord Surtur');
    const seed = seedWhereFirstRollAtLeast(10 + stats.ac, 4);
    const { w } = worldWithBoss(seed, stats, 1000, 5, 3);
    // Mirror the RNG: attack roll, then one bolt-tier d8 (tier 1).
    const parallel = new MSLCG(seed);
    parallel.rand(20);
    const base = parallel.rand(8) + 1;
    const expected = Math.ceil(base * 1.5);
    const result = resolveSpellAttack(w, w.data.spells['s-lightning-bolt']!, { x: 8, y: 3 });
    expect(result.resolved).toBe(true);
    expect(result.hitCount).toBe(1);
    expect(w.levels.get(0)!.entities.get(7)!.monster!.hp).toBe(1000 - expected);
    expect(w.log.at(-1)!.text).toBe('The lightning tears into The Demon Lord Surtur!');
  });
});

it('reports actual enemy hit or miss without changing combat results or random state',async()=>{
 const {captureCombat}=await import('./combat-feedback');
 const a=worldWith(1),b=worldWith(1);
 for(const w of [a,b]){const level=w.levels.get(0)!;level.entities.set(7,{id:7,kind:'monster',name:'Kobold',x:4,y:3,monster:spawnMonsterState('Kobold')});level.occupancy[3*64+4]=7;}
 const observed=captureCombat(a,()=>monsterAttack(a,7)),plain=monsterAttack(b,7);
 expect(observed.result).toEqual(plain);expect(a.rng.getState()).toBe(b.rng.getState());
 expect(observed.events).toEqual([{attacker:{id:7,x:4,y:3},target:{id:0,x:3,y:3},hit:plain.hit,damage:plain.damage}]);
});
it('gives Ice Devils a deep demon tier instead of rat defaults',async()=>{
 const {loadSpawnRoster,eligibleFor}=await import('./monsters');
 const roster=loadSpawnRoster([{id:'ice-devil',name:'Ice Devil'}]);
 expect(monsterCombatStats('Ice Devil').maxHp).toBeGreaterThanOrEqual(80);
 expect(eligibleFor(1,roster)).toHaveLength(0);
 expect(eligibleFor(25,roster)).toHaveLength(1);
});
