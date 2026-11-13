/** Synthetic legacy saves test terminal stairs and death recovery. No user saves are read. */
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {newWorld} from '../../src/engine/game';
import {ensureLevel,findStair} from '../../src/engine/world';
import {serializeGame} from '../../src/engine/save';
import {TILE_FLOOR,TILE_STAIRS_DOWN,TILE_STAIRS_UP} from '../../src/engine/dungeon';
import type {CotwHooks} from '../../src/app/devtools';
import {launchBrave,ensureVite,newPage} from './brave';
import {runWith,collectPageErrors,assertNoPageErrors} from './helpers';
declare global {interface Window {__cotw:CotwHooks}}
await runWith([],async close=>{
 const folder=await mkdtemp(join(tmpdir(),'cotw-recovery-'));close(()=>rm(folder,{recursive:true,force:true}));
 const browser=await launchBrave(console.error);close(()=>browser.close());
 const server=process.env.E2E_URL?{url:process.env.E2E_URL,stop:async()=>{}}:await ensureVite(console.error);close(()=>server.stop());
 for(const part of [1,2] as const){
  const world=newWorld({part,worldSeed:71,player:{name:'Recovery test',gender:'male',strength:50,intelligence:50,constitution:50,dexterity:50,difficulty:'intermediate'}});
  const node=world.data.levels.find(n=>n.index>0&&n.links.down===null&&!n.links.special)!;
  const level=ensureLevel(world,node.index);world.current=node.index;world.questState!.pending=[];
  Object.assign(world.player,findStair(level,TILE_STAIRS_UP)!);
  level.tiles[level.tiles.findIndex(tile=>tile===TILE_FLOOR)]=TILE_STAIRS_DOWN;
  const file=join(folder,`legacy-${part}.json`);await writeFile(file,JSON.stringify(serializeGame(world)));
  const page=await newPage(browser.browser,server.url);const {errors}=collectPageErrors(page);
  await page.click(`[data-part="${part}"]`);await page.click('[data-action="load-game"]');
  const upload=await page.waitForSelector('.save-dialog input[type="file"]');await upload!.uploadFile(file);
  await page.waitForFunction(()=>window.__cotw.position()!==null);
  assert.equal(await page.evaluate(()=>window.__cotw.stair('down')),null);
  assert.ok(await page.evaluate(()=>window.__cotw.stair('up')));
  await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.__cotw.position()?.level),node.links.up);
  for(let n=0;n<40;n++){const next=await page.$('.story-overlay [data-action="continue"]');if(!next)break;await next.click();}
  const storage=()=>page.evaluate(()=>JSON.stringify(Object.keys(localStorage).filter(k=>k.startsWith('cotw.save')).sort().map(k=>[k,localStorage.getItem(k)])));
  for(const dismiss of ['close','escape'] as const){
   const before=await storage();
   const scene=await page.evaluate(()=>{const result=window.__cotw.scene('death');window.__cotw.dispatch({type:'WAIT'});return result;});
   assert.equal(scene.ok,true,JSON.stringify(scene));
   await page.waitForSelector('.dialog-death');
   if(dismiss==='close')await page.click('.dialog-death [data-action="close"]');else await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>window.__cotw.position()),null);
   assert.equal(await storage(),before,'death dismissal must not overwrite saves');
   await page.click('[data-action="new-game"]');assert.ok(await page.$('[data-field="name"]'));
   await page.keyboard.press('Escape');
   await page.click('[data-action="load-game"]');const input=await page.waitForSelector('.save-dialog input[type="file"]');await input!.uploadFile(file);
   await page.waitForFunction(()=>window.__cotw.position()!==null);
  }
  assertNoPageErrors(errors);console.log(JSON.stringify({part,synthetic:true,terminalStairsRepaired:true,returnStairsWork:true,deathDismissalUsable:true,savesPreserved:true}));
  await page.close();
 }
});
