import { recordCombat } from './combat-feedback';
/**
 * Combat resolution + original combat messages (Task 4.1).
 *
 * Attack formula is APPROX (thac0-style: hit when d20 + toHit ≥ 10 + ac);
 * the exact original roll lives in unrecovered combat code
 * (EXTRACTION-GAPS.md #1). All flavor text strings are VERBATIM originals
 * from the EXE string segment (src/data/part1/messages.json — verified by tests).
 *
 * RNG consumption order (stable, mirrored by tests via parallel MSLCG):
 * attack roll → damage dice → message pick → loot/breath rolls.
 */
import { gainExperience } from './character';
import { formatMessage } from './messages';
import type { Level, Entity } from './map';
import { idx } from './map';
import { equipmentStats } from './inventory';
import { questEvent } from './quests';
import { rollDamage, boltPath, ballImpactArea, type SpellDefRuntime } from './spells';
import type { MonsterCombatStats, MonsterState, BreathElement } from './types';
import type { World } from './world';
import type { MSLCG } from './rng';

// ─── Original message pools (verbatim strings; tests verify membership) ──────

export const KILL_MESSAGES: readonly string[] = [
  "You crush %t%i's skull into jelly.",
  'You decapitate %t%i with a backhand stroke.',
  'You skewer %t%i, which collapses, spitting blood.',
  'You disembowel %t%i with a final cut.',
  'You slash through %t%i\'s throat with a neat lunge and slice.',
  'You impale %t%i with a lightning stroke.',
  'You crush %t%i, splintering bone and spraying gore.',
  'You cleave %t%i wide open!',
  '%t%i is dead!',
  '%t%i is destroyed!',
  '%t%i falls dead with a mighty crash!',
];

export const PLAYER_HIT_MESSAGES: readonly string[] = [
  'You hit %t%i in the head!',
  'You hit %t%i in the arm!',
  'You hit %t%i in the leg!',
  'You thrust deep into %t%i!',
  'You strike %t%i a glancing blow.',
  'You deal %t%i a solid blow!',
  'You deal %t%i a crushing blow!',
  'You smite %t%i, driving it back a step.',
  'You barely hit %t%i.',
  "You slip past %t%i's guard and hit!",
];

export const PLAYER_MISS_MESSAGES: readonly string[] = [
  'You miss %t%i by a league!',
  'You stumble and miss %t%i, cleaving the air.',
  'You missed %t%i!',
  'You lunge at %t%i, but fumble the thrust.',
  'You slash at air as %t%i dances back.',
];

/** Monster attack verbs (original "%t%i %i you!" pattern). */
export const MONSTER_HIT_VERBS: readonly string[] = ['bites', 'claws'];

const MISS_MESSAGES: readonly string[] = PLAYER_MISS_MESSAGES;

// ─── APPROX monster stat derivation ─────────────────────────────────────────

interface TierSpec {
  keywords: RegExp;
  maxHp: number;
  ac: number;
  toHit: number;
  damage: { count: number; sides: number; bonus: number };
  speed: number;
  xp: number;
  breath?: MonsterCombatStats['breath'];
  vulnerableElement?: MonsterCombatStats['vulnerableElement'];
  immuneElement?: MonsterCombatStats['immuneElement'];
}

/**
 * APPROX tiers by name keywords, first match wins. HP/xp scale within a tier
 * by age/size qualifiers. Real stat tables were runtime-built and are gone
 * (EXTRACTION-GAPS.md #1); values are tuned to manual bestiary flavor.
 */
