// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {loadActorSprites} from './actor-art';
import {NPC_ROLES,PROP_KINDS} from '../../engine/map';
it('loads the actual NPC and prop canvases into the runtime sprite catalog', async () => {
  const context = {fillStyle:'',fillRect:vi.fn(),clearRect:vi.fn(),imageSmoothingEnabled:false};
  const spy = vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  try {
    const sprites = await loadActorSprites();
    for(const role of NPC_ROLES) expect(sprites[`npc:${role}`]).toBeInstanceOf(HTMLCanvasElement);
    for(const kind of PROP_KINDS) expect(sprites[`prop:${kind}`]).toBeInstanceOf(HTMLCanvasElement);
  } finally {spy.mockRestore();}
});
