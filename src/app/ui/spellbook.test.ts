// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCharacter } from '../../engine/character';
import type { Player } from '../../engine/types';
import type { SpellDefRuntime } from '../../engine/spells';
import {
  buildSpellbookContent,
  closeAllModals,
  createSpellbookPanel,
  openSpellbookDialog,
} from './spellbook';

function player(overrides: Partial<Player> = {}): Player {
  return {
    ...createCharacter({
      name: 'Sigrun', gender: 'female', strength: 50, intelligence: 50,
      constitution: 50, dexterity: 50, difficulty: 'intermediate',
    }),
    knownSpells: ['s510', 's527', 's323'],
    mana: 6,
    maxMana: 6,
    level: 1,
    ...overrides,
  };
}

function spells(): Record<string, SpellDefRuntime> {
  return {
    s510: { id: 's510', name: 'MAGIC ARROW', tier: 1, baseMana: 1, target: 'enemy', effect: 'missile' },
    s527: { id: 's527', name: 'FIREBALL', tier: 4, baseMana: 5, target: 'enemy', effect: 'ball', element: 'fire' },
    s323: { id: 's323', name: 'SHIELD', tier: 1, baseMana: 1, target: 'self', effect: 'shield' },
    s512: { id: 's512', name: 'HEAL MINOR WOUNDS', tier: 1, baseMana: 1, target: 'self', effect: 'heal' },
  };
}

afterEach(() => {
  closeAllModals();
  document.body.innerHTML = '';
});