const TIERS: readonly TierSpec[] = [
  {
    keywords: /hrungnir/i,
    maxHp: 110, ac: 8, toHit: 10, damage: { count: 3, sides: 8, bonus: 6 }, speed: 1, xp: 1500,
  },
  {
    // Part-2 final boss — must sit ABOVE /demon lord/ (story 22: Surtur
    // commands fire and only lightning harms him).
    keywords: /surtur/i,
    maxHp: 240, ac: 12, toHit: 12, damage: { count: 3, sides: 10, bonus: 8 }, speed: 1, xp: 6000,
    vulnerableElement: 'lightning', immuneElement: 'fire',
  },
  {
    keywords: /ancient (\w+ )?dragon|dragon lord/i,
    maxHp: 130, ac: 8, toHit: 8, damage: { count: 3, sides: 6, bonus: 4 }, speed: 1, xp: 900,
  },
  {
    keywords: /(spiked|horned|ice) devil|abyss fiend|demon lord/i,
    maxHp: 90, ac: 8, toHit: 8, damage: { count: 2, sides: 8, bonus: 4 }, speed: 1, xp: 600,
  },
  {
    keywords: /very old (\w+ )?dragon/i,
    maxHp: 105, ac: 7, toHit: 7, damage: { count: 3, sides: 6, bonus: 2 }, speed: 1, xp: 600,
  },
  {
    // NOTE: young adult must be tested before adult/old — "Young Adult Blue
    // Dragon" contains "Adult Blue Dragon", and the ladder is first-match.
    keywords: /young adult (\w+ )?dragon/i,
    maxHp: 55, ac: 5, toHit: 5, damage: { count: 2, sides: 6, bonus: 1 }, speed: 1, xp: 180,
  },
  {
    keywords: /old (\w+ )?dragon/i,
    maxHp: 90, ac: 7, toHit: 7, damage: { count: 3, sides: 6, bonus: 1 }, speed: 1, xp: 450,
  },
  {
    keywords: /adult (\w+ )?dragon/i,
    maxHp: 75, ac: 6, toHit: 6, damage: { count: 2, sides: 6, bonus: 3 }, speed: 1, xp: 320,
  },
  {
    keywords: /young (\w+ )?dragon/i,
    maxHp: 35, ac: 4, toHit: 4, damage: { count: 1, sides: 8, bonus: 2 }, speed: 1, xp: 90,
  },
  {
    keywords: /dragon/i,
    maxHp: 60, ac: 5, toHit: 5, damage: { count: 2, sides: 6, bonus: 2 }, speed: 1, xp: 250,
  },
  {
    // Part-2 jotun kings — above the generic /giant king/ tier.
    keywords: /(hill|stone|frost|fire) giant king/i,
    maxHp: 150, ac: 9, toHit: 9, damage: { count: 3, sides: 8, bonus: 5 }, speed: 1, xp: 1500,
  },
  {
    keywords: /giant king|giant lord/i,
    maxHp: 95, ac: 7, toHit: 8, damage: { count: 3, sides: 6, bonus: 5 }, speed: 1, xp: 800,
  },
  {
    keywords: /two headed giant/i,
    maxHp: 70, ac: 6, toHit: 7, damage: { count: 2, sides: 8, bonus: 3 }, speed: 1, xp: 350,
  },
  {
    keywords: /(fire|frost|hill|stone) giant/i,
    maxHp: 50, ac: 5, toHit: 6, damage: { count: 2, sides: 8, bonus: 3 }, speed: 1, xp: 250,
  },
  {
    keywords: /elemental|manticore/i,
    maxHp: 40, ac: 5, toHit: 5, damage: { count: 2, sides: 6, bonus: 2 }, speed: 1, xp: 180,
  },
  {
    keywords: /troll|ogre/i,
    maxHp: 38, ac: 4, toHit: 5, damage: { count: 2, sides: 6, bonus: 2 }, speed: 1, xp: 130,
  },
  {
    keywords: /vampire|spectre/i,
    maxHp: 45, ac: 6, toHit: 6, damage: { count: 2, sides: 6, bonus: 2 }, speed: 1, xp: 300,
  },
  {
    keywords: /wight|wraith|ghost|walking corpse|undead/i,
    maxHp: 22, ac: 5, toHit: 4, damage: { count: 1, sides: 8, bonus: 1 }, speed: 1, xp: 90,
  },
  {
    keywords: /wizard|necromancer/i,
    maxHp: 18, ac: 4, toHit: 3, damage: { count: 1, sides: 6, bonus: 1 }, speed: 1, xp: 110,
  },
  {
    keywords: /warrior|berserker|guard|bandit|sneak thief|thief|rat-man|wolf-man|bear-man|bull-man/i,
    maxHp: 20, ac: 5, toHit: 4, damage: { count: 1, sides: 8, bonus: 1 }, speed: 1, xp: 60,
  },
  {
    keywords: /bear|statue/i,
    maxHp: 30, ac: 4, toHit: 4, damage: { count: 2, sides: 6, bonus: 0 }, speed: 1, xp: 70,
  },
  {
    keywords: /wolf|viper|snake|scorpion|spider|creeper|slime|glob/i,
    maxHp: 14, ac: 6, toHit: 3, damage: { count: 1, sides: 6, bonus: 0 }, speed: 1, xp: 35,
  },
  {
    keywords: /goblin|orc|hobgoblin|kobold|\bant\b|lizard|\bbat\b/i,
    maxHp: 9, ac: 4, toHit: 2, damage: { count: 1, sides: 4, bonus: 0 }, speed: 1, xp: 20,
  },
  {
    keywords: /rat|dog/i,
    maxHp: 6, ac: 5, toHit: 2, damage: { count: 1, sides: 4, bonus: 0 }, speed: 1, xp: 10,
  },
];

