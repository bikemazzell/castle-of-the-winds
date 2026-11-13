import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {newWorld} from '../../src/engine/game';
import {serializeGame} from '../../src/engine/save';
import {launchBrave,ensurePreview,newPage} from './brave';

const browser=await launchBrave(console.error);
const folder=await mkdtemp(join(tmpdir(),'cotw-release-'));
let stop:(()=>Promise<void>)|undefined;
try {
 let url=process.env.COTW_RELEASE_URL;
 if(!url){const server=await ensurePreview(console.error);url=server.url;stop=()=>server.stop();}
 const page=await newPage(browser.browser,url);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 const file=join(folder,'backup.cotwsave.json');
 const world=newWorld({worldSeed:42,part:1,player:{name:'Backup Hero',gender:'female',strength:50,intelligence:50,constitution:50,dexterity:50,difficulty:'intermediate'}});
 world.questState!.pending=[];
 await writeFile(file,JSON.stringify(serializeGame(world)));
 await page.waitForSelector('[data-action="load-game"]');
 await page.click('[data-action="load-game"]');
 const upload=await page.waitForSelector('.save-dialog input[type="file"]');await upload!.uploadFile(file);
 await page.waitForFunction(()=>document.querySelector('header.hud [data-field="name"]')?.textContent==='Backup Hero');
 await page.click('[data-action="pause"]');await page.click('[data-pause-action="quit"]');
 await page.waitForSelector('[data-action="quit-without"]');await page.click('[data-action="quit-without"]');
 await page.click('[data-part="2"]');await page.click('[data-action="new-game"]');
 await page.click('[data-action="import-p1"]');
 const p2upload=await page.waitForSelector('.save-dialog input[type="file"]');await p2upload!.uploadFile(file);
 await page.waitForFunction(()=>document.querySelector('header.hud [data-field="name"]')?.textContent==='Backup Hero');
 for(let n=0;n<30;n++) {const next=await page.$('.story-overlay [data-action="continue"]');if(!next)break;await next.click();}
 await page.waitForFunction(()=>!document.querySelector('.story-overlay'));
 await page.click('[data-action="pause"]');await page.click('[data-pause-action="help"]');await page.click('[data-htab="manual"]');
 const manual=await page.$eval('[data-panel="manual"]',el=>el.textContent??'');assert.ok(manual.includes('The Story So Far'));
 await page.keyboard.press('Escape');
 const colors=await page.$eval('.map canvas',el=>{const canvas=el,ctx=canvas.getContext('2d')!;return new Set(ctx.getImageData(0,0,canvas.width,canvas.height).data).size;});
 assert.ok(colors>20,'game artwork renders');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({url,backupImport:true,part2Import:true,unsavedWarning:true,part2Manual:true,artwork:true,errors}));
} finally {
 await browser.close();await stop?.();await rm(folder,{recursive:true,force:true});
}
