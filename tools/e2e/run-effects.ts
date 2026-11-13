/** Assisted browser acceptance for optional swearing, gore, and creature sizing.
 * Imported fixtures set low HP, three harmless sleeping foes, and safe pits.
 * This tests rendering and option behavior, not normal campaign balance.
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'puppeteer-core';
import type { CotwHooks } from '../../src/app/devtools';
import { newWorld } from '../../src/engine/game';
import { serializeGame, deserializeGame } from '../../src/engine/save';
import { spawnMonsterState } from '../../src/engine/combat';
import { curseLine } from '../../src/engine/curses';
import { garbleSpeech } from '../../src/engine/injured-speech';
import { idx } from '../../src/engine/map';
import { TILE_FLOOR, FLAG_ROOM } from '../../src/engine/dungeon';
import { creatureAppearance } from '../../src/app/render/creature-catalog';
import { launchBrave, ensureVite, newPage } from './brave';
import { runWith, screenshot, collectPageErrors, assertNoPageErrors } from './helpers';

declare global { interface Window { __cotw: CotwHooks } }
// Ordinary chatter is disabled in this fixture, so any hero speech is a curse.
const curseCount=(log:string[]):number=>log.filter(entry=>entry.startsWith('Sailor: ')).length;
async function frame(page:Page):Promise<void>{await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));}
async function options(page:Page):Promise<void>{await page.click('[data-action="pause"]');await page.click('[data-pause-action="settings"]');}
async function closeOptions(page:Page):Promise<void>{await page.keyboard.press('Escape');await frame(page);}
async function sample(page:Page,x:number,y:number,colors:string[]):Promise<{count:number;height:number}>{
  await frame(page);
  return page.evaluate((x,y,colors)=>{
    const canvas=document.querySelector('canvas')!,camera=window.__cotw.camera()!;
    const size=Math.floor(camera.tile);
    const pixels=canvas.getContext('2d')!.getImageData(Math.round((x-camera.originX)*camera.tile),Math.round((y-camera.originY)*camera.tile),size,size).data;
    let count=0,min=size,max=-1;
    for(let n=0;n<pixels.length;n+=4){
      const rgb=`#${pixels[n]!.toString(16).padStart(2,'0')}${pixels[n+1]!.toString(16).padStart(2,'0')}${pixels[n+2]!.toString(16).padStart(2,'0')}`;
      if(colors.includes(rgb)){count++;const row=Math.floor(n/4/size);min=Math.min(min,row);max=Math.max(max,row);}
    }
    return {count,height:max>=min?max-min+1:0};
  },x,y,colors);
}

await runWith([],async close=>{
  const folder=await mkdtemp(join(tmpdir(),'cotw-effects-'));close(()=>rm(folder,{recursive:true,force:true}));
  const browser=await launchBrave(console.error);close(()=>browser.close());
  const server=await ensureVite(console.error);close(()=>server.stop());
  const page=await newPage(browser.browser,server.url);await page.setViewport({width:1280,height:900,deviceScaleFactor:1});
  const {errors}=collectPageErrors(page);
  // Suppress dev-only live reloads caused by parallel coverage files, retaining styles.
  await page.setRequestInterception(true);
  page.on('request',request=>{
    if(new URL(request.url()).pathname==='/@vite/client')void request.respond({status:200,contentType:'application/javascript',body:`export const createHotContext=()=>({accept(){},dispose(){},prune(){},on(){},invalidate(){},data:{}});export function updateStyle(id,content){const s=document.createElement('style');s.textContent=content;document.head.append(s);}export function removeStyle(){}`});
    else void request.continue();
  });
  await page.evaluate(()=>{localStorage.clear();localStorage.setItem('cotw.onboarding',JSON.stringify({skipped:true,done:[]}));});
  await page.reload({waitUntil:'load'});
  const world=newWorld({part:1,worldSeed:71,player:{name:'Sailor',gender:'female',strength:50,intelligence:50,constitution:50,dexterity:50,difficulty:'intermediate'}});
  world.questState!.pending=[];Object.assign(world.player,{x:10,y:10,hp:25,maxHp:80});
  const level=world.levels.get(0)!;level.entities.clear();level.occupancy.fill(0);level.props=[];
  for(let y=6;y<=14;y++)for(let x=6;x<=16;x++){level.tiles[idx(x,y)]=TILE_FLOOR;level.flags[idx(x,y)]=FLAG_ROOM;}
  const creatures=[{name:'Giant Rat',x:8,y:10},{name:'Orc',x:10,y:11},{name:'Ancient Red Dragon',x:13,y:11}];
  for(const [n,creature] of creatures.entries()){
    const id=240+n,monster=spawnMonsterState(creature.name);
    monster.hp=Math.max(1,Math.floor(monster.maxHp*0.75));monster.sleepTurns=1000;
    level.entities.set(id,{...creature,id,kind:'monster',monster});level.occupancy[idx(creature.x,creature.y)]=id;
  }
  level.traps=[{id:'default-off',kind:'pit',x:10,y:9,known:false},{id:'enabled',kind:'pit',x:12,y:10,known:false},{id:'disabled',kind:'pit',x:14,y:9,known:false}];
  const fixture=serializeGame(world);deserializeGame(fixture,world.data);
  const file=join(folder,'effects.json');await writeFile(file,JSON.stringify(fixture));
  await page.click('[data-action="load-game"]');const upload=await page.waitForSelector('.save-dialog input[type="file"]');await upload!.uploadFile(file);
  await page.waitForFunction(()=>window.__cotw.position()!==null);
  await options(page);
  assert.equal(await page.$eval('[data-option="curses"]',el=>(el as HTMLInputElement).checked),false,'Curses defaults off');
  assert.equal(await page.$eval('[data-option="blood"]',el=>(el as HTMLInputElement).checked),true);
  await page.click('[data-reduce-motion="on"]');
  await page.click('[data-option="chatter"]');
  await closeOptions(page);
  const heights:number[]=[];
  for(const creature of creatures)heights.push((await sample(page,creature.x,creature.y,[creatureAppearance(creature.name).color])).height);
  assert.ok(heights[0]!>0 && heights[0]!<heights[1]! && heights[1]!<heights[2]!,`visible size order rat < orc < dragon: ${heights.join(',')}`);
  assert.ok((await sample(page,10,11,['#80b879'])).count>40,'orc health bar remains visible directly below hero');
  await screenshot(page,'docs/e2e/effects-creature-sizes.png');

  await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowDown');
  assert.equal(curseCount(await page.evaluate(()=>window.__cotw.log())),0,'default-off trap hit has no swearing');
  await options(page);await page.click('[data-option="curses"]');await closeOptions(page);
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  const enabledLog=await page.evaluate(()=>window.__cotw.log());
  const injuredHp=await page.evaluate(()=>window.__cotw.hp());
  const clearTrap=curseLine(world.worldSeed,0,'trap',world.player.name);
  const injuredTrap=garbleSpeech(clearTrap,injuredHp,world.player.maxHp,world.worldSeed,0);
  assert.notEqual(injuredTrap,clearTrap,'low HP must visibly corrupt the expected trap curse');
  assert.ok(injuredTrap.startsWith('Sailor: '),'injury leaves the speaker name clear');
  assert.ok(enabledLog.includes(injuredTrap),`enabled trap hit adds the exact injury-corrupted curse: ${injuredTrap}`);
  const curses=curseCount(enabledLog);
  await screenshot(page,'docs/e2e/effects-curses-and-gore.png');
  await options(page);await page.click('[data-option="curses"]');await closeOptions(page);
  await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  assert.equal(curseCount(await page.evaluate(()=>window.__cotw.log())),curses,'turning Curses off stops new curse comments');
  const bloodColors=['#a72f36','#b83c3c','#652029'];
  const stains=(await sample(page,11,10,bloodColors)).count;
  assert.ok(stains>0,'wounded movement leaves static blood on an unoccupied trail tile with reduced motion');
  await screenshot(page,'docs/e2e/effects-blood-trail.png');
  await options(page);await page.click('[data-option="blood"]');await closeOptions(page);
  assert.equal((await sample(page,11,10,bloodColors)).count,0,'Blood off hides existing stains');
  await screenshot(page,'docs/e2e/effects-blood-disabled.png');
  // Import the same scene at full health into a fresh controller. The first
  // search comment must match the authored line exactly, with no speech damage.
  await options(page);await page.click('[data-option="curses"]');await closeOptions(page);
  world.player.hp=world.player.maxHp;
  const healthyFile=join(folder,'effects-healthy.json');
  await writeFile(healthyFile,JSON.stringify(serializeGame(world)));
  const healthyPage=await newPage(browser.browser,server.url);
  const healthyErrors=collectPageErrors(healthyPage).errors;
  await healthyPage.click('[data-action="load-game"]');
  const healthyUpload=await healthyPage.waitForSelector('.save-dialog input[type="file"]');
  await healthyUpload!.uploadFile(healthyFile);
  await healthyPage.waitForFunction(()=>window.__cotw.position()!==null);
  await healthyPage.evaluate(()=>window.__cotw.dispatch({type:'SEARCH'}));
  assert.equal(await healthyPage.evaluate(()=>window.__cotw.hp()),world.player.maxHp,'healthy speech fixture stays at full HP');
  const healthyLog=await healthyPage.evaluate(()=>window.__cotw.log());
  assert.ok(healthyLog.includes(curseLine(world.worldSeed,0,'search',world.player.name)),'full-health curse remains the exact authored line');
  assertNoPageErrors(healthyErrors);
  assertNoPageErrors(errors);
  console.log(JSON.stringify({part:1,assisted:true,cursesDefaultOff:true,cursesTrapOnAndOff:true,injuredSpeechExact:true,fullHealthSpeechClear:true,creatureHeights:heights,barVisible:true,reducedMotionTrailPixels:stains,bloodOffHidesStains:true,screenshots:'docs/e2e/effects-*.png'}));
});
