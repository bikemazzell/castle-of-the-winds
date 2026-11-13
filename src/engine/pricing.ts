// Merchant pricing rules (Task 5.4d).
//
// Item values are a table-wide extraction gap (docs/EXTRACTION-GAPS.md #1:
// original prices were runtime/haggling-driven). These APPROX derivations
// follow the manual's qualitative rules: stores sell at market, buy back at
// "a much lower price", the Junk Store pays market price below 25 C.P. else a
// flat 25 C.P. (topic 571-572 "Stores"), and the Sage quotes a price per
// identification. Currency base: copper pieces (CP).
import type { ItemDefRuntime } from './types';

/** APPROX market (buy) price in copper pieces. */
export function buyPrice(def: ItemDefRuntime): number {
  if (def.price !== undefined && Number.isFinite(def.price) && def.price >= 0) return Math.round(def.price);
  const expansionPrices: Record<string, number> = { 'x-bow': 600, 'x-arrow': 12, 'x-crossbow': 1200, 'x-bolt': 20, 'x-hand-cannon': 4800, 'x-cannonball': 90, 'x-rock': 6, 'x-bone': 4, 'x-bone-club': 180, 'x-whip': 450 };
  if (expansionPrices[def.id] !== undefined) return expansionPrices[def.id]!;
  if (def.armorClass !== undefined) return (def.armorClass + 1) * 200;
  if (def.weaponClass !== undefined) return (def.weaponClass + 1) * 150;
  // misc: potions/scrolls/books flat, wearables mid-range
  if (/potion/i.test(def.name)) return 150;
  if (/scroll|book/i.test(def.name)) return 300;
  return 400;
}

/** APPROX store buy-back offer (manual: "a much lower price"). */
export function sellPrice(def: ItemDefRuntime): number {
  return Math.max(1, Math.floor(buyPrice(def) / 3));
}

/** Junk Store rule (manual 572): market price if < 25 C.P., else flat 25. */
export function junkOffer(def: ItemDefRuntime): number {
  const market = sellPrice(def);
  return market < 25 ? market : 25;
}

/**
 * A priced line item shared by shop quotes and transactions (UI plan
 * Phase 5, A23): the SAME calculation must drive the displayed quote and
 * the applied gold change, including stack quantities and the junk rule.
 */
export interface PriceQuote {
  /** Price for a single unit in copper pieces. */
  readonly unit: number;
  /** Price for the whole line (unit × count). */
  readonly total: number;
  /** How many units the quote covers. */
  readonly count: number;
}

/** Market cost of buying `count` of an item from a shop. */
export function buyCost(def: ItemDefRuntime, count = 1): PriceQuote {
  const unit = buyPrice(def);
  return { unit, total: unit * count, count };
}

/** Gold gained selling `count` of an item — one rule for quote and transaction. */
export function sellGain(def: ItemDefRuntime, shop: 'store' | 'junk', count = 1): PriceQuote {
  const unit = shop === 'junk' ? junkOffer(def) : sellPrice(def);
  return { unit, total: unit * count, count };
}


/** APPROX Sage identification price per item. */
export function identifyPrice(_def: ItemDefRuntime): number {
  return 25;
}

/** APPROX temple healing: 3 C.P. per missing hit point. */
export function healPrice(missingHp: number): number {
  return missingHp * 3;
}
