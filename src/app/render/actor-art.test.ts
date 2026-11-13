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
