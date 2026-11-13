// Inventory & equipment operations (Task 3.2).
// Pure data ops over Inventory; effect hooks go through EffectSystem
// (stubs until Task 3.3/3.4). Weight limits follow manual topic 294:
// rated maximum at normal speed, twice rated is the hard carry limit.
import type {
  EffectSystem,
  EquipSlot,
  Inventory,
  InventoryItem,
  ItemDefRuntime,
  Player,
} from './types';
import {
  damageBonus,
  dexArmorBonus,
  hardCarryLimit,
  movementSpeedPercent,
  ratedMaxCarry,
  toHitBonus,
} from './formulas';
import { statusArmorBonus } from './effects';

/** No-op effect system (Task 3.2 default; replaced in 3.3/3.4). */
export function defaultEffectSystem(): EffectSystem {
  return { onUse: () => null };
}

export function createInventory(): Inventory {
  return { pack: [], gold: 0, equipment: {}, seq: 0 };
}

/** Uids are definition + inventory-local sequence (stable across save/load). */
function newUid(inv: Inventory, defId: string): string {
  inv.seq += 1;
  return `${defId}#${inv.seq.toString(36)}`;
}

export function totalWeightGrams(inv: Inventory, defs: Record<string, ItemDefRuntime>): number {
  const packWeight = inv.pack.reduce(
    (sum, item) => sum + (defs[item.defId]?.weightGrams ?? 0) * item.count,
    0,
  );
  const equipWeight = Object.values(inv.equipment).reduce(
    (sum, item) => sum + (item ? (defs[item.defId]?.weightGrams ?? 0) : 0),
    0,
  );
  return packWeight + equipWeight; // gold is weightless (APPROX simplification)
}

export class InventoryError extends Error {}

/**
 * Picks up `count` of an item definition, merging stacks when stackable.
 * Throws when the total would exceed twice the rated maximum carry.
 */
export function pickup(
  inv: Inventory,
  player: Player,
  defId: string,
  defs: Record<string, ItemDefRuntime>,
  count = 1,
): InventoryItem {
  const def = defs[defId];
  if (!def) throw new InventoryError(`unknown item definition: ${defId}`);
  if (!Number.isInteger(count) || count < 1 || count > 999) {
    throw new InventoryError(`count must be an integer between 1 and 999 (got ${count})`);
  }
  const added = (def.weightGrams ?? 0) * count;
  const limit = hardCarryLimit(player.strength);
  if (totalWeightGrams(inv, defs) + added > limit) {
    throw new InventoryError(`too heavy: would exceed carry limit of ${limit} g`);
  }
  if (def.stackable) {
    const existing = inv.pack.find((i) => i.defId === defId);
    if (existing) {
      existing.count += count;
      return existing;
    }
  }
  const item: InventoryItem = { uid: newUid(inv, defId), defId, count };
  inv.pack.push(item);
  return item;
}

function findInPack(inv: Inventory, uid: string): InventoryItem {
  const item = inv.pack.find((i) => i.uid === uid);
  if (!item) throw new InventoryError(`item not in pack: ${uid}`);
  return item;
}

/** Drops exactly `count` (default all); throws on invalid counts. */
export function dropItem(inv: Inventory, uid: string, count?: number): void {
  const item = findInPack(inv, uid);
  const n = count ?? item.count;
  if (!Number.isInteger(n) || n < 1 || n > item.count) {
    throw new InventoryError(
      `drop count must be an integer between 1 and ${item.count} (got ${count})`,
    );
  }
  if (n >= item.count) {
    inv.pack = inv.pack.filter((i) => i.uid !== uid);
  } else {
    item.count -= n;
  }
}

/** First free ring slot, or the base slot for swaps. */
function targetSlot(def: ItemDefRuntime, inv: Inventory): EquipSlot {
  if (def.slot === 'ring1' && !inv.equipment.ring1) return 'ring1';
  if (def.slot === 'ring1' && !inv.equipment.ring2) return 'ring2';
  if (!def.slot) throw new InventoryError(`${def.name} cannot be equipped`);
  return def.slot;
}

export function equip(
  inv: Inventory,
  player: Player,
  uid: string,
  defs: Record<string, ItemDefRuntime>,
  sys?: EffectSystem,
): { slot: EquipSlot; item: InventoryItem } {
  const item = findInPack(inv, uid);
  const def = defs[item.defId];
  if (!def) throw new InventoryError(`unknown item definition: ${item.defId}`);
  const slot = targetSlot(def, inv);
  const occupied = inv.equipment[slot];
  // Equipping takes EXACTLY ONE item: a stack stays in the pack with count−1
  // and a fresh single-count item takes the slot (Task 7).
  let equippedItem: InventoryItem;
  if (item.count > 1) {
    item.count -= 1;
    equippedItem = { uid: newUid(inv, item.defId), defId: item.defId, count: 1 };
  } else {
    inv.pack = inv.pack.filter((i) => i.uid !== uid);
    equippedItem = item;
  }
  inv.equipment[slot] = equippedItem;
  if (occupied) inv.pack.push(occupied);
  sys?.onEquip?.(undefined, equippedItem, def);
  return { slot, item: equippedItem };
}

