import { playerAttack, playerCombatant } from './combat';
import { idx, LEVEL_SIZE } from './map';
import { boltPath } from './spells';
import type { ItemDefRuntime } from './types';
import type { World } from './world';

export interface RangedProfile {
  range: number;
  ammoId?: string;
  throwable?: boolean;
  loud?: boolean;
  damage: { count: number; sides: number; bonus: number };
}

const profiles: Record<string, RangedProfile> = {
  'x-bow': { range: 6, ammoId: 'x-arrow', damage: { count: 1, sides: 6, bonus: 0 } },
  'x-crossbow': { range: 7, ammoId: 'x-bolt', damage: { count: 1, sides: 8, bonus: 1 } },
  'x-hand-cannon': { range: 4, ammoId: 'x-cannonball', loud: true, damage: { count: 2, sides: 6, bonus: 2 } },
  'x-rock': { range: 3, throwable: true, damage: { count: 1, sides: 4, bonus: 0 } },
  'x-bone': { range: 3, throwable: true, damage: { count: 1, sides: 3, bonus: 0 } },
  'x-whip': { range: 2, damage: { count: 1, sides: 4, bonus: 0 } },
};

export function rangedProfile(defId: string): RangedProfile | undefined {
  return Object.hasOwn(profiles, defId) ? profiles[defId] : undefined;
}

function weapon(id: string, name: string, weightGrams: number, weaponClass: number): ItemDefRuntime {
  return { id, name, kind: 'weapon', weightGrams, weaponClass, slot: 'weapon', stackable: false, consumable: false };
}
function ammo(id: string, name: string, weightGrams: number): ItemDefRuntime {
  return { id, name, kind: 'ammunition', weightGrams, slot: null, stackable: true, consumable: false };
}

export const EXPANSION_WEAPONS: Record<string, ItemDefRuntime> = {
  'x-bow': weapon('x-bow', 'Short Bow', 700, 3),
  'x-arrow': ammo('x-arrow', 'Arrow', 30),
  'x-crossbow': weapon('x-crossbow', 'Crossbow', 2200, 4),
  'x-bolt': ammo('x-bolt', 'Crossbow Bolt', 50),
  'x-hand-cannon': weapon('x-hand-cannon', 'Hand Cannon', 4200, 5),
  'x-cannonball': ammo('x-cannonball', 'Cannonball', 600),
  'x-rock': ammo('x-rock', 'Throwing Rock', 200),
  'x-bone': ammo('x-bone', 'Throwing Bone', 120),
  'x-bone-club': weapon('x-bone-club', 'Salvaged Bone Club', 900, 6),
  'x-whip': weapon('x-whip', 'Whip', 500, 4),
};

const descriptions: Record<string, string> = {
  'x-bow': 'Fires arrows up to 6 cells. Shot damage: 1d6 plus your damage bonus.',
  'x-arrow': 'One arrow is spent each time you fire a short bow.',
  'x-crossbow': 'Fires bolts up to 7 cells. Shot damage: 1d8+1 plus your damage bonus.',
  'x-bolt': 'One bolt is spent each time you fire a crossbow.',
  'x-hand-cannon': 'Fires cannonballs up to 4 cells. Shot damage: 2d6+2 plus your damage bonus. Wakes enemies within 10 cells.',
  'x-cannonball': 'One cannonball is spent each time you fire a hand cannon.',
  'x-rock': 'Throw up to 3 cells for 1d4 plus your damage bonus. Spent when thrown.',
  'x-bone': 'Throw up to 3 cells for 1d3 plus your damage bonus. Spent when thrown.',
  'x-bone-club': 'A salvaged melee weapon with weapon class 6.',
  'x-whip': 'Strike an enemy up to 2 cells away through clear space. Damage: 1d4 plus your damage bonus.',
};
for (const [id, description] of Object.entries(descriptions)) {
  Object.assign(EXPANSION_WEAPONS[id]!, { description });
}

/** Reject invalid shots before spending ammunition or combat random numbers. */
export function fireWeapon(world: World, target: { x: number; y: number }, itemUid?: string): { ok: boolean; message: string } {
  const reject = (message: string) => ({ ok: false, message });
  const equipped = world.inventory.equipment.weapon;
  const item = itemUid === undefined || itemUid === equipped?.uid
    ? equipped : world.inventory.pack.find((entry) => entry.uid === itemUid);
  const profile = item && rangedProfile(item.defId);
  if (!item || !profile || item.count < 1) return reject('Choose a ranged weapon or a throwing item.');
  if (item !== equipped && !profile.throwable) return reject('Equip that weapon before firing it.');
  if (!Number.isInteger(target.x) || !Number.isInteger(target.y) || target.x < 0 || target.y < 0 || target.x >= LEVEL_SIZE || target.y >= LEVEL_SIZE) {
    return reject('Choose a target inside the map.');
  }
  const distance = Math.max(Math.abs(target.x - world.player.x), Math.abs(target.y - world.player.y));
  if (distance < 1 || distance > profile.range) return reject(`That target is outside the weapon's ${profile.range}-cell range.`);
  if (!world.visible[idx(target.x, target.y)]) return reject('You cannot see that target.');
  const level = world.levels.get(world.current)!;
  const enemy = level.entities.get(level.occupancy[idx(target.x, target.y)]!);
  if (!enemy || enemy.kind !== 'monster' || !enemy.monster || enemy.monster.hp <= 0) return reject('Choose a living enemy.');
  const path = boltPath(level, world.player, target);
  const end = path.at(-1);
  if (end?.x !== target.x || end.y !== target.y || path.some((point, index) => {
    const cell = idx(point.x, point.y);
    const previous = index === 0 ? world.player : path[index - 1]!;
    const diagonal = point.x !== previous.x && point.y !== previous.y;
    const closedCorner = diagonal &&
      !world.data.tiles[level.tiles[idx(point.x, previous.y)]!]?.walkable &&
      !world.data.tiles[level.tiles[idx(previous.x, point.y)]!]?.walkable;
    return closedCorner || !world.data.tiles[level.tiles[cell]!]?.walkable ||
      (level.occupancy[cell] !== 0 && level.occupancy[cell] !== enemy.id);
  })) return reject('Something blocks the shot.');
  const spent = profile.throwable ? item : profile.ammoId
    ? world.inventory.pack.find((entry) => entry.defId === profile.ammoId && entry.count > 0) : undefined;
  if (profile.ammoId && !spent) return reject(`You need ${EXPANSION_WEAPONS[profile.ammoId]!.name.toLowerCase()} ammunition.`);

  const attacker = playerCombatant(world);
  attacker.damage = { ...profile.damage, bonus: profile.damage.bonus + attacker.damage.bonus };
  if (spent) {
    spent.count--;
    if (spent.count === 0) {
      world.inventory.pack = world.inventory.pack.filter((entry) => entry !== spent);
      if (spent === equipped) delete world.inventory.equipment.weapon;
    }
  }
  if (profile.loud) {
    for (const entity of level.entities.values()) {
      if (entity.kind === 'monster' && entity.monster && Math.max(Math.abs(entity.x - world.player.x), Math.abs(entity.y - world.player.y)) <= 10) {
        entity.monster.alert = true;
        entity.monster.sleepTurns = 0;
      }
    }
    world.log.push({ turn: world.turn, text: 'The hand cannon booms through the corridors.' });
  }
  const result = playerAttack(world, enemy.id, attacker);
  return { ok: true, message: result.message };
}