const AGE_MULTIPLIER: readonly [RegExp, number][] = [
  [/ancient/i, 1.3],
  [/very old/i, 1.15],
  [/huge|giant/i, 1.2],
  [/young/i, 0.75],
];

const BREATH_ELEMENT: readonly [RegExp, BreathElement][] = [
  [/red/i, 'fire'],
  [/blue/i, 'lightning'],
  [/white|frost/i, 'cold'],
  [/green/i, 'poison_gas'],
  [/black/i, 'acid'],
];

/** APPROX stats for a monster by name (see TIERS note). */
export function monsterCombatStats(name: string): MonsterCombatStats {
  const tier = TIERS.find((t) => t.keywords.test(name)) ?? TIERS[TIERS.length - 1]!;
  let hp = tier.maxHp;
  for (const [pattern, mult] of AGE_MULTIPLIER) {
    if (pattern.test(name)) {
      hp = Math.round(hp * mult);
      break;
    }
  }
  const stats: MonsterCombatStats = {
    maxHp: hp,
    ac: tier.ac,
    toHit: tier.toHit,
    damage: { ...tier.damage },
    speed: tier.speed,
    xp: Math.max(5, Math.round((tier.xp * hp) / tier.maxHp / 5) * 5),
  };
  if (/dragon/i.test(name) && !/young/i.test(name)) {
    const element = BREATH_ELEMENT.find(([pattern]) => pattern.test(name))?.[1] ?? 'fire';
    stats.breath = { element, dieSides: 6, every: 4 };
  }
  if (tier.vulnerableElement) stats.vulnerableElement = tier.vulnerableElement;
  if (tier.immuneElement) stats.immuneElement = tier.immuneElement;
  return stats;
}

/** Full-hp monster state for spawning (Task 4.2 uses this). */
export function spawnMonsterState(name: string): MonsterState {
  const stats = monsterCombatStats(name);
  return { hp: stats.maxHp, maxHp: stats.maxHp, stats };
}

// ─── Melee resolution ───────────────────────────────────────────────────────

export interface Combatant {
  name: string;
  toHit: number;
  damage: { count: number; sides: number; bonus: number };
  ac: number;
}

export interface MeleeResult {
  hit: boolean;
  roll: number;
  damage: number;
  killed: boolean;
  message: string;
}

/** d20 attack: hit when roll + toHit ≥ 10 + ac (APPROX thac0-style). */
export function attackRollHits(rng: MSLCG, toHit: number, ac: number): { roll: number; hit: boolean } {
  const roll = rng.rand(20) + 1;
  return { roll, hit: roll + toHit >= 10 + ac };
}

/**
 * Pure resolution of one melee attack. RNG order: roll → damage dice →
 * message pick. Does not mutate anything; callers apply the result.
 */