export function unequip(
  inv: Inventory,
  slot: EquipSlot,
  sys?: EffectSystem,
): InventoryItem {
  const item = inv.equipment[slot];
  if (!item) throw new InventoryError(`nothing equipped in ${slot}`);
  delete inv.equipment[slot];
  inv.pack.push(item);
  sys?.onUnequip?.(undefined, item, { id: item.defId, name: item.defId, kind: '', slot: null, stackable: false, consumable: false });
  return item;
}

export interface EquipmentStats {
  armorValue: number;
  weaponClass: number;
  toHit: number;
  damage: number;
  weightGrams: number;
  ratedMax: number;
  hardLimit: number;
  movementSpeedPercent: number;
}

/** Aggregated combat/carry stats: equipment pieces + attribute bonuses. */
export function equipmentStats(
  inv: Inventory,
  defs: Record<string, ItemDefRuntime>,
  player: Player,
): EquipmentStats {
  // Armor Value → d20 AC: original AVs (6..48, likely hit-chance percentages)
  // must map into the same 0..~12 regime the monster AC tiers use, or Plate
  // Mail would make the wearer literally unhittable (AV 48 vs d20 max 20+8).
  const ARMOR_TO_AC_DIVISOR = 4;
  let armorValue = dexArmorBonus(player.dexterity);
  let weaponClass = 0;
  for (const item of Object.values(inv.equipment)) {
    if (!item) continue;
    const def = defs[item.defId];
    if (!def) continue;
    armorValue += Math.floor((def.armorClass ?? 0) / ARMOR_TO_AC_DIVISOR); // manual 298: pieces affect all attacks
    if (def.slot === 'weapon') weaponClass = def.weaponClass ?? 0;
  }
  armorValue += statusArmorBonus(player); // Shield spell (Task 3.4)
  const weightGrams = totalWeightGrams(inv, defs);
  const ratedMax = ratedMaxCarry(player.strength);
  return {
    armorValue,
    weaponClass,
    toHit: toHitBonus(player.dexterity),
    damage: damageBonus(player.strength) + weaponClass,
    weightGrams,
    ratedMax,
    hardLimit: hardCarryLimit(player.strength),
    movementSpeedPercent: movementSpeedPercent(weightGrams, ratedMax),
  };
}

/**
 * Activates an item through the effect system. Consumables are decremented
 * when the effect reports consumption. Returns the effect (or null for the
 * stub system).
 */
export function useItem(
  inv: Inventory,
  uid: string,
  defs: Record<string, ItemDefRuntime>,
  sys: EffectSystem = defaultEffectSystem(),
  world?: unknown,
): { consumed: boolean; message?: string } | null {
  const item = findInPack(inv, uid);
  const def = defs[item.defId];
  if (!def) throw new InventoryError(`unknown item definition: ${item.defId}`);
  const effect = sys.onUse(world, item, def);
  if (effect?.consumed) {
    if (item.count > 1) item.count -= 1;
    else inv.pack = inv.pack.filter((i) => i.uid !== uid);
  }
  return effect;
}

/** Per-turn inventory ticking: light-source fuel burn-down. */
export function tickInventory(inv: Inventory, turns = 1): void {
  const expired: string[] = [];
  for (const item of inv.pack) {
    if (item.fuelTurns !== undefined) {
      item.fuelTurns = Math.max(0, item.fuelTurns - turns);
      if (item.fuelTurns === 0) expired.push(item.uid);
    }
  }
  if (expired.length > 0) {
    inv.pack = inv.pack.filter((i) => !expired.includes(i.uid));
  }
}

/** Original Auto Arrange option: sort pack by kind then name. */
export function autoArrange(
  inv: Inventory,
  defs: Record<string, ItemDefRuntime>,
): void {
  const rank = (kind: string) =>
    kind === 'armor' ? 0 : kind === 'helmet' ? 1 : kind === 'shield' ? 2 : kind === 'weapon' ? 3 : 4;
  inv.pack.sort((a, b) => {
    const da = defs[a.defId];
    const db = defs[b.defId];
    const ka = da ? rank(da.kind) : 9;
    const kb = db ? rank(db.kind) : 9;
    if (ka !== kb) return ka - kb;
    return (da?.name ?? a.defId).localeCompare(db?.name ?? b.defId);
  });
}
