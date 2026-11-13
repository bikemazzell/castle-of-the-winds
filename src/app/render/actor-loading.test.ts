// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import monsters from '../../data/part2/monsters.json';
import {loadActorSprites,actorSpriteName} from './actor-art';
it('loads each Part Two appearance instead of the unknown fallback', async()=>{
 const context=vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({fillStyle:'',fillRect:vi.fn()} as unknown as CanvasRenderingContext2D);
 try {
  const sprites=await loadActorSprites();
  for(const {name} of monsters.records){expect(actorSpriteName(name),name).not.toBe('actor:unknown');expect(sprites[actorSpriteName(name)],name).toBeTruthy();}
 } finally {context.mockRestore();}
});
