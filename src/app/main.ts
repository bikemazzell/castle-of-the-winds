/**
 * App entry: mounts the game controller (shell + HUD + renderer + input +
 * dialogs) into #app and shows the title screen.
 */
import './styles.css';
import './ui/gameplay-polish.css';
import './ui/panel-polish.css';
import { createGameController } from './controller';
import { loadWorldData } from '../engine/game';
import { loadTownShops } from './scenes/town';

const root = document.querySelector<HTMLElement>('#app');
if (root) {
  const controller = createGameController({
    root,
    data: loadWorldData(),
    town: loadTownShops(),
  });
  controller.start();
}
