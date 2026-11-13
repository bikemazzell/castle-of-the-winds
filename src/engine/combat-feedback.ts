export interface CombatCue {attacker:{id:number;x:number;y:number};target:{id:number;x:number;y:number};hit:boolean;damage:number}
const captures=new WeakMap<object,CombatCue[]>();
export function recordCombat(world:object,cue:CombatCue):void {captures.get(world)?.push(cue);}
export function captureCombat<T>(world:object,run:()=>T):{result:T;events:CombatCue[]} {
 const previous=captures.get(world),events:CombatCue[]=[];captures.set(world,events);
 try{return {result:run(),events};}finally{if(previous)captures.set(world,previous);else captures.delete(world);}
}
