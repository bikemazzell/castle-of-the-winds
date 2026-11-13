/**
 * Spellbook panel + on-map target picker.
 *
 * Phase 6 rebuild: each spell row shows name, mana cost, target type, an
 * effect summary, and the availability reason. Players pin favorite spells
 * with an explicit toggle (favorites render first and feed the HUD quick
 * slots). Enemy-target spells hand off to the target picker, which
 * validates the chosen cell against an injected visibility predicate
 * (Task 3.3 targeting — attack spells need a visible target cell).
 */
import type { Player } from '../../engine/types';
import type { SpellDefRuntime } from '../../engine/spells';
import { canCast, manaCostFor } from '../../engine/spells';
import { spellGlyph } from './hud';
import { openModal, type ModalHandle } from './dialogs';

export { closeAllModals } from './dialogs';

// ─── Effect summaries (facts only — no damage forecasts, UI plan §8) ────────

const ELEMENT_LABEL: Record<string, string> = {
  fire: 'Fire',
  cold: 'Cold',
  lightning: 'Lightning',
  acid: 'Acid',
  poison_gas: 'Poison gas',
};

export const EFFECT_SUMMARY: Record<string, string> = {
  missile: 'Force dart attack',
  bolt: 'Elemental bolt attack',
  ball: 'Elemental blast — 3×3 area',
  heal: 'Heals your wounds',
  shield: 'Shields you (raises armor)',
  resist: 'Wards against an element',
  light_radius: 'Lights the area around you',
  detect_traps: 'Reveals traps nearby',
  detect_objects: 'Reveals objects nearby',
  detect_monsters: 'Senses monsters through rock',
  clairvoyance: 'Maps the area around you',
  levitation: 'Float over pits and traps',
  teleport_self: 'Teleports you a short distance',
  rune_of_return: 'Returns you to town',
  phase_door: 'Opens a passage in a wall',
  identify: 'Identifies an item',
  remove_curse: 'Removes a curse',
  neutralize_poison: 'Cures poison',
  debuff_sleep: 'Puts a foe to sleep',
  debuff_slow: 'Slows a foe',
  transmogrify: 'Transforms a foe into another creature',
  monster_ai: 'A monster’s spell',
};

function effectSummary(def: SpellDefRuntime): string {
  const element = def.element !== undefined ? ELEMENT_LABEL[def.element] : undefined;
  if (def.effect === 'missile') return element ? `${element} dart attack` : EFFECT_SUMMARY.missile!;
  if (def.effect === 'bolt') return element ? `${element} bolt attack` : EFFECT_SUMMARY.bolt!;
  if (def.effect === 'ball') return element ? `${element} blast — 3×3 area` : EFFECT_SUMMARY.ball!;
  if (def.effect === 'resist') return element ? `Wards against ${element.toLowerCase()}` : EFFECT_SUMMARY.resist!;
  return EFFECT_SUMMARY[def.effect] ?? def.effect.replace(/_/g, ' ');
}

function targetLabel(def: SpellDefRuntime): string {
  if (def.target === 'enemy') return 'Target: enemy';
  if (def.target === 'self') return 'Target: self';
  return '';
}

// ─── Spellbook panel (Phase 6) ───────────────────────────────────────────────

export interface SpellbookActions {
  onCast: (spellId: string) => void;
  onToggleFavorite?: (spellId: string) => void;
}

export interface SpellbookData {
  player: Player;
  spells: Record<string, SpellDefRuntime>;
  /** Spell ids currently pinned (rendered first, in slot order). */
  favorites?: string[];
  actions?: SpellbookActions;
}

export interface SpellbookPanel {
  el: HTMLElement;
  refresh(data: SpellbookData): void;
}