describe('spellbook panel', () => {
  it('lists known spells favorites-first, then tier and name, with mana cost', () => {
    const panel = createSpellbookPanel({
      player: player(), spells: spells(), favorites: ['s527'],
      actions: { onCast: () => {}, onToggleFavorite: () => {} },
    });
    const rows = [...panel.el.querySelectorAll('[data-spell]')].map((r) => r.getAttribute('data-spell'));
    expect(rows).toEqual(['s527', 's510', 's323']); // favorite first, then tier 1s by name

    const fireball = panel.el.querySelector('[data-spell="s527"]') as HTMLElement;
    expect(fireball.textContent).toContain('FIREBALL');
    // level 1 caster: base 5 + tier 4 - level 1 = 8
    expect(fireball.textContent).toContain('8');
  });

  it('shows target type and an effect summary per spell', () => {
    const panel = createSpellbookPanel({
      player: player(), spells: spells(), favorites: [],
      actions: { onCast: () => {}, onToggleFavorite: () => {} },
    });
    const fireball = panel.el.querySelector('[data-spell="s527"]') as HTMLElement;
    expect(fireball.textContent).toContain('Target: enemy');
    expect(fireball.textContent).toMatch(/fire blast.*3×3|3×3.*fire blast/i);

    const shield = panel.el.querySelector('[data-spell="s323"]') as HTMLElement;
    expect(shield.textContent).toContain('Target: self');
    expect(shield.textContent).toMatch(/shield/i);
  });

  it('favorite toggle reflects state and fires onToggleFavorite', () => {
    const onToggleFavorite = vi.fn();
    const panel = createSpellbookPanel({
      player: player(), spells: spells(), favorites: ['s510'],
      actions: { onCast: () => {}, onToggleFavorite },
    });
    const fav = panel.el.querySelector('[data-spell="s510"] [data-action="toggle-favorite"]') as HTMLButtonElement;
    expect(fav.getAttribute('aria-pressed')).toBe('true');

    const shieldFav = panel.el.querySelector('[data-spell="s323"] [data-action="toggle-favorite"]') as HTMLButtonElement;
    expect(shieldFav.getAttribute('aria-pressed')).toBe('false');
    shieldFav.click();
    expect(onToggleFavorite).toHaveBeenCalledWith('s323');
  });

  it('disables spells that cannot be cast and shows the reason', () => {
    const panel = createSpellbookPanel({
      player: player({ mana: 1 }), spells: spells(), favorites: [],
      actions: { onCast: () => {}, onToggleFavorite: () => {} },
    });
    const fireball = panel.el.querySelector('[data-spell="s527"]') as HTMLElement;
    const btn = fireball.querySelector('[data-action="cast"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(fireball.textContent).toContain('not enough mana');
  });

  it('cast button fires onCast with the spell id', () => {
    const onCast = vi.fn();
    const panel = createSpellbookPanel({
      player: player(), spells: spells(), favorites: [],
      actions: { onCast, onToggleFavorite: () => {} },
    });
    (panel.el.querySelector('[data-spell="s510"] [data-action="cast"]') as HTMLButtonElement).click();
    expect(onCast).toHaveBeenCalledWith('s510');
  });

  it('refresh updates live mana costs and favorite marks', () => {
    const panel = createSpellbookPanel({
      player: player(), spells: spells(), favorites: [],
      actions: { onCast: () => {}, onToggleFavorite: () => {} },
    });
    panel.refresh({ player: player({ mana: 1 }), spells: spells(), favorites: ['s510'] });

    const fireball = panel.el.querySelector('[data-spell="s527"]') as HTMLElement;
    const btn = fireball.querySelector('[data-action="cast"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    const fav = panel.el.querySelector('[data-spell="s510"] [data-action="toggle-favorite"]') as HTMLButtonElement;
    expect(fav.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows a hint when no spells are known', () => {
    const panel = createSpellbookPanel({
      player: player({ knownSpells: [] }), spells: spells(), favorites: [],
      actions: { onCast: () => {}, onToggleFavorite: () => {} },
    });
    expect(panel.el.querySelector('[data-field="empty"]')).not.toBeNull();
  });

  it('opens as a modal titled Spellbook', () => {
    const modal = openSpellbookDialog({
      player: player(), spells: spells(), favorites: [],
      actions: { onCast: () => {}, onToggleFavorite: () => {} },
    });
    expect(modal.el.querySelector('.dialog-title')?.textContent).toContain('Spellbook');
  });
});

// Legacy content builder kept for compatibility during migration.
describe('spellbook content builder', () => {
  it('still lists known spells', () => {
    const el = buildSpellbookContent({ player: player(), spells: spells() });
    expect(el.querySelectorAll('[data-spell]').length).toBe(3);
  });
});

it('keeps keyboard focus on a favorite after the rows reorder', () => {
  const data = { player: player(), spells: spells(), favorites: [] as string[] };
  const panel = createSpellbookPanel(data);
  document.body.append(panel.el);
  panel.el.querySelector<HTMLButtonElement>('[data-spell="s527"] [data-action="toggle-favorite"]')!.focus();
  panel.refresh({ ...data, favorites: ['s527'] });
  expect(document.activeElement?.closest('[data-spell]')?.getAttribute('data-spell')).toBe('s527');
  expect(document.activeElement?.getAttribute('data-action')).toBe('toggle-favorite');
});

it('reveals the focused favorite after a deliberate reorder but not a passive refresh', () => {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  try {
    const data = { player: player(), spells: spells(), favorites: [] as string[] };
    const panel = createSpellbookPanel({ ...data, actions: {
      onCast: () => {},
      onToggleFavorite: (id) => panel.refresh({ ...data, favorites: [id] }),
    } });
    document.body.append(panel.el);
    const favorite = panel.el.querySelector<HTMLButtonElement>('[data-spell="s527"] [data-action="toggle-favorite"]')!;
    favorite.focus();
    favorite.click();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'instant' });
    panel.refresh({ ...data, favorites: ['s527'] });
    expect(scroll).toHaveBeenCalledTimes(1);
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});


it('casts directly from the named spell button and keeps favorite clicks separate', () => {
  const onCast = vi.fn();
  const onToggleFavorite = vi.fn();
  const panel = createSpellbookPanel({player:player(),spells:spells(),actions:{onCast,onToggleFavorite}});
  const row = panel.el.querySelector('[data-spell="s323"]')!;
  const cast = row.querySelector<HTMLButtonElement>('[data-action="cast"]')!;
  expect(cast.textContent).toContain('SHIELD');
  expect(cast.textContent).toContain('1 mana');
  expect(cast.querySelector('.spell-glyph')?.getAttribute('aria-hidden')).toBe('true');
  expect(cast.getAttribute('aria-label')).toMatch(/Cast SHIELD, 1 mana.*self/i);
  cast.querySelector<HTMLElement>('.spell-title')!.click();
  expect(onCast).toHaveBeenCalledExactlyOnceWith('s323');
  row.querySelector<HTMLButtonElement>('[data-action="toggle-favorite"]')!.click();
  expect(onCast).toHaveBeenCalledTimes(1);
  expect(onToggleFavorite).toHaveBeenCalledWith('s323');
});


it('shows a custom spell description alongside the existing effect and target hints', () => {
  const defs = spells();
  defs.s323!.description = 'Borrow a little safety from tomorrow.';
  const panel = createSpellbookPanel({player:player(),spells:defs});
  const cast = panel.el.querySelector('[data-spell="s323"] [data-action="cast"]')!;
  expect(cast.textContent).toContain('Borrow a little safety from tomorrow.');
  expect(cast.textContent).toContain('Target: self');
  expect(cast.textContent).toContain('Shields you');
  expect(cast.textContent).toContain('1 mana');
});
