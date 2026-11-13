import {expect,it} from 'vitest';
import {renderFrame,type Ctx2D} from './renderer';
import {cameraFor} from './camera';
import {newWorld} from '../../engine/game';
import {createEmptyLevel} from '../../engine/map';
import {detectTrapsOnLevel,triggerTrapAt,disarmTrapAt} from '../../engine/traps';

function fixture() {
  const w=newWorld({worldSeed:7,player:{name:'Trapper',gender:'male',strength:50,intelligence:50,constitution:50,dexterity:50,difficulty:'intermediate'}});
  const level=createEmptyLevel(1); level.tiles.fill(1);
  level.traps=[{id:'test',kind:'pit',x:6,y:5,known:false}];
  w.current=1;w.levels.set(1,level);w.player.x=5;w.player.y=5;
  const seen=new Uint8Array(4096),visible=new Uint8Array(4096);
  w.seen.set(1,seen);w.visible=visible;
  const draw=()=>{
    const fills:string[]=[];let images=0;
    const ctx:Ctx2D={fillStyle:'',globalAlpha:1,fillRect(){fills.push(this.fillStyle);},drawImage(){images++;}};
    renderFrame(ctx,cameraFor(w.player,{width:320,height:320},32),{level,seen,visible,player:w.player},{tiles:{'1':{sprite:'floor'}},sprites:{floor:{}}});
    return {fills,images};
  };
  return {w,level,seen,visible,draw};
}
it('shows magic-detected trap locations in fog without showing undiscovered terrain',()=>{
  const {w,level,draw}=fixture();
  const hidden=draw();
  expect(detectTrapsOnLevel(w)).toBe(1);
  expect(level.traps![0]!.known).toBe(true);
  const revealed=draw();
  expect(revealed.fills).not.toEqual(hidden.fills);
  expect(revealed.images).toBe(0);
});
it('keeps triggered trap markers and removes them after successful disarming',()=>{
  const {w,draw}=fixture();
  const hidden=draw();
  triggerTrapAt(w,6,5);
  expect(draw().fills).not.toEqual(hidden.fills);
  w.player.dexterity=100;
  expect(disarmTrapAt(w,6,5).ok).toBe(true);
  expect(draw().fills).toEqual(hidden.fills);
});
it('never exposes unknown traps on visible floor',()=>{
  const {level,seen,visible,draw}=fixture();seen.fill(1);visible.fill(1);
  const hidden=draw();level.traps=[];
  expect(draw()).toEqual(hidden);
});
