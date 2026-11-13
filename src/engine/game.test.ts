import { describe, expect, it } from 'vitest';
import { newWorld, loadWorldData } from './game';
import { TILE_STAIRS_DOWN } from './dungeon';
import { findStair, idx } from './map';
import type { WorldData } from './types';

const INIT = {
  name: 'Sigrun',
  gender: 'female',
  strength: 50,
  intelligence: 50,
  constitution: 50,
  dexterity: 50,
  difficulty: 'intermediate',
} as const;

describe('loadWorldData', () => {
  it('includes the XP thresholds from xp.json', () => {
    const data = loadWorldData();
    expect(data.xpThresholds).toHaveLength(25);
    expect(data.xpThresholds?.[1]).toBe(0);
    expect(data.xpThresholds?.[2]).toBe(1000);
  });
});

describe('newWorld', () => {
  it('spawns the character at the town spawn on the town level', () => {
    const world = newWorld({ worldSeed: 7, player: INIT });
    expect(world.current).toBe(0);
    expect(world.player.name).toBe('Sigrun');
    expect(world.player.x).toBe(world.data.town.spawn.x);
    expect(world.player.y).toBe(world.data.town.spawn.y);
    expect(world.player.hp).toBeGreaterThan(0);
    expect(world.player.level).toBe(1);
  });

  it('the town level is built with the mine entrance stairs', () => {
    const world = newWorld({ worldSeed: 7, player: INIT });
    const town = world.levels.get(0)!;
    const entrance = world.data.town.mineEntrance;
    expect(town.tiles[idx(entrance.x, entrance.y)]).toBe(TILE_STAIRS_DOWN);
    expect(findStair(town, TILE_STAIRS_DOWN)).toEqual({ x: entrance.x, y: entrance.y });
  });

  it('worlds with the same seed are identical', () => {
    const a = newWorld({ worldSeed: 42, player: INIT });
    const b = newWorld({ worldSeed: 42, player: INIT });
    expect(a.player).toEqual(b.player);
    expect([...a.levels.keys()]).toEqual([...b.levels.keys()]);
  });
});

describe('newWorld uses the injected data (CODE-QUALITY Task 11)', () => {
  it('plays the provided WorldData instead of re-loading the built-in one', () => {
    const full = loadWorldData();
    // A two-node slice of the real graph: town + one dungeon level, no items.
    const small: WorldData = {
      ...full,
      levels: full.levels.slice(0, 2),
      items: {},
      spells: {},
    };
    const world = newWorld({ worldSeed: 7, player: INIT, data: small });
    expect(world.data.levels).toHaveLength(2);
    expect(world.data.items).toEqual({});
    expect([...world.levels.keys()]).toEqual([0]); // only the town is live
  });

  it('keeps loading the built-in data when none is injected', () => {
    const world = newWorld({ worldSeed: 7, player: INIT });
    expect(world.data.levels).toHaveLength(loadWorldData().levels.length);
  });
});

describe('part-aware world data (PART2-PLAN Task P5)', () => {
  it('loads the part 2 bundle with the castle graph and quest', () => {
    const data = loadWorldData(2);
    expect(data.part).toBe(2);
    expect(data.levels).toHaveLength(26);
    expect(data.quests?.[0]?.id).toBe('lifthransirs-bane');
    expect(data.town.mineEntrance).toEqual({ x: 15, y: 2 }); // castle stair
  });

  it('caches each part separately and keeps part 1 unchanged', () => {
    const one = loadWorldData();
    const two = loadWorldData(2);
    expect(one).not.toBe(two);
    expect(one).toBe(loadWorldData());
    expect(two).toBe(loadWorldData(2));
    expect(one.part).toBe(1);
    expect(one.levels).toHaveLength(12);
    expect(one.quests?.[0]?.id).toBe('vengeance');
  });

  it('newWorld with part 2 spawns the part 2 world', () => {
    const world = newWorld({ worldSeed: 7, player: INIT, part: 2 });
    expect(world.data.part).toBe(2);
    expect(world.data.levels).toHaveLength(26);
  });
});

it('provides a physical route back to town from every Part Two floor', async()=>{
 const {ensureLevel,dispatch}=await import('./world');
 const {TILE_STAIRS_UP}=await import('./dungeon');
 const w=newWorld({worldSeed:42,player:INIT,part:2});
 for(let n=25;n>=1;n--){
  const level=ensureLevel(w,n), stair=findStair(level,TILE_STAIRS_UP);
  expect(stair,`return stair at level ${n}`).not.toBeNull();
  w.current=n;w.player.x=stair!.x;w.player.y=stair!.y;
  dispatch(w,{type:'ASCEND'});expect(w.current).toBe(n-1);
 }
 expect(w.questState?.completed['shade-warning']).toBeDefined();
});
it('repairs missing return stairs in existing Part Two levels',async()=>{
 const {ensureLevel}=await import('./world');const {TILE_STAIRS_UP,TILE_FLOOR}=await import('./dungeon');
 const w=newWorld({worldSeed:42,player:INIT,part:2});const level=ensureLevel(w,1);
 for(let i=0;i<level.tiles.length;i++)if(level.tiles[i]===TILE_STAIRS_UP)level.tiles[i]=TILE_FLOOR;
 expect(findStair(ensureLevel(w,1),TILE_STAIRS_UP)).not.toBeNull();
});
