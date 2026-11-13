import { expect, it, vi } from 'vitest';
import { curseLine, CURSE_LINES, type CurseContext } from './curses';
import { MSLCG } from './rng';
it('provides varied explicit player swearing in every requested context',()=>{
 const contexts:CurseContext[]=['hurt','surprised','trap','victory','combat','search','idle','barter'];
 for(const context of contexts){
  const lines=CURSE_LINES[context];expect(lines.length).toBeGreaterThanOrEqual(5);expect(new Set(lines).size).toBe(lines.length);
  for(const line of lines)expect(line).toMatch(/fuck|shit|bastard|arse|asshole|bollocks/i);
  for(let sequence=0;sequence<lines.length*2;sequence++){
   const line=curseLine(42,sequence,context,'Sigrun');
   expect(line).toMatch(/^Sigrun: /);expect(line).toBe(curseLine(42,sequence,context,'Sigrun'));
   expect(line).not.toBe(curseLine(42,sequence+1,context,'Sigrun'));
  }
 }
});
it('never consumes gameplay or platform randomness',()=>{
 const random=vi.spyOn(Math,'random').mockImplementation(()=>{throw new Error('cosmetic RNG leak');});
 const next=vi.spyOn(MSLCG.prototype,'next').mockImplementation(()=>{throw new Error('gameplay RNG leak');});
 try{
  for(const context of Object.keys(CURSE_LINES) as CurseContext[])for(let sequence=0;sequence<20;sequence++)curseLine(123,sequence,context,'Hero');
  expect(random).not.toHaveBeenCalled();expect(next).not.toHaveBeenCalled();
 }finally{random.mockRestore();next.mockRestore();}
});
