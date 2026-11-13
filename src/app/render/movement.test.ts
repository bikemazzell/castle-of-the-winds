import { expect,it } from 'vitest';
import { movementPosition,continueMovement } from './movement';
it('moves at an even speed without vertical bounce',()=>{
 const move=continueMovement(undefined,1,{x:5,y:5},{x:6,y:5});
 expect(movementPosition({x:6,y:5},{...move,progress:0.5})).toEqual({x:5.5,y:5});
});
it('continues from the displayed position when a new step interrupts an old one',()=>{
 const first=continueMovement(undefined,1,{x:5,y:5},{x:6,y:5});
 const next=continueMovement(first,0.5,{x:6,y:5},{x:7,y:5});
 expect(movementPosition({x:7,y:5},{...next,progress:0})).toEqual({x:5.5,y:5});
 expect(movementPosition({x:7,y:5},{...next,progress:1})).toEqual({x:7,y:5});
});
it('preserves cardinal corners instead of cutting diagonally across walls',()=>{
 const first=continueMovement(undefined,1,{x:5,y:5},{x:6,y:5});
 const next=continueMovement(first,0.5,{x:6,y:5},{x:6,y:6});
 const p=movementPosition({x:6,y:6},{...next,progress:0.25});
 expect(p.y).toBe(5);expect(p.x).toBeGreaterThan(5.5);
});
it('keeps path endpoints independent of mutable world actors',()=>{
 const actor={x:6,y:5};
 const first=continueMovement(undefined,1,{x:5,y:5},actor);
 actor.y=6;
 const next=continueMovement(first,0.5,{x:6,y:5},actor);
 expect(movementPosition(actor,{...next,progress:0})).toEqual({x:5.5,y:5});
 expect(movementPosition(actor,{...next,progress:0.25}).y).toBe(5);
});
it('snaps teleports instead of moving the camera along an invisible path',()=>{
 const move=continueMovement(undefined,1,{x:5,y:5},{x:20,y:20});
 expect(movementPosition({x:20,y:20},{...move,progress:0.5})).toEqual({x:20,y:20});
});
