# Castle of the Winds

[Play in your browser](https://bikemazzell.github.io/castle-of-the-winds/).

An independent, turn-based browser RPG loosely inspired by Castle of the Winds, the Windows game by Rick Saada.
Play with a keyboard, mouse, or touch screen. Both campaigns are playable.

This version uses newly written TypeScript code and new pixel art drawn in code.
It does not use original game code or artwork. You do not need the original game files to build or play.
The story, names, messages, maps, and game data still include material adapted or extracted from the original game.
This is an unofficial project. The new code and artwork do not make those other materials original to this project.

## Run locally

Install Node.js 22 or later. From the repository root, run:

```sh
npm ci
npm run dev
```

Open the local address printed by Vite.

For a production build, run:

```sh
npm run build
npm run preview
```

The `dist/` directory contains the static site. The build supports hosting beneath a path prefix.

## Play

- Move with WASD, arrows, or the numpad. Numpad 7/9/1/3 move NW/NE/SW/SE. Numpad 5 waits.
- Click or tap a reachable tile to travel there.
- Open Bag or Spells from the floating action bar.
- Click a spell shortcut, then click a visible target. Self spells cast with one click.
- Pin favorite spells in the spellbook. Without favorites, the bar shows up to six learned spells.
- Press F to choose a ranged weapon. Click a visible enemy to fire.
- Press T to talk or inspect nearby objects. Actions also contains these commands.
- Press Escape to pause. The pause menu provides saves, preferences, help, and Debug controls.
- Use Debug to reveal the map, change character values, and edit gold or inventory.
- Use the map controls to zoom and return the view to the hero.

The hero moves smoothly between tiles. The camera follows near the edge of the safe viewing area.
Combat shows attack, hit, and miss effects. Small health bars appear above visible enemies. Interactions show a brief pulse.
Living creatures have idle motion. Equipped items change the hero appearance.
Terrain has coordinate-based variation, moving foliage, and water ripples.
Dungeon torches cast local light. Outdoor daylight uses game time, which advances through actions and rest.
Optional idle rest and search use separate delays in Settings. Both default to Off.
Automatic actions pause during dialogs, targeting, travel, focus loss, and visible enemy encounters.
Rest advances one game hour. Search advances one turn. Both automatic actions write messages to the log.

Shops show purchase receipts and require a new selection before another purchase.
Sell All previews the pack contents and total price before confirmation. Equipped items stay with the hero.

Dungeons contain treasure boxes, junk, bones, mushrooms, runes, rubble, ghosts, and harmless mice.
Search reveals secret doors and collects nearby salvage. Each object gives its reward once.
Travelers and shopkeepers have distinct dialogue. Some trade, wander, or offer a small gift.
Optional chatter covers combat, bargaining, searching, and idle time. Disable it in Settings.

Weapon shops sell bows, arrows, crossbows, bolts, hand cannons, cannonballs, bone clubs, and whips.
Rocks and bones can be thrown. Ranged attacks require a visible enemy, a clear path, and matching ammunition.
Hand cannons wake nearby enemies. Whips reach across two tiles without ammunition.

Alchemy shops sell mead, spirits, Sparkleaf, Dreamcap, and Mellowroot.
Item descriptions explain their temporary benefits and penalties. Sparkleaf ends with a short crash.
Dreamcap also tints the visible map. These effects survive saves and expire as game time advances.
Magic shops sell scrolls for Mandatory Bedtime, Urgent Paperwork, and Borrowed Sunshine.
General stores sell underwear dyes and helmet polish. These change the hero sprite without changing character values.

Reduced motion disables animation. Blood, debris, and chatter have separate controls in the pause preferences.

Part One follows the Mine and Fortress campaign. Part Two continues the journey and supports importing a Part One character.
Every Part Two castle floor has return stairs. Magic shops sell scrolls that teach character spells.
Saves stay in the browser on the current origin. The save menu also supports file export and import.

## Development

Run these commands before submitting changes:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Browser tests use `/usr/bin/brave-browser-stable` and isolated browser profiles:

```sh
npm run e2e:preview
npm run e2e:mobile
npm run e2e:release
npm run e2e:campaign
npm run e2e:campaign2
npm run e2e:expansion
```

Campaign browser tests include assisted phases with edited characters. They do not establish full-campaign balance.

The engine lives in `src/engine/`. The interface and renderer live in `src/app/`.
Campaign definitions live in `src/data/part1/` and `src/data/part2/`.
Shared tiles and experience values live in `src/data/`. Procedural artwork lives in `src/app/render/`.
Gameplay uses seeded random numbers. Visual effects use separate calculations and do not change game results.

## Attribution and publication

Castle of the Winds and the original game content are credited to Rick Saada.
This repository does not claim ownership of that content or imply the original author's endorsement.
No blanket public-domain or open-source license claim applies to all included material.

The public repository contains the application, game data, tests, build configuration, and this README.
It excludes original binaries, extracted artwork, internal research, plans, review files, and private repository history.

GitHub Actions runs tests and builds the game before publishing `main` to GitHub Pages.
Browser saves belong to the site address. Export a save file to move between a local build and the hosted game.
