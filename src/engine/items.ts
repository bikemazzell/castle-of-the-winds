// Engine adapter: items.json records -> runtime item definitions (Task 3.2).
// items.json comes from the manual Objects directory (Task 1.8); weight is
// in grams there, armorClass/weaponClass are the original game's values.
import type { SpellDefRuntime } from './spells';
import type { ItemsFile } from './types';
import type { EquipSlot, ItemDefRuntime } from './types';

/** Fixed ring entry point so equipping a second ring finds ring2. */
const RING_PRIMARY: EquipSlot = 'ring1';

function slotForKindAndName(kind: string, name: string): EquipSlot | null {
  switch (kind) {
    case 'armor':
      return 'armor';
    case 'helmet':
      return 'helm';
    case 'shield':
      return 'shield';
    case 'weapon':
      return 'weapon';
    case 'misc':
      break;
    default:
      return null;
  }
  const lowered = name.toLowerCase();
  if (lowered.startsWith('boots')) return 'boots';
  if (lowered.startsWith('gauntlets')) return 'gauntlets';
  if (lowered.startsWith('bracers')) return 'bracers';
  if (lowered.startsWith('cloak')) return 'cloak';
  if (lowered.startsWith('ring')) return RING_PRIMARY;
  if (lowered.startsWith('amulet')) return 'amulet';
  return null; // Potion, Scroll or Book, Staff: usable, not equippable
}

export function loadItemDefs(file: ItemsFile): Record<string, ItemDefRuntime> {
  const defs: Record<string, ItemDefRuntime> = {};
  for (const record of file.records) {
    const slot = slotForKindAndName(record.kind ?? 'misc', record.name);
    const usable = slot === null; // manual 334: potions, scrolls, wands, staves
    defs[record.id] = {
      id: record.id,
      name: record.name,
      kind: record.kind ?? 'misc',
      weightGrams: record.weight,
      armorClass: record.armorClass,
      weaponClass: record.weaponClass,
      slot,
      stackable: usable && (record.kind === 'misc') && /potion|scroll|book/i.test(record.name),
      consumable: usable && /potion|scroll|book/i.test(record.name),
    };
  }
  return defs;
}

/** Gameplay adaptation: concrete scrolls expose the existing spell-learning rules. */
export function spellScrollDefs(spells: Record<string, SpellDefRuntime>): Record<string, ItemDefRuntime> {
  return Object.fromEntries(Object.values(spells).filter(spell => spell.effect !== 'monster_ai').map(spell => {
    // Names, unlike spell IDs, are stable across campaigns and character imports.
    const id = `i-scroll-of-${spell.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`;
    const description = spell.description
      ? `Read to learn ${spell.name}. ${spell.description} Base casting cost: ${spell.baseMana} mana; your level adjusts the cost shown in the spellbook. Reading consumes the scroll.`
      : undefined;
    return [id, {id, name:`Scroll of ${spell.name}`, description, kind:'misc', weightGrams:50, slot:null, stackable:true, consumable:true}];
  }));
}
