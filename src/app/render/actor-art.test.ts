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
