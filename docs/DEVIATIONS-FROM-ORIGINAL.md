# Changes from the original game

Updated November 13, 2026.

This file tracks deliberate changes, approximations, and known gaps in this independent browser version of Castle of the Winds.
It is a running record, not a claim that every original feature received a direct comparison.
Add an entry when a change affects rules, content, controls, or presentation.
Update existing entries when behavior changes. Keep planned work separate from shipped work.

## Scope and attribution

The application uses new TypeScript code and new pixel art drawn in code. It does not ship original executable code or artwork.
Story text, names, messages, maps, and game data still include adapted or extracted original material.
This is an unofficial adaptation, not an exact recreation or an entirely original setting.

Both campaigns remain playable. Part One covers the Mine and Fortress. Part Two covers the castle and its story arc.
The campaign structure and retained narrative do not imply exact original balance, placement, or triggers.

## Deliberate changes

These entries describe this project's implementation. They do not establish that the original lacked every related concept.

| Area | Current change | Source |
|---|---|---|
| Platform | Browser application with static hosting, keyboard, mouse, and touch controls. | `README.md`, `src/app/` |
| Artwork | All terrain, actors, equipment, and application icons use new pixel art. Related creatures share base forms with visible differences. | `src/app/render/` |
| Hero appearance | Equipped armor, clothing, weapons, shields, headwear, and accessories change the hero sprite. Gender choices have distinct hair. | `src/app/render/hero-art.ts` |
| Creature presentation | Creatures have idle motion and different sizes. Enemy health bars remain visible above other actors. | `src/app/render/` |
| Movement | Actors move smoothly between tile centers. The camera follows within a stable viewing area. | `src/app/render/`, `src/app/controller.ts` |
| Combat presentation | Attacks, hits, misses, projectiles, and interactions have visual effects. | `src/app/render/` |
| Terrain | Ground and walls vary by location. Grass, foliage, and water animate. Stores have distinct accents, doors, and signs. | `src/app/render/` |
| Lighting | Outdoor daylight follows game time. Dungeon torches add local light. Lighting does not reveal hidden actors or terrain. | `src/app/render/` |
| Blood and Gore | Optional splashes, floor stains, and wounded walking trails vary by creature material. Reduced motion retains static stains. | `src/app/render/`, `src/app/prefs.ts` |
| Controls | WASD and numpad movement, click-to-travel, zoom, and recenter controls supplement the keyboard interface. | `src/app/input/` |
| Action interface | Floating controls and a persistent Actions panel replace repeated menu visits. Wait sits inside Actions. | `src/app/ui/action-palette.ts` |
| Spell interface | Favorite shortcuts cast self spells directly. Targeted spells accept a target click or keyboard selection. | `src/app/controller.ts` |
| Interaction | Interact uses an object underfoot first, then requests a direction key or adjacent map click without a modal. | `src/app/controller.ts` |
| Brief messages | NPC replies and level gains appear in the log. Merchants open trade directly. Empty weapon guidance uses the log. | `src/app/controller.ts` |
| Idle actions | Optional automatic rest and search have separate delays. They pause during interruptions and write to the log. | `src/app/controller.ts` |
| Shopping | Purchases show receipts and require a new selection before another purchase. Sell All previews the sale and excludes equipped items. | `src/app/ui/merchant.ts` |
| Debug controls | A pause-menu editor can reveal maps and change character values, inventory, and gold. | `src/app/devtools.ts`, `src/app/editor/` |
| Saves | Browser storage, separate campaign slots, autosaves, and file import/export replace original save handling. | `src/app/saves/`, `src/engine/save.ts` |
| Campaign import | A living Part One character can enter Part Two. Import remaps known spells and starts fresh quest progress. | `src/app/import.ts` |
| Ranged weapons | Bows, crossbows, hand cannons, and matching ammunition use visible targets and clear firing paths. Cannons alert nearby enemies. | `src/engine/ranged.ts` |
| Improvised weapons | Throwable rocks and bones, bone clubs, and two-tile whips expand the weapon choices. | `src/engine/ranged.ts`, `src/engine/oddities.ts` |
| Consumables | Mead, spirits, Sparkleaf, Dreamcap, and Mellowroot add temporary benefits and penalties. Sparkleaf has a crash. Dreamcap changes the visible colors. | `src/engine/oddities.ts` |
| Cosmetic items | Dyes change underwear colors. Polish changes helmet colors without changing combat values. | `src/engine/oddities.ts` |
| Added spells | Mandatory Bedtime, Urgent Paperwork, and Borrowed Sunshine add new spell choices and scrolls. | `src/engine/oddities.ts`, `src/engine/effects.ts` |
| Dungeon objects | Treasure boxes, junk, bones, mushrooms, runes, and rubble give finite rewards or effects. Search can collect nearby salvage. | `src/engine/encounters.ts` |
| Ambient NPCs | Travelers, adventurers, peddlers, witches, wizards, salvagers, ghosts, and harmless mice add encounters. Some trade, wander, or give a small gift. | `src/engine/encounters.ts` |
| NPC names | Procedural NPCs receive distinct names at creation. Saved names stay fixed. Existing story characters and shopkeepers retain their names. | `src/engine/npc-names.ts` |
| Dialogue | 480 ordinary lines, 480 curse lines, and 300 NPC lines provide distinct cycles. NPC conversation progress persists in saves. | `src/data/speech/`, `src/engine/speech.ts` |
| Curses | An optional, initially disabled mode adds explicit player swearing during fights, traps, surprises, searches, trade, and idle time. | `src/engine/curses.ts`, `src/app/controller.ts` |
| Injured speech | Below 75%, 50%, and 25% health, speech becomes progressively garbled. Healing restores clarity. Names and action reports remain readable. | `src/engine/injured-speech.ts` |
| Trap presentation | Known traps have icons and corner marks, including detected locations through fog. Triggered traps stay marked and can trigger again. | `src/app/render/trap-art.ts`, `src/engine/traps.ts` |

