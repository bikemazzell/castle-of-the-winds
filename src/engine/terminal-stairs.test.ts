import {expect,it} from 'vitest';
import {newWorld,loadWorldData} from './game';
import {ensureLevel,dispatch,findStair} from './world';
import {serializeGame,deserializeGame} from './save';
import {TILE_FLOOR,TILE_STAIRS_DOWN,TILE_STAIRS_UP} from './dungeon';
import {idx} from './map';
const make=(part:1|2)=>newWorld({part,worldSeed:71,player:{name:'Stair tester',gender:'male',strength:50,intelligence:50,constitution:50,dexterity:50,difficulty:'intermediate'}});
it.each([1,2] as const)('omits stairs without a destination in campaign %i',part=>{
 const w=make(part);const node=w.data.levels.find(n=>n.index>0&&n.links.down===null&&!n.links.special)!;
 const level=ensureLevel(w,node.index);
 expect(findStair(level,TILE_STAIRS_DOWN)).toBeNull();expect(findStair(level,TILE_STAIRS_UP)).not.toBeNull();
});
it.each([1,2] as const)('repairs legacy terminal stairs on load without resetting progress in campaign %i',part=>{
 const w=make(part);const node=w.data.levels.find(n=>n.index>0&&n.links.down===null&&!n.links.special)!;
 const level=ensureLevel(w,node.index);const cell=level.tiles.findIndex(t=>t===TILE_FLOOR);
 level.tiles[cell]=TILE_STAIRS_DOWN;w.current=node.index;
 const up=findStair(level,TILE_STAIRS_UP)!;Object.assign(w.player,up);
 const file=serializeGame(w);const original=JSON.stringify(file);
 const loaded=deserializeGame(file,loadWorldData(part));
 expect(loaded.levels.get(node.index)!.tiles[cell]).toBe(TILE_FLOOR);
 expect(JSON.stringify(file)).toBe(original);expect(loaded.player).toEqual(w.player);expect(loaded.inventory).toEqual(w.inventory);
 expect(loaded.questState).toEqual(w.questState);expect(loaded.rng.getState()).toBe(w.rng.getState());
 expect([...loaded.levels.get(node.index)!.entities.values()]).toEqual([...level.entities.values()]);
 dispatch(loaded,{type:'ASCEND'});expect(loaded.current).toBe(node.links.up);
 expect(loaded.levels.get(loaded.current)!.tiles[idx(loaded.player.x,loaded.player.y)]).toBe(TILE_STAIRS_DOWN);
});
it('preserves the town entrance with a special downward link',()=>{
 const w=make(1);const down=findStair(w.levels.get(0)!,TILE_STAIRS_DOWN)!;
 const loaded=deserializeGame(serializeGame(w),w.data);Object.assign(loaded.player,down);
 dispatch(loaded,{type:'DESCEND'});expect(loaded.current).toBe(1);
});
