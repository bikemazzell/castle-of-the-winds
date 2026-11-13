// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameController, afterActionEffects, type GameController } from './controller';
import { loadWorldData, newWorld } from '../engine/game';
import { createCharacter } from '../engine/character';
import { deserializeGame, serializeGame } from '../engine/save';
import { loadTownShops } from './scenes/town';
import { closeAllModals } from './ui/dialogs';
import { buyCost, sellGain, healPrice } from '../engine/pricing';
import { idx } from '../engine/map';
import { pickup } from '../engine/inventory';
import type { World } from '../engine/world';
import type { WorldData } from '../engine/types';
import { createSaveManager, type SaveManager, type SaveStorage } from './saves/manager';
import type { PreferenceStorage } from './prefs';
import { chatterLine } from '../engine/chatter';
import { curseLine } from '../engine/curses';
import { garbleSpeech } from '../engine/injured-speech';
import { MSLCG } from '../engine/rng';
import type { Entity } from '../engine/map';

let controller: GameController | null = null;
let root: HTMLElement;
/** Late-bound target for the injected screenToWorld (enemy-spell test). */
const pickTarget = { x: 0, y: 0 };

function memoryStorage(): SaveStorage & { dump(): Map<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    dump: () => map,
  };
}

const INIT = {
  name: 'Sigrun',
  gender: 'female',
  strength: 50,
  intelligence: 50,
  constitution: 50,
  dexterity: 50,
  difficulty: 'intermediate',
} as const;

let prefsStore: ReturnType<typeof memoryStorage>;

function bootstrap(
  opts: { realCamera?: boolean; now?: () => number; reducedMotion?: () => boolean } = {},
): GameController {
  root = document.createElement('div');
  document.body.appendChild(root);
  prefsStore = memoryStorage();
  controller = createGameController({
    root,
    data: loadWorldData(),
    town: loadTownShops(),
    win: window,
    now: opts.now ?? (() => 0x5eed),
    reducedMotion: opts.reducedMotion,
    loadTileSprites: () => Promise.resolve({}),
    // Tests inject a fixed mapping; the A04 resize test needs the real
    // camera-based path, so it opts out.
    ...(opts.realCamera ? {} : { screenToWorld: () => ({ ...pickTarget }) }),
    saves: createSaveManager({ storage: memoryStorage() }),
    storage: prefsStore, // favorites + onboarding isolated per test
  });
  controller.start();
  return controller;
}

/** Run the new-game wizard flow and return the spawned world. */
function beginGame(c: GameController): World {
  c.newGame();
  const name = document.querySelector('.modal-overlay [data-field="name"]') as HTMLInputElement;
  name.value = 'Sigrun';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  (document.querySelector('.modal-overlay [data-action="begin"]') as HTMLButtonElement).click();
  const world = c.getWorld();
  if (!world) throw new Error('world did not spawn');
  // Dismiss the opening cutscene (intro story text).
  for (;;) {
    const btn = document.querySelector<HTMLButtonElement>('.story-overlay [data-action="continue"]');
    if (!btn) break;
    btn.click();
  }
  return world;
}

/**
 * A window-like object whose `localStorage` property access itself throws
 * (browsers can do this when storage is disabled by policy). The controller
 * must fall back to its no-op storage instead of crashing at construction.
 */
function windowWithThrowingStorage(): Window {
  const w = Object.create(window) as Window;
  Object.defineProperty(w, 'localStorage', {
    get(): Storage {
      throw new DOMException('Access is denied for this document', 'SecurityError');
    },
    configurable: true,
  });
  return w;
}

/** Dismiss any visible story overlays (mirrors a player clicking through). */
function dismissStoryAll(): void {
  for (let i = 0; i < 40; i++) {
    const btn = document.querySelector<HTMLButtonElement>('.story-overlay [data-action="continue"]');
    if (btn) { btn.click(); continue; }
    break;
  }
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  closeAllModals();
  controller?.destroy();
  controller = null;
});

describe('stale dialog after death (UI plan Phase 1)', () => {
  it('inventory does not reopen after the player dies mid-use', () => {
    const c = bootstrap();
    const w = beginGame(c);
    // Dungeon scene: level 1, player placed adjacent to an alerted monster.
    const hooks = (window as unknown as {
      __cotw: { scene: (n: string) => { ok: boolean; detail?: string } };
    }).__cotw;
    const combat = hooks.scene('combat');
    expect(combat.ok).toBe(true);
    const level = w.levels.get(1);
    expect(level).toBeDefined();
    // Silence every non-adjacent monster (sleepers skip without RNG use) so
    // the alerted neighbor's attack is the first roll after setState.
    let target: Entity | null = null;
    for (const e of level!.entities.values()) {
      if (e.kind !== 'monster' || !e.monster) continue;
      const d = Math.max(Math.abs(e.x - w.player.x), Math.abs(e.y - w.player.y));
      if (d === 1) {
        target = e;
        e.monster.alert = true;
      } else {
        e.monster.sleepTurns = 1000;
      }
    }
    expect(target).not.toBeNull();
    w.player.hp = 1;
    pickup(w.inventory, w.player, 'i-potion', w.data.items, 1);
    // Find a gameplay seed whose first d20 roll is a guaranteed hit (roll ≥ 17
    // beats AC 2 + 10 with any monster toHit ≥ −5).
    let seed = 1;
    for (; seed < 500000; seed++) {
      if (new MSLCG(seed).rand(20) >= 16) break;
    }
    w.rng.setState(seed);
    // Open the inventory, select the potion, and use it (generic Potion =
    // no-op effect, but the turn passes and the alerted monster kills the
    // 1-hp player).
    const invBtn = root.querySelector<HTMLButtonElement>('button[data-action="inventory"]');
    expect(invBtn).not.toBeNull();
    invBtn!.click();
    const row = document.querySelector('.modal-overlay .item-row[data-uid]');
    expect(row).not.toBeNull();
    (row!.querySelector('button') as HTMLButtonElement).click(); // select
    const useBtn = document.querySelector('.modal-overlay [data-field="primary-action"]');
    expect(useBtn?.textContent).toMatch(/use/i);
    (useBtn as HTMLButtonElement).click();
    // The death dialog must be the only dialog on screen…
    expect(document.body.textContent).toContain('You are dead');
    // …and the inventory panel must have closed beneath it.
    expect(document.querySelector('.modal-overlay .inventory-panel')).toBeNull();
    expect(c.isDead()).toBe(true);
  });
});

describe('title + new game', () => {
  it('start() shows the title overlay with a New Game button', () => {
    const c = bootstrap();
    expect(root.querySelector('.title-overlay')).not.toBeNull();
    expect(root.querySelector('[data-action="new-game"]')).not.toBeNull();
    expect(c.getWorld()).toBeNull();
  });

  it('New Game opens the wizard; Begin spawns the world and hides the title', () => {
    const c = bootstrap();
    const world = beginGame(c);
    expect(world.player.name).toBe('Sigrun');
    expect(root.querySelector('.title-overlay')).toBeNull();
    expect(root.querySelector('.map canvas')).not.toBeNull();
    const hud = root.querySelector('.hud-bar');
    expect(hud?.querySelector('[data-field="name"]')?.textContent).toBe('Sigrun');
    expect(hud?.querySelector('[data-field="place"]')?.textContent).toBe('Map · Crossroads · 08:00');
  });
});

describe('dispatchAction', () => {
  it('moves the player east and updates the HUD', () => {
    const c = bootstrap();
    const world = beginGame(c);
    const x0 = world.player.x;
    c.dispatchAction({ type: 'MOVE', dx: 1, dy: 0 });
    expect(world.player.x).toBe(x0 + 1);
  });

  it('ignores actions before a world exists', () => {
    const c = bootstrap();
    expect(() => c.dispatchAction({ type: 'WAIT' })).not.toThrow();
  });

  it('stairs need an explicit confirm: MOVE lands, own-cell tap descends', () => {
    const c = bootstrap();
    const world = beginGame(c);
    const stairs = world.data.town.mineEntrance;
    // find a walkable neighbor south/east of the stairs to step from
    const level = world.levels.get(0)!;
    let from = { x: stairs.x, y: stairs.y + 1 };
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const t = level.tiles[idx(stairs.x + dx, stairs.y + dy)] ?? 0;
      if (world.data.tiles[String(t)]?.walkable) {
        from = { x: stairs.x + dx, y: stairs.y + dy };
        break;
      }
    }
    world.player.x = from.x;
    world.player.y = from.y;
    c.dispatchAction({ type: 'MOVE', dx: stairs.x - from.x, dy: stairs.y - from.y });
    // Phase 2: no auto-descend — the hero stands on the stair, same level.
    expect(world.current).toBe(0);
    expect(world.player.x).toBe(stairs.x);
    expect(world.player.y).toBe(stairs.y);
    // Own-cell tap performs the explicit transition.
    const cotw = window as unknown as {
      __cotw: { travel: { tap: (cell: { x: number; y: number }, pointerType?: string) => void } };
    };
    cotw.__cotw.travel.tap({ x: stairs.x, y: stairs.y }, 'touch');
    expect(world.current).toBe(1);
    const place = root.querySelector('[data-field="place"]')?.textContent;
    expect(place).toBe('Map · The Mine, Level 1');
    expect(world.log.some((e) => e.text.includes('descend'))).toBe(true);
  });
});

describe('afterActionEffects', () => {
  const base = { ...INIT };
  it('detects death', () => {
    const w = newWorld({ worldSeed: 1, player: base });
    w.player.hp = 0;
    expect(afterActionEffects(w, 1)).toBe('death');
  });
  it('detects a level gain', () => {
    const w = newWorld({ worldSeed: 1, player: base });
    w.player.level = 2;
    expect(afterActionEffects(w, 1)).toBe('level-up');
  });
  it('returns null otherwise', () => {
    const w = newWorld({ worldSeed: 1, player: base });
    expect(afterActionEffects(w, 1)).toBeNull();
  });
});

