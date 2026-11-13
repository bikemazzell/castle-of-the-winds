import monsters from '../../data/monsters.json';
import part2Monsters from '../../data/part2/monsters.json';
import { creatureAppearance } from './creature-catalog';
import { creaturePixels, pixelCanvas } from './pixel-art';
export function actorSpriteName(name: string): string {
  return creatureAppearance(name).family === 'unknown' ? 'actor:unknown' : `creature:${name.toLowerCase()}`;
}

export function loadActorSprites(): Promise<Record<string, HTMLCanvasElement>> {
  const sprites: Record<string, HTMLCanvasElement> = {};
  for (const { name } of [...monsters.records, ...part2Monsters.records]) {
    const key = actorSpriteName(name);
    if (!sprites[key]) sprites[key] = pixelCanvas(creaturePixels(name));
  }
  sprites['actor:unknown'] = pixelCanvas(creaturePixels('unknown'));
  return Promise.resolve(sprites);
}
