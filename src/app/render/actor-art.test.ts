import { describe, expect, it, vi } from 'vitest';
import { actorSpriteName } from './actor-art';
import { renderFrame } from './renderer';
import { cameraFor } from './camera';
import { createEmptyLevel, idx } from '../../engine/map';

describe('actor art', () => {
  it('uses new creature art for the formerly extracted icons', () => {
    expect(actorSpriteName('Giant Rat')).toBe('creature:giant rat');
    expect(actorSpriteName('Skeleton')).toBe('creature:skeleton');
    expect(actorSpriteName('Unknown monster')).toBe('actor:unknown');
  });
  it('draws loaded hero and visible enemy sprites, but hides unseen enemies', () => {
    const level = createEmptyLevel(1);
    const seen = new Uint8Array(4096).fill(1);
    const visible = new Uint8Array(4096);
    visible[idx(5, 5)] = 1;
    const hero = {}, rat = {};
    const ctx = { fillStyle: '', globalAlpha: 1, fillRect: vi.fn(), drawImage: vi.fn() };
    renderFrame(ctx, cameraFor({x: 5, y: 5}, {width: 320, height: 320}, 32), {
      level, seen, visible, player: {x: 5, y: 5}, entities: [
        {id: 1, kind: 'monster', name: 'Giant Rat', x: 5, y: 5},
        {id: 2, kind: 'monster', name: 'Giant Rat', x: 6, y: 5},
      ],
    }, {tiles: {}, sprites: {'actor:hero': hero, 'creature:giant rat': rat}});
    expect(ctx.drawImage.mock.calls.filter(call => call[0] === hero)).toHaveLength(1);
    expect(ctx.drawImage.mock.calls.filter(call => call[0] === rat)).toHaveLength(1);
  });
});
it.each(['male', 'female'] as const)('draws the selected %s hero icon', gender => {
  const hero = {};
  const ctx = { fillStyle: '', globalAlpha: 1, fillRect: vi.fn(), drawImage: vi.fn() };
  renderFrame(ctx, cameraFor({x: 5, y: 5}, {width: 320, height: 320}, 32), {
    level: createEmptyLevel(1), seen: new Uint8Array(4096), visible: new Uint8Array(4096),
    player: {x: 5, y: 5}, playerGender: gender,
  }, {tiles: {}, sprites: {[`actor:hero:${gender}`]: hero}});
  expect(ctx.drawImage.mock.calls.filter(call => call[0] === hero)).toHaveLength(1);
});

it('never shares scorpion and orc art',()=>{expect(actorSpriteName('Giant Scorpion')).not.toBe(actorSpriteName('Orc'));});

it('uses the explicit unknown silhouette when a future roster sprite is not loaded',()=>{
 const fallback={},ctx={fillStyle:'',globalAlpha:1,fillRect:vi.fn(),drawImage:vi.fn()};
 renderFrame(ctx,cameraFor({x:5,y:5},{width:320,height:320},32),{
  level:createEmptyLevel(1),seen:new Uint8Array(4096).fill(1),visible:new Uint8Array(4096).fill(1),player:{x:5,y:5},entities:[{id:1,name:'Frost Troll',kind:'monster',x:6,y:5}],
 },{tiles:{},sprites:{'actor:unknown':fallback}});
 expect(ctx.drawImage.mock.calls.some(call=>call[0]===fallback)).toBe(true);
});

it('draws a proportional health bar only for a currently visible enemy', () => {
  const level = createEmptyLevel(1), visible = new Uint8Array(4096);
  const enemy = { id: 1, kind: 'monster' as const, name: 'Giant Rat', x: 5, y: 5, monster: { hp: 4, maxHp: 8 } };
  const bars: {color: string; width: number}[] = [];
  const ctx = { fillStyle: '', globalAlpha: 1, fillRect(_x: number, _y: number, width: number) { if (this.fillStyle === '#e5bd62') bars.push({ color: this.fillStyle, width }); }, drawImage: vi.fn() };
  const scene = {level, seen:new Uint8Array(4096).fill(1), visible, player:{x:6,y:6}, entities:[enemy]} as Parameters<typeof renderFrame>[2];
  const camera = cameraFor(scene.player,{width:320,height:320},32);
  renderFrame(ctx,camera,scene,{tiles:{},sprites:{}});
  expect(bars).toHaveLength(0);
  visible[idx(5,5)] = 1;
  renderFrame(ctx,camera,scene,{tiles:{},sprites:{}});
  expect(bars).toHaveLength(1);
  expect(bars[0]!.width).toBe(10);
});