export function resolveMelee(attacker: Combatant, defender: { name: string; ac: number; hp: number }, rng: MSLCG): MeleeResult {
  const { roll, hit } = attackRollHits(rng, attacker.toHit, defender.ac);
  if (!hit) {
    const message = pick(rng, MISS_MESSAGES);
    return { hit: false, roll, damage: 0, killed: false, message: formatForPlayer(message, defender.name) };
  }
  let damage = attacker.damage.bonus;
  for (let i = 0; i < attacker.damage.count; i++) damage += rng.rand(attacker.damage.sides) + 1;
  damage = Math.max(0, damage);
  const killed = damage >= defender.hp;
  const pool = killed ? KILL_MESSAGES : PLAYER_HIT_MESSAGES;
  const message = pick(rng, pool);
  return { hit: true, roll, damage, killed, message: formatForPlayer(message, defender.name) };
}

function pick(rng: MSLCG, pool: readonly string[]): string {
  return pool[rng.rand(pool.length)] ?? pool[0]!;
}

/** "%t%i" with the definite article + the monster's display name. */
function formatForPlayer(template: string, monsterName: string): string {
  return formatMessage(template, { t: 'the ', args: [midSentenceName(monsterName)] });
}

/**
 * Monster name as it appears mid-sentence. The original game lowercased
 * monster names inside messages and titled bosses self-article ("Killed by
 * a hrungnir, the hill giant lord") — so a leading English article is
 * stripped to avoid "the the demon lord surtur" when the template adds its
 * own article.
 */
function midSentenceName(name: string): string {
  return name.toLowerCase().replace(/^the\s+/, '');
}

// ─── Player ↔ monster world integration ─────────────────────────────────────

/** Player combat profile from equipment + attributes. */
export function playerCombatant(world: World): Combatant {
  const stats = equipmentStats(world.inventory, world.data.items, world.player);
  const sides = Math.max(2, stats.weaponClass);
  return {
    name: 'You',
    toHit: stats.toHit,
    damage: { count: 1, sides, bonus: stats.damage - stats.weaponClass },
    ac: stats.armorValue,
  };
}

function monsterOf(level: Level, entityId: number): Entity & { monster: MonsterState } {
  const entity = level.entities.get(entityId);
  if (!entity || entity.kind !== 'monster' || !entity.monster) {
    throw new Error(`entity ${entityId} is not a combat-capable monster`);
  }
  return entity as Entity & { monster: MonsterState };
}

/** Loot roll for a slain monster (APPROX gold; item drops land with 4.2). */
export function lootFor(stats: MonsterCombatStats, rng: MSLCG): number {
  if (rng.rand(4) === 0) return rng.rand(Math.max(2, stats.xp)) + 1;
  return 0;
}

/** Retained exhausted props enforce a per-level salvage limit across saves. */
function leaveMonsterRemains(world: World, entity: Entity): void {
  if (!world.data.items['x-bone']) return;
  const level = world.levels.get(world.current)!;
  level.props ??= [];
  if (level.props.length >= 32) return;
  const id = `remains-${level.index}-${level.props.length}`;
  if (level.props.some(prop => prop.id === id)) return;
  level.props.push({ id, x: entity.x, y: entity.y, kind: 'bones', exhausted: false });
}

/**
 * Player attacks `entityId` on the current level. Applies damage, removes
 * slain monsters (occupancy + records), awards xp/gold, logs the original
 * message. Mutates world.
 */
export function playerAttack(world: World, entityId: number, attacker: Combatant = playerCombatant(world)): MeleeResult {
  const level = world.levels.get(world.current)!;
  const entity = monsterOf(level, entityId);
  // Attacking wakes sleeping monsters and alerts them (manual: Sleep Monster).
  entity.monster.sleepTurns = 0;
  entity.monster.alert = true;
  const result = resolveMelee(attacker, { name: entity.name, ac: entity.monster.stats.ac, hp: entity.monster.hp }, world.rng);
  recordCombat(world,{attacker:{id:0,x:world.player.x,y:world.player.y},target:{id:entity.id,x:entity.x,y:entity.y},hit:result.hit,damage:result.damage});
  if (result.hit) {
    entity.monster.hp -= result.damage;
    if (entity.monster.hp <= 0) {
      const stats = entity.monster.stats;
      level.occupancy[idx(entity.x, entity.y)] = 0;
      level.entities.delete(entityId);
      leaveMonsterRemains(world, entity);
      gainExperience(world.player, stats.xp, world.data.xpThresholds ?? []);
      questEvent(world, { kind: 'monster-killed', name: entity.name });
      const gold = lootFor(stats, world.rng);
      if (gold > 0) {
        world.inventory.gold += gold;
        world.log.push({ turn: world.turn, text: `You collect ${gold} copper pieces from the corpse.` });
      }
    }
  }
  world.log.push({ turn: world.turn, text: result.message });
  return result;
}

