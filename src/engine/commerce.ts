// Shop transactions as explicit engine operations (CODE-QUALITY Task 6,
// F14): every mutation returns a result instead of silently no-oping, and
// every rejection happens BEFORE any gold/item/health state changes.
//
// Pricing itself lives in pricing.ts — the SAME PriceQuote calculation
// drives both the merchant display and these transactions (UI plan A23).
import { pickup, dropItem, InventoryError } from './inventory';
import { buyCost, healPrice, sellGain } from './pricing';
import type { World } from './world';

/** The outcome of one shop transaction. */
export type CommerceResult =
  | { ok: true; goldDelta: number; message?: string }
  | { ok: false; reason: string };

function unknownItem(reason: string): CommerceResult {
  return { ok: false, reason };
}

/**
 * Buy `count` units of `defId` at market price. Rejections (unknown definition,
 * insufficient gold, over carry limit) leave gold and pack untouched.
 */
export function buyItem(world: World, defId: string, count = 1): CommerceResult {
  const def = world.data.items[defId];
  if (!def) return unknownItem(`unknown item definition '${defId}'`);
  if (!Number.isInteger(count) || count < 1 || count > 999) return { ok: false, reason: 'Choose a whole quantity from 1 to 999.' };
  if (!def.stackable && count !== 1) return { ok: false, reason: 'Buy this item one at a time.' };
  const quote = buyCost(def, count);
  if (world.inventory.gold < quote.total) return { ok: false, reason: 'Not enough gold.' };
  try {
    pickup(world.inventory, world.player, defId, world.data.items, count);
  } catch (err) {
    // pickup validated before mutating; surface the carry/registry reason.
    return unknownItem(err instanceof InventoryError || err instanceof Error ? err.message : 'Too heavy to carry.');
  }
  world.inventory.gold -= quote.total;
  return { ok: true, goldDelta: -quote.total };
}

/**
 * Sell `count` units (default: the whole stack) of a pack item. Store and
 * junk shops use the same sellGain rule the merchant UI quotes from.
 * Count validation happens before any mutation.
 */
export function sellItem(world: World, uid: string, count?: number, shop: 'store' | 'junk' = 'store'): CommerceResult {
  const item = world.inventory.pack.find((i) => i.uid === uid);
  if (!item) return unknownItem(`unknown item uid '${uid}'`);
  const def = world.data.items[item.defId];
  if (!def) return unknownItem(`unknown item definition '${item.defId}'`);
  const n = count ?? item.count;
  if (!Number.isInteger(n) || n < 1 || n > item.count) {
    return { ok: false, reason: `sell count must be a whole number between 1 and ${item.count}` };
  }
  const quote = sellGain(def, shop, n);
  dropItem(world.inventory, uid, n);
  world.inventory.gold += quote.total;
  return { ok: true, goldDelta: quote.total };
}

/**
 * Temple healing: 3 C.P. per missing hit point (manual APPROX, pricing.ts).
 * Rejected when healthy or broke — no partial charges.
 */
export function healPlayer(world: World): CommerceResult {
  const missing = world.player.maxHp - world.player.hp;
  if (missing <= 0) return { ok: false, reason: 'You are already at full health.' };
  const price = healPrice(missing);
  if (world.inventory.gold < price) return { ok: false, reason: 'Not enough gold.' };
  world.inventory.gold -= price;
  world.player.hp = world.player.maxHp;
  return { ok: true, goldDelta: -price, message: 'The priests heal your wounds.' };
}

/**
 * Sage identification. The engine currently has no unidentified-item state
 * (items.json carries full definitions), so the service can never change
 * item state — per the code-quality plan it must not charge for nothing.
 * Free + honest until an unidentified-state feature exists (if ever).
 */
export function identifyItem(world: World, uid: string): CommerceResult {
  const item = world.inventory.pack.find((i) => i.uid === uid);
  if (!item) return unknownItem(`unknown item uid '${uid}'`);
  return {
    ok: true,
    goldDelta: 0,
    message: `${world.data.items[item.defId]?.name ?? 'The item'} holds nothing hidden.`,
  };
}
