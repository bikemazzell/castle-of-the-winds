import { expect,it,vi } from 'vitest';
import { drawActionFeedback } from './action-feedback';
import { cameraFor } from './camera';
it('draws attack and interaction cues only in visible cells and expires them',()=>{
 const ctx={fillStyle:'',globalAlpha:1,drawImage:vi.fn(),fillRect:vi.fn()},camera=cameraFor({x:5,y:5},{width:320,height:320},32);
 const cues=[{kind:'attack' as const,from:{x:5,y:5},at:{x:6,y:5},hit:true},{kind:'interact' as const,at:{x:5,y:5}}];
 drawActionFeedback(ctx,camera,cues,new Uint8Array(4096),0.5);expect(ctx.fillRect).not.toHaveBeenCalled();
 drawActionFeedback(ctx,camera,cues,new Uint8Array(4096).fill(1),0.5);expect(ctx.fillRect).toHaveBeenCalled();
 ctx.fillRect.mockClear();drawActionFeedback(ctx,camera,cues,new Uint8Array(4096).fill(1),1);expect(ctx.fillRect).not.toHaveBeenCalled();
});
