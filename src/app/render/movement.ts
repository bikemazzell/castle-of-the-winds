import type { Point } from './camera';
import type { ActorMotion } from './renderer';
export const MOVE_DURATION_MS=150;
function remainingPath(target:Point,motion:ActorMotion):Point[]{
 const path=motion.path??[motion.from??target,target];
 const lengths=path.slice(1).map((p,i)=>Math.abs(p.x-path[i]!.x)+Math.abs(p.y-path[i]!.y));
 let distance=lengths.reduce((a,b)=>a+b,0)*Math.max(0,Math.min(1,motion.progress));
 for(let i=0;i<lengths.length;i++){
  const length=lengths[i]!;if(distance>=length){distance-=length;continue;}
  const a=path[i]!,b=path[i+1]!,t=length?distance/length:1;
  return [{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},...path.slice(i+1)];
 }
 return [target];
}
export function movementPosition(target:Point,motion?:ActorMotion):Point{
 const source=motion?.source??motion?.from;
 if(source&&Math.max(Math.abs(source.x-target.x),Math.abs(source.y-target.y))!==1)return target;
 return motion?.kind==='move'?remainingPath(target,motion)[0]!:target;
}
export function continueMovement(previous:ActorMotion|undefined,progress:number,from:Point,to:Point):ActorMotion{
 const path=previous?.kind==='move'&&progress<1?remainingPath(from,{...previous,progress}):[{...from}];
 path.push({...to});
 // Coalesce straight segments while retaining each corner.
 for(let i=path.length-2;i>0;i--){const a=path[i-1]!,b=path[i]!,c=path[i+1]!;if((a.x===b.x&&b.x===c.x&&Math.sign(b.y-a.y)===Math.sign(c.y-b.y))||(a.y===b.y&&b.y===c.y&&Math.sign(b.x-a.x)===Math.sign(c.x-b.x)))path.splice(i,1);}
 return {kind:'move',progress:0,from:path[0],source:{...from},path};
}