describe('town merchants', () => {
  it('warns before discarding a purchase made after saving',()=>{
    const c=bootstrap();const world=beginGame(c);world.inventory.gold=2000;
    world.player.x=16;world.player.y=16;
    document.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-pause-action="save"]')!.click();
    document.querySelector<HTMLButtonElement>('.dialog [data-action="save"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-slot-id="2"] [data-action="save-here"]')!.click();
    c.openMerchant(loadTownShops().shops.gunnhild!);
    document.querySelector<HTMLButtonElement>('.merchant-buy-list .item-row-button')!.click();
    document.querySelector<HTMLButtonElement>('[data-field="primary-action"]')!.click();
    document.querySelector<HTMLButtonElement>('.modal-overlay [data-action="close"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-pause-action="quit"]')!.click();
    expect(document.querySelector('[data-action="quit-without"]')).not.toBeNull();
  });

  it('a shop door needs an explicit open: MOVE stays silent, Enter opens', () => {
    const c = bootstrap();
    const world = beginGame(c);
    // step onto Snorri's door from the south
    world.player.x = 6;
    world.player.y = 8;
    c.dispatchAction({ type: 'MOVE', dx: 0, dy: -1 });
    expect(world.player.x).toBe(6);
    expect(world.player.y).toBe(7);
    // Phase 2: no auto-open on arrival.
    expect(document.querySelector('.modal-overlay')).toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    const title = document.querySelector('.dialog-title')?.textContent;
    expect(title).toContain('Snorri the Sage');
  });

  it('buy decreases gold and adds the item; sell restores it', () => {
    const c = bootstrap();
    const world = beginGame(c);
    const openGunnhild = (): void => {
      world.player.x = 16;
      world.player.y = 17;
      c.dispatchAction({ type: 'MOVE', dx: 0, dy: -1 }); // Gunnhild's door (16,16)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    };
    world.inventory.gold = 2000;
    openGunnhild();

    // Select the first stock row, then the single primary action buys it.
    const buyRow = document.querySelector<HTMLElement>('.merchant-buy-list .item-row[data-def-id]');
    expect(buyRow).not.toBeNull();
    const defId = buyRow!.getAttribute('data-def-id')!;
    const def = world.data.items[defId]!;
    const quote = buyCost(def, 1);
    expect(buyRow!.querySelector('.merchant-price')?.textContent).toBe(`${quote.total} Gold`);

    (buyRow!.querySelector('.item-row-button') as HTMLButtonElement).click();
    const buyAction = document.querySelector<HTMLButtonElement>('[data-field="primary-action"]');
    expect(buyAction?.textContent).toContain('Buy');
    buyAction!.click();
    expect(world.inventory.gold).toBe(2000 - quote.total);
    expect(world.inventory.pack.some((i) => i.defId === defId)).toBe(true);

    // Sell it back on the Sell tab; the panel refreshes in place.
    (document.querySelector('[data-mtab="sell"]') as HTMLButtonElement).click();
    const sellRow = document.querySelector<HTMLElement>(
      `.merchant-sell-list .item-row[data-uid="${world.inventory.pack.find((i) => i.defId === defId)!.uid}"]`,
    );
    expect(sellRow).not.toBeNull();
    (sellRow!.querySelector('.item-row-button') as HTMLButtonElement).click();
    const sellAction = document.querySelector<HTMLButtonElement>('[data-field="primary-action"]');
    expect(sellAction?.textContent).toContain('Sell');
    const gain = sellGain(def, 'store', 1).total;
    sellAction!.click();
    expect(world.inventory.gold).toBe(2000 - quote.total + gain);
    expect(world.inventory.pack.some((i) => i.defId === defId)).toBe(false);
  });

  it('junk store pays the quoted junk rate, not the store rate (A23)', () => {
    const c = bootstrap();
    const world = beginGame(c);
    // Two long swords: store rate would be 450 each (900), junk rule pays 25 each.
    world.inventory.gold = 0;
    for (let i = 0; i < 2; i++) {
      world.inventory.pack.push({ uid: `sword-${i}`, defId: 'i-long-sword', count: 1 });
    }
    // Olaf's Junk Store door (25,23): stand on it and open.
    world.player.x = 25;
    world.player.y = 23;
    c.dispatchAction({ type: 'MOVE', dx: 0, dy: 0 }); // no-op move keeps turn semantics simple
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    // Junk shops open on the Sell tab with one row per sword.
    const rows = document.querySelectorAll('.merchant-sell-list .item-row[data-uid]');
    expect(rows.length).toBe(2);
    const row = rows[0]! as HTMLElement;
    expect(row.querySelector('.merchant-price')?.textContent).toContain('25 Gold'); // junk quote displayed
    (row.querySelector('.item-row-button') as HTMLButtonElement).click();
    const sellAction = document.querySelector<HTMLButtonElement>('[data-field="primary-action"]');
    expect(sellAction?.textContent).toContain('25 Gold');
    sellAction!.click();
    expect(world.inventory.gold).toBe(25); // junk rate applied — not 450
  });

  it('temple heal charges the exact quote and restores full health (CODE-QUALITY Task 6)', () => {
    const c = bootstrap();
    const world = beginGame(c);
    const missing = 4;
    world.player.hp = world.player.maxHp - missing;
    world.inventory.gold = 100;
    // Church door (16,23): stand on it and open.
    world.player.x = 16;
    world.player.y = 23;
    c.dispatchAction({ type: 'MOVE', dx: 0, dy: 0 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    const healBtn = document.querySelector<HTMLButtonElement>('[data-action="heal"]');
    expect(healBtn).not.toBeNull();
    healBtn!.click();
    expect(world.player.hp).toBe(world.player.maxHp);
    expect(world.inventory.gold).toBe(100 - healPrice(missing)); // 3 per missing point
    expect(world.log.some((e) => /priests heal/i.test(e.text))).toBe(true);
  });

  it('the Sage never charges while identification cannot change item state (CODE-QUALITY Task 6)', () => {
    const c = bootstrap();
    const world = beginGame(c);
    world.inventory.gold = 100;
    pickup(world.inventory, world.player, 'i-long-sword', world.data.items, 1);
    // Snorri's door (6,7).
    world.player.x = 6;
    world.player.y = 7;
    c.dispatchAction({ type: 'MOVE', dx: 0, dy: 0 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    const row = document.querySelector<HTMLElement>('[data-identify-uid]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('Free');
    (row!.querySelector('button') as HTMLButtonElement).click();
    expect(world.inventory.gold).toBe(100); // honest service: zero charge
    expect(world.log.some((e) => /nothing hidden/i.test(e.text))).toBe(true);
  });
});

describe('spells', () => {
  it('self spell: spellbook Cast dispatches CAST and applies the status', () => {
    const c = bootstrap();
    const world = beginGame(c);
    world.player.knownSpells.push('s675'); // LIGHT
    world.player.mana = 10;
    world.player.maxMana = 10;
    c.dispatchAction({ type: 'WAIT' }); // no-op spacing turn
    // open spellbook via HUD command route
    root.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();
    const row = document.querySelector('[data-spell="s675"]') as HTMLElement;
    expect(row).not.toBeNull();
    (row.querySelector('[data-action="cast"]') as HTMLButtonElement).click();
    expect(world.player.mana).toBe(9);
    expect(world.player.statuses.some((s) => s.kind === 'light')).toBe(true);
  });

  it('enemy spell: one target click casts immediately', () => {
    const c = bootstrap();
    const world = beginGame(c);
    world.player.knownSpells.push('s527'); // FIREBALL, enemy target
    world.player.mana = 20;
    world.player.maxMana = 20;
    c.dispatchAction({ type: 'WAIT' });
    root.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();
    (document.querySelector('[data-spell="s527"] [data-action="cast"]') as HTMLButtonElement).click();
    // targeting bar is up: input gated, Cast disabled until a target is chosen
    expect(document.querySelector('.target-bar')).not.toBeNull();
    expect(c.isInputEnabled()).toBe(false);
    expect(
      document.querySelector<HTMLButtonElement>('[data-action="cast-target"]')!.disabled,
    ).toBe(true);
    // One visible target click completes the cast.
    const cell = { x: world.player.x + 1, y: world.player.y };
    const cotwTap = (window as unknown as {
      __cotw: { travel: { tap: (c2: { x: number; y: number }, t?: string) => void } };
    }).__cotw.travel.tap;
    cotwTap(cell, 'touch');
    expect(document.querySelector('.target-bar')).toBeNull();
    expect(c.isInputEnabled()).toBe(true);
    const castLog = world.log.find((e) => e.text.includes('FIREBALL'));
    expect(castLog).toBeDefined();
    expect(world.player.mana).toBe(20 - 8); // level 1 caster: 5 + 4 - 1
  });

  it('targeting: unseen cell is refused without spending mana or a turn', () => {
    const c = bootstrap();
    const world = beginGame(c);
    world.player.knownSpells.push('s527'); // FIREBALL
    world.player.mana = 20;
    world.player.maxMana = 20;
    const turnBefore = world.turn;
    c.dispatchAction({ type: 'WAIT' });
    root.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();
    (document.querySelector('[data-spell="s527"] [data-action="cast"]') as HTMLButtonElement).click();
    // (3,0) is behind fog in the town fixture (spawn 16,20; fog surrounds)
    (window as unknown as {
      __cotw: { travel: { tap: (c2: { x: number; y: number }, t?: string) => void } };
    }).__cotw.travel.tap({ x: 3, y: 0 }, 'touch');
    const notice = document.querySelector('[data-field="target-notice"]')?.textContent ?? '';
    expect(notice).toMatch(/cannot target/i);
    expect(document.querySelector('.target-bar')).not.toBeNull();
    expect(world.player.mana).toBe(20);
    expect(world.turn).toBe(turnBefore + 1); // only the spacing WAIT
  });

  it('targeting: Cancel button ends targeting without spending mana or a turn', () => {
    const c = bootstrap();
    const world = beginGame(c);
    world.player.knownSpells.push('s527'); // FIREBALL
    world.player.mana = 20;
    world.player.maxMana = 20;
    const turnBefore = world.turn;
    c.dispatchAction({ type: 'WAIT' });
    root.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();
    (document.querySelector('[data-spell="s527"] [data-action="cast"]') as HTMLButtonElement).click();
    (document.querySelector('[data-action="cancel-target"]') as HTMLButtonElement).click();
    expect(document.querySelector('.target-bar')).toBeNull();
    expect(c.isInputEnabled()).toBe(true);
    expect(world.player.mana).toBe(20);
    expect(world.turn).toBe(turnBefore + 1); // only the spacing WAIT
  });

  it('targeting: Escape keydown cancels targeting', () => {
    const c = bootstrap();
    const world = beginGame(c);
    world.player.knownSpells.push('s527'); // FIREBALL
    world.player.mana = 20;
    world.player.maxMana = 20;
    c.dispatchAction({ type: 'WAIT' });
    root.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();
    (document.querySelector('[data-spell="s527"] [data-action="cast"]') as HTMLButtonElement).click();
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(document.querySelector('.target-bar')).toBeNull();
    expect(c.isInputEnabled()).toBe(true);
  });

  it('targeting: keyboard Tab cycles visible monsters and Enter casts', () => {
    const c = bootstrap();
    const world = beginGame(c);
    const hooks = (window as unknown as {
      __cotw: {
        scene: (n: string) => { ok: boolean; detail?: string };
        entities: () => { x: number; y: number; name: string }[];
        targeting: () => { active: boolean; cell: { x: number; y: number } | null };
      };
    }).__cotw;
    // combat review scene: player adjacent to an alerted monster on level 1
    expect(hooks.scene('combat').ok).toBe(true);
    dismissStoryAll();
    world.player.knownSpells.push('s527'); // FIREBALL
    world.player.mana = 30;
    world.player.maxMana = 30;
    const targets = hooks.entities();
    expect(targets.length).toBeGreaterThan(0);
    c.dispatchAction({ type: 'WAIT' });
    root.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();
    (document.querySelector('[data-spell="s527"] [data-action="cast"]') as HTMLButtonElement).click();
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
    );
    const notice = document.querySelector('[data-field="target-notice"]')?.textContent ?? '';
    expect(notice).toMatch(/target:/i);
    expect(hooks.targeting().cell).not.toBeNull();
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(document.querySelector('.target-bar')).toBeNull();
    const castLog = world.log.find((e) => e.text.includes('FIREBALL'));
    expect(castLog).toBeDefined();
  });

  it('targeting: movement keys do not move the player while targeting', () => {
    const c = bootstrap();
    const world = beginGame(c);
    const hooks = (window as unknown as {
      __cotw: { position: () => { x: number; y: number; level: number } | null };
    }).__cotw;
    world.player.knownSpells.push('s527'); // FIREBALL
    world.player.mana = 20;
    world.player.maxMana = 20;
    c.dispatchAction({ type: 'WAIT' });
    const posBefore = { ...hooks.position()! };
    root.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();
    (document.querySelector('[data-spell="s527"] [data-action="cast"]') as HTMLButtonElement).click();
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    expect(hooks.position()).toEqual(posBefore);
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  });
});

describe('cast flash feedback (UI plan Phase 6)', () => {
  it('flashCellsFor covers the spell geometry: ball 3×3, bolt path, missile cell, self cell', async () => {
    const { flashCellsFor } = await import('./controller');
    const { createEmptyLevel } = await import('../engine/map');
    const { loadWorldData } = await import('../engine/game');
    const data = loadWorldData();
    const level = createEmptyLevel(1);
    for (let i = 0; i < level.tiles.length; i++) level.tiles[i] = 1; // open floor

    const ball = flashCellsFor(data.spells['s527']!, level, { x: 10, y: 10 }, { x: 12, y: 12 });
    expect(ball).toHaveLength(9);
    expect(ball).toContainEqual({ x: 12, y: 12 });
    expect(ball).toContainEqual({ x: 11, y: 11 });
    expect(ball).toContainEqual({ x: 13, y: 13 });

    const bolt = flashCellsFor(data.spells['s522']!, level, { x: 10, y: 10 }, { x: 14, y: 10 });
    expect(bolt.length).toBeGreaterThanOrEqual(4);
    expect(bolt).toContainEqual({ x: 11, y: 10 });
    expect(bolt).toContainEqual({ x: 14, y: 10 });
    expect(bolt).not.toContainEqual({ x: 10, y: 10 });

    const missile = flashCellsFor(data.spells['s510']!, level, { x: 10, y: 10 }, { x: 10, y: 13 });
    expect(missile).toEqual([{ x: 10, y: 13 }]);

    const self = flashCellsFor(data.spells['s675']!, level, { x: 7, y: 8 });
    expect(self).toEqual([{ x: 7, y: 8 }]);
  });

  it('a successful cast starts a brief flash; it fades out by duration end', () => {
    let fakeNow = 1_000;
    const c = bootstrap({ now: () => fakeNow });
    const world = beginGame(c);
    const hooks = (window as unknown as {
      __cotw: { flash: () => { active: boolean; cells: number; remainingMs: number } };
    }).__cotw;
    world.player.knownSpells.push('s675'); // LIGHT (self)
    world.player.mana = 10;
    world.player.maxMana = 10;
    root.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();
    (document.querySelector('[data-spell="s675"] [data-action="cast"]') as HTMLButtonElement).click();
    expect(world.player.mana).toBe(9); // cast actually happened
    expect(hooks.flash()).toEqual({ active: true, cells: 1, remainingMs: 400 });

    fakeNow += 399;
    expect(hooks.flash().active).toBe(true); // last flickering frame
    fakeNow += 1;
    expect(hooks.flash().active).toBe(false); // expired
  });

  it('reduced motion skips the flash entirely', () => {
    const c = bootstrap({ reducedMotion: () => true });
    const world = beginGame(c);
    const hooks = (window as unknown as {
      __cotw: { flash: () => { active: boolean; cells: number; remainingMs: number } };
    }).__cotw;
    world.player.knownSpells.push('s675'); // LIGHT (self)
    world.player.mana = 10;
    world.player.maxMana = 10;
    root.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();
    (document.querySelector('[data-spell="s675"] [data-action="cast"]') as HTMLButtonElement).click();
    expect(world.player.mana).toBe(9); // cast happened…
    expect(hooks.flash().active).toBe(false); // …but no animation feedback
  });

  it('a rejected cast (not enough mana) never flashes', () => {
    const c = bootstrap();
    const world = beginGame(c);
    const hooks = (window as unknown as {
      __cotw: { flash: () => { active: boolean; cells: number; remainingMs: number } };
    }).__cotw;
    world.player.knownSpells.push('s527'); // FIREBALL costs 8
    world.player.mana = 2;
    world.player.maxMana = 20;
    c.dispatchAction({ type: 'CAST', spellId: 's527' });
    expect(world.player.mana).toBe(2); // rejected
    expect(hooks.flash().active).toBe(false);
  });
});

describe('spellbook favorites + quick slots (UI plan Phase 6)', () => {
  it('toggle pins a spell and shows it in the first HUD quick slot', () => {
    const c = bootstrap();
    const world = beginGame(c);
    world.player.knownSpells.push('s323'); // SHIELD
    c.dispatchAction({ type: 'WAIT' });
    root.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();

    const fav = document.querySelector('[data-spell="s323"] [data-action="toggle-favorite"]') as HTMLButtonElement;
    expect(fav.getAttribute('aria-pressed')).toBe('false');
    fav.click();

    // Panel refreshed in place: mark flipped, row still present.
    const favAfter = document.querySelector('[data-spell="s323"] [data-action="toggle-favorite"]') as HTMLButtonElement;
    expect(favAfter.getAttribute('aria-pressed')).toBe('true');

    // HUD slot 0 now carries the spell with live cost.
    const slot = root.querySelector<HTMLButtonElement>('.quickbar [data-action="slot-0"]');
    expect(slot?.disabled).toBe(false);
    expect(slot?.textContent).toContain('SHIELD');
    expect(slot?.textContent).toContain('1');
  });

  it('clicking a quick slot casts the self spell', () => {
    const c = bootstrap();
    const world = beginGame(c);
    world.player.knownSpells.push('s323');
    c.dispatchAction({ type: 'WAIT' });
    root.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();
    (document.querySelector('[data-spell="s323"] [data-action="toggle-favorite"]') as HTMLButtonElement).click();
    closeAllModals();

    const before = { mana: world.player.mana, turn: world.turn };
    (root.querySelector('.quickbar [data-action="slot-0"]') as HTMLButtonElement).click();
    expect(world.player.mana).toBe(before.mana - 1);
    expect(world.turn).toBe(before.turn + 1);
    expect(world.player.statuses.some((s) => s.kind === 'shield')).toBe(true);
  });

  it('an unaffordable favorite stays visible in its slot but disabled', () => {
    const c = bootstrap();
    const world = beginGame(c);
    world.player.knownSpells.push('s527'); // FIREBALL costs 8 at level 1
    world.player.mana = 5;
    c.dispatchAction({ type: 'WAIT' });
    root.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();
    (document.querySelector('[data-spell="s527"] [data-action="toggle-favorite"]') as HTMLButtonElement).click();
    closeAllModals();

    const slot = root.querySelector<HTMLButtonElement>('.quickbar [data-action="slot-0"]');
    expect(slot?.textContent).toContain('FIREBALL');
    expect(slot?.disabled).toBe(true);
    expect(slot?.getAttribute('aria-label')).toContain('mana');
  });

  it('keeps at most two favorites', () => {
    const c = bootstrap();
    const world = beginGame(c);
    for (const id of ['s323', 's512', 's675']) world.player.knownSpells.push(id);
    c.dispatchAction({ type: 'WAIT' });
    root.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();
    for (const id of ['s323', 's512', 's675']) {
      (document.querySelector(`[data-spell="${id}"] [data-action="toggle-favorite"]`) as HTMLButtonElement).click();
    }
    closeAllModals();
    const slots = root.querySelectorAll('.quickbar [data-action^="slot-"]:not([hidden])');
    expect(slots.length).toBe(2);
    expect((slots[0] as HTMLElement).textContent).toContain('SHIELD');
    expect((slots[1] as HTMLElement).textContent).toContain('HEAL');
  });
});

describe('death + rest + menus', () => {
  it('death opens the death dialog and disables input', () => {
    const c = bootstrap();
    const world = beginGame(c);
    world.player.hp = 0;
    c.dispatchAction({ type: 'WAIT' });
    expect(c.isDead()).toBe(true);
    expect(document.querySelector('.dialog-title')?.textContent).toMatch(/dead|fallen/i);
    expect(c.isInputEnabled()).toBe(false);
  });

  it('rest command opens the rest dialog and REST refills mana', () => {
    const c = bootstrap();
    const world = beginGame(c);
    world.player.mana = 0;
    c.dispatchAction({ type: 'WAIT' });
    // Rest lives in the Actions panel (Phase 3 dock)
    root.querySelector<HTMLButtonElement>('[data-action="actions"]')!.click();
    expect(root.querySelector<HTMLElement>('.action-palette')?.hidden).toBe(false);
    (document.querySelector('.action-palette [data-action="rest"]') as HTMLButtonElement).click();
    expect(document.querySelector('.dialog-title')?.textContent).toMatch(/rest/i);
    // the dialog-level rest button (inside .dialog) triggers the engine REST
    (document.querySelector('.dialog [data-action="rest"]') as HTMLButtonElement).click();
    expect(world.player.mana).toBeGreaterThan(0);
  });

  it('pause screen opens with settings + help; location chip opens the map', () => {
    const c = bootstrap();
    const world = beginGame(c);
    c.dispatchAction({ type: 'WAIT' });
    root.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    expect(document.querySelector('.dialog-title')?.textContent).toMatch(/paused/i);
    const actions = [...document.querySelectorAll('[data-pause-action]')].map(
      (b) => (b as HTMLElement).dataset.pauseAction,
    );
    expect(actions).toEqual(['resume', 'save', 'settings', 'help', 'debug', 'quit']);
    // recap line names the hero + place
    const pauseEl = document.querySelector('.pause')!;
    expect(pauseEl.textContent).toContain(world.player.name);
    closeAllModals();
    root.querySelector<HTMLButtonElement>('.hud-location')!.click();
    expect(document.querySelector('.dialog-title')?.textContent).toMatch(/map/i);
  });
});

describe('controller quest flow', () => {
  it('exposes e2e debug hooks (window.__cotw / __cotwPerf)', () => {
    const c = bootstrap();
    beginGame(c);
    type Hooks = {
      turn: () => number;
      position: () => { x: number; y: number; level: number } | null;
      hp: () => number;
      mana: () => number;
      dispatch: (a: { type: 'WAIT' }) => void;
      appliedCount: () => number;
      walkable: (x: number, y: number) => boolean;
      stair: (kind: 'down' | 'up') => { x: number; y: number } | null;
      boss: () => { x: number; y: number; name: string; hp: number } | null;
      shopDoors: () => { shopId: string; x: number; y: number }[];
      camera: () => { tile: number; originX: number; originY: number } | null;
    };
    const hooks = (window as unknown as { __cotw: Hooks }).__cotw;
    expect(hooks).toBeDefined();
    expect(hooks.hp()).toBeGreaterThan(0);
    expect(hooks.mana()).toBeGreaterThanOrEqual(0);
    expect(hooks.turn()).toBeGreaterThanOrEqual(0);
    const pos = hooks.position();
    expect(pos!.level).toBe(0);
    expect((window as unknown as { __cotwPerf: { frames: number } }).__cotwPerf).toBeDefined();
    // drivers: WAIT advances a turn; town has the mine stair + shop doors
    const before = hooks.turn();
    hooks.dispatch({ type: 'WAIT' });
    expect(hooks.turn()).toBe(before + 1);
    // appliedCount moves for applied actions and stalls for swallowed ones
    // (e2e verifies its dispatches with it — campaign runs 18-20 regression)
    const applied0 = hooks.appliedCount();
    expect(applied0).toBeGreaterThan(0);
    hooks.dispatch({ type: 'WAIT' });
    expect(hooks.appliedCount()).toBe(applied0 + 1);
    expect(hooks.stair('down')).toEqual({ x: 15, y: 2 });
    expect(hooks.walkable(15, 2)).toBe(true);
    expect(hooks.shopDoors().length).toBe(8);
    expect(hooks.boss()).toBeNull(); // no boss in town
  });

  it('resize recomputes the canvas backing store synchronously and never answers with stale camera geometry (A04)', () => {
    const c = bootstrap({ realCamera: true });
    beginGame(c);
    const canvas = root.querySelector('canvas')!;
    // jsdom default backing store (300x150): the first draw() skipped because
    // clientWidth was 0. Simulate a rotation/resize giving the canvas layout.
    expect(canvas.width).toBe(300);
    Object.defineProperty(canvas, 'clientWidth', { value: 480, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 640, configurable: true });
    window.dispatchEvent(new Event('resize'));
    // Backing store recomputed synchronously (dpr 1 in jsdom)…
    expect(canvas.width).toBe(480);
    expect(canvas.height).toBe(640);
    // …and the camera hook answers with geometry computed for the NEW
    // viewport (state-based since Phase 4), never pre-resize coordinates.
    const hooks = (window as unknown as { __cotw: { camera: () => { tile: number; originX: number; originY: number } | null } }).__cotw;
    const cam = hooks.camera();
    expect(cam).not.toBeNull();
    // 480×640 default zoom -> tile floor(480/11)=43
    expect(cam!.tile).toBe(43);
  });

  it('new game shows the intro cutscene; input is gated until dismissed', () => {
    const c = bootstrap();
    c.newGame();
    const name = document.querySelector('.modal-overlay [data-field="name"]') as HTMLInputElement;
    name.value = 'Sigrun';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    (document.querySelector('.modal-overlay [data-action="begin"]') as HTMLButtonElement).click();
    const world = c.getWorld()!;
    expect(world.questState?.pending).toEqual([]);
    const overlay = document.querySelector('.story-overlay') as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector('[data-field="story-text"]')!.textContent).toContain('charred ruins');
    expect(c.isInputEnabled()).toBe(false);
    (overlay.querySelector('[data-action="continue"]') as HTMLButtonElement).click();
    expect(document.querySelector('.story-overlay')).toBeNull();
    expect(c.isInputEnabled()).toBe(true);
  });

  it('journal lists quest entries from the Actions panel', () => {
    const c = bootstrap();
    beginGame(c);
    root.querySelector<HTMLButtonElement>('[data-action="actions"]')!.click();
    const journal = [...document.querySelectorAll('.action-palette button')]
      .find((b) => b.textContent === 'Journal') as HTMLButtonElement | undefined;
    expect(journal).toBeDefined();
    journal!.click();
    const entries = document.querySelectorAll('.modal-overlay .journal-entry');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.textContent).toContain('Avenge');
  });

  it('victory drains cutscenes then shows the ending with campaign stats', () => {
    const c = bootstrap();
    const world = beginGame(c);
    // Complete every required stage except queue the final story texts.
    const q = world.questState!;
    for (const stage of ['intro', 'mine-bottom', 'homecoming', 'fortress', 'chests', 'confrontation']) {
      q.completed[stage] = 0;
    }
    q.completed['victory'] = world.turn;
    q.pending.push(10, 11, 12, 13, 14);
    q.done = true;
    q.victory = true;
    c.dispatchAction({ type: 'WAIT' });
    // Cutscenes play first.
    expect(document.querySelector('.story-overlay')).not.toBeNull();
    for (;;) {
      const btn = document.querySelector<HTMLButtonElement>('.story-overlay [data-action="continue"]');
      if (!btn) break;
      btn.click();
    }
    // Then the victory screen.
    const overlay = document.querySelector('.story-overlay.victory') as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector('.victory-stats')!.textContent).toContain('Sigrun');
    expect(overlay.querySelector('[data-field="story-text"]')!.textContent).toContain('Here ends Part One');
    expect(world.questState?.endingShown).toBe(true);
    (overlay.querySelector('[data-action="new-game"]') as HTMLButtonElement).click();
    expect(document.querySelector('.modal-overlay [data-field="name"]')).not.toBeNull();
  });
});

describe('save manager integration', () => {
  function bootstrapWithSaves(
    storage?: SaveStorage,
    managerOpts?: { validate?: (parsed: unknown) => void },
  ): {
    c: GameController;
    manager: SaveManager;
    storage: SaveStorage;
  } {
    const store = storage ?? memoryStorage();
    const manager = createSaveManager({ storage: store, validate: managerOpts?.validate });
    root = document.createElement('div');
    document.body.appendChild(root);
    controller = createGameController({
      root,
      data: loadWorldData(),
      town: loadTownShops(),
      win: window,
      now: () => 0x5eed,
      loadTileSprites: () => Promise.resolve({}),
      screenToWorld: () => ({ ...pickTarget }),
      saves: manager,
    });
    controller.start();
    return { c: controller, manager, storage: store };
  }


  const hidePage = (): void => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  };

  it('autosaves when the mine stairs take the player to a new level', () => {
    const { c, storage } = bootstrapWithSaves();
    const world = beginGame(c);
    const stairs = world.data.town.mineEntrance;
    const level = world.levels.get(0)!;
    let from = { x: stairs.x, y: stairs.y + 1 };
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const t = level.tiles[idx(stairs.x + dx, stairs.y + dy)] ?? 0;
      if (world.data.tiles[String(t)]?.walkable) {
        from = { x: stairs.x + dx, y: stairs.y + dy };
        break;
      }
    }
    world.player.x = from.x;
    world.player.y = from.y;
    c.dispatchAction({ type: 'MOVE', dx: stairs.x - from.x, dy: stairs.y - from.y });
    // Phase 2 task 6: explicit own-cell tap performs the descent (autosave hook).
    (window as unknown as {
      __cotw: { travel: { tap: (cell: { x: number; y: number }, pointerType?: string) => void } };
    }).__cotw.travel.tap({ x: world.player.x, y: world.player.y }, 'touch');
    expect(world.current).toBe(1);
    const raw = storage.getItem('cotw.save.auto');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { player: { name: string }; world: { current: number } };
    expect(parsed.player.name).toBe('Sigrun');
    expect(parsed.world.current).toBe(1);
  });

  it('autosaves when the page becomes hidden', () => {
    const { c, storage } = bootstrapWithSaves();
    const world = beginGame(c);
    c.dispatchAction({ type: 'MOVE', dx: 1, dy: 0 });
    hidePage();
    const parsed = JSON.parse(storage.getItem('cotw.save.auto')!) as { world: { turn: number } };
    expect(parsed.world.turn).toBe(world.turn);
  });

  it('Continue on the title screen loads the most recent save directly', () => {
    const store = memoryStorage();
    const first = bootstrapWithSaves(store);
    const world = beginGame(first.c);
    world.player.x += 1;
    const x = world.player.x;
    const turn = world.turn;
    hidePage();
    first.c.destroy();
    document.body.innerHTML = '';

    const second = bootstrapWithSaves(store);
    expect(root.querySelector('.title-overlay')).not.toBeNull();
    const cont = root.querySelector<HTMLButtonElement>('[data-action="continue"]');
    expect(cont?.disabled).toBe(false);
    // Truthful label: character, level, place, and save time up front (Phase 7).
    expect(cont?.textContent).toContain('Sigrun');
    expect(cont?.textContent).toContain('Lv 1');
    expect(cont?.textContent).toContain('Crossroads');
    cont!.click();
    // Continue loads directly — no slot-list detour.
    expect(document.querySelector('.save-dialog')).toBeNull();
    const restored = second.c.getWorld();
    expect(restored).not.toBeNull();
    expect(restored!.player.name).toBe('Sigrun');
    expect(restored!.player.x).toBe(x);
    expect(restored!.turn).toBe(turn);
    expect(root.querySelector('.title-overlay')).toBeNull();
    expect(root.querySelector('.map canvas')).not.toBeNull();
  });

  it('Continue falls back to the slot list when the save fails to load', () => {
    const store = memoryStorage();
    const first = bootstrapWithSaves(store);
    beginGame(first.c);
    hidePage();
    first.c.destroy();
    document.body.innerHTML = '';

    const second = bootstrapWithSaves(store, {
      validate: () => {
        throw new Error('incompatible save version');
      },
    });
    const cont = root.querySelector<HTMLButtonElement>('[data-action="continue"]');
    expect(cont?.disabled).toBe(false);
    cont!.click();
    // The load failed, so the manager dialog opens instead of the game.
    expect(document.querySelector('.save-dialog')).not.toBeNull();
    expect(second.c.getWorld()).toBeNull();
    second.c.destroy();
    document.body.innerHTML = '';
  });

  it('Continue stays disabled but backup import remains available without saves', () => {
    bootstrap();
    const cont = root.querySelector<HTMLButtonElement>('[data-action="continue"]');
    const load = root.querySelector<HTMLButtonElement>('[data-action="load-game"]');
    expect(cont?.disabled).toBe(true);
    expect(load?.disabled).toBe(false);
  });

  it('title screen offers Settings and Help alongside Continue', () => {
    bootstrap();
    root.querySelector<HTMLButtonElement>('[data-action="settings"]')!.click();
    expect(document.querySelector('.modal-overlay .dialog-title')?.textContent).toBe('Options');
    closeAllModals();
    root.querySelector<HTMLButtonElement>('[data-action="help"]')!.click();
    expect(document.querySelector('.modal-overlay .dialog-title')?.textContent).toBe('Help');
    closeAllModals();
  });

  it('pause Save writes a manual slot and logs it', () => {
    const { c, storage } = bootstrapWithSaves();
    const world = beginGame(c);
    root.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    (document.querySelector('[data-pause-action="save"]') as HTMLButtonElement).click();
    (document.querySelector('.dialog [data-action="save"]') as HTMLButtonElement).click();
    (document.querySelector('[data-slot-id="2"] [data-action="save-here"]') as HTMLButtonElement).click();
    expect(storage.getItem('cotw.save.2')).not.toBeNull();
    expect(world.log.some((e) => e.text.includes('Game saved.'))).toBe(true);
  });

  it('loading a foreign-format save surfaces the error without replacing the world', () => {
    const { c, storage } = bootstrapWithSaves();
    const world = beginGame(c);
    storage.setItem('cotw.save.0', JSON.stringify({ format: 'nope', version: 1 }));
    root.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    (document.querySelector('[data-pause-action="save"]') as HTMLButtonElement).click();
    (document.querySelector('.dialog [data-action="load"]') as HTMLButtonElement).click();
    (document.querySelector('[data-slot-id="0"] [data-action="load"]') as HTMLButtonElement).click();
    const err = document.querySelector('[data-field="import-error"]') as HTMLElement;
    expect(err?.textContent).toMatch(/format/i);
    expect(c.getWorld()).toBe(world);
  });

  it('pause Edit Save hot-swaps the running world after Apply', () => {
    const { c } = bootstrapWithSaves();
    beginGame(c);
    root.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    (document.querySelector('[data-pause-action="save"]') as HTMLButtonElement).click();
    (document.querySelector('.dialog [data-action="edit-save"]') as HTMLButtonElement).click();
    const strInput = document.querySelector<HTMLInputElement>('.modal-overlay [data-field="str"]');
    expect(strInput).not.toBeNull();
    strInput!.value = '91';
    strInput!.dispatchEvent(new Event('input', { bubbles: true }));
    const apply = document.querySelector<HTMLButtonElement>('[data-action="apply-edits"]')!;
    apply.click();
    const world = c.getWorld();
    expect(world).not.toBeNull();
    expect(world!.player.strength).toBe(91);
    expect(world!.player.maxStrength).toBe(91);
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('slot-list Edit updates the stored slot after Apply', () => {
    const { c, storage } = bootstrapWithSaves();
    beginGame(c);
    root.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    (document.querySelector('[data-pause-action="save"]') as HTMLButtonElement).click();
    (document.querySelector('.dialog [data-action="save"]') as HTMLButtonElement).click();
    (document.querySelector('[data-slot-id="2"] [data-action="save-here"]') as HTMLButtonElement).click();
    const before = JSON.parse(storage.getItem('cotw.save.2')!) as { inventory: { gold: number } };
    expect(before.inventory.gold).toBe(0);

    root.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    (document.querySelector('[data-pause-action="save"]') as HTMLButtonElement).click();
    (document.querySelector('.dialog [data-action="load"]') as HTMLButtonElement).click();
    (document.querySelector('[data-slot-id="2"] [data-action="edit"]') as HTMLButtonElement).click();
    const goldInput = document.querySelector<HTMLInputElement>('.modal-overlay [data-field="gold"]');
    expect(goldInput).not.toBeNull();
    goldInput!.value = '5000';
    goldInput!.dispatchEvent(new Event('input', { bubbles: true }));
    (document.querySelector('[data-action="apply-edits"]') as HTMLButtonElement).click();
    const after = JSON.parse(storage.getItem('cotw.save.2')!) as { inventory: { gold: number } };
    expect(after.inventory.gold).toBe(5000);
    const world = c.getWorld();
    expect(world?.log.some((e) => e.text.includes('Save updated.'))).toBe(true);
  });
});

describe('art loading (F05/F16, Task 3)', () => {
  const bootWithArtSpy = (
    seeded?: (manager: SaveManager) => void,
    seededPart2?: (manager2: SaveManager) => void,
  ): {
    c: GameController;
    manager: SaveManager;
    spy: ReturnType<typeof vi.fn>;
  } => {
    const store = memoryStorage();
    const manager = createSaveManager({ storage: store });
    const manager2 = createSaveManager({ storage: store, part: 2 });
    // Seed BEFORE start(): the title screen's Continue state is computed at
    // mount time.
    seeded?.(manager);
    seededPart2?.(manager2);
    const spy = vi.fn(() => Promise.resolve({}));
    root = document.createElement('div');
    document.body.appendChild(root);
    controller = createGameController({
      root,
      data: loadWorldData(),
      town: loadTownShops(),
      win: window,
      now: () => 0x5eed,
      loadTileSprites: spy,
      screenToWorld: () => ({ ...pickTarget }),
      saves: manager,
      savesPart2: manager2,
    });
    controller.start();
    return { c: controller, manager, spy };
  };

  const coldSave = () =>
    serializeGame(
      newWorld({
        worldSeed: 7,
        player: createCharacter({
          name: 'Cold',
          gender: 'female',
          strength: 50,
          intelligence: 50,
          constitution: 50,
          dexterity: 50,
          difficulty: 'intermediate',
        }),
      }),
      { savedAt: '2026-11-12T08:00:00.000Z' },
    );

  it('loads tile art on a cold Continue before any New Game (F16)', async () => {
    const { c, spy } = bootWithArtSpy((manager) => {
      // Seed the autosave with a valid world — Continue must work without any
      // New Game ever having run in this session.
      manager.autosave(coldSave());
    });
    const cont = document.querySelector<HTMLButtonElement>('.title-overlay [data-action="continue"]');
    expect(cont?.disabled).toBe(false);
    cont!.click();
    await vi.waitFor(() => {
      expect(c.getWorld()).not.toBeNull();
    });
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('loads art exactly once per controller session across game and reload', async () => {
    const { c, spy } = bootWithArtSpy((manager) => {
      manager.autosave(coldSave());
    });
    (document.querySelector('.title-overlay [data-action="continue"]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(c.getWorld()).not.toBeNull();
    });
    // The loaded world replays its queued intro story (pending is serialized)
    // — dismiss it; story blocks all gameplay commands including pause (Task 5).
    dismissStoryAll();
    // A second world in the same session (quit to title, then a new game)
    // must not re-fetch the art.
    (document.querySelector('[data-action="pause"]') as HTMLButtonElement).click();
    (document.querySelector('[data-pause-action="quit"]') as HTMLButtonElement).click();
    // The loaded world is clean (just loaded) → quit goes directly to title.
    (document.querySelector('.title-overlay [data-action="new-game"]') as HTMLButtonElement).click();
    const nameInput = document.querySelector<HTMLInputElement>('.modal-overlay [data-field="name"]');
    nameInput!.value = 'Second';
    nameInput!.dispatchEvent(new Event('input', { bubbles: true }));
    (document.querySelector('.modal-overlay [data-action="begin"]') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(c.getWorld()?.player.name).toBe('Second');
    });
    expect(spy.mock.calls.length).toBe(1);
  });

  it('Continue loads a part-2 save into the part-2 world (P5)', async () => {
    const data2 = loadWorldData(2);
    const part2Save = serializeGame(
      newWorld({
        worldSeed: 7,
        player: createCharacter({
          name: 'Champion2',
          gender: 'female',
          strength: 50,
          intelligence: 50,
          constitution: 50,
          dexterity: 50,
          difficulty: 'intermediate',
        }),
        part: 2,
      }),
      { savedAt: '2026-11-12T09:00:00.000Z' },
    );
    expect(part2Save.meta.part).toBe(2);
    // Sanity: the part-2 save really is foreign to the part-1 bundle.
    expect(() => deserializeGame(part2Save, data2)).not.toThrow();

    const { c } = bootWithArtSpy(undefined, (manager2) => {
      manager2.autosave(part2Save);
    });
    // Select part 2 first: Continue is part-scoped (Task P6).
    document.querySelector<HTMLButtonElement>('[data-part="2"]')!.click();
    const cont = document.querySelector<HTMLButtonElement>('.title-overlay [data-action="continue"]');
    expect(cont?.disabled).toBe(false);
    cont!.click();
    await vi.waitFor(() => {
      expect(c.getWorld()?.player.name).toBe('Champion2');
    });
    expect(c.getWorld()?.data.part).toBe(2);
    expect(c.getWorld()?.data.levels).toHaveLength(26);
  });
});

describe('pause + dock (UI plan Phase 3)', () => {
  const bootSaves = (storage?: SaveStorage): { c: GameController; storage: SaveStorage } => {
    const store = storage ?? memoryStorage();
    root = document.createElement('div');
    document.body.appendChild(root);
    controller = createGameController({
      root,
      data: loadWorldData(),
      town: loadTownShops(),
      win: window,
      now: () => 0x5eed,
      loadTileSprites: () => Promise.resolve({}),
      screenToWorld: () => ({ ...pickTarget }),
      saves: createSaveManager({ storage: store }),
    });
    controller.start();
    return { c: controller, storage: store };
  };

  const openPause = (): void => {
    root.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
  };

  it('Actions Wait advances the turn; recent-event line opens the full log', () => {
    const c = bootstrap();
    const w = beginGame(c);
    const turn0 = w.turn;
    root.querySelector<HTMLButtonElement>('[data-action="actions"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-action="wait"]')!.click();
    expect(c.getWorld()!.turn).toBe(turn0 + 1);
    const recent = root.querySelector<HTMLButtonElement>('.recent-event')!;
    expect(recent.textContent.length).toBeGreaterThan(0);
    recent.click();
    expect(document.querySelector('.dialog-title')?.textContent).toMatch(/message log/i);
    const entries = document.querySelectorAll('.log-full .log-entry');
    expect(entries.length).toBeGreaterThan(0);
  });

  it('pause marks unsaved progress after a move and clears it after saving', () => {
    const { c, storage } = bootSaves();
    const w = beginGame(c);
    c.dispatchAction({ type: 'WAIT' }); // dirty the world
    openPause();
    expect(document.querySelector('.pause')?.textContent).toMatch(/unsaved/i);
    (document.querySelector('[data-pause-action="save"]') as HTMLButtonElement).click();
    (document.querySelector('.dialog [data-action="save"]') as HTMLButtonElement).click();
    (document.querySelector('[data-slot-id="0"] [data-action="save-here"]') as HTMLButtonElement).click();
    expect(storage.getItem('cotw.save.0')).not.toBeNull();
    closeAllModals();
    openPause();
    expect(document.querySelector('.pause')?.textContent).not.toMatch(/unsaved/i);
    expect(w).toBeDefined();
  });

  it('Escape key opens the pause screen when nothing else is active', () => {
    const c = bootstrap();
    beginGame(c);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.dialog-title')?.textContent).toMatch(/paused/i);
    // Escape again resumes
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.modal-overlay')).toBeNull();
    expect(c.getWorld()).not.toBeNull();
  });

  it('Actions panel offers Search and Rest', () => {
    const c = bootstrap();
    beginGame(c);
    root.querySelector<HTMLButtonElement>('[data-action="actions"]')!.click();
    const labels = [...document.querySelectorAll('.action-palette button')].map((b) => b.textContent);
    expect(labels).toContain('Search');
    expect(labels).toContain('Rest');
    const w = c.getWorld()!;
    const turn0 = w.turn;
    (document.querySelector('.action-palette [data-action="search"]') as HTMLButtonElement).click();
    expect(c.getWorld()!.turn).toBe(turn0 + 1); // searching costs the turn
  });

  it('Save and Quit returns to the title screen with the save written', () => {
    const { c, storage } = bootSaves();
    beginGame(c);
    c.dispatchAction({ type: 'WAIT' });
    openPause();
    (document.querySelector('[data-pause-action="quit"]') as HTMLButtonElement).click();
    // dirty world → 3-way choice
    const quit = document.querySelector('.dialog [data-action="quit-save"]') as HTMLButtonElement;
    expect(quit).not.toBeNull();
    quit.click();
    expect(c.getWorld()).toBeNull();
    expect(document.querySelector('.title-overlay')).not.toBeNull();
    expect(storage.getItem('cotw.save.auto')).not.toBeNull();
    // Continue is now enabled with the saved game
    const cont = document.querySelector<HTMLButtonElement>('[data-action="continue"]');
    expect(cont?.disabled).toBe(false);
  });

  it('a saved world quits directly to title (no 3-way choice)', () => {
    const { c, storage } = bootSaves();
    beginGame(c);
    c.dispatchAction({ type: 'WAIT' });
    // save first → the world is clean
    openPause();
    (document.querySelector('[data-pause-action="save"]') as HTMLButtonElement).click();
    (document.querySelector('.dialog [data-action="save"]') as HTMLButtonElement).click();
    (document.querySelector('[data-slot-id="0"] [data-action="save-here"]') as HTMLButtonElement).click();
    expect(storage.getItem('cotw.save.0')).not.toBeNull();
    openPause();
    (document.querySelector('[data-pause-action="quit"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-action="quit-save"]')).toBeNull(); // no 3-way
    expect(c.getWorld()).toBeNull();
    expect(document.querySelector('.title-overlay')).not.toBeNull();
  });

  it('quit with a dirty world offers discard, and discarding drops progress', () => {
    const c = bootstrap();
    beginGame(c);
    c.dispatchAction({ type: 'WAIT' });
    const turn1 = c.getWorld()!.turn;
    openPause();
    (document.querySelector('[data-pause-action="quit"]') as HTMLButtonElement).click();
    (document.querySelector('[data-action="quit-without"]') as HTMLButtonElement).click();
    expect(c.getWorld()).toBeNull();
    expect(document.querySelector('.title-overlay')).not.toBeNull();
    expect(turn1).toBeGreaterThan(0);
  });

  it('save failure during Save-and-Quit keeps the game open with an Export offer', () => {
    const failing = {
      getItem: (): string | null => null,
      setItem: (): void => {
        throw new Error('quota exceeded');
      },
      removeItem: (): void => {},
    };
    const { c } = bootSaves(failing);
    beginGame(c);
    c.dispatchAction({ type: 'WAIT' });
    openPause();
    (document.querySelector('[data-pause-action="quit"]') as HTMLButtonElement).click();
    (document.querySelector('[data-action="quit-save"]') as HTMLButtonElement).click();
    // save failed → stayed in game with error + export offer
    expect(c.getWorld()).not.toBeNull();
    const dialog = document.querySelector('.dialog')!;
    expect(dialog.textContent).toMatch(/quota|failed/i);
    expect(document.querySelector('[data-action="quit-export"]')).not.toBeNull();
    expect(document.querySelector('[data-action="quit-stay"]')).not.toBeNull();
  });

  it('Escape closes an open panel before it can open the pause screen', () => {
    const c = bootstrap();
    beginGame(c);
    root.querySelector<HTMLButtonElement>('[data-action="inventory"]')!.click();
    expect(document.querySelector('.modal-overlay')).not.toBeNull();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('Escape cancels targeting without opening pause', () => {
    const c = bootstrap();
    const w = beginGame(c);
    w.player.knownSpells.push('s510');
    root.querySelector<HTMLButtonElement>('[data-action="cast"]')!.click();
    expect(document.querySelector('.dialog-title')?.textContent).toMatch(/spellbook/i);
    document.querySelector<HTMLButtonElement>('.spell-row [data-action="cast"]')!.click();
    expect(document.querySelector('.target-bar')).not.toBeNull();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.target-bar')).toBeNull();
    expect(document.querySelector('.modal-overlay')).toBeNull();
    expect(c.isInputEnabled()).toBe(true);
  });

  it('every dock action, hero, chip, and pause entry is reachable by pointer alone', () => {
    const c = bootstrap();
    const w = beginGame(c);
    const click = (sel: string): void => {
      (document.querySelector(sel) as HTMLButtonElement)?.click();
    };
    const title = (): string => document.querySelector('.dialog-title')?.textContent ?? '';
    const close = (): void => click('.modal-overlay [data-action="close"]');

    // hero → character sheet
    click('[data-action="character"]');
    expect(title()).toMatch(/character/i);
    close();
    // location chip → map
    click('[data-action="map"]');
    expect(title()).toMatch(/map/i);
    close();
    // dock: Bag
    click('[data-action="inventory"]');
    expect(title()).toMatch(/inventory/i);
    close();
    // dock: Spells
    click('[data-action="cast"]');
    expect(title()).toMatch(/spellbook/i);
    close();
    // Persistent Actions: Wait, Search, Rest, Journal.
    click('[data-action="actions"]');
    const turn0 = w.turn;
    click('[data-action="wait"]');
    expect(c.getWorld()!.turn).toBe(turn0 + 1);
    expect(root.querySelector<HTMLElement>('.action-palette')?.hidden).toBe(false);
    click('[data-action="search"]');
    expect(c.getWorld()!.turn).toBe(turn0 + 2);
    click('.action-palette [data-action="rest"]');
    expect(title()).toMatch(/rest/i);
    close();
    click('.action-palette [data-action="journal"]');
    expect(title()).toMatch(/journal/i);
    close();
    // pause entries
    click('[data-action="pause"]');
    expect(title()).toMatch(/paused/i);
    click('[data-pause-action="settings"]');
    expect(title()).toMatch(/options/i);
    close();
    click('[data-action="pause"]');
    click('[data-pause-action="help"]');
    expect(title()).toMatch(/help/i);
    close();
    click('[data-action="pause"]');
    click('[data-pause-action="save"]');
    expect(title()).toMatch(/save \/ load/i);
    close();
    click('[data-action="pause"]');
    click('[data-pause-action="quit"]');
    expect(title()).toMatch(/quit to title/i);
    close();
    click('[data-action="pause"]');
    click('[data-pause-action="resume"]');
    expect(document.querySelector('.modal-overlay')).toBeNull();
    expect(c.getWorld()).not.toBeNull();
  });

  it('no administrative menu button remains: the dock contains Bag, Spells, and Actions', () => {
    const c = bootstrap();
    beginGame(c);
    expect(root.querySelector('[data-action="menu"]')).toBeNull();
    const labels = [...root.querySelectorAll('.dock button')].map((b) => b.textContent);
    expect(labels).toEqual(['Bag', 'Spells', 'Actions']);
  });
});

describe('review scenes (UI plan Phase 0)', () => {
  type Cotw = typeof window extends never ? never : {
    newGame: (seed: number) => boolean;
    scene: (name: string) => { ok: boolean; detail?: string };
    hp: () => number;
    mana: () => number;
    position: () => { x: number; y: number; level: number } | null;
    entities: () => { x: number; y: number; name: string; hp: number }[];
    shopDoors: () => { shopId: string; x: number; y: number }[];
    dispatch: (a: unknown) => void;
    isDead: () => boolean;
  };
  const hooks = (): Cotw => (window as unknown as { __cotw: Cotw }).__cotw;
  /** Dismiss any visible story overlays (mirrors a player clicking through). */
  const dismissStory = (): void => {
    for (let i = 0; i < 40; i++) {
      const btn = document.querySelector<HTMLButtonElement>('.story-overlay [data-action="continue"]');
      if (btn) { btn.click(); continue; }
      break;
    }
  };

  it('newGame(seed) spawns a review character deterministically', () => {
    const c = bootstrap();
    expect(hooks().newGame(7)).toBe(true);
    const world = c.getWorld();
    expect(world).not.toBeNull();
    expect(world!.player.name).toBe('Review');
    expect(hooks().position()?.level).toBe(0);
    // Same seed twice → identical level-1 monster layout.
    const first = JSON.stringify(hooks().entities());
    hooks().scene('combat');
    const combatEntities = JSON.stringify(hooks().entities());
    hooks().newGame(7);
    hooks().scene('combat');
    expect(JSON.stringify(hooks().entities())).toBe(combatEntities);
    expect(first).toBe('[]');
  });

  it('scene low-health sets hp to 3', () => {
    bootstrap();
    hooks().newGame(7);
    expect(hooks().scene('low-health').ok).toBe(true);
    expect(hooks().hp()).toBe(3);
  });

  it('scene full-pack fills inventory and equipment', () => {
    bootstrap();
    hooks().newGame(7);
    expect(hooks().scene('full-pack').ok).toBe(true);
    const c = controller!;
    const w = c.getWorld()!;
    expect(w.inventory.pack.length).toBeGreaterThanOrEqual(6);
    expect(w.inventory.equipment.weapon).toBeDefined();
    expect(w.inventory.equipment.armor).toBeDefined();
  });

  it('scene combat places an alert adjacent monster on level 1', () => {
    bootstrap();
    hooks().newGame(7);
    expect(hooks().scene('combat').ok).toBe(true);
    const pos = hooks().position()!;
    expect(pos.level).toBe(1);
    const ents = hooks().entities();
    expect(ents.length).toBeGreaterThan(0);
    const near = ents.some((e) => Math.max(Math.abs(e.x - pos.x), Math.abs(e.y - pos.y)) <= 1);
    expect(near).toBe(true);
  });

  it('scene targeting grants a known attack spell and full mana', () => {
    bootstrap();
    hooks().newGame(7);
    expect(hooks().scene('targeting').ok).toBe(true);
    const c = controller!;
    const w = c.getWorld()!;
    expect(w.player.knownSpells).toContain('s527');
    expect(w.player.mana).toBe(w.player.maxMana);
  });

  it('scene shop positions the hero beside a shop door', () => {
    bootstrap();
    hooks().newGame(7);
    expect(hooks().scene('shop').ok).toBe(true);
    const pos = hooks().position()!;
    const doors = hooks().shopDoors();
    const near = doors.some((d) => Math.max(Math.abs(d.x - pos.x), Math.abs(d.y - pos.y)) === 1);
    expect(near).toBe(true);
  });

  it('scene death produces the death dialog on the next turn', () => {
    bootstrap();
    hooks().newGame(7);
    dismissStory();
    expect(hooks().scene('death').ok).toBe(true);
    expect(hooks().hp()).toBe(0);
    hooks().dispatch({ type: 'WAIT' });
    expect(hooks().isDead()).toBe(true);
    expect(document.querySelector('.modal-overlay')).not.toBeNull();
    expect(document.body.textContent).toMatch(/dead/i);
  });

  it('scene victory drains the story and shows the victory screen', () => {
    bootstrap();
    hooks().newGame(7);
    dismissStory();
    expect(hooks().scene('victory').ok).toBe(true);
    hooks().dispatch({ type: 'WAIT' });
    dismissStory();
    const victory = document.querySelector('.story-overlay.victory');
    expect(victory).not.toBeNull();
    expect(victory?.textContent).toMatch(/Here ends Part One/);
  });
});

describe('death and victory close-out (UI plan Phase 7)', () => {
  interface CloseOutHooks {
    scene: (name: string) => { ok: boolean; detail?: string };
    dispatch: (a: unknown) => void;
    isDead: () => boolean;
    newGame: (seed?: number) => void;
    travel: {
      tap: (cell: { x: number; y: number }, pointerType?: string) => void;
      state: () => { active: boolean };
    };
  }
  const hooks = (): CloseOutHooks => (window as unknown as { __cotw: CloseOutHooks }).__cotw;

  it('death stops travel and lists the recent events that led to it', () => {
    const c = bootstrap();
    beginGame(c);
    const w = c.getWorld()!;
    w.seen.get(0)!.fill(1); // explored town for routing
    w.log.push({ turn: w.turn, text: 'The gruesome troll claws you!' });
    hooks().travel.tap({ x: 18, y: 20 });
    hooks().travel.tap({ x: 18, y: 20 }); // confirm — travel starts
    expect(hooks().travel.state().active).toBe(true);
    hooks().scene('death');
    hooks().dispatch({ type: 'WAIT' }); // reaps the death
    expect(hooks().isDead()).toBe(true);
    expect(hooks().travel.state().active).toBe(false);
    const events = document.querySelectorAll('.death-events [data-field="death-event"]');
    expect(events.length).toBeGreaterThan(0);
    const joined = Array.from(events).map((e) => e.textContent ?? '').join('\n');
    expect(joined).toContain('troll claws you');
  });

  it('death while targeting removes the target bar', () => {
    const c = bootstrap();
    beginGame(c);
    const w = c.getWorld()!;
    w.player.knownSpells.push('s510'); // Magic Arrow — needs a target
    (document.querySelector('button[data-action="cast"]') as HTMLButtonElement).click();
    const row = document.querySelector('.spell-row[data-spell="s510"] [data-action="cast"]') as HTMLButtonElement;
    row.click();
    expect(document.querySelector('.target-bar')).not.toBeNull();
    hooks().scene('death');
    hooks().dispatch({ type: 'WAIT' });
    expect(document.querySelector('.target-bar')).toBeNull();
    expect(hooks().isDead()).toBe(true);
  });

  it('victory offers journal and return to title', () => {
    const c = bootstrap();
    hooks().newGame(7);
    dismissStoryAll();
    expect(hooks().scene('victory').ok).toBe(true);
    hooks().dispatch({ type: 'WAIT' });
    dismissStoryAll();
    const victory = document.querySelector('.story-overlay.victory') as HTMLElement;
    expect(victory).not.toBeNull();
    // Journal opens on top; the ending waits behind it and returns after.
    (victory.querySelector('[data-action="journal"]') as HTMLButtonElement).click();
    expect(document.querySelector('.modal-overlay .journal')).not.toBeNull();
    expect(victory.style.display).toBe('none');
    (document.querySelector('.modal-overlay [data-action="close"]') as HTMLButtonElement).click();
    expect(victory.style.display).toBe('');
    expect(document.querySelector('.modal-overlay')).toBeNull();
    // Return to Title leaves the run behind.
    (victory.querySelector('[data-action="return-title"]') as HTMLButtonElement).click();
    expect(document.querySelector('.story-overlay.victory')).toBeNull();
    expect(document.querySelector('.title-overlay')).not.toBeNull();
    expect(c.getWorld()).toBeNull();
  });
});

describe('destination travel (UI plan Phase 2)', () => {
  type TravelHooks = {
    scene: (name: string) => { ok: boolean; detail?: string };
    travel: {
      tap: (cell: { x: number; y: number }, pointerType?: string) => void;
      hover: (cell: { x: number; y: number } | null) => void;
      state: () => {
        active: boolean;
        reason: string | null;
        remaining: number;
        selected: { x: number; y: number } | null;
        hover: { x: number; y: number } | null;
        preview: number;
        attack: { x: number; y: number } | null;
      };
    };
    position: () => { x: number; y: number; level: number } | null;
    turn: () => number;
    entities: () => { x: number; y: number; name: string; hp: number }[];
    walkable: (x: number, y: number) => boolean;
  };
  const hooks = (): TravelHooks => (window as unknown as { __cotw: TravelHooks }).__cotw;
  const logText = (w: World): string => w.log.map((e) => e.text).join('\n');

  afterEach(() => {
    vi.useRealTimers();
  });

  it('touch: first tap selects and previews the route, second tap travels it', () => {
    vi.useFakeTimers();
    const c = bootstrap();
    beginGame(c);
    const w = c.getWorld()!;
    w.seen.get(0)!.fill(1); // explored town for routing
    const turn0 = w.turn;
    hooks().travel.tap({ x: 18, y: 20 });
    const sel = hooks().travel.state();
    expect(sel.selected).toEqual({ x: 18, y: 20 });
    expect(sel.active).toBe(false);
    expect(w.turn).toBe(turn0); // selecting never spends a turn
    expect(logText(w)).toMatch(/2 steps/);
    hooks().travel.tap({ x: 18, y: 20 }); // confirm
    expect(hooks().travel.state().active).toBe(true);
    vi.advanceTimersByTime(150);
    vi.advanceTimersByTime(150);
    expect(hooks().position()).toEqual({ x: 18, y: 20, level: 0 });
    expect(w.turn).toBe(turn0 + 2);
    const st = hooks().travel.state();
    expect(st.active).toBe(false);
    expect(st.reason).toBe('arrived');
  });

  it('adjacent cardinal tap steps immediately without selection', () => {
    const c = bootstrap();
    beginGame(c);
    const w = c.getWorld()!;
    w.seen.get(0)!.fill(1);
    const turn0 = w.turn;
    hooks().travel.tap({ x: 17, y: 20 });
    expect(hooks().position()).toEqual({ x: 17, y: 20, level: 0 });
    expect(w.turn).toBe(turn0 + 1);
    expect(hooks().travel.state().selected).toBeNull();
  });

  it('unexplored destination explains and never routes or spends a turn', () => {
    const c = bootstrap();
    beginGame(c);
    const w = c.getWorld()!;
    const turn0 = w.turn;
    hooks().travel.tap({ x: 2, y: 2 }); // far unseen corner
    expect(w.turn).toBe(turn0);
    expect(hooks().travel.state().selected).toBeNull();
    expect(logText(w)).toMatch(/explored/i);
  });

  it('hostile visible refuses multi-step travel; a deliberate adjacent step still works', () => {
    vi.useFakeTimers();
    const c = bootstrap();
    const w = beginGame(c);
    hooks().scene('combat');
    dismissStoryAll();
    w.seen.get(w.current)!.fill(1);
    const pos = hooks().position()!;
    // Find a far, unoccupied, walkable cell on the combat level.
    let target: { x: number; y: number } | null = null;
    const ents = hooks().entities();
    for (let y = 0; y < 64 && !target; y++) {
      for (let x = 0; x < 64 && !target; x++) {
        const far = Math.max(Math.abs(x - pos.x), Math.abs(y - pos.y)) >= 4;
        const busy = ents.some((e) => e.x === x && e.y === y);
        if (far && !busy && hooks().walkable(x, y)) target = { x, y };
      }
    }
    expect(target).not.toBeNull();
    hooks().travel.tap(target!);
    hooks().travel.tap(target!); // confirm attempt
    expect(hooks().travel.state().active).toBe(false);
    expect(logText(w)).toMatch(/enemy is visible/i);
    vi.advanceTimersByTime(1000);
    expect(hooks().position()).toEqual(pos); // never moved
  });

  it('travel halts before the stairs boundary and keeps the final step queued', () => {
    vi.useFakeTimers();
    const c = bootstrap();
    beginGame(c);
    const w = c.getWorld()!;
    w.seen.get(0)!.fill(1);
    w.player.x = 15;
    w.player.y = 4; // two tiles south of the mine stair
    hooks().travel.tap({ x: 15, y: 2 });
    hooks().travel.tap({ x: 15, y: 2 });
    vi.advanceTimersByTime(150); // step to (15,3)
    vi.advanceTimersByTime(150); // boundary check stops before the stair
    expect(hooks().position()).toEqual({ x: 15, y: 3, level: 0 });
    const st = hooks().travel.state();
    expect(st.active).toBe(false);
    expect(st.reason).toMatch(/stairs/i);
    expect(st.remaining).toBe(1); // boundary cell stays queued for explicit entry
    expect(w.current).toBe(0); // never auto-descended
  });

  it('attack target: tap selects, second tap bump-attacks the adjacent monster', () => {
    const c = bootstrap();
    const w = beginGame(c);
    hooks().scene('combat');
    dismissStoryAll();
    w.seen.get(w.current)!.fill(1);
    const pos = hooks().position()!;
    const adj = hooks().entities().find(
      (e) => Math.abs(e.x - pos.x) + Math.abs(e.y - pos.y) === 1,
    );
    expect(adj).toBeDefined();
    const turn0 = w.turn;
    hooks().travel.tap({ x: adj!.x, y: adj!.y });
    expect(hooks().travel.state().selected).toEqual({ x: adj!.x, y: adj!.y });
    expect(w.turn).toBe(turn0); // aiming is free
    hooks().travel.tap({ x: adj!.x, y: adj!.y });
    expect(w.turn).toBe(turn0 + 1); // the attack itself costs the turn
    expect(logText(w)).toMatch(/hit|miss/i);
    expect(hooks().travel.state().active).toBe(false);
  });

  it('a panel opened mid-travel stops travel immediately', () => {
    vi.useFakeTimers();
    const c = bootstrap();
    beginGame(c);
    const w = c.getWorld()!;
    w.seen.get(0)!.fill(1);
    hooks().travel.tap({ x: 22, y: 20 });
    hooks().travel.tap({ x: 22, y: 20 });
    expect(hooks().travel.state().active).toBe(true);
    vi.advanceTimersByTime(150); // one step east
    const after = hooks().position()!;
    // opening the inventory (a blocking panel) must interrupt travel
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
    expect(hooks().travel.state().active).toBe(false);
    expect(hooks().travel.state().reason).toMatch(/panel/i);
    vi.advanceTimersByTime(5000);
    expect(hooks().position()).toEqual(after); // no further steps after the stop
  });

  it('Escape mid-travel stops travel without opening the pause screen', () => {
    vi.useFakeTimers();
    const c = bootstrap();
    beginGame(c);
    const w = c.getWorld()!;
    w.seen.get(0)!.fill(1);
    hooks().travel.tap({ x: 22, y: 20 });
    hooks().travel.tap({ x: 22, y: 20 });
    expect(hooks().travel.state().active).toBe(true);
    vi.advanceTimersByTime(150);
    const after = hooks().position()!;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(hooks().travel.state().active).toBe(false);
    expect(hooks().travel.state().reason).toMatch(/interaction|cancel/i);
    expect(document.querySelector('.modal-overlay')).toBeNull(); // no pause screen
    vi.advanceTimersByTime(5000);
    expect(hooks().position()).toEqual(after);
  });

  it('mouse hover preview is tracked and cleared', () => {
    const c = bootstrap();
    beginGame(c);
    hooks().travel.hover({ x: 17, y: 20 });
    expect(hooks().travel.state().hover).toEqual({ x: 17, y: 20 });
    hooks().travel.hover(null);
    expect(hooks().travel.state().hover).toBeNull();
  });

  it('selection previews the route; confirming swaps preview for the live queue', () => {
    vi.useFakeTimers();
    const c = bootstrap();
    beginGame(c);
    const w = c.getWorld()!;
    w.seen.get(0)!.fill(1);
    hooks().travel.tap({ x: 18, y: 20 });
    let st = hooks().travel.state();
    expect(st.selected).toEqual({ x: 18, y: 20 });
    expect(st.preview).toBe(2); // route cells tinted on the map
    hooks().travel.tap({ x: 18, y: 20 }); // confirm
    expect(hooks().travel.state().active).toBe(true);
    st = hooks().travel.state();
    expect(st.remaining).toBe(2); // overlay now shows the travel queue
    vi.advanceTimersByTime(150);
    st = hooks().travel.state();
    expect(st.remaining).toBe(1); // queue shrinks as the hero walks
    expect(st.preview).toBe(0); // stale preview never lingers
    vi.advanceTimersByTime(150);
    expect(hooks().travel.state().active).toBe(false);
    expect(hooks().travel.state().preview).toBe(0);
  });

  it('mouse hover previews a route to the hovered cell (overlay source)', () => {
    const c = bootstrap();
    beginGame(c);
    const w = c.getWorld()!;
    w.seen.get(0)!.fill(1);
    hooks().travel.hover({ x: 18, y: 20 });
    const st = hooks().travel.state();
    expect(st.hover).toEqual({ x: 18, y: 20 });
    expect(st.preview).toBe(2);
    expect(st.selected).toBeNull(); // hover is not a selection
    hooks().travel.hover(null);
    expect(hooks().travel.state().preview).toBe(0);
  });

  it('targeting a monster rings the attack cell; a blocked target clears it', () => {
    const c = bootstrap();
    const w = beginGame(c);
    hooks().scene('combat');
    dismissStoryAll();
    w.seen.get(w.current)!.fill(1);
    const ents = hooks().entities();
    expect(ents.length).toBeGreaterThan(0);
    const m = ents[0]!;
    hooks().travel.tap({ x: m.x, y: m.y }, 'touch'); // select target
    let st = hooks().travel.state();
    expect(st.attack).toEqual({ x: m.x, y: m.y });
    hooks().travel.tap({ x: 2, y: 2 }); // unexplored corner → blocked clears selection
    st = hooks().travel.state();
    expect(st.attack).toBeNull();
    expect(st.preview).toBe(0);
  });
});

describe('explicit transitions (UI plan Phase 2 task 6)', () => {
  const enterKey = (): void => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  };

  it('Enter descends when standing on stairs', () => {
    const c = bootstrap();
    const world = beginGame(c);
    const stairs = world.data.town.mineEntrance;
    world.player.x = stairs.x;
    world.player.y = stairs.y;
    enterKey();
    expect(world.current).toBe(1);
  });

  it('own-cell tap chain descends 1→4, Enter ascends the up stair', () => {
    const c = bootstrap();
    const world = beginGame(c);
    const tap = (cell: { x: number; y: number }): void => {
      (window as unknown as {
        __cotw: { travel: { tap: (cell2: { x: number; y: number }, pointerType?: string) => void } };
      }).__cotw.travel.tap(cell, 'touch');
    };
    // Levels 1–3 arrivals land on the down stair: repeated own-cell taps descend.
    const stairs = world.data.town.mineEntrance;
    world.player.x = stairs.x;
    world.player.y = stairs.y;
    for (const expected of [1, 2, 3, 4]) {
      tap({ x: world.player.x, y: world.player.y });
      expect(world.current).toBe(expected);
    }
    // level 4+ arrivals land on the up stair.
    const level = world.levels.get(4)!;
    expect(level.tiles[idx(world.player.x, world.player.y)]).toBe(0x13);
    const turnBefore = world.turn;
    enterKey();
    expect(world.current).toBe(3);
    expect(world.turn).toBe(turnBefore + 1);
  });

  it('confirm tap on an adjacent stair steps and descends in one go', () => {
    const c = bootstrap();
    const world = beginGame(c);
    const stairs = world.data.town.mineEntrance;
    // stand one south of the stair (road column at x=15 in the APPROX town)
    world.player.x = stairs.x;
    world.player.y = stairs.y + 1;
    c.dispatchAction({ type: 'WAIT' }); // recompute FOV from the new position
    const turnBefore = world.turn;
    const cotw = (window as unknown as {
      __cotw: { travel: { tap: (cell: { x: number; y: number }, pointerType?: string) => void } };
    }).__cotw;
    cotw.travel.tap({ x: stairs.x, y: stairs.y }, 'touch'); // select + preview
    expect(world.current).toBe(0);
    expect(world.turn).toBe(turnBefore); // selection is free
    cotw.travel.tap({ x: stairs.x, y: stairs.y }, 'touch'); // confirm: step + transition
    expect(world.current).toBe(1);
    // Arrival for levels 1–3 is the down stair of the new level.
    const level1 = world.levels.get(1)!;
    expect(level1.tiles[idx(world.player.x, world.player.y)]).toBe(0x12);
    expect(world.turn).toBe(turnBefore + 2); // MOVE + DESCEND
  });

  it('mouse click on an adjacent stair transitions directly', () => {
    const c = bootstrap();
    const world = beginGame(c);
    const stairs = world.data.town.mineEntrance;
    world.player.x = stairs.x;
    world.player.y = stairs.y + 1;
    c.dispatchAction({ type: 'WAIT' }); // recompute FOV from the new position
    (window as unknown as {
      __cotw: { travel: { tap: (cell: { x: number; y: number }, pointerType?: string) => void } };
    }).__cotw.travel.tap({ x: stairs.x, y: stairs.y }, 'mouse');
    expect(world.current).toBe(1);
  });

  it('Enter with nothing to interact is a silent no-op', () => {
    const c = bootstrap();
    const world = beginGame(c); // spawns on the town road, no stair/shop there
    const turnBefore = world.turn;
    const logsBefore = world.log.length;
    enterKey();
    expect(world.turn).toBe(turnBefore);
    expect(world.log.length).toBe(logsBefore);
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });
});

describe('inventory auto arrange (UI plan Phase 1, A12)', () => {
  it('sorts the pack and consumes no turn', () => {
    const c = bootstrap();
    const world = beginGame(c);
    pickup(world.inventory, world.player, 'i-potion', world.data.items, 1);
    pickup(world.inventory, world.player, 'i-long-sword', world.data.items, 1);
    pickup(world.inventory, world.player, 'i-leather-armor', world.data.items, 1);
    const turnBefore = world.turn;
    const rngBefore = world.rng.getState();
    const hpBefore = world.player.hp;
    (root.querySelector('[data-action="inventory"]') as HTMLButtonElement).click();
    const btn = document.querySelector('[data-action="auto-arrange"]') as HTMLButtonElement;
    btn.click();
    expect(world.turn).toBe(turnBefore);
    // CODE-QUALITY Task 6: sorting is presentation — RNG, health, and the
    // world stay untouched (monsters unchanged trivially in town; the RNG
    // pin is what guards future "accidental" engine calls).
    expect(world.rng.getState()).toBe(rngBefore);
    expect(world.player.hp).toBe(hpBefore);
    expect(world.inventory.pack.map((i) => i.defId)).toEqual([
      'i-leather-armor', 'i-long-sword', 'i-potion',
    ]);
  });
});

describe('camera view controls (UI plan Phase 4)', () => {
  type Cam = { tile: number; originX: number; originY: number; zoomIndex: number; panX: number; panY: number } | null;
  const cam = (): Cam => (window as unknown as { __cotw: { camera: () => Cam } }).__cotw.camera();

  /** Fire a pointer event on the map canvas (jsdom lacks PointerEvent). */
  const pev = (type: string, props: Record<string, unknown>): void => {
    const canvas = root.querySelector('canvas')!;
    const e = new Event(type, { bubbles: true, cancelable: true });
    for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v, configurable: true });
    canvas.dispatchEvent(e);
  };

  const sizeCanvas = (): void => {
    const canvas = root.querySelector('canvas')!;
    Object.defineProperty(canvas, 'clientWidth', { value: 480, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 640, configurable: true });
  };

  it('map view controls exist: zoom in/out + center on hero', () => {
    const c = bootstrap({ realCamera: true });
    beginGame(c);
    sizeCanvas();
    const controls = root.querySelector('.map-controls');
    expect(controls).not.toBeNull();
    expect(controls!.querySelectorAll('button[data-action]')).toHaveLength(3);
    expect(controls!.querySelector('[data-action="zoom-in"]')).not.toBeNull();
    expect(controls!.querySelector('[data-action="zoom-out"]')).not.toBeNull();
    expect(controls!.querySelector('[data-action="center-hero"]')).not.toBeNull();
  });

  it('zoom buttons step through zoom levels (bigger tiles in)', () => {
    const c = bootstrap({ realCamera: true });
    beginGame(c);
    sizeCanvas();
    expect(cam()!.tile).toBe(43); // 480 / 11 tiles
    (root.querySelector('[data-action="zoom-in"]') as HTMLButtonElement).click();
    expect(cam()!.tile).toBe(60); // 480 / 8
    (root.querySelector('[data-action="zoom-in"]') as HTMLButtonElement).click();
    expect(cam()!.tile).toBe(80); // 480 / 6 — max zoom
    (root.querySelector('[data-action="zoom-in"]') as HTMLButtonElement).click();
    expect(cam()!.tile).toBe(80); // clamped at the top
    (root.querySelector('[data-action="zoom-out"]') as HTMLButtonElement).click();
    expect(cam()!.tile).toBe(60);
  });

  it('drag pans the view; center-on-hero restores it', () => {
    const c = bootstrap({ realCamera: true });
    beginGame(c);
    sizeCanvas();
    const before = cam()!;
    pev('pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, buttons: 1 });
    pev('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 104, buttons: 1 });
    pev('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 104 });
    const panned = cam()!;
    // Dragging right moves the camera center left (map follows the finger).
    expect(panned.panX).toBeLessThan(0);
    expect(panned.originX).toBeLessThan(before.originX);
    (root.querySelector('[data-action="center-hero"]') as HTMLButtonElement).click();
    const centered = cam()!;
    expect(centered.panX).toBe(0);
    expect(centered.panY).toBe(0);
    expect(Math.abs(centered.originX - before.originX)).toBeLessThanOrEqual(1);
  });

  it('pinch out doubles tiles: one zoom step per doubling', () => {
    const c = bootstrap({ realCamera: true });
    beginGame(c);
    sizeCanvas();
    expect(cam()!.tile).toBe(43);
    pev('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
    pev('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 100 });
    pev('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 100 });
    // Spread 100 -> 200 px = scale 2 = exactly one doubling = one zoom step.
    expect(cam()!.tile).toBe(60);
  });

  it('wheel zooms one step per notch', () => {
    const c = bootstrap({ realCamera: true });
    beginGame(c);
    sizeCanvas();
    const canvas = root.querySelector('canvas')!;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
    expect(cam()!.tile).toBe(60);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
    expect(cam()!.tile).toBe(43);
  });

  it('device-pixel-ratio change re-renders and re-registers its listener', () => {
    const dprListeners: Array<() => void> = [];
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: (_t: string, fn: () => void) => {
        if (query.includes('dppx')) dprListeners.push(fn);
      },
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    try {
      const c = bootstrap({ realCamera: true });
      beginGame(c);
      const canvas = root.querySelector('canvas')!;
      expect(canvas.width).toBe(300); // unsized default backing store
      sizeCanvas();
      expect(dprListeners.length).toBe(1); // watch registered at start
      dprListeners[0]!(); // simulate a dpr change (e.g. moved between displays)
      expect(canvas.width).toBe(480); // resize path ran synchronously
      expect(dprListeners.length).toBe(2); // re-registered (self-healing)
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('onboarding hints (UI plan Phase 7)', () => {
  it('shows the first hint after the opening story of a new game', () => {
    const c = bootstrap();
    beginGame(c); // dismisses the intro cutscene; onDone fires
    const toast = document.querySelector('.hint-toast');
    expect(toast).not.toBeNull();
    const title = toast!.querySelector('[data-field="hint-title"]')?.textContent ?? '';
    expect(title).toMatch(/Turns \(1\/4\)/i);
    const body = toast!.querySelector('[data-field="hint-body"]')?.textContent ?? '';
    expect(body).toMatch(/enemies act when you do/i);
  });

  it('advancing walks the sequence and records progress in preferences', () => {
    const c = bootstrap();
    beginGame(c);
    for (let i = 0; i < 4; i++) {
      const next = document.querySelector('.hint-toast [data-action="hint-next"]') as HTMLButtonElement;
      expect(next).not.toBeNull();
      next.click();
    }
    expect(document.querySelector('.hint-toast')).toBeNull();
    const stored = JSON.parse(prefsStore.getItem('cotw.onboarding')!) as {
      done: string[];
      skipped: boolean;
    };
    expect(stored.done.length).toBe(4);
    expect(stored.skipped).toBe(false);
  });

  it('Skip all ends the sequence immediately and persists', () => {
    const c = bootstrap();
    beginGame(c);
    (document.querySelector('.hint-toast [data-action="hint-skip"]') as HTMLButtonElement).click();
    expect(document.querySelector('.hint-toast')).toBeNull();
    const stored = JSON.parse(prefsStore.getItem('cotw.onboarding')!) as { skipped: boolean };
    expect(stored.skipped).toBe(true);
  });

  it('completed hints do not replay on the next new game until Help replays them', () => {
    const c = bootstrap();
    beginGame(c);
    for (let i = 0; i < 4; i++) {
      (document.querySelector('.hint-toast [data-action="hint-next"]') as HTMLButtonElement).click();
    }
    // Help offers the replay entry point
    (document.querySelector('[data-action="pause"]') as HTMLButtonElement).click();
    (document.querySelector('[data-pause-action="help"]') as HTMLButtonElement).click();
    const replay = document.querySelector('[data-action="replay-hints"]') as HTMLButtonElement;
    expect(replay).not.toBeNull();
    replay.click();
    expect(document.querySelector('.modal-overlay')).toBeNull(); // help closed
    const toast = document.querySelector('.hint-toast');
    expect(toast).not.toBeNull();
    expect(toast!.querySelector('[data-field="hint-title"]')?.textContent).toMatch(/Turns \(1\/4\)/i);
  });

  it('a completed sequence stays quiet on a fresh new game', () => {
    const c = bootstrap();
    beginGame(c);
    for (let i = 0; i < 4; i++) {
      (document.querySelector('.hint-toast [data-action="hint-next"]') as HTMLButtonElement).click();
    }
    // Start another new game through the wizard
    const ng = document.querySelector('[data-action="new-game"]') as HTMLButtonElement;
    if (ng) ng.click();
    // (title-only New Game; when no title exists the world is already running —
    // in either case no toast may reappear without the Help replay)
    expect(document.querySelector('.hint-toast')).toBeNull();
  });

  it('loading a game does not replay hints', () => {
    const { c, storage } = bootSavesForHints();
    beginGame(c);
    // Skip the story + hints, save, quit clean, Continue — no toast on load.
    for (let i = 0; i < 4; i++) {
      const btn = document.querySelector('.hint-toast [data-action="hint-next"]') as HTMLButtonElement;
      if (btn) btn.click();
    }
    (document.querySelector('[data-action="pause"]') as HTMLButtonElement).click();
    (document.querySelector('[data-pause-action="save"]') as HTMLButtonElement).click();
    (document.querySelector('[data-action="save"]') as HTMLButtonElement).click();
    (document.querySelector('.save-dialog [data-slot-id="0"] [data-action="save-here"]') as HTMLButtonElement).click();
    // Saving made the world clean: quit goes directly to the title screen.
    (document.querySelector('[data-action="pause"]') as HTMLButtonElement).click();
    (document.querySelector('[data-pause-action="quit"]') as HTMLButtonElement).click();
    const cont = document.querySelector('[data-action="continue"]') as HTMLButtonElement;
    expect(cont).not.toBeNull();
    cont.click();
    expect(document.querySelector('.hint-toast')).toBeNull();
    expect(storage.getItem('cotw.save.0')).not.toBeNull();
  });

  function bootSavesForHints(): { c: GameController; storage: SaveStorage } {
    const store = memoryStorage();
    root = document.createElement('div');
    document.body.appendChild(root);
    prefsStore = memoryStorage();
    controller = createGameController({
      root,
      data: loadWorldData(),
      town: loadTownShops(),
      win: window,
      now: () => 0x5eed,
      loadTileSprites: () => Promise.resolve({}),
      screenToWorld: () => ({ ...pickTarget }),
      saves: createSaveManager({ storage: store }),
      storage: prefsStore,
    });
    controller.start();
    return { c: controller, storage: store };
  }
});

describe('expanded log + modern Help (UI plan Phase 7)', () => {
  const announceText = (): string =>
    document.querySelector('.sr-only-announce')?.textContent ?? '';

  it('groups consecutive repeated messages with a visible count', () => {
    const c = bootstrap();
    const w = beginGame(c);
    for (let i = 0; i < 3; i++) w.log.push({ turn: 90 + i, text: 'The kobold misses you!' });
    root.querySelector<HTMLButtonElement>('.recent-event')!.click();
    const rows = [...document.querySelectorAll('.log-full .log-entry')];
    const grouped = rows.find((r) => r.textContent?.includes('The kobold misses you!'));
    expect(grouped?.querySelector('.log-count')?.textContent).toBe('×3');
  });

  it('routine actions never touch the assertive announce region', () => {
    const c = bootstrap();
    beginGame(c);
    c.dispatchAction({ type: 'WAIT' });
    c.dispatchAction({ type: 'WAIT' });
    expect(announceText()).toBe('');
  });

  it('taking damage announces hit points; death announces the death', () => {
    const c = bootstrap();
    const w = beginGame(c);
    // Poison ticks are deterministic damage: 1 hp per 10 turns.
    w.player.statuses = [{ kind: 'poison', remainingTurns: 100, magnitude: 10 }];
    w.player.hp = 12;
    for (let i = 0; i < 10; i++) c.dispatchAction({ type: 'WAIT' });
    expect(announceText()).toMatch(/hit points/i);

    // Death via a seeded lethal adjacent monster (scene('combat') pattern).
    (window as unknown as { __cotw: { scene: (n: string) => { ok: boolean } } }).__cotw.scene('combat');
    const w2 = c.getWorld()!;
    for (const [, e] of w2.levels.get(w2.current)!.entities) {
      if (e.monster) e.monster.sleepTurns = 1000; // freeze the room
    }
    const adjacent = [...w2.levels.get(w2.current)!.entities.values()].find(
      (e) => e.monster && Math.abs(e.x - w2.player.x) + Math.abs(e.y - w2.player.y) === 1,
    );
    expect(adjacent).toBeDefined();
    adjacent!.monster!.alert = true;
    adjacent!.monster!.sleepTurns = 0;
    w2.player.hp = 1;
    let seed = 0;
    for (let s = 1; s < 500000; s++) {
      if (new MSLCG(s).rand(20) >= 16) { seed = s; break; }
    }
    w2.rng.setState(seed);
    c.dispatchAction({ type: 'WAIT' });
    expect(c.isDead()).toBe(true);
    expect(announceText()).toMatch(/you have died/i);
  });

  it('Help opens on the modern landing with the manual as a second tab', () => {
    const c = bootstrap();
    beginGame(c);
    root.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    (document.querySelector('[data-pause-action="help"]') as HTMLButtonElement).click();
    const modern = document.querySelector('[data-panel="modern"]');
    expect(modern?.classList.contains('active')).toBe(true);
    expect(modern?.textContent).toContain('Tap an explored tile');
    expect(document.querySelector('[data-htab="manual"]')?.textContent).toContain('Original manual');
    // Replay-hints entry survives (onboarding task).
    expect(document.querySelector('[data-action="replay-hints"]')).not.toBeNull();
  });
});

describe('working preferences (UI plan Phase 7)', () => {
  type Cam = { zoomIndex: number } | null;
  type TravelState = { active: boolean; selected: { x: number; y: number } | null };
  interface PrefHooks {
    turn: () => number;
    flash: () => { active: boolean };
    camera: () => Cam;
    travel: { state: () => TravelState & { preview: number }; tap: (c: { x: number; y: number }, t?: string) => void };
  }
  const hooks = (): PrefHooks => (window as unknown as { __cotw: PrefHooks }).__cotw;

  const openSettingsViaPause = (): void => {
    root.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    (document.querySelector('[data-pause-action="settings"]') as HTMLButtonElement).click();
  };

  const closeSettings = (): void => closeAllModals();

  it('text scale applies immediately and persists the complete state', () => {
    const c = bootstrap();
    beginGame(c);
    openSettingsViaPause();
    (document.querySelector('button[data-text-scale="1.5"]') as HTMLButtonElement).click();
    expect(document.documentElement.style.getPropertyValue('--text-scale')).toBe('1.5');
    const first = prefsStore.getItem('cotw.preferences');
    expect(first).toContain('"textScale":1.5');
    // A second, different change must carry the first along (A17 pattern).
    (document.querySelector('button[data-map-scale="1"]') as HTMLButtonElement).click();
    const second = JSON.parse(prefsStore.getItem('cotw.preferences') ?? '{}') as {
      textScale: number;
      mapScale: number;
    };
    expect(second.textScale).toBe(1.5);
    expect(second.mapScale).toBe(1);
    closeSettings();
  });

  it('production wiring (no injected win/storage) persists and applies preferences', () => {
    // Regression (Phase 8 e2e): main.ts passes only root/data/town. Reading
    // deps.win directly instead of the controller's global-window fallback
    // silently disabled persistence + the text-scale variable in production.
    window.localStorage.clear();
    try {
      root = document.createElement('div');
      document.body.appendChild(root);
      controller = createGameController({
        root,
        data: loadWorldData(),
        town: loadTownShops(),
        loadTileSprites: () => Promise.resolve({}),
        screenToWorld: () => ({ ...pickTarget }),
      });
      controller.start();
      beginGame(controller);
      openSettingsViaPause();
      (document.querySelector('button[data-text-scale="1.5"]') as HTMLButtonElement).click();
      expect(document.documentElement.style.getPropertyValue('--text-scale')).toBe('1.5');
      expect(window.localStorage.getItem('cotw.preferences')).toContain('"textScale":1.5');
      closeSettings();
    } finally {
      window.localStorage.clear();
    }
  });

  it('map scale shifts the camera zoom level', () => {
    const c = bootstrap({ realCamera: true });
    beginGame(c);
    const canvas = root.querySelector('canvas')!;
    Object.defineProperty(canvas, 'clientWidth', { value: 480, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 640, configurable: true });
    expect(hooks().camera()!.zoomIndex).toBe(1); // default
    openSettingsViaPause();
    (document.querySelector('button[data-map-scale="1"]') as HTMLButtonElement).click();
    closeSettings();
    expect(hooks().camera()!.zoomIndex).toBe(2); // default + 1
    openSettingsViaPause();
    (document.querySelector('button[data-map-scale="-1"]') as HTMLButtonElement).click();
    closeSettings();
    expect(hooks().camera()!.zoomIndex).toBe(0);
  });

  it('reduce motion "on" skips the cast flash while mana is still spent', () => {
    const c = bootstrap();
    const w = beginGame(c);
    openSettingsViaPause();
    (document.querySelector('button[data-reduce-motion="on"]') as HTMLButtonElement).click();
    closeSettings();
    w.player.knownSpells.push('s675');
    w.player.mana = 5;
    c.dispatchAction({ type: 'CAST', spellId: 's675' });
    expect(w.player.mana).toBe(4);
    expect(hooks().flash().active).toBe(false);
  });

  it('safe confirmation makes mouse travel select first instead of starting', async () => {
    const c = bootstrap();
    const w = beginGame(c);
    w.seen.get(0)!.fill(1); // routing needs discovered terrain
    openSettingsViaPause();
    const box = document.querySelector('[data-option="safe-confirmation"]') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    closeSettings();
    const before = hooks().turn();
    hooks().travel.tap({ x: 18, y: 20 }, 'mouse'); // two steps east on the road
    expect(hooks().turn()).toBe(before); // nothing spent yet
    expect(hooks().travel.state().selected).toEqual({ x: 18, y: 20 });
    // Second tap on the same cell confirms and travel starts ticking.
    hooks().travel.tap({ x: 18, y: 20 }, 'mouse');
    expect(hooks().travel.state().active).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 400)); // ≥2 ticks at 150ms
    expect(hooks().turn()).toBeGreaterThan(before);
  });
});

describe('storage failure resilience (CODE-QUALITY Task 1, F18)', () => {
  it('a throwing localStorage access still builds a playable controller', () => {
    root = document.createElement('div');
    document.body.appendChild(root);
    const w = windowWithThrowingStorage();
    expect(() => {
      controller = createGameController({
        root,
        data: loadWorldData(),
        town: loadTownShops(),
        win: w,
        now: () => 0x5eed,
        loadTileSprites: () => Promise.resolve({}),
        screenToWorld: () => ({ ...pickTarget }),
      });
      controller.start();
    }).not.toThrow();
    // The full new-game flow still works with storage disabled.
    const c = controller;
    if (!c) throw new Error('controller missing');
    const world = beginGame(c);
    expect(world.player.name).toBe('Sigrun');
    expect(c.getWorld()).not.toBeNull();
  });

  it('a storage getter that throws at read time keeps preferences at defaults', () => {
    root = document.createElement('div');
    document.body.appendChild(root);
    const throwingStore: PreferenceStorage = {
      getItem: () => {
        throw new Error('unreadable');
      },
      setItem: () => {
        throw new Error('unwritable');
      },
    };
    expect(() => {
      controller = createGameController({
        root,
        data: loadWorldData(),
        town: loadTownShops(),
        win: window,
        now: () => 0x5eed,
        loadTileSprites: () => Promise.resolve({}),
        screenToWorld: () => ({ ...pickTarget }),
        saves: createSaveManager({ storage: memoryStorage() }),
        storage: throwingStore,
      });
      controller.start();
    }).not.toThrow();
    const c = controller;
    if (!c) throw new Error('controller missing');
    const world = beginGame(c);
    expect(world.player.name).toBe('Sigrun');
  });
});

describe('canvas device-pixel correctness (F06/F16, Task 4)', () => {
  type Cam = { tile: number; originX: number; originY: number; zoomIndex: number; panX: number; panY: number } | null;
  type TravelState = { active: boolean; reason: string | null; remaining: number; selected: { x: number; y: number } | null; preview: number };
  type Hooks = { camera: () => Cam; travel: { state: () => TravelState } };

  const hooks = (): Hooks => (window as unknown as { __cotw: Hooks }).__cotw;

  interface CtxCall { op: string; args: number[] }

  /** Minimal 2d-context recorder: transform, smoothing, fills, images. */
  const makeCtxSpy = (): {
    ctx: unknown;
    calls: CtxCall[];
    smoothing: boolean[];
  } => {
    const calls: CtxCall[] = [];
    const smoothing: boolean[] = [];
    const ctx = {
      setTransform(...args: number[]): void {
        calls.push({ op: 'setTransform', args });
      },
      get imageSmoothingEnabled(): boolean {
        return smoothing[smoothing.length - 1] ?? false;
      },
      set imageSmoothingEnabled(v: boolean) {
        smoothing.push(v);
      },
      fillStyle: '',
      globalAlpha: 1,
      fillRect(...args: number[]): void {
        calls.push({ op: 'fillRect', args });
      },
      drawImage(): void {
        calls.push({ op: 'drawImage', args: [] });
      },
    };
    return { ctx, calls, smoothing };
  };

  /** Stand in a recording 2d context on the map canvas. */
  const stubCtx = (canvas: HTMLCanvasElement, spy: { ctx: unknown }): void => {
    canvas.getContext = (() => spy.ctx) as typeof canvas.getContext;
  };

  const setDpr = (dpr: number): void => {
    Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });
  };

  const sizeCanvas = (): void => {
    const canvas = root.querySelector('canvas')!;
    Object.defineProperty(canvas, 'clientWidth', { value: 480, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 640, configurable: true });
  };

  afterEach(() => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
  });

  it.each([1, 2, 2.625])('drawing transform matches device pixel ratio %s', (dpr) => {
    setDpr(dpr);
    const spy = makeCtxSpy();
    const c = bootstrap({ realCamera: true });
    beginGame(c);
    sizeCanvas();
    const canvas = root.querySelector('canvas')!;
    stubCtx(canvas, spy);
    window.dispatchEvent(new Event('resize'));
    expect(canvas.width).toBe(Math.round(480 * dpr));
    expect(canvas.height).toBe(Math.round(640 * dpr));
    // The drawing transform scales CSS pixels to the full backing store.
    const st = spy.calls.find((k) => k.op === 'setTransform');
    expect(st?.args).toEqual([dpr, 0, 0, dpr, 0, 0]);
    // Pixel art never smooths, and the whole viewport is cleared each frame.
    expect(spy.smoothing.every((v) => v === false)).toBe(true);
    expect(spy.calls.some((k) => k.op === 'fillRect' && k.args[0] === 0 && k.args[1] === 0 && k.args[2] === 480 && k.args[3] === 640)).toBe(true);
  });

  it.each([1, 2, 2.625])('cell-center tap round-trip is dpr-independent at ratio %s', (dpr) => {
    setDpr(dpr);
    const spy = makeCtxSpy();
    const c = bootstrap({ realCamera: true });
    const world = beginGame(c);
    sizeCanvas();
    const canvas = root.querySelector('canvas')!;
    stubCtx(canvas, spy);
    // Discover the town so route preview works for a distant road tile.
    world.seen.get(0)!.fill(1);
    window.dispatchEvent(new Event('resize'));
    const camera = hooks().camera();
    if (!camera) throw new Error('camera missing after resize');
    const target = { x: 18, y: 20 };
    const px = (target.x - camera.originX + 0.5) * camera.tile;
    const py = (target.y - camera.originY + 0.5) * camera.tile;
    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(down, 'clientX', { value: px, configurable: true });
    Object.defineProperty(down, 'clientY', { value: py, configurable: true });
    Object.defineProperty(down, 'pointerId', { value: 7, configurable: true });
    Object.defineProperty(down, 'pointerType', { value: 'touch', configurable: true });
    canvas.dispatchEvent(down);
    const up = new Event('pointerup', { bubbles: true, cancelable: true });
    Object.defineProperty(up, 'clientX', { value: px, configurable: true });
    Object.defineProperty(up, 'clientY', { value: py, configurable: true });
    Object.defineProperty(up, 'pointerId', { value: 7, configurable: true });
    Object.defineProperty(up, 'pointerType', { value: 'touch', configurable: true });
    canvas.dispatchEvent(up);
    const state = hooks().travel.state();
    expect(state.selected).toEqual(target);
  });

  it('ResizeObserver on the map element invalidates the camera without a window resize', () => {
    const instances: FakeRO[] = [];
    class FakeRO {
      cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
        instances.push(this);
      }
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', FakeRO);
    try {
      const spy = makeCtxSpy();
      const c = bootstrap({ realCamera: true });
      beginGame(c);
      sizeCanvas();
      const canvas = root.querySelector('canvas')!;
      stubCtx(canvas, spy);
      expect(instances.length).toBeGreaterThanOrEqual(1);
      // Element resized (sheet grew, devtools opened) — no window event fires.
      instances[0]!.cb();
      expect(canvas.width).toBe(480);
      expect(canvas.height).toBe(640);
      expect(hooks().camera()).not.toBeNull();
      c.destroy();
      expect(instances.length).toBeGreaterThanOrEqual(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('new game plays the injected data (CODE-QUALITY Task 11)', () => {
  it('spawns on the deps.data graph, not a re-loaded one', () => {
    root = document.createElement('div');
    document.body.appendChild(root);
    prefsStore = memoryStorage();
    const full = loadWorldData();
    const small: WorldData = { ...full, levels: full.levels.slice(0, 2), items: {}, spells: {} };
    controller = createGameController({
      root,
      data: small,
      town: loadTownShops(),
      win: window,
      now: () => 0x5eed,
      loadTileSprites: () => Promise.resolve({}),
      screenToWorld: () => ({ ...pickTarget }),
      saves: createSaveManager({ storage: memoryStorage() }),
      storage: prefsStore,
    });
    controller.start();
    beginGame(controller);
    const w = controller.getWorld();
    expect(w).not.toBeNull();
    expect(w!.data.levels).toHaveLength(2);
    expect(w!.data).toBe(small);
  });
});

describe('one interface-state owner (CODE-QUALITY Task 5)', () => {
  interface CQHooks {
    turn: () => number;
    position: () => { x: number; y: number; level: number } | null;
    dispatch: (a: unknown) => void;
    scene: (name: string) => { ok: boolean; detail?: string };
  }
  const hooks = (): CQHooks => (window as unknown as { __cotw: CQHooks }).__cotw;
  const aliveWorld = (c: GameController): World => {
    const w = c.getWorld();
    if (!w) throw new Error('world did not spawn');
    return w;
  };
  const bootWith = (storage: SaveStorage): GameController => {
    root = document.createElement('div');
    document.body.appendChild(root);
    prefsStore = memoryStorage();
    const c = createGameController({
      root,
      data: loadWorldData(),
      town: loadTownShops(),
      now: () => 0x5eed,
      screenToWorld: () => ({ ...pickTarget }),
      loadTileSprites: () => Promise.resolve({}),
      saves: createSaveManager({ storage }),
      storage: prefsStore,
    });
    controller = c;
    c.start();
    return c;
  };
  const beginNamed = (c: GameController, name: string, dismissStory = true): void => {
    c.newGame();
    const input = document.querySelector('.modal-overlay [data-field="name"]') as HTMLInputElement;
    input.value = name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    (document.querySelector('.modal-overlay [data-action="begin"]') as HTMLElement).click();
    if (dismissStory) {
      for (;;) {
        const btn = document.querySelector<HTMLButtonElement>('.story-overlay [data-action="continue"]');
        if (!btn) break;
        btn.click();
      }
    }
  };
  const waitButton = (): HTMLElement =>
    document.querySelector('button[data-action="wait"]') as HTMLElement;

  it('HUD buttons are inert while the opening story is showing', async () => {
    const c = bootstrap();
    // Begin WITHOUT dismissing the intro cutscene.
    beginNamed(c, 'StoryGate', false);
    await vi.waitFor(() => {
      expect(document.querySelector('.story-overlay')).not.toBeNull();
    });
    const turnBefore = hooks().turn();
    waitButton().click();
    expect(hooks().turn()).toBe(turnBefore);
    dismissStoryAll();
  });

  it('gameplay dispatches and HUD buttons are blocked after victory', async () => {
    const c = bootstrap();
    beginNamed(c, 'Victor');
    hooks().scene('victory');
    c.dispatchAction({ type: 'WAIT' });
    dismissStoryAll();
    await vi.waitFor(() => {
      expect(document.querySelector('.story-overlay.victory')).not.toBeNull();
    });
    const turnBefore = hooks().turn();
    // Test-command path (debug dispatch) must refuse.
    hooks().dispatch({ type: 'WAIT' });
    // HUD path must refuse too.
    waitButton().click();
    expect(hooks().turn()).toBe(turnBefore);
    // Leaving to title restores a clean (title) state.
    (document.querySelector('[data-action="return-title"]') as HTMLElement).click();
    expect(document.querySelector('.title-overlay')).not.toBeNull();
    expect(hooks().position()).toBeNull();
  });

  it('loading a world cancels targeting and replays queued story text', async () => {
    const storage = memoryStorage();
    const c = bootWith(storage);
    beginNamed(c, 'Reload');
    // Targeting is armed…
    const w = aliveWorld(c);
    w.player.knownSpells.push('s510');
    (document.querySelector('button[data-action="cast"]') as HTMLElement).click();
    const castButton = document.querySelector(
      '.spell-row[data-spell="s510"] [data-action="cast"]',
    ) as HTMLElement;
    castButton.click();
    expect(document.querySelector('.target-bar')).not.toBeNull();
    // …and a save with a queued story text is stored as the newest autosave.
    w.questState!.pending = [1];
    const file = serializeGame(w, { savedAt: '2026-11-12T10:00:00.000Z' });
    storage.setItem('cotw.save.auto', JSON.stringify(file));
    // Quit to title (dirty world → three-way), then Continue loads it.
    (document.querySelector('button[data-action="pause"]') as HTMLElement).click();
    (document.querySelector('[data-pause-action="quit"]') as HTMLElement).click();
    (document.querySelector('[data-action="quit-without"]') as HTMLElement).click();
    await vi.waitFor(() => {
      expect(document.querySelector('.title-overlay')).not.toBeNull();
    });
    (document.querySelector('[data-action="continue"]') as HTMLElement).click();
    // Targeting bar from the previous world is gone…
    expect(document.querySelector('.target-bar')).toBeNull();
    // …and the queued story text (re)appears.
    await vi.waitFor(() => {
      expect(document.querySelector('.story-overlay')).not.toBeNull();
    });
    dismissStoryAll();
  });

  it('destroy closes owned overlays, removes debug globals, and remounts cleanly', async () => {
    const c = bootstrap();
    beginNamed(c, 'Doomed');
    // An owned panel is open at destroy time.
    (document.querySelector('button[data-action="inventory"]') as HTMLElement).click();
    expect(document.querySelector('.modal-overlay .inventory-panel')).not.toBeNull();
    const w = window as unknown as { __cotw?: unknown; __cotwPerf?: unknown };
    expect(w.__cotw).toBeDefined();
    c.destroy();
    // Module modal stack is empty (a remount must not inherit stale handles).
    const { openModalCount } = await import('./ui/dialogs');
    expect(openModalCount()).toBe(0);
    expect(w.__cotw).toBeUndefined();
    expect(w.__cotwPerf).toBeUndefined();
    // Remount: a fresh controller works on the same root.
    const c2 = bootstrap();
    beginNamed(c2, 'Remounted');
    expect(aliveWorld(c2).player.name).toBe('Remounted');
    expect(hooks().turn()).toBe(0);
  });
});

it('opens Debug from Pause and marks applied inventory edits as unsaved', () => {
  const c = bootstrap();
  const before = beginGame(c);
  const turn = before.turn;
  const position = [before.player.x, before.player.y];
  const seen = [...before.seen.get(before.current)!];
  (document.querySelector('.hud-pause') as HTMLButtonElement).click();
  (document.querySelector('[data-pause-action="debug"]') as HTMLButtonElement).click();
  (document.querySelector('[data-field="debug-reveal"]') as HTMLInputElement).click();
  expect([...before.seen.get(before.current)!]).toEqual(seen);
  (document.querySelector('[data-debug-edit="inventory"]') as HTMLButtonElement).click();
  const gold = document.querySelector('[data-field="gold"]') as HTMLInputElement;
  gold.value = '1234';
  gold.dispatchEvent(new Event('input', {bubbles: true}));
  (document.querySelector('[data-action="apply-edits"]') as HTMLButtonElement).click();
  const after = c.getWorld()!;
  expect(after.inventory.gold).toBe(1234);
  expect(after.turn).toBe(turn);
  expect([after.player.x, after.player.y]).toEqual(position);
  (document.querySelector('.hud-pause') as HTMLButtonElement).click();
  expect(document.querySelector('.pause-unsaved')).not.toBeNull();
});

it('turn motion follows movement and expires without changing game state', () => {
  let time = 1000;
  const c = bootstrap({now:()=>time});
  const w = beginGame(c);
  const hook = (window as unknown as {__cotw:{motion:()=>{active:boolean;kind:string}}}).__cotw;
  const level = w.levels.get(w.current)!;
  w.player.x = 30; w.player.y = 30;
  level.tiles[30*64+31] = 1;
  level.occupancy[30*64+31] = 0;
  c.dispatchAction({type:'MOVE',dx:1,dy:0});
  expect(w.player.x).toBe(31);
  expect(hook.motion()).toMatchObject({active:true,kind:'move'});
  const turn = w.turn;
  time += 180;
  expect(hook.motion().active).toBe(false);
  expect(w.turn).toBe(turn);
  c.dispatchAction({type:'MOVE',dx:-1,dy:0});
  expect(hook.motion().active).toBe(true);
  beginGame(c);
  expect(hook.motion().active).toBe(false);
});

it('reduced motion skips sprite movement effects', () => {
  const c = bootstrap({reducedMotion:()=>true});
  const w = beginGame(c);
  const level = w.levels.get(w.current)!;
  w.player.x = 30; w.player.y = 30;
  level.tiles[30*64+31] = 1;
  level.occupancy[30*64+31] = 0;
  c.dispatchAction({type:'MOVE',dx:1,dy:0});
  expect(w.player.x).toBe(31);
  const hook = (window as unknown as {__cotw:{motion:()=>{active:boolean}}}).__cotw;
  expect(hook.motion().active).toBe(false);
});

it('quitting during targeting removes its controls and keyboard capture', () => {
  const c = bootstrap();
  const w = beginGame(c);
  w.player.knownSpells.push('s527');
  w.player.mana = 30; w.player.maxMana = 30;
  root.querySelector<HTMLButtonElement>('.dock [data-action="cast"]')!.click();
  document.querySelector<HTMLButtonElement>('.spell-row [data-action="cast"]')!.click();
  expect(root.querySelector('.target-bar')).not.toBeNull();
  root.querySelector<HTMLButtonElement>('.hud-pause')!.click();
  document.querySelector<HTMLButtonElement>('[data-pause-action="quit"]')!.click();
  document.querySelector<HTMLButtonElement>('[data-action="quit-without"]')!.click();
  expect(root.querySelector('.target-bar')).toBeNull();
  expect(root.querySelector('.title-overlay')).not.toBeNull();
  const hooks = (window as unknown as {__cotw:{targeting:()=>{active:boolean}}}).__cotw;
  expect(hooks.targeting().active).toBe(false);
});

it('stops ambient frame scheduling when the system motion preference changes',()=>{
 vi.useFakeTimers();
 const media=new EventTarget() as MediaQueryList;
 Object.defineProperty(media,'matches',{value:false,writable:true});
 const originalMedia=Object.getOwnPropertyDescriptor(window,'matchMedia');
 Object.defineProperty(window,'matchMedia',{value:()=>media,configurable:true,writable:true});
 const raf=vi.spyOn(window,'requestAnimationFrame');
 try {
  const c=bootstrap();beginGame(c);vi.advanceTimersByTime(1000);expect(raf.mock.calls.length).toBeGreaterThan(5);
  Object.defineProperty(media,'matches',{value:true,writable:true});media.dispatchEvent(new Event('change'));
  vi.advanceTimersByTime(100);raf.mockClear();vi.advanceTimersByTime(1000);expect(raf).not.toHaveBeenCalled();
 } finally {controller?.destroy();controller=null;if(originalMedia)Object.defineProperty(window,'matchMedia',originalMedia);else Reflect.deleteProperty(window,'matchMedia');raf.mockRestore();vi.useRealTimers();}
});

it.each(['hidden','title','death','victory','destroy'])('stops ambient scheduling in %s state',(state)=>{
 vi.useFakeTimers();const raf=vi.spyOn(window,'requestAnimationFrame');
 const oldHidden=Object.getOwnPropertyDescriptor(document,'hidden');
 try {
  const c=bootstrap(),world=beginGame(c);vi.advanceTimersByTime(1000);expect(raf.mock.calls.length).toBeGreaterThan(5);
  if(state==='hidden'){Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));}
  if(state==='title'){
   document.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();document.querySelector<HTMLButtonElement>('[data-pause-action="quit"]')!.click();document.querySelector<HTMLButtonElement>('[data-action="quit-without"]')!.click();
  }
  if(state==='death'){world.player.hp=0;c.dispatchAction({type:'WAIT'});}
  if(state==='victory'){
   const hooks=(window as unknown as {__cotw:{scene:(name:string)=>unknown}}).__cotw;hooks.scene('victory');c.dispatchAction({type:'WAIT'});dismissStoryAll();
  }
  if(state==='destroy')c.destroy();
  vi.advanceTimersByTime(600);raf.mockClear();vi.advanceTimersByTime(1000);expect(raf).not.toHaveBeenCalled();
 }finally{
  controller?.destroy();controller=null;
  if(oldHidden)Object.defineProperty(document,'hidden',oldHidden);else Reflect.deleteProperty(document,'hidden');
  raf.mockRestore();vi.useRealTimers();
 }
});

describe('part selection (PART2-PLAN Task P6)', () => {
  function bootP2(): { c: GameController; part1: SaveStorage & { dump(): Map<string, string> }; part2: SaveStorage & { dump(): Map<string, string> } } {
    const part1 = memoryStorage();
    const part2 = memoryStorage();
    root = document.createElement('div');
    document.body.appendChild(root);
    prefsStore = memoryStorage();
    controller = createGameController({
      root,
      data: loadWorldData(),
      town: loadTownShops(),
      win: window,
      now: () => 0x5eed,
      loadTileSprites: () => Promise.resolve({}),
      screenToWorld: () => ({ ...pickTarget }),
      saves: createSaveManager({ storage: part1 }),
      savesPart2: createSaveManager({ storage: part2, part: 2 }),
      storage: prefsStore,
    });
    controller.start();
    return { c: controller, part1, part2 };
  }

  function beginOnPart(c: GameController, part: 1 | 2, name: string): World {
    document.querySelector<HTMLButtonElement>(`[data-part="${part}"]`)!.click();
    c.newGame();
    const nameInput = document.querySelector('.modal-overlay [data-field="name"]') as HTMLInputElement;
    nameInput.value = name;
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    (document.querySelector('.modal-overlay [data-action="begin"]') as HTMLButtonElement).click();
    const world = c.getWorld();
    if (!world) throw new Error('world did not spawn');
    dismissStoryAll();
    return world;
  }

  function quitToTitleFromPlaying(c: GameController): void {
    void c;
    document.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-pause-action="quit"]')!.click();
    // Fresh worlds are dirty: take the explicit discard path.
    const discard = document.querySelector<HTMLButtonElement>('[data-action="quit-without"]');
    if (discard) discard.click();
  }

  it('the title offers both parts and Part 2 spawns the part-2 world', () => {
    const { c } = bootP2();
    const parts = document.querySelectorAll('.title-parts [data-part]');
    expect(parts.length).toBe(2);
    expect((parts[0] as HTMLElement).dataset.part).toBe('1');
    expect((parts[1] as HTMLElement).dataset.part).toBe('2');
    const w2 = beginOnPart(c, 2, 'Beta');
    expect(w2.data.part).toBe(2);
    expect(w2.data.levels.length).toBe(26);
    quitToTitleFromPlaying(c);
    document.querySelector<HTMLButtonElement>('[data-part="1"]')!.click();
    const sub = document.querySelector('.title-overlay p')!;
    expect(sub.textContent).toMatch(/Part One/);
    const w1 = beginOnPart(c, 1, 'Alpha');
    expect(w1.data.part).toBe(1);
    expect(w1.data.levels.length).toBe(12);
  });

  it.each([1,2] as const)('shows the campaign %s manual in Help', part => {
    const {c}=bootP2();beginOnPart(c,part,'Reader');
    document.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-pause-action="help"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-htab="manual"]')!.click();
    expect(document.querySelector('[data-panel="manual"]')?.textContent).toContain(part===2?'The Story So Far':'Order Information');
  });

  it('manual saves never collide across parts', () => {
    const { c, part1, part2 } = bootP2();
    beginOnPart(c, 2, 'Beta');
    document.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-pause-action="save"]')!.click();
    (document.querySelector('.modal-overlay [data-action="save"]') as HTMLButtonElement).click();
    (document.querySelector('.save-dialog [data-slot-id="0"] [data-action="save-here"]') as HTMLButtonElement).click();
    expect(part2.dump().has('cotw.save-p2.0')).toBe(true);
    expect(part1.dump().size).toBe(0);
    quitToTitleFromPlaying(c);
    document.querySelector<HTMLButtonElement>('[data-part="1"]')!.click();
    beginOnPart(c, 1, 'Alpha');
    document.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-pause-action="save"]')!.click();
    (document.querySelector('.modal-overlay [data-action="save"]') as HTMLButtonElement).click();
    (document.querySelector('.save-dialog [data-slot-id="0"] [data-action="save-here"]') as HTMLButtonElement).click();
    expect(part1.dump().has('cotw.save.0')).toBe(true);
    // Each part loads its own slot 0.
    const beta = createSaveManager({ storage: part2, part: 2 }).loadSlot(0);
    const alpha = createSaveManager({ storage: part1, part: 1 }).loadSlot(0);
    expect(beta.player.name).toBe('Beta');
    expect(alpha.player.name).toBe('Alpha');
  });

  it('Continue resolves per selected part', () => {
    const mkSave = (name: string, part: 1 | 2, savedAt: string): string => {
      const w = newWorld({
        worldSeed: 7,
        player: { ...createCharacter({ name, gender: 'female', strength: 50, intelligence: 50, constitution: 50, dexterity: 50, difficulty: 'intermediate' }) },
        part,
      });
      return JSON.stringify(serializeGame(w, { savedAt }));
    };
    const part1 = memoryStorage();
    const part2 = memoryStorage();
    part1.setItem('cotw.save.auto', mkSave('Alpha', 1, '2026-11-12T10:00:00.000Z'));
    part2.setItem('cotw.save.auto-p2', mkSave('Beta', 2, '2026-11-12T11:00:00.000Z'));
    root = document.createElement('div');
    document.body.appendChild(root);
    prefsStore = memoryStorage();
    controller = createGameController({
      root,
      data: loadWorldData(),
      town: loadTownShops(),
      win: window,
      now: () => 0x5eed,
      loadTileSprites: () => Promise.resolve({}),
      screenToWorld: () => ({ ...pickTarget }),
      saves: createSaveManager({ storage: part1 }),
      savesPart2: createSaveManager({ storage: part2, part: 2 }),
      storage: prefsStore,
    });
    controller.start();
    const cont = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('[data-action="continue"]')!;
    expect(cont().textContent).toContain('Alpha');
    document.querySelector<HTMLButtonElement>('[data-part="2"]')!.click();
    expect(cont().textContent).toContain('Beta');
    cont().click();
    const world = controller.getWorld();
    expect(world?.player.name).toBe('Beta');
    expect(world?.data.part).toBe(2);
  });

  it('part-2 shop doors open the part-2 merchants', () => {
    const { c } = bootP2();
    const world = beginOnPart(c, 2, 'Beta');
    const t2 = loadTownShops(2);
    const ingrid = t2.buildings.find((b) => b.shopId === 'ingrid')!;
    // Stand adjacent to the door (above it), reveal the tile, step onto it.
    world.player.x = ingrid.door.x;
    world.player.y = ingrid.door.y - 1;
    world.seen.get(world.data.town !== undefined ? 0 : 0)!.fill(1);
    c.dispatchAction({ type: 'MOVE', dx: 0, dy: 1 });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const title = document.querySelector('.modal-overlay .dialog-title');
    expect(title?.textContent).toBe("Ingrid's Alchemy Shop");
  });

  it('editor teleport to level 20 works on a part-2 save', () => {
    const { c } = bootP2();
    beginOnPart(c, 2, 'Beta');
    document.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-pause-action="save"]')!.click();
    (document.querySelector('.modal-overlay [data-action="edit-save"]') as HTMLButtonElement).click();
    const level = document.querySelector('.modal-overlay [data-field="pos-level"]') as HTMLSelectElement;
    expect(level.querySelectorAll('option').length).toBe(26);
    level.value = '20';
    level.dispatchEvent(new Event('change', { bubbles: true }));
    (document.querySelector('.modal-overlay [data-action="apply-edits"]') as HTMLButtonElement).click();
    const world = c.getWorld();
    expect(world?.data.part).toBe(2);
    expect(world?.current).toBe(20);
    expect(world?.levels.get(20)).toBeDefined();
  });
});

describe('part 1 import (PART2-PLAN Task P7)', () => {
  function veteranSave(name: string, hp?: number): ReturnType<typeof serializeGame> {
    const world = newWorld({
      worldSeed: 7,
      player: createCharacter({
        name,
        gender: 'female',
        strength: 60,
        intelligence: 50,
        constitution: 55,
        dexterity: 35,
        difficulty: 'intermediate',
      }),
      part: 1,
    });
    world.player.level = 5;
    world.player.knownSpells.push('s323'); // SHIELD (C1 id)
    if (hp !== undefined) world.player.hp = hp;
    return serializeGame(world, { savedAt: '2026-11-13T10:00:00.000Z' });
  }

  function bootImport(seeded: Map<string, string> = new Map()): GameController {
    const part1 = memoryStorage();
    for (const [key, value] of seeded) part1.setItem(key, value);
    root = document.createElement('div');
    document.body.appendChild(root);
    prefsStore = memoryStorage();
    controller = createGameController({
      root,
      data: loadWorldData(),
      town: loadTownShops(),
      win: window,
      now: () => 0x5eed,
      loadTileSprites: () => Promise.resolve({}),
      screenToWorld: () => ({ ...pickTarget }),
      saves: createSaveManager({ storage: part1 }),
      savesPart2: createSaveManager({ storage: memoryStorage(), part: 2 }),
      storage: prefsStore,
    });
    controller.start();
    return controller;
  }

  function seedSlot(slot: number, save: ReturnType<typeof serializeGame>): Map<string, string> {
    const store = memoryStorage();
    createSaveManager({ storage: store }).saveToSlot(slot, save);
    return store.dump();
  }

  function openPart2Wizard(c: GameController): void {
    document.querySelector<HTMLButtonElement>('[data-part="2"]')!.click();
    c.newGame();
  }

  it('the part-2 wizard offers the import; the part-1 wizard does not', () => {
    const c = bootImport();
    openPart2Wizard(c);
    expect(document.querySelector('.modal-overlay [data-action="import-p1"]')).not.toBeNull();
    closeAllModals();
    // Switch back to part 1 on the title screen.
    document.querySelector<HTMLButtonElement>('[data-part="1"]')!.click();
    c.newGame();
    expect(document.querySelector('.modal-overlay [data-action="import-p1"]')).toBeNull();
  });

  it('importing a part 1 hero loads the part-2 world with remapped spells', () => {
    const c = bootImport(seedSlot(0, veteranSave('Veteran')));
    openPart2Wizard(c);
    (document.querySelector('.modal-overlay [data-action="import-p1"]') as HTMLButtonElement).click();
    // Part-1 slot list opens in load mode.
    (document.querySelector('.save-dialog [data-slot-id="0"] [data-action="load"]') as HTMLButtonElement).click();
    const world = c.getWorld();
    expect(world).not.toBeNull();
    expect(world?.data.part).toBe(2);
    expect(world?.data.levels.length).toBe(26);
    expect(world?.player.name).toBe('Veteran');
    expect(world?.player.level).toBe(5);
    expect(world?.player.knownSpells).toEqual(['s-shield']);
    dismissStoryAll();
  });

  it('imports a Part One backup file into a new Part Two campaign',async()=>{
    const c=bootImport();openPart2Wizard(c);
    document.querySelector<HTMLButtonElement>('[data-action="import-p1"]')!.click();
    const input=document.querySelector<HTMLInputElement>('.save-dialog input[type="file"]')!;
    const file=new File([], 'hero.cotwsave.json');
    Object.defineProperty(file,'text',{value:()=>Promise.resolve(JSON.stringify(veteranSave('Backup')))});
    Object.defineProperty(input,'files',{value:[file]});input.dispatchEvent(new Event('change',{bubbles:true}));
    await vi.waitFor(()=>expect(c.getWorld()?.data.part).toBe(2));
    expect(c.getWorld()?.player.name).toBe('Backup');
    dismissStoryAll();
    document.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-pause-action="quit"]')!.click();
    expect(document.querySelector('[data-action="quit-without"]')).not.toBeNull();
  });

  it('a dead hero is rejected with the reason shown in the wizard', () => {
    const c = bootImport(seedSlot(1, veteranSave('Fallen', 0)));
    openPart2Wizard(c);
    (document.querySelector('.modal-overlay [data-action="import-p1"]') as HTMLButtonElement).click();
    (document.querySelector('.save-dialog [data-slot-id="1"] [data-action="load"]') as HTMLButtonElement).click();
    expect(c.getWorld()).toBeNull();
    const err = document.querySelector('.modal-overlay [data-field="import-error"]');
    expect(err?.textContent).toMatch(/dead/i);
    // The wizard is still open for a manual start.
    expect(document.querySelector('.modal-overlay [data-action="begin"]')).not.toBeNull();
  });
});

it('allows a fresh browser to open the backup import dialog',()=>{
 const c=bootstrap();void c;
 const button=document.querySelector<HTMLButtonElement>('[data-action="load-game"]')!;
 expect(button.disabled).toBe(false);button.click();
 expect(document.querySelector('.save-dialog input[type="file"]')).not.toBeNull();
});

it('runs configured idle actions only during unobstructed active play', () => {
  vi.useFakeTimers();
  try {
    const c = bootstrap({ now: () => Date.now() });
    const world = beginGame(c);
    root.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-pause-action="settings"]')!.click();
    for (const key of ['idleRestSeconds', 'idleSearchSeconds']) {
      const select = document.querySelector<HTMLSelectElement>(`[data-option="${key}"]`)!;
      select.value = '5'; select.dispatchEvent(new Event('change'));
    }
    expect(prefsStore.getItem('cotw.preferences')).toContain('"idleSearchSeconds":5');
    const start = world.turn;
    vi.advanceTimersByTime(6000);
    expect(world.turn).toBe(start);
    closeAllModals();
    world.player.hp = world.player.maxHp - 2;
    vi.advanceTimersByTime(5000);
    expect(world.player.hp).toBe(world.player.maxHp);
    expect(world.log.some(entry => entry.text.startsWith('Auto rest:'))).toBe(true);
    const rested = world.turn;
    vi.advanceTimersByTime(5000);
    expect(world.turn).toBe(rested + 1);
    expect(world.log.some(entry => entry.text.startsWith('Auto search:'))).toBe(true);
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(10000);
    expect(world.turn).toBe(rested + 1);
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(4999);
    expect(world.turn).toBe(rested + 1);
    c.destroy(); controller = null;
  } finally { vi.useRealTimers(); }
});

it('Sell All clears the pack at the quoted price and preserves equipped items', () => {
  const c = bootstrap();
  const world = beginGame(c);
  const def = Object.values(world.data.items).find(d => d.name === 'Club')!;
  pickup(world.inventory, world.player, def.id, world.data.items);
  pickup(world.inventory, world.player, def.id, world.data.items);
  world.inventory.equipment.weapon = { uid: 'equipped-test', defId: def.id, count: 1 };
  const expected = world.inventory.pack.reduce((sum, i) => sum + sellGain(world.data.items[i.defId]!, 'store', i.count).total, 0);
  const before = world.inventory.gold;
  c.openMerchant(loadTownShops().shops.gunnhild!);
  document.querySelector<HTMLButtonElement>('[data-mtab="sell"]')!.click();
  document.querySelector<HTMLButtonElement>('[data-action="sell-all"]')!.click();
  expect(world.inventory.gold).toBe(before);
  document.querySelector<HTMLButtonElement>('[data-action="confirm-sell-all"]')!.click();
  expect(world.inventory.gold).toBe(before + expected);
  expect(world.inventory.pack).toHaveLength(0);
  expect(world.inventory.equipment.weapon?.uid).toBe('equipped-test');
});

it('offers a ranged weapon selector and enters aiming without spending a turn', () => {
  const c = bootstrap();
  const w = beginGame(c);
  pickup(w.inventory, w.player, 'x-rock', w.data.items, 3);
  root.querySelector<HTMLButtonElement>('[data-action="actions"]')!.click();
  const fire = document.querySelector<HTMLButtonElement>('[data-action="fire"]');
  expect(fire).not.toBeNull();
  fire!.click();
  const turn = w.turn;
  document.querySelector<HTMLButtonElement>('[data-ranged]')!.click();
  expect(document.querySelector('.target-bar')?.textContent).toContain('Rock');
  expect(w.turn).toBe(turn);
});

it('offers nearby encounter interaction in the actions menu', () => {
  const c = bootstrap();
  const w = beginGame(c);
  w.levels.get(w.current)!.entities.set(991, {id:991,kind:'npc',name:'Passing traveler',x:w.player.x+1,y:w.player.y,npc:{role:'traveler',giftClaimed:false,stock:[]}});
  w.visible[idx(w.player.x+1,w.player.y)] = 1;
  root.querySelector<HTMLButtonElement>('[data-action="actions"]')!.click();
  const talk = document.querySelector<HTMLButtonElement>('[data-action="interact"]');
  expect(talk).not.toBeNull();
  talk!.click();
  expect(document.querySelector('.interaction-bar')?.textContent).toContain('direction');
  expect(document.querySelector('.modal-overlay')).toBeNull();
});

it('shows learned spells as direct shortcuts before the player pins favorites', () => {
  const c = bootstrap();
  const w = beginGame(c);
  w.player.knownSpells = ['s323'];
  w.player.mana = w.player.maxMana = 20;
  c.dispatchAction({type:'WAIT'});
  const button = root.querySelector<HTMLButtonElement>('[data-action="slot-0"]')!;
  expect(button.hidden).toBe(false);
  expect(button.textContent).toMatch(/shield/i);
  button.click();
  expect(w.player.statuses.some(s => s.kind === 'shield')).toBe(true);
  expect(document.querySelector('.modal-overlay')).toBeNull();
});

it('keeps conversation text when the log reaches its size limit', () => {
  const c = bootstrap();
  const w = beginGame(c);
  const level = w.levels.get(w.current)!;
  const x = w.player.x+1, y = w.player.y;
  level.entities.clear();
  level.tiles[idx(x,y)] = level.tiles[idx(w.player.x,w.player.y)]!;
  level.entities.set(992,{id:992,kind:'npc',name:'Passing traveler',x,y,npc:{role:'traveler',giftClaimed:false,stock:[]}});
  w.visible[idx(x,y)] = 1;
  w.log = Array.from({length:500},()=>({turn:0,text:'Old entry'}));
  const hooks = (window as unknown as {__cotw:{travel:{tap:(p:{x:number;y:number})=>void}}}).__cotw;
  hooks.travel.tap({x,y});
  expect(w.log.some(entry=>entry.text.includes('Passing traveler:'))).toBe(true);
  expect(document.querySelector('.modal-overlay')).toBeNull();
});

it('routes around a visible shopkeeper instead of walking into it', () => {
  const c = bootstrap();
  const w = beginGame(c);
  w.player.x = 16; w.player.y = 20;
  const level = w.levels.get(0)!;
  level.entities.clear();
  const floor = level.tiles[idx(16,20)]!;
  for (let y=19;y<=21;y++) for(let x=16;x<=20;x++) level.tiles[idx(x,y)] = floor;
  w.seen.get(0)!.fill(1); w.visible.fill(1);
  level.entities.set(993,{id:993,kind:'npc',name:'Owner',x:17,y:20,npc:{role:'shopkeeper',giftClaimed:false,stock:[]}});
  const hooks=(window as unknown as {__cotw:{travel:{hover:(p:{x:number;y:number})=>void;state:()=>{preview:number}}}}).__cotw;
  hooks.travel.hover({x:19,y:20});
  expect(hooks.travel.state().preview).toBe(5);
});

it('keeps Actions open for repeated turns without blocking movement',()=>{
  const c=bootstrap();const w=beginGame(c);
  const toggle=root.querySelector<HTMLButtonElement>('.dock [data-action="actions"]')!;
  toggle.click();
  const palette=root.querySelector<HTMLElement>('.action-palette');
  expect(palette).not.toBeNull();expect(palette!.hidden).toBe(false);
  expect(document.querySelector('.modal-overlay')).toBeNull();expect(c.isInputEnabled()).toBe(true);
  const turn=w.turn;
  palette!.querySelector<HTMLButtonElement>('[data-action="wait"]')!.click();
  palette!.querySelector<HTMLButtonElement>('[data-action="wait"]')!.click();
  expect(w.turn).toBe(turn+2);expect(palette!.hidden).toBe(false);
  expect(root.querySelector('.dock [data-action="wait"]')).toBeNull();
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  expect(palette!.hidden).toBe(true);expect(document.querySelector('.modal-overlay')).toBeNull();
});

it('offers disarming and shows success feedback at a known trap',()=>{
  const c=bootstrap({reducedMotion:()=>false});const w=beginGame(c);
  const level=w.levels.get(w.current)!;
  const x=w.player.x+1,y=w.player.y;
  level.traps=[{id:'known-pit',kind:'pit',x,y,known:true}];w.player.dexterity=100;
  root.querySelector<HTMLButtonElement>('[data-action="actions"]')!.click();
  const disarm=document.querySelector<HTMLButtonElement>('[data-action="disarm"]');
  expect(disarm).not.toBeNull();disarm!.click();
  expect(level.traps).toHaveLength(0);
  const hooks=(window as unknown as {__cotw:{flash:()=>{cells:number;active:boolean}}}).__cotw;
  expect(hooks.flash().cells).toBe(1);
  expect(hooks.flash().active).toBe(true);
  expect(w.log.some(entry=>entry.text==='You disarmed the trap.')).toBe(true);
});

it('Curses adds a player reaction to traps and stops when disabled',()=>{
  const c=bootstrap();const w=beginGame(c);
  const toggleCurses=()=>{
    root.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-pause-action="settings"]')!.click();
    document.querySelector<HTMLInputElement>('[data-option="curses"]')!.click();
    closeAllModals();
  };
  toggleCurses();
  const level=w.levels.get(w.current)!;
  level.entities.clear();level.occupancy.fill(0);
  w.player.hp=w.player.maxHp=100;
  const floor=level.tiles[idx(w.player.x,w.player.y)]!;
  for(let n=1;n<=2;n++)level.tiles[idx(w.player.x+n,w.player.y)]=floor;
  level.traps=[1,2].map(n=>({id:`curse-pit-${n}`,kind:'pit' as const,x:w.player.x+n,y:w.player.y,known:false}));
  w.log=[];
  c.dispatchAction({type:'MOVE',dx:1,dy:0});
  expect(w.log.some(entry=>entry.text.startsWith('Sigrun: ') && /fuck|shit|bastard|arse|asshole/i.test(entry.text))).toBe(true);
  expect(w.log.filter(entry=>entry.text.startsWith('Sigrun: '))).toHaveLength(1);
  toggleCurses();w.log=[];
  c.dispatchAction({type:'MOVE',dx:1,dy:0});
  expect(w.log.some(entry=>/fuck|shit|bastard|arse|asshole/i.test(entry.text))).toBe(false);
});

it('keeps player barter curses enabled when ordinary chatter is off',()=>{
  const c=bootstrap();const w=beginGame(c);
  root.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
  document.querySelector<HTMLButtonElement>('[data-pause-action="settings"]')!.click();
  document.querySelector<HTMLInputElement>('[data-option="curses"]')!.click();
  document.querySelector<HTMLInputElement>('[data-option="chatter"]')!.click();closeAllModals();
  w.inventory.gold=10000;w.log=[];
  c.openMerchant(loadTownShops().shops.gunnhild!);
  document.querySelector<HTMLButtonElement>('.merchant-buy-list .item-row-button')!.click();
  document.querySelector<HTMLButtonElement>('[data-field="primary-action"]')!.click();
  expect(w.inventory.gold).toBeLessThan(10000);
  expect(w.log.some(entry=>entry.text.startsWith('Sigrun: ') && /fuck|shit|bastard|arse|asshole|bollocks/i.test(entry.text))).toBe(true);
});

describe('directional interaction without conversation dialogs', () => {
  const key = (key: string, code = '') => window.dispatchEvent(new KeyboardEvent('keydown', {key, code, bubbles:true}));
  const start = () => {
    const c = bootstrap(); const w = beginGame(c);
    const level = w.levels.get(w.current)!;
    level.entities.clear(); level.occupancy.fill(0); level.props=[];
    return {c,w,level};
  };
  it('uses an underfoot prop immediately without a direction prompt', () => {
    const {w,level}=start();
    level.props=[{id:'underfoot',kind:'bones',x:w.player.x,y:w.player.y,exhausted:false}];
    const turn=w.turn;
    key('t');
    expect(level.props[0]!.exhausted).toBe(true);
    expect(w.turn).toBe(turn+1);
    expect(document.querySelector('.interaction-bar')).toBeNull();
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });
  it.each([['d','',1,0],['ArrowUp','',0,-1],['End','Numpad1',-1,1],['9','',1,-1]] as const)(
    'interacts using %s %s without moving', (name,code,dx,dy) => {
      const {c,w,level}=start(); const {x,y}=w.player;
      level.entities.set(991,{id:991,kind:'npc',name:'Passing traveler',x:x+dx,y:y+dy,npc:{role:'traveler',giftClaimed:false,stock:[]}});
      w.visible[idx(x+dx,y+dy)]=1;
      key('t');
      expect(document.querySelector('.interaction-bar')?.textContent).toContain('direction');
      expect(document.querySelector('.modal-overlay')).toBeNull();
      expect(c.isInputEnabled()).toBe(false);
      const turn=w.turn;
      key(name,code);
      expect(w.turn).toBe(turn+1);
      expect({x:w.player.x,y:w.player.y}).toEqual({x,y});
      expect(w.log.some(e=>e.text.includes('Passing traveler:'))).toBe(true);
      expect(document.querySelector('.modal-overlay')).toBeNull();
      expect(document.querySelector('.interaction-bar')).toBeNull();
      expect(c.isInputEnabled()).toBe(true);
    });
  it('cancels direction selection without opening pause or spending a turn', () => {
    const {c,w}=start(); const turn=w.turn;
    key('t'); key('Escape');
    expect(document.querySelector('.interaction-bar')).toBeNull();
    expect(document.querySelector('.modal-overlay')).toBeNull();
    expect(w.turn).toBe(turn); expect(c.isInputEnabled()).toBe(true);
  });
  it('rejects distant map clicks and uses adjacent map clicks', () => {
    const {w,level}=start();const {x,y}=w.player;
    level.props=[{id:'adjacent',kind:'bones',x:x+1,y,exhausted:false}];w.visible[idx(x+1,y)]=1;
    const hooks=(window as unknown as {__cotw:{travel:{tap:(cell:{x:number;y:number})=>void}}}).__cotw;
    key('t'); const turn=w.turn;
    hooks.travel.tap({x:x+3,y});
    expect(w.turn).toBe(turn);expect(document.querySelector('.interaction-bar')).not.toBeNull();
    hooks.travel.tap({x:x+1,y});
    expect(level.props[0]!.exhausted).toBe(true);expect(w.turn).toBe(turn+1);
    expect(document.querySelector('.interaction-bar')).toBeNull();
  });
  it('opens merchant trade directly after a directional greeting', () => {
    const {w,level}=start();const {x,y}=w.player;
    level.entities.set(991,{id:991,kind:'npc',name:'Peddler',x:x+1,y,npc:{role:'peddler',giftClaimed:false,stock:['x-rock']}});w.visible[idx(x+1,y)]=1;
    key('t');key('d');
    expect(document.querySelector('.merchant-panel')).not.toBeNull();
    expect(document.querySelector('[data-action="trade"]')).toBeNull();
  });
  it('reports a level gain once in the log without a dialog', () => {
    const {c,w,level}=start();
    w.player.experience=w.data.xpThresholds![1]!-1;w.player.dexterity=100;
    level.traps=[{id:'level-gain',kind:'pit',x:w.player.x+1,y:w.player.y,known:true}];
    c.dispatchAction({type:'DISARM'});
    expect(w.player.level).toBe(2);
    expect(w.log.filter(e=>/reached level 2/.test(e.text))).toHaveLength(1);
    expect(document.querySelector('.modal-overlay')).toBeNull();
    expect(c.isInputEnabled()).toBe(true);
  });
});


it('advances player speech per context and applies current health only to the hero', () => {
  let now=100000;
  const c=bootstrap({now:()=>now});const w=beginGame(c);
  w.levels.get(w.current)!.entities.clear();
  w.player.maxHp=100;w.player.hp=100;w.inventory.gold=10000;
  const speech=()=>w.log.filter(e=>e.text.startsWith(`${w.player.name}: `)).at(-1)!.text;
  c.dispatchAction({type:'SEARCH'});
  expect(speech()).toBe(chatterLine(w.worldSeed,0,'search',w.player.name));
  now+=13000;
  const shop=loadTownShops().shops.gunnhild!;
  c.openMerchant(shop);
  document.querySelector<HTMLButtonElement>('.merchant-buy-list .item-row-button')!.click();
  document.querySelector<HTMLButtonElement>('[data-field="primary-action"]')!.click();
  expect(w.log.at(-1)!.text).toBe(chatterLine(w.worldSeed,0,'barter',shop.name));
  closeAllModals();
  c.dispatchAction({type:'WAIT'});c.dispatchAction({type:'WAIT'});
  now+=13000;w.player.hp=20;
  c.dispatchAction({type:'SEARCH'});
  const clear=chatterLine(w.worldSeed,1,'search',w.player.name);
  expect(speech()).toBe(garbleSpeech(clear,w.player.hp,w.player.maxHp,w.worldSeed,1));
  expect(speech()).not.toBe(clear);
  now+=13000;w.player.hp=100;
  c.dispatchAction({type:'SEARCH'});
  expect(speech()).toBe(chatterLine(w.worldSeed,2,'search',w.player.name));
});

it('tracks curse contexts independently and garbles the current injured voice', () => {
  const c=bootstrap();const w=beginGame(c);
  root.querySelector<HTMLButtonElement>('[data-action="pause"]')!.click();
  document.querySelector<HTMLButtonElement>('[data-pause-action="settings"]')!.click();
  document.querySelector<HTMLInputElement>('[data-option="curses"]')!.click();closeAllModals();
  const level=w.levels.get(w.current)!;level.entities.clear();level.occupancy.fill(0);
  w.player.hp=25;w.player.maxHp=100;
  c.dispatchAction({type:'SEARCH'});
  const expected=garbleSpeech(curseLine(w.worldSeed,0,'search',w.player.name),w.player.hp,w.player.maxHp,w.worldSeed,0);
  expect(w.log.at(-1)!.text).toBe(expected);
  const floor=level.tiles[idx(w.player.x,w.player.y)]!;
  level.tiles[idx(w.player.x+1,w.player.y)]=floor;
  level.traps=[{id:'separate-context',kind:'pit',x:w.player.x+1,y:w.player.y,known:false}];
  c.dispatchAction({type:'MOVE',dx:1,dy:0});
  expect(w.log.at(-1)!.text).toBe(garbleSpeech(curseLine(w.worldSeed,0,'trap',w.player.name),w.player.hp,w.player.maxHp,w.worldSeed,0));
});

it('logs empty ranged equipment guidance without opening a dialog', () => {
  const c=bootstrap();const w=beginGame(c);
  w.inventory.equipment.weapon=undefined;w.inventory.pack=[];
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'f'}));
  expect(w.log.at(-1)?.text).toContain('Equip a bow');
  expect(document.querySelector('.modal-overlay')).toBeNull();
});

it('clears interaction targeting when the window loses focus', () => {
  const c=bootstrap();beginGame(c);
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'t'}));
  expect(document.querySelector('.interaction-bar')).not.toBeNull();
  window.dispatchEvent(new Event('blur'));
  expect(document.querySelector('.interaction-bar')).toBeNull();
  window.dispatchEvent(new Event('focus'));
  expect(c.isInputEnabled()).toBe(true);
});

it('cleans direction selection when a modal opens, a new game begins, and the controller is destroyed', () => {
  const c=bootstrap();const w=beginGame(c);
  const start=()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'t'}));
  start();c.openMerchant(loadTownShops().shops.gunnhild!);
  expect(document.querySelector('.interaction-bar')).toBeNull();closeAllModals();
  start();c.newGame();
  expect(document.querySelector('.interaction-bar')).toBeNull();closeAllModals();
  start();const turn=w.turn;c.destroy();controller=null;
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'d'}));
  expect(document.querySelector('.interaction-bar')).toBeNull();expect(w.turn).toBe(turn);
});
