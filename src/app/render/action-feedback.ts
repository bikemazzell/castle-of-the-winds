import type { Ctx2D } from './renderer';
import type { Camera,Point } from './camera';
import { idx } from '../../engine/map';
export interface ActionCue {kind:'attack'|'interact';from?:Point;at:Point;hit?:boolean}
export function drawActionFeedback(ctx:Ctx2D,camera:Camera,cues:ActionCue[],visible:Uint8Array,progress:number):void{
 if(progress<0||progress>=1)return;
 const size=Math.max(1,Math.round(camera.tile/20));
 for(const cue of cues){
  if(!visible[idx(cue.at.x,cue.at.y)]||(cue.from&&!visible[idx(cue.from.x,cue.from.y)]))continue;
  const target=camera.worldToScreen(cue.at.x,cue.at.y),cx=target.x+camera.tile/2,cy=target.y+camera.tile/2;
  ctx.fillStyle=cue.kind==='interact'?'#dfc786':cue.hit?'#ffdda3':'#9daeb6';
  if(cue.kind==='attack'&&cue.from){
   const source=camera.worldToScreen(cue.from.x,cue.from.y),angle=Math.atan2(cue.at.y-cue.from.y,cue.at.x-cue.from.x);
   for(let n=0;n<9;n++){const a=angle-0.8+progress*1.6-n*0.08;ctx.fillRect(Math.round(source.x+camera.tile/2+Math.cos(a)*camera.tile*.53),Math.round(source.y+camera.tile/2+Math.sin(a)*camera.tile*.53),size,size);}
  }
  const radius=camera.tile*(cue.kind==='interact'?0.20+progress*0.25:0.1+progress*0.12);
  for(let n=0;n<8;n++){const angle=n*Math.PI/4;const r=cue.hit?radius*(n%2?0.6:1):radius;ctx.fillRect(Math.round(cx+Math.cos(angle)*r),Math.round(cy+Math.sin(angle)*r),size,size);}
 }
}
