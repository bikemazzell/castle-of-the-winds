/** Debug-assisted trap acceptance. Imported floor, traps, mana and dexterity
 * isolate discovery/rendering; this does not test natural dungeon balance.
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'puppeteer-core';
import type { CotwHooks } from '../../src/app/devtools';
import { newWorld, loadWorldData } from '../../src/engine/game';
import { serializeGame, deserializeGame, b64ToBytes, type SaveFile } from '../../src/engine/save';
import { idx } from '../../src/engine/map';
import { TILE_FLOOR } from '../../src/engine/dungeon';
import { slotKey } from '../../src/app/saves/manager';
import { launchBrave, ensureVite, newPage } from './brave';
import { runWith, screenshot, collectPageErrors, assertNoPageErrors } from './helpers';

declare global { interface Window { __cotw: CotwHooks } }

async function frame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function litPixels(page: Page, x: number, y: number): Promise<number> {
  await frame(page);
  return page.evaluate((x,y) => {
    const canvas=document.querySelector('canvas')!;
    const camera=window.__cotw.camera()!;
    const context=canvas.getContext('2d')!;
    const pixels=context.getImageData(Math.round((x-camera.originX)*camera.tile),Math.round((y-camera.originY)*camera.tile),Math.floor(camera.tile),Math.floor(camera.tile)).data;
    let bright=0;
    for(let i=0;i<pixels.length;i+=4) if(Math.max(pixels[i]!,pixels[i+1]!,pixels[i+2]!)>40) bright++;
    return bright;
  },x,y);
}
async function saveSnapshot(page: Page): Promise<SaveFile> {
  await page.click('[data-action="pause"]');await page.click('[data-pause-action="save"]');
  await page.click('.modal-overlay [data-action="save"]');
  await page.click('.save-dialog [data-slot-id="0"] [data-action="save-here"]');
  const overwrite=await page.$('[data-action="save-confirm"]');if(overwrite)await overwrite.click();
  await page.waitForFunction(()=>!document.querySelector('.modal-overlay'));
  return JSON.parse(await page.evaluate(key=>localStorage.getItem(key)!,slotKey(0,1))) as SaveFile;
}

await runWith([],async close=>{
  const folder=await mkdtemp(join(tmpdir(),'cotw-traps-'));close(()=>rm(folder,{recursive:true,force:true}));
  const browser=await launchBrave(console.error);close(()=>browser.close());
  const server=await ensureVite(console.error);close(()=>server.stop());
  const page=await newPage(browser.browser,server.url);
  await page.setViewport({width:1280,height:900,deviceScaleFactor:1});
  const {errors}=collectPageErrors(page);
  // Disable Vite live reload only, so another agent's coverage output cannot reset the test.
  await page.setRequestInterception(true);
  page.on('request',request=>{
    if(new URL(request.url()).pathname==='/@vite/client')void request.respond({status:200,contentType:'application/javascript',body:`export const createHotContext=()=>({accept(){},dispose(){},prune(){},on(){},invalidate(){},data:{}});export function updateStyle(id,content){const s=document.createElement('style');s.textContent=content;document.head.append(s);}export function removeStyle(){}`});
    else void request.continue();
  });
  await page.evaluate(()=>{localStorage.clear();localStorage.setItem('cotw.onboarding',JSON.stringify({skipped:true,done:[]}));localStorage.setItem('cotw.preferences',JSON.stringify({reduceMotion:'on',chatter:false}));});
  await page.reload({waitUntil:'load'});
  const world=newWorld({part:1,worldSeed:71,player:{name:'Trap Review',gender:'female',strength:50,intelligence:50,constitution:50,dexterity:50,difficulty:'intermediate'}});
  world.questState!.pending=[];
  const detect=Object.values(loadWorldData(1).spells).find(s=>s.effect==='detect_traps')!;
  Object.assign(world.player,{dexterity:100,x:10,y:10,hp:60,maxHp:60,mana:30,maxMana:30,knownSpells:[detect.id]});
  const level=world.levels.get(0)!;level.entities.clear();level.occupancy.fill(0);level.props=[];
  world.seen.get(0)!.fill(0);
  for(let y=7;y<=14;y++)for(let x=7;x<=16;x++){level.tiles[idx(x,y)]=TILE_FLOOR;level.flags[idx(x,y)]=0;}
  level.traps=[{id:'near-pit',kind:'pit',x:11,y:10,known:false},{id:'far-dart',kind:'dart',x:14,y:10,known:false},{id:'far-fire',kind:'fire',x:14,y:11,known:false}];
  const fixture=serializeGame(world);deserializeGame(fixture,world.data);
  const file=join(folder,'traps.json');await writeFile(file,JSON.stringify(fixture));
  await page.click('[data-action="load-game"]');const upload=await page.waitForSelector('.save-dialog input[type="file"]');await upload!.uploadFile(file);
  await page.waitForFunction(()=>window.__cotw.position()!==null);
  assert.equal(await litPixels(page,14,10),0,'hidden trap must not draw through fog');
  await screenshot(page,'docs/e2e/traps-hidden.png');

  const hp=await page.evaluate(()=>window.__cotw.hp());
  await page.keyboard.press('ArrowRight');
  assert.ok(await page.evaluate(()=>window.__cotw.hp())<hp,'unknown pit triggers');
  await page.keyboard.press('ArrowLeft');
  let save=await saveSnapshot(page);
  assert.equal(save.levels['0']!.traps.find(t=>t.id==='near-pit')!.known,true);
  await screenshot(page,'docs/e2e/traps-triggered.png');

  await page.keyboard.press('c');await page.click(`[data-spell="${detect.id}"] [data-action="cast"]`);
  assert.ok(await litPixels(page,14,10)>25,'Detect Traps must draw the known dart marker even outside visible terrain');
  assert.ok(await litPixels(page,14,11)>25,'Detect Traps must draw the known fire marker even outside visible terrain');
  await screenshot(page,'docs/e2e/traps-detected.png');
  save=await saveSnapshot(page);
  assert.ok(save.levels['0']!.traps.every(t=>t.known));
  assert.equal(b64ToBytes(save.levels['0']!.seenB64)[idx(14,10)],0,'detection must not reveal terrain');

  await page.click('.dock [data-action="actions"]');await page.click('[data-action="disarm"]');
  assert.ok(await page.evaluate(()=>window.__cotw.log().some(line=>line.includes('You disarmed the trap.'))));
  if (await page.$('.modal-overlay')) {
    assert.match(await page.$eval('.dialog-title',el=>el.textContent??''),/Level Up/);
    await page.click('.modal-overlay [data-action="close"]');
  }
  const paletteTurn=await page.evaluate(()=>window.__cotw.turn());
  await frame(page);
  await page.click('.action-palette [data-action="wait"]');
  await page.waitForFunction(turn=>window.__cotw.turn()===turn+1,{},paletteTurn);
  await frame(page);
  await page.click('.action-palette [data-action="search"]');
  assert.equal(await page.evaluate(()=>window.__cotw.turn()),paletteTurn+2);
  assert.equal(await page.$eval('.action-palette',el=>(el as HTMLElement).hidden),false);
  assert.equal(await page.$('.dock [data-action="wait"]'),null,'Wait belongs only in Actions');
  assert.equal(await page.$('.modal-overlay'),null,'Actions must not block the map');
  await screenshot(page,'docs/e2e/traps-actions-desktop.png');
  await page.setViewport({width:390,height:844,deviceScaleFactor:1});
  await frame(page);
  const zoom=await page.evaluate(()=>window.__cotw.camera()!.zoomIndex);
  await page.click('.map-controls [data-action="zoom-out"]');
  await frame(page);
  assert.ok(await page.evaluate(()=>window.__cotw.camera()!.zoomIndex)<zoom,'map zoom works with Actions open');
  assert.equal(await page.$eval('.action-palette',el=>(el as HTMLElement).hidden),false);
  assert.equal(await page.evaluate(()=>window.__cotw.turn()),paletteTurn+2,'zoom spends no turn');
  await screenshot(page,'docs/e2e/traps-actions-mobile.png');
  await page.click('[data-palette-close]');
  await page.setViewport({width:1280,height:900,deviceScaleFactor:1});
  await frame(page);
  save=await saveSnapshot(page);
  assert.equal(save.levels['0']!.traps.some(t=>t.id==='near-pit'),false,'disarmed trap removed');
  assert.equal(save.levels['0']!.traps.length,2);
  await page.reload({waitUntil:'load'});await page.click('[data-action="continue"]');
  await page.waitForFunction(()=>window.__cotw.position()!==null);
  assert.ok(await litPixels(page,14,10)>25,'known trap marker survives reload');
  assert.ok(await litPixels(page,14,11)>25);
  await screenshot(page,'docs/e2e/traps-restored.png');
  const restored=await saveSnapshot(page);
  assert.deepEqual(restored.levels['0']!.traps,save.levels['0']!.traps);
  assert.equal(b64ToBytes(restored.levels['0']!.seenB64)[idx(14,10)],0);
  assertNoPageErrors(errors);
  console.log(JSON.stringify({part:1,assisted:true,hiddenTrapsInvisible:true,triggerPersists:true,detectMarkersInFog:true,noTerrainLeak:true,disarmViaActions:true,persistentActionsDesktopMobile:true,reloadPersists:true,screenshots:'docs/e2e/traps-*.png'}));
});