export function createSpellbookPanel(data: SpellbookData): SpellbookPanel {
  const el = document.createElement('div');
  el.className = 'spellbook';
  let changingFavorite = false;

  const render = (d: SpellbookData): void => {
    const active = document.activeElement instanceof HTMLElement && el.contains(document.activeElement)
      ? document.activeElement : null;
    const focusedSpell = active?.closest<HTMLElement>('[data-spell]')?.dataset.spell;
    const focusedAction = active?.dataset.action;
    el.replaceChildren();
    const { player, spells } = d;
    const favorites = d.favorites ?? [];

    const known = player.knownSpells
      .map((id) => spells[id])
      .filter((s): s is SpellDefRuntime => Boolean(s));

    if (known.length === 0) {
      const empty = document.createElement('p');
      empty.dataset.field = 'empty';
      empty.textContent = 'You know no spells yet. Read scrolls to learn them.';
      el.appendChild(empty);
      return;
    }

    // Favorites first (slot order), then tier, then name.
    const favRank = (id: string): number => {
      const i = favorites.indexOf(id);
      return i === -1 ? favorites.length : i;
    };
    known.sort(
      (a, b) =>
        favRank(a.id) - favRank(b.id) ||
        (a.tier ?? 99) - (b.tier ?? 99) ||
        a.name.localeCompare(b.name),
    );

    for (const def of known) {
      const check = canCast(def, player);
      const cost = manaCostFor(def, player);
      const row = document.createElement('div');
      row.className = 'spell-row';
      if (favorites.includes(def.id)) row.classList.add('favorite');
      row.dataset.spell = def.id;

      const info = document.createElement('span');
      info.className = 'spell-info';
      const title = document.createElement('span');
      title.className = 'char-value spell-title';
      title.textContent = `${def.name} (lv ${def.tier ?? '?'}) — ${cost} mana`;
      const detail = document.createElement('span');
      detail.className = 'spell-detail';
      detail.dataset.field = 'effect';
      const target = targetLabel(def);
      detail.textContent = `${target ? `${target} — ` : ''}${effectSummary(def)}`;
      info.append(title, detail);
      if (def.description) {
        const description = document.createElement('span');
        description.className = 'spell-detail';
        description.textContent = def.description;
        info.append(description);
      }

      const fav = document.createElement('button');
      fav.type = 'button';
      fav.className = 'spell-fav';
      fav.dataset.action = 'toggle-favorite';
      fav.setAttribute('aria-pressed', favorites.includes(def.id) ? 'true' : 'false');
      fav.setAttribute('aria-label', `Favorite ${def.name}`);
      fav.textContent = favorites.includes(def.id) ? '★' : '☆';
      fav.addEventListener('click', () => {
        changingFavorite = true;
        try { d.actions?.onToggleFavorite?.(def.id); }
        finally { changingFavorite = false; }
      });

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.action = 'cast';
      btn.className = 'spell-cast';
      const glyph = document.createElement('span');
      glyph.className = 'spell-glyph';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = spellGlyph(def.name);
      btn.append(glyph, info);
      btn.setAttribute('aria-label', `Cast ${def.name}, ${cost} mana. ${target}. ${effectSummary(def)}${def.description ? `. ${def.description}` : ''}${check.ok ? '' : `. ${check.reason ?? 'cannot cast'}`}`);
      if (!check.ok) {
        btn.disabled = true;
        const reason = document.createElement('span');
        reason.className = 'spell-reason';
        reason.textContent = check.reason ?? 'cannot cast';
        row.append(btn, fav, reason);
      } else {
        btn.addEventListener('click', () => d.actions?.onCast(def.id));
        row.append(btn, fav);
      }
      el.appendChild(row);
    }
    if (focusedSpell && focusedAction) {
      const row = [...el.querySelectorAll<HTMLElement>('[data-spell]')]
        .find((candidate) => candidate.dataset.spell === focusedSpell);
      const button = [...(row?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        .find((candidate) => candidate.dataset.action === focusedAction && !candidate.disabled);
      button?.focus({ preventScroll: true });
      if (changingFavorite && focusedAction === 'toggle-favorite') {
        button?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
      }
    }
  };

  render(data);
  return {
    el,
    refresh: render,
  };
}

export function openSpellbookDialog(data: SpellbookData): ModalHandle {
  const panel = createSpellbookPanel(data);
  return openModal({
    title: 'Spellbook',
    content: panel.el,
    className: 'dialog-spellbook',
  });
}

// ─── Legacy content builder (pre-panel API, kept for compatibility) ─────────

export function buildSpellbookContent(data: SpellbookData): HTMLElement {
  return createSpellbookPanel(data).el;
}

