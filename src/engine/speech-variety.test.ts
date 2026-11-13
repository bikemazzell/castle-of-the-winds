import {expect,it} from 'vitest';
import {CHATTER,NPC_CHATTER,chatterLine,npcChatterLine} from './chatter';
import {CURSE_LINES,curseLine} from './curses';

it('provides tenfold speech variety with distinct authored lines',()=>{
  for(const lines of Object.values(CHATTER))expect(lines.length).toBeGreaterThanOrEqual(120);
  for(const lines of Object.values(CURSE_LINES))expect(lines.length).toBeGreaterThanOrEqual(60);
  for(const [role,lines] of Object.entries(NPC_CHATTER))expect(lines.length).toBeGreaterThanOrEqual(role==='ghost'||role==='critter'?10:40);
  expect(Object.keys(NPC_CHATTER)).toContain('ghost');expect(Object.keys(NPC_CHATTER)).toContain('critter');
  const lines=[...Object.values(CHATTER),...Object.values(CURSE_LINES),...Object.values(NPC_CHATTER)].flat();
  expect(lines.length).toBeGreaterThanOrEqual(1260);
  expect(new Set(lines.map(line=>line.toLowerCase().trim())).size).toBe(lines.length);
});
it('uses every line once per cycle and avoids a repeat at cycle boundaries',()=>{
  for(const [context,lines] of Object.entries(CHATTER)){
    const sample=Array.from({length:lines.length+1},(_,n)=>chatterLine(42,n,context as keyof typeof CHATTER));
    expect(new Set(sample.slice(0,-1)).size).toBe(lines.length);expect(sample.at(-1)).not.toBe(sample.at(-2));
  }
  for(const [context,lines] of Object.entries(CURSE_LINES)){
    const sample=Array.from({length:lines.length+1},(_,n)=>curseLine(42,n,context as keyof typeof CURSE_LINES,'Hero'));
    expect(new Set(sample.slice(0,-1)).size).toBe(lines.length);expect(sample.at(-1)).not.toBe(sample.at(-2));
  }
  for(const [role,lines] of Object.entries(NPC_CHATTER)){
    const sample=Array.from({length:lines.length+1},(_,n)=>npcChatterLine(42,n,role as keyof typeof NPC_CHATTER,'Mara'));
    expect(new Set(sample.slice(0,-1)).size).toBe(lines.length);expect(sample.at(-1)).not.toBe(sample.at(-2));
  }
});
it('normalizes invalid cosmetic sequence values instead of showing undefined',()=>{
  expect(chatterLine(42,NaN,'idle')).toBe(chatterLine(42,0,'idle'));
  expect(npcChatterLine(42,Infinity,'wizard','Mara')).toBe(npcChatterLine(42,0,'wizard','Mara'));
});

it('keeps a complete cycle for every pool size and several seeds', async()=>{
  const {speechIndex}=await import('./speech');
  for(const size of [10,40,60,120])for(const seed of [0,1,-1,42,2147483647]){
    const indices=Array.from({length:size},(_,n)=>speechIndex(size,seed,n,'idle'));
    expect(new Set(indices).size).toBe(size);
    expect(indices.every(index=>index>=0&&index<size)).toBe(true);
  }
});