/** Monster attacks the player. Mutates world (hp + log). */
export function monsterAttack(world: World, entityId: number): MeleeResult & { message: string } {
  const level = world.levels.get(world.current)!;
  const entity = monsterOf(level, entityId);
  const stats = entity.monster.stats;
  const attacker: Combatant = { name: entity.name, toHit: stats.toHit, damage: stats.damage, ac: stats.ac };
  const defenderAc = playerCombatant(world).ac;
  const { roll, hit } = attackRollHits(world.rng, attacker.toHit, defenderAc);
  if (!hit) {
    const message = formatMessage('%t%i missed you!', { t: 'the ', args: [midSentenceName(entity.name)] });
    world.log.push({ turn: world.turn, text: message });
    recordCombat(world,{attacker:{id:entity.id,x:entity.x,y:entity.y},target:{id:0,x:world.player.x,y:world.player.y},hit:false,damage:0});
    return { hit: false, roll, damage: 0, killed: false, message };
  }
  let damage = stats.damage.bonus;
  for (let i = 0; i < stats.damage.count; i++) damage += world.rng.rand(stats.damage.sides) + 1;
  world.player.hp = Math.max(0, world.player.hp - damage);
  const killed = world.player.hp === 0;
  const verb = pick(world.rng, MONSTER_HIT_VERBS);
  const message = killed
    ? formatMessage('Killed by %y%i', { args: ['a ', midSentenceName(entity.name)] })
    : formatMessage('%t%i %i you!', { t: 'the ', args: [midSentenceName(entity.name), verb] });
  world.log.push({ turn: world.turn, text: message });
  recordCombat(world,{attacker:{id:entity.id,x:entity.x,y:entity.y},target:{id:0,x:world.player.x,y:world.player.y},hit:true,damage});
  return { hit: true, roll, damage, killed, message };
}

export interface BreathResult {
  breathed: boolean;
  damage: number;
  resisted: boolean;
  message: string;
}

/**
 * Dragon breath vs the player: 1-in-N chance per call, element dice damage,
 * halved by the matching resist status. Announces with the two original
 * breath strings.
 */
export function monsterBreath(world: World, entityId: number): BreathResult {
  const level = world.levels.get(world.current)!;
  const entity = monsterOf(level, entityId);
  const breath = entity.monster.stats.breath;
  if (!breath) return { breathed: false, damage: 0, resisted: false, message: '' };
  if (world.rng.rand(breath.every) !== 0) {
    return { breathed: false, damage: 0, resisted: false, message: '' };
  }
  const elementText = breath.element === 'poison_gas' ? 'poison gas' : breath.element.replace('_', ' ');
  world.log.push({
    turn: world.turn,
    text: formatMessage('The %i breathes %i!', { args: [midSentenceName(entity.name), elementText] }),
  });
  let damage = 0;
  for (let i = 0; i < breath.dieSides; i++) damage += world.rng.rand(6) + 1;
  const resisted = world.player.statuses.some((s) => s.kind === `resist_${breath.element}`);
  if (resisted) damage = Math.floor(damage / 2);
  world.player.hp = Math.max(0, world.player.hp - damage);
  const message = formatMessage('The dragon breath hits %t%i!', { t: '', args: ['you'] });
  world.log.push({ turn: world.turn, text: message });
  if (resisted) {
    world.log.push({ turn: world.turn, text: 'You resist the worst of the breath.' });
  }
  return { breathed: true, damage, resisted, message };
}

// ─── Attack spells ──────────────────────────────────────────────────────────

export interface SpellAttackResult {
  resolved: boolean;
  hitCount: number;
}

