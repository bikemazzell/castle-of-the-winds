import { expect, it } from 'vitest';
import { damageImpacts, createImpactStore } from './impacts';
const before = [{ id: 1, name: 'Orc', x: 4, y: 5, hp: 10, visible: true }];
it('emits only real visible damage and death, with the correct material', () => {
    expect(damageImpacts(before, [{ ...before[0]!, hp: 10 }], 0)).toHaveLength(0);
    expect(damageImpacts(before, [{ ...before[0]!, hp: 8 }], 0)).toHaveLength(1);
    expect(damageImpacts(before, [], 0)[0]?.fatal).toBe(true);
    expect(damageImpacts([{ ...before[0]!, visible: false }], [], 0)).toHaveLength(0);
    expect(damageImpacts([{ ...before[0]!, name: 'Skeleton' }], [], 0)[0]?.material).toBe('bone');
});
it('caps retained stains and clears all effects between worlds', () => {
    const store = createImpactStore();
    for (let i = 0; i < 200; i++)
        store.add(damageImpacts(before, [], i));
    expect(store.all().length).toBe(96);
    store.clear();
    expect(store.all()).toHaveLength(0);
});
it('expires spirit effects and never draws impacts in unknown cells', async () => {
    const { vi } = await import('vitest');
    const { drawImpacts } = await import('./impacts');
    const { cameraFor } = await import('./camera');
    const ctx = { fillStyle: '', globalAlpha: 1, drawImage: vi.fn(), fillRect: vi.fn() }, camera = cameraFor({ x: 4, y: 5 }, { width: 320, height: 320 }, 32);
    const impact = { x: 4, y: 5, start: 0, fatal: true, material: 'spirit' as const, seed: 1 }, known = new Uint8Array(4096).fill(1);
    drawImpacts(ctx, camera, [impact], known, known, 900, false);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    drawImpacts(ctx, camera, [{ ...impact, material: 'blood' }], new Uint8Array(4096), known, 100, false);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    drawImpacts(ctx, camera, [{ ...impact, material: 'bone' }], known, known, 900, true);
    expect(ctx.fillRect).toHaveBeenCalledTimes(9);
});

it('puts observed damage at the new position and does not expose unseen destinations',()=>{
 const after=[{...before[0]!,x:5,hp:8}];
 expect(damageImpacts(before,after,100)[0]?.x).toBe(5);
 expect(damageImpacts(before,[{...after[0]!,visible:false}],100)).toHaveLength(0);
});

import { movementBlood, drawImpacts } from './impacts';
import { cameraFor } from './camera';
import { vi } from 'vitest';

it.each(['hero','Orc','Green Slime'])('leaves persistent movement stains for wounded %s without mutating actors', name => {
  const old = { id: 1, name, x: 4, y: 5, hp: 5, maxHp: 10, visible: true, level: 1 };
  const next = { ...old, x: 5 };
  const snapshot = structuredClone([old,next]);
  const trail = movementBlood([old],[next],100);
  expect(trail).toHaveLength(2);
  expect(trail.map(p=>[p.x,p.y])).toEqual([[4,5],[5,5]]);
  expect(trail.every(p=>p.kind==='trail' && !p.fatal)).toBe(true);
  expect(trail[0]?.material).toBe(name==='Green Slime'?'slime':'blood');
  expect([old,next]).toEqual(snapshot);
  expect(movementBlood([old],[next],100)).toEqual(trail);
});

it.each(['healthy','stationary','teleport','new level','hidden old','hidden new','dead','missing maxHp','Skeleton','Ghost','Stone Elemental'])('does not leave movement blood for %s', reason => {
  const old = { id: 1, name:'Orc', x:4,y:5,hp:5,maxHp:10 as number|undefined,visible:true,level:1 };
  const next = { ...old, x:5 };
  if(reason==='healthy') next.hp=6;
  if(reason==='stationary') next.x=4;
  if(reason==='teleport') next.x=8;
  if(reason==='new level') next.level=2;
  if(reason==='hidden old') old.visible=false;
  if(reason==='hidden new') next.visible=false;
  if(reason==='dead') next.hp=0;
  if(reason==='missing maxHp') next.maxHp=undefined;
  if(['Skeleton','Ghost','Stone Elemental'].includes(reason)) old.name=next.name=reason;
  expect(movementBlood([old],[next],100)).toHaveLength(0);
});

it('draws substantially more blood, keeps stains in reduced motion, and clips every pixel to its known tile', () => {
  const ctx={fillStyle:'',globalAlpha:1,drawImage:vi.fn(),fillRect:vi.fn()};
  const camera=cameraFor({x:4,y:5},{width:320,height:320},32), cell=camera.worldToScreen(4,5);
  const known=new Uint8Array(4096);known[4+5*64]=1;
  const impact={x:4,y:5,start:0,fatal:true,material:'blood' as const,seed:1};
  drawImpacts(ctx,camera,[impact],known,known,200,false);
  expect(ctx.fillRect.mock.calls.length).toBeGreaterThanOrEqual(40);
  for(const [x,y,w,h] of ctx.fillRect.mock.calls){
    expect(x).toBeGreaterThanOrEqual(cell.x);expect(x+w).toBeLessThanOrEqual(cell.x+32);
    expect(y).toBeGreaterThanOrEqual(cell.y);expect(y+h).toBeLessThanOrEqual(cell.y+32);
  }
  ctx.fillRect.mockClear();
  drawImpacts(ctx,camera,[impact],known,new Uint8Array(4096),60_000,true);
  expect(ctx.fillRect.mock.calls.length).toBeGreaterThanOrEqual(20);
});

it('draws walking stains without an animated burst and hides every impact when the supplied list is empty', () => {
  const ctx={fillStyle:'',globalAlpha:1,drawImage:vi.fn(),fillRect:vi.fn()},known=new Uint8Array(4096).fill(1);
  const camera=cameraFor({x:4,y:5},{width:320,height:320},32);
  const old={id:0,name:'hero',x:4,y:5,hp:4,maxHp:10,visible:true};
  const trail=movementBlood([old],[{...old,x:5}],100);
  drawImpacts(ctx,camera,trail,known,known,100,false);
  const animated=ctx.fillRect.mock.calls.slice();
  expect(animated.length).toBeGreaterThan(0);
  ctx.fillRect.mockClear();drawImpacts(ctx,camera,trail,known,known,500,true);
  expect(ctx.fillRect.mock.calls).toEqual(animated);
  ctx.fillRect.mockClear();drawImpacts(ctx,camera,[],known,known,500,false);
  expect(ctx.fillRect).not.toHaveBeenCalled();
});
