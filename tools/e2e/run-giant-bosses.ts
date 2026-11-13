/** Prepared scene: verifies presentation and real body-click targeting, not campaign balance. */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newWorld } from '../../src/engine/game';
import { serializeGame } from '../../src/engine/save';
import { spawnMonsterState } from '../../src/engine/combat';
import { idx } from '../../src/engine/map';
import { TILE_FLOOR, FLAG_ROOM } from '../../src/engine/dungeon';
import { launchBrave, ensureVite, newPage } from './brave';
import { runWith, collectPageErrors, assertNoPageErrors } from './helpers';
import type { CotwHooks } from '../../src/app/devtools';
declare global { interface Window { __cotw: CotwHooks } }
await runWith([],async close=>{
  const folder=await mkdtemp(join(tmpdir(),'cotw-giant-bosses-acceptance-'));
  const browser=await launchBrave(console.error);close(()=>browser.close());
  const server=process.env.E2E_URL?{url:process.env.E2E_URL,stop:async()=>{}}:await ensureVite(console.error);close(()=>server.stop());
  const world=newWorld({part:1,worldSeed:71,player:{name:'Giant review',gender:'female',strength:50,intelligence:50,constitution:50,dexterity:50,difficulty:'intermediate'}});
  world.questState!.pending=[];Object.assign(world.player,{x:10,y:10,hp:500,maxHp:500});
  const level=world.levels.get(0)!;level.entities.clear();level.occupancy.fill(0);level.props=[];level.traps=[];
  for(let y=2;y<=20;y++)for(let x=2;x<=20;x++){level.tiles[idx(x,y)]=TILE_FLOOR;level.flags[idx(x,y)]=FLAG_ROOM;}
  for(const [n,creature] of [{name:'Hrungnir',x:11,y:10},{name:'Evil Warrior',x:8,y:10}].entries()){
    const id=240+n,monster=spawnMonsterState(creature.name);monster.hp=monster.maxHp=500;monster.sleepTurns=1000;
    level.entities.set(id,{...creature,id,kind:'monster',monster});level.occupancy[idx(creature.x,creature.y)]=id;
  }
  const file=join(folder,'fixture.json');await writeFile(file,JSON.stringify(serializeGame(world)));
  for(const [label,width,height,touch] of [['desktop',1280,900,false],['mobile',390,844,true]] as const){
    const page=await newPage(browser.browser,server.url);const {errors}=collectPageErrors(page);
    await page.setViewport({width,height,deviceScaleFactor:1,isMobile:touch,hasTouch:touch});
    await page.evaluate(()=>{localStorage.clear();localStorage.setItem('cotw.onboarding',JSON.stringify({skipped:true,done:[]}));});await page.reload({waitUntil:'load'});
    await page.click('[data-action="load-game"]');const upload=await page.waitForSelector('.save-dialog input[type="file"]');await upload!.uploadFile(file);
    await page.waitForFunction(()=>window.__cotw.position()!==null);
    await page.click('[data-action="pause"]');await page.click('[data-pause-action="settings"]');await page.click('[data-reduce-motion="on"]');await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('.options-dialog'));
    await page.screenshot({path:join(folder,`${label}.png`)});
    const point=await page.evaluate(()=>{const cam=window.__cotw.camera()!,rect=document.querySelector('canvas')!.getBoundingClientRect();return {x:rect.left+(11.5-cam.originX)*cam.tile,y:rect.top+(11-3.2+3.2*0.5-cam.originY)*cam.tile};});
    const turn=await page.evaluate(()=>window.__cotw.turn());
    if(touch){await page.touchscreen.tap(point.x,point.y);assert.deepEqual(await page.evaluate(()=>window.__cotw.travel.state().attack),{x:11,y:10});await page.touchscreen.tap(point.x,point.y);}else await page.mouse.click(point.x,point.y);
    await page.waitForFunction((turn)=>window.__cotw.turn()>turn,{},turn);
    const log=await page.evaluate(()=>window.__cotw.log());assert.ok(log.some(line=>/hrungnir/i.test(line)),`${label}: attack log names the boss`);
    assert.deepEqual(await page.evaluate(()=>window.__cotw.position()),{x:10,y:10,level:0});
    await page.screenshot({path:join(folder,`${label}-attack.png`)});
    assertNoPageErrors(errors);await page.close();
  }
  console.log(`Giant boss acceptance passed: ${folder}`);
});