it('keeps health bars inside their own tile and above every actor draw', () => {
  const hero = {}, enemy = {};
  const calls: {kind:string; y:number; height:number}[] = [];
  const ctx = { fillStyle:'', globalAlpha:1,
    fillRect(_x:number,y:number,_width:number,height:number) { if (this.fillStyle === '#e5bd62' || this.fillStyle === '#151a20') calls.push({kind:'bar',y,height}); },
    drawImage(image:unknown,_x:number,y:number,_width:number,height:number) { calls.push({kind:image===hero?'hero':'enemy',y,height}); },
  };
  const level = createEmptyLevel(1), camera = cameraFor({x:5,y:4},{width:320,height:320},32);
  const scene = {level,seen:new Uint8Array(4096).fill(1),visible:new Uint8Array(4096).fill(1),player:{x:5,y:4},entities:[
    {id:1,kind:'monster',name:'Giant Rat',x:5,y:5,monster:{hp:4,maxHp:8}},
  ]} as Parameters<typeof renderFrame>[2];
  renderFrame(ctx,camera,scene,{tiles:{},sprites:{'actor:hero':hero,'creature:giant rat':enemy}});
  const top = camera.worldToScreen(5,5).y;
  const bars = calls.filter(call=>call.kind==='bar');
  expect(bars).toHaveLength(2);
  for (const bar of bars) { expect(bar.y).toBeGreaterThanOrEqual(top); expect(bar.y+bar.height).toBeLessThanOrEqual(top+32); }
  expect(calls.findIndex(call=>call.kind==='bar')).toBeGreaterThan(calls.findIndex(call=>call.kind==='hero'));
  expect(calls.findIndex(call=>call.kind==='bar')).toBeGreaterThan(calls.findIndex(call=>call.kind==='enemy'));
});

it.each([
  ['Giant Rat', undefined, 'creature:giant rat',16],
  ['Ancient Red Dragon', undefined, 'creature:ancient red dragon',32],
  ['Cellar Mouse', 'critter', 'npc:critter',11],
] as const)('centers %s at its own size and keeps its feet on the tile floor', (name,role,key,size) => {
  const actor = {}, ctx={fillStyle:'',globalAlpha:1,fillRect:vi.fn(),drawImage:vi.fn()};
  const camera=cameraFor({x:5,y:4},{width:320,height:320},32), cell=camera.worldToScreen(5,5);
  const entity={id:1,kind:role?'npc':'monster',name,x:5,y:5,...(role?{npc:{role,stock:[],giftClaimed:false}}:{})};
  renderFrame(ctx,camera,{level:createEmptyLevel(1),seen:new Uint8Array(4096).fill(1),visible:new Uint8Array(4096).fill(1),player:{x:5,y:4},entities:[entity]} as Parameters<typeof renderFrame>[2],{tiles:{},sprites:{[key]:actor}});
  const draw=ctx.drawImage.mock.calls.find(call=>call[0]===actor)!;
  expect(draw).toBeDefined();
  expect(draw[3]).toBe(size); expect(draw[4]).toBe(size);
  expect(draw[1]).toBe(cell.x+Math.round((32-size)/2));
  expect(draw[2]+draw[4]).toBe(cell.y+32);
});

it('keeps the small rat scale during movement and hides it when its destination is unseen', () => {
  const rat={},ctx={fillStyle:'',globalAlpha:1,fillRect:vi.fn(),drawImage:vi.fn()};
  const camera=cameraFor({x:5,y:4},{width:320,height:320},32),cell=camera.worldToScreen(5,5);
  const visible=new Uint8Array(4096).fill(1);
  const scene:Parameters<typeof renderFrame>[2]={level:createEmptyLevel(1),seen:new Uint8Array(4096).fill(1),visible,player:{x:5,y:4},entities:[{id:1,kind:'monster',name:'Giant Rat',x:5,y:5}],animation:{entities:new Map([[1,{kind:'move',from:{x:4,y:5},progress:0.5}]])}};
  renderFrame(ctx,camera,scene,{tiles:{},sprites:{'creature:giant rat':rat}});
  expect(ctx.drawImage.mock.calls.find(call=>call[0]===rat)).toEqual([rat,cell.x-8,cell.y+16,16,16]);
  ctx.drawImage.mockClear(); visible[idx(5,5)]=0;
  renderFrame(ctx,camera,scene,{tiles:{},sprites:{'creature:giant rat':rat}});
  expect(ctx.drawImage.mock.calls.filter(call=>call[0]===rat)).toHaveLength(0);
});

it('places the rat health bar lower than the dragon bar beside each scaled head', () => {
  const bars:number[]=[];
  const ctx={fillStyle:'',globalAlpha:1,drawImage:vi.fn(),fillRect(_x:number,y:number){if(this.fillStyle==='#e5bd62') bars.push(y);}};
  const camera=cameraFor({x:5,y:4},{width:320,height:320},32),top=camera.worldToScreen(5,5).y;
  const entities=['Giant Rat','Ancient Red Dragon','Orc'].map((name,i)=>({id:i+1,kind:'monster',name,x:5+i,y:5,monster:{hp:4,maxHp:8}}));
  renderFrame(ctx,camera,{level:createEmptyLevel(1),seen:new Uint8Array(4096).fill(1),visible:new Uint8Array(4096).fill(1),player:{x:5,y:4},entities} as Parameters<typeof renderFrame>[2],{tiles:{},sprites:{}});
  expect(bars).toEqual([top+18,top+2,top+8]);
});