function hitMonsterWithSpell(world: World, def: SpellDefRuntime, entity: Entity, centerDist: number): boolean {
  const monster = entity.monster!;
  // Spell hits wake and alert sleeping monsters like melee attacks.
  monster.sleepTurns = 0;
  monster.alert = true;
  // Story: casting at the quest boss triggers his magic-ward scene.
  questEvent(world, { kind: 'spell-cast-at', name: entity.name });
  const { hit } = attackRollHits(world.rng, playerCombatant(world).toHit, monster.stats.ac);
  const spellText = def.name.toLowerCase();
  if (!hit) {
    world.log.push({
      turn: world.turn,
      text: formatMessage('The %i misses %t%i!', { args: [spellText, midSentenceName(entity.name)], t: 'the ' }),
    });
    return false;
  }
  const kind = def.effect as 'missile' | 'bolt' | 'ball';
  const element = def.element;
  let damage = rollDamage(kind, def.tier ?? 1, world.rng, centerDist);
  let hitText: string;
  if (element && monster.stats.immuneElement === element) {
    // Part-2 bosses can be immune to an element (story 22: Surtur commands fire).
    damage = 0;
    hitText = `${entity.name} shrugs off the ${element}!`;
  } else if (element && monster.stats.vulnerableElement === element) {
    damage = Math.ceil(damage * 1.5);
    hitText = `The ${element} tears into ${entity.name}!`;
  } else {
    hitText = formatMessage('The %i hit %t%i!', { args: [spellText, midSentenceName(entity.name)], t: 'the ' });
  }
  monster.hp -= damage;
  if (monster.hp <= 0) {
    const level = world.levels.get(world.current)!;
    level.occupancy[idx(entity.x, entity.y)] = 0;
    level.entities.delete(entity.id);
    leaveMonsterRemains(world, entity);
    gainExperience(world.player, monster.stats.xp, world.data.xpThresholds ?? []);
    questEvent(world, { kind: 'monster-killed', name: entity.name });
    const gold = lootFor(monster.stats, world.rng);
    if (gold > 0) world.inventory.gold += gold;
  }
  world.log.push({ turn: world.turn, text: hitText });
  return true;
}

/**
 * Resolve an attack spell (missile/bolt/ball) against the monsters on the
 * current level. Missile: the target cell. Bolt: first monster along the
 * line, wall-stopped. Ball: every monster in the 3×3 area.
 */
export function resolveSpellAttack(world: World, def: SpellDefRuntime, target: { x: number; y: number }): SpellAttackResult {
  const level = world.levels.get(world.current)!;
  const player = world.player;
  const spellText = def.name.toLowerCase();

  if (def.effect === 'ball') {
    let hitCount = 0;
    const area = ballImpactArea(level, target);
    for (const cell of area) {
      const id = level.occupancy[idx(cell.x, cell.y)] ?? 0;
      if (id === 0) continue;
      const entity = level.entities.get(id);
      if (entity?.kind === 'monster' && entity.monster && entity.monster.hp > 0) {
        if (hitMonsterWithSpell(world, def, entity, cell.centerDist)) hitCount += 1;
      }
    }
    return { resolved: true, hitCount };
  }

  if (def.effect === 'bolt') {
    const path = boltPath(level, { x: player.x, y: player.y }, target);
    for (const point of path) {
      const id = level.occupancy[idx(point.x, point.y)] ?? 0;
      if (id !== 0) {
        const entity = level.entities.get(id);
        if (entity?.kind === 'monster' && entity.monster) {
          const hit = hitMonsterWithSpell(world, def, entity, 0);
          return { resolved: true, hitCount: hit ? 1 : 0 };
        }
      }
    }
    world.log.push({ turn: world.turn, text: formatMessage('The %i hit the wall!', { args: [spellText] }) });
    return { resolved: true, hitCount: 0 };
  }

  // missile: direct target cell
  const id = level.occupancy[idx(target.x, target.y)] ?? 0;
  const entity = id === 0 ? undefined : level.entities.get(id);
  if (entity?.kind === 'monster' && entity.monster) {
    const hit = hitMonsterWithSpell(world, def, entity, 0);
    return { resolved: true, hitCount: hit ? 1 : 0 };
  }
  world.log.push({ turn: world.turn, text: `The ${spellText} streaks into the darkness.` });
  return { resolved: true, hitCount: 0 };
}
