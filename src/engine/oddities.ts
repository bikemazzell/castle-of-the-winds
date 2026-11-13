/** Original expansion items. Durations and tradeoffs are measured in game turns. */
import type { ItemDefRuntime, Player, UseEffect } from './types';
import type { SpellDefRuntime } from './spells';
import type { World } from './world';
import { applyStatus } from './effects';

const entries = [
  ['x-mead', 'Courage Mead', 'Restore 4 HP. For 10 turns: +2 damage, −3 accuracy. Courage sold separately from good judgment.'],
  ['x-spirits', 'Dungeon Spirits', 'Restore 12 HP. For 20 turns: +2 damage, −3 accuracy. The bottle insists it is medicinal.'],
  ['x-sparkleaf', 'Sparkleaf', 'For 8 turns: +3 accuracy and +2 damage. Then 4 turns of crash: −3 accuracy and −2 damage.'],
  ['x-dreamcap', 'Dreamcap', 'For 12 turns: +2 armor and −4 accuracy. Colors look strange; danger remains real.'],
  ['x-mellowroot', 'Mellowroot', 'Restore 8 HP. For 12 turns: +2 armor and −2 damage. Even your sword wants a nap.'],
  ...(['blue', 'red', 'green', 'purple'] as const).map(c => [`x-dye-${c}`, `${c[0]!.toUpperCase()}${c.slice(1)} Underwear Dye`, `Dye your underwear ${c}. No combat effect.`]),
  ...(['silver', 'gold'] as const).map(c => [`x-polish-${c}`, `${c[0]!.toUpperCase()}${c.slice(1)} Metal Polish`, `Color your worn helmet ${c}. Requires a worn helmet; no combat effect.`]),
];
export const ODDITY_ITEMS: Record<string, ItemDefRuntime> = Object.fromEntries(entries.map(([id, name, description]) => [id!, {id:id!, name:name!, description:description!, kind:'misc', slot:null, stackable:true, consumable:true, weightGrams:100, price:id!.startsWith('x-dye-') ? 15 : id!.startsWith('x-polish-') ? 25 : id === 'x-mead' ? 12 : 40}]));
export const ODDITY_SPELLS: Record<string, SpellDefRuntime> = {
  'x-bedtime': {id:'x-bedtime', name:'MANDATORY BEDTIME', tier:1, baseMana:3, target:'enemy', effect:'debuff_sleep', description:'Put one foe to sleep for 60 turns. Attacks wake it. No bedtime story required.'},
  'x-paperwork': {id:'x-paperwork', name:'URGENT PAPERWORK', tier:1, baseMana:3, target:'enemy', effect:'debuff_slow', description:'Make one foe act at half its normal rate. Further casts slow it more, with smaller gains. The forms are in triplicate.'},
  'x-lantern': {id:'x-lantern', name:'BORROWED SUNSHINE', tier:1, baseMana:2, target:'self', effect:'light_radius', description:'Light the area around you for 1,000 turns. The sun expects it back in good condition.'},
};
export function oddityCombatModifiers(player: Player): {accuracy:number; damage:number; armor:number} {
  const result = {accuracy:0, damage:0, armor:0};
  for (const status of player.statuses) {
    if (status.remainingTurns <= 0) continue;
    switch (status.kind) {
      case 'drunken': result.accuracy -= 3; result.damage += 2; break;
      case 'stimulated': result.accuracy += 3; result.damage += 2; break;
      case 'crash': result.accuracy -= 3; result.damage -= 2; break;
      case 'hallucination': result.accuracy -= 4; result.armor += 2; break;
      case 'sedated': result.damage -= 2; result.armor += 2; break;
    }
  }
  return result;
}
export function useOddity(world: World, id: string): UseEffect | null {
  if (!ODDITY_ITEMS[id]) return null;
  const player = world.player;
  if (id.startsWith('x-dye-')) {
    player.underwearColor = id.slice(6) as NonNullable<Player['underwearColor']>;
  } else if (id.startsWith('x-polish-')) {
    const helm = world.inventory.equipment.helm;
    if (!helm) return {consumed:false, message:'Wear a helmet before polishing it.'};
    helm.color = id === 'x-polish-gold' ? 'gold' : 'silver';
  } else {
    switch (id) {
      case 'x-mead': player.hp = Math.min(player.maxHp, player.hp + 4); applyStatus(player, 'drunken', 10); break;
      case 'x-spirits': player.hp = Math.min(player.maxHp, player.hp + 12); applyStatus(player, 'drunken', 20); break;
      case 'x-sparkleaf': applyStatus(player, 'stimulated', 8); break;
      case 'x-dreamcap': applyStatus(player, 'hallucination', 12); break;
      case 'x-mellowroot': player.hp = Math.min(player.maxHp, player.hp + 8); applyStatus(player, 'sedated', 12); break;
    }
  }
  return {consumed:true, message:ODDITY_ITEMS[id].description};
}