Injured speech currently applies to the hero and speaking NPCs with health data. Ordinary enemies have no general dialogue system.
Long campaign stories remain intact. Critter action descriptions remain clear.
Visual changes and speech selection do not consume the combat random-number stream.

## Approximations and uncertain fidelity

The table below summarizes known limits. Detailed recovery notes remain internal and are not included in the public repository.

| Area | Current fidelity limit |
|---|---|
| Combat and progression | Attack rolls, monster statistics, experience thresholds, loot, spell damage, and several durations use approximations or tuned values. |
| Character rules | Attribute allocation, health and mana growth, carrying limits, armor conversion, and difficulty multipliers include inferred rules. |
| World generation | Dungeon generation retains recovered algorithm behavior, but density, placement, and tuning include project choices. |
| Towns and shops | Layouts, inventories, prices, and some services use reconstructed or curated data. |
| Monster behavior | Sight, pursuit, fleeing, wandering spawns, and rest interruptions include project-specific rules. |
| Traps and secret doors | Placement, damage, discovery, and disarming include inferred constants. Bump-search is a convenience in this version. |
| Campaign events | Story triggers, boss placement, guards, return paths, and some inventory semantics differ or remain approximations. |
| Artwork identity | New sprites represent creature families. They do not establish the original icon-to-monster assignments. |

Do not describe inferred values as recovered original values. Consult the implementation before relying on a number in older research notes.

## Known omissions and boundaries

Bank vault transactions and configurable key bindings remain deferred.
The broader Inspect command remains deferred. Directional interaction covers NPCs and dungeon objects, not a complete inspection system.

Unknown map cells remain hidden. The lighting effects do not make unexplored rooms visible.
Visual blood stains do not persist in save files. They clear when the floor or world changes.
Generated names do not rename existing saved NPCs, including duplicate names in older saves.

This record is published with the application and linked from the README. Internal research, plans, and review files remain excluded.

## Maintenance

For each future change, add its behavior, implementation path, and status here.
If original behavior is unknown, label it as unknown instead of calling the new behavior a confirmed difference.
If a feature is only planned, keep it out of the current-change table until it ships.
