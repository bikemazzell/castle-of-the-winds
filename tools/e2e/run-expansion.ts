/** Debug-assisted acceptance, not a progression or balance test.
 * Real fresh-game UI in both parts; imported fixtures add funds, positioning,
 * items, a sleeping foe, traveler, and prop. Purchases, shots, spell targeting,
 * interactions, use, and save/reload run through the shipped controller/UI.
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'puppeteer-core';
import type { CotwHooks } from '../../src/app/devtools';
import { newWorld, loadWorldData } from '../../src/engine/game';
import { serializeGame, deserializeGame, type SaveFile } from '../../src/engine/save';
import { pickup, equip } from '../../src/engine/inventory';
import { spawnMonsterState } from '../../src/engine/combat';
import { MSLCG } from '../../src/engine/rng';
import { idx } from '../../src/engine/map';
import { TILE_FLOOR, FLAG_ROOM } from '../../src/engine/dungeon';
import { loadTownShops } from '../../src/app/scenes/town';
import { slotKey } from '../../src/app/saves/manager';
import { launchBrave, ensureVite, newPage } from './brave';
import { runWith, screenshot, collectPageErrors, assertNoPageErrors } from './helpers';

declare global { interface Window { __cotw: CotwHooks } }

async function drainStory(page: Page): Promise<void> {
  for (let n = 0; n < 40; n++) {
    const next = await page.$('.story-overlay [data-action="continue"]');
    if (!next) break;
    await next.click();
  }
  assert.equal(await page.$('.story-overlay'), null);
}
async function loadFixture(page: Page, file: string, part: 1 | 2): Promise<void> {
  await page.reload({waitUntil:'load'});
  await page.click(`[data-part="${part}"]`);
  await page.click('[data-action="load-game"]');
  const upload = await page.waitForSelector('.save-dialog input[type="file"]');
  await upload!.uploadFile(file);
  await page.waitForFunction(() => window.__cotw.position() !== null);
  await drainStory(page);
}
async function saveSnapshot(page: Page, part: 1 | 2): Promise<SaveFile> {
  await page.click('[data-action="pause"]');
  await page.click('[data-pause-action="save"]');
  await page.click('.modal-overlay [data-action="save"]');
  await page.click('.save-dialog [data-slot-id="0"] [data-action="save-here"]');
  const overwrite = await page.$('[data-action="save-confirm"]');
  if (overwrite) await overwrite.click();
  await page.waitForFunction(() => !document.querySelector('.modal-overlay'));
  return JSON.parse(await page.evaluate(key => localStorage.getItem(key)!, slotKey(0,part))) as SaveFile;
}
async function mapPoint(page: Page, x: number, y: number): Promise<{x:number;y:number}> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return page.evaluate((x,y) => {
    const camera=window.__cotw.camera()!;
    const rect=document.querySelector('canvas')!.getBoundingClientRect();
    return {x:rect.left+(x-camera.originX+0.5)*camera.tile,y:rect.top+(y-camera.originY+0.5)*camera.tile};
  },x,y);
}
async function useItem(page: Page, uid: string): Promise<void> {
  await page.keyboard.press('i');
  await page.click(`.pack-list [data-uid="${uid}"] .item-row-button`);
  await page.click('.inventory-panel [data-field="primary-action"]');
  await page.keyboard.press('Escape');
}

await runWith([], async close => {
  const folder = await mkdtemp(join(tmpdir(),'cotw-expansion-'));
  close(() => rm(folder,{recursive:true,force:true}));
  const browser = await launchBrave(console.error);
  close(() => browser.close());
  const server = await ensureVite(console.error);
  close(() => server.stop());
  for (const part of [1,2] as const) {
    const page = await newPage(browser.browser,server.url);
    // Ignore dev-server live reloads from parallel coverage runs; retain CSS injection.
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/@vite/client') void request.respond({status:200,contentType:'application/javascript',body:`export const createHotContext = () => ({accept(){},dispose(){},prune(){},on(){},invalidate(){},data:{}}); export function updateStyle(id, content) { const style=document.createElement('style');style.textContent=content;document.head.append(style); } export function removeStyle() {}`});
      else void request.continue();
    });
    await page.setViewport({width:1280,height:900,deviceScaleFactor:1});
    const {errors} = collectPageErrors(page);
    // Storage belongs only to this runner's isolated browser profile.
    await page.evaluate(() => {localStorage.clear(); localStorage.setItem('cotw.onboarding',JSON.stringify({skipped:true,done:[]}));});
    await page.reload({waitUntil:'load'});
    await page.click(`[data-part="${part}"]`);
    await page.click('[data-action="new-game"]');
    await page.type('.modal-overlay [data-field="name"]',`Expansion ${part}`);
    await page.click('.modal-overlay [data-action="begin"]');
    await drainStory(page);
    assert.ok(await page.evaluate(() => window.__cotw.position() !== null));

    const world = newWorld({part,worldSeed:71,player:{name:`Expansion ${part}`,gender:'female',strength:50,intelligence:50,constitution:50,dexterity:50,difficulty:'intermediate'}});
    world.questState!.pending = [];
    world.inventory.gold = 1000; // ASSISTED shopping budget and door positioning.
    const town = loadTownShops(part);
    const shop = Object.values(town.shops).find(s => s.kind === 'weapons')!;
    Object.assign(world.player,town.buildings.find(b => b.shopId === shop.id)!.door);
    const file = join(folder,`part-${part}.json`);
    await writeFile(file,JSON.stringify(serializeGame(world)));
    await loadFixture(page,file,part);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.merchant-buy-list');
    for (const id of ['x-bow','x-arrow','x-crossbow','x-bolt','x-hand-cannon','x-cannonball']) {
      assert.ok(await page.$(`[data-def-id="${id}"]`),`part ${part} catalog missing ${id}`);
    }
    for (const id of ['x-bow','x-arrow']) {
      await page.click(`[data-def-id="${id}"] .item-row-button`);
      if (id === 'x-arrow') {
        await page.click('[data-action="quantity-plus"]');
        assert.equal(await page.$eval('[data-field="buy-quantity"]', el => (el as HTMLInputElement).value), '2');
        await page.click('[data-action="quantity-minus"]');
        assert.equal(await page.$eval('[data-field="buy-quantity"]', el => (el as HTMLInputElement).value), '1');
        await page.click('[data-field="buy-quantity"]');
        await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
        await page.type('[data-field="buy-quantity"]', '20');
        assert.match(await page.$eval('[data-field="primary-action"]', el => el.textContent), /240 Gold/);
        await screenshot(page,`docs/e2e/expansion-part${part}-quantity.png`);
      }
      await page.click('.merchant-panel [data-field="primary-action"]');
      await page.waitForFunction(() => document.querySelector('.merchant-receipt')?.textContent?.includes('Purchased'));
    }
    await screenshot(page,`docs/e2e/expansion-part${part}-shop.png`);
    await page.keyboard.press('Escape');
    console.log(`part ${part}: shopping complete`);
    const bought = await saveSnapshot(page,part);
    assert.equal(bought.inventory.pack.find(i => i.defId === 'x-arrow')?.count,20);
    assert.equal(bought.inventory.gold,160);

    // ASSISTED arena, preserving the purchased equipment. Not a generated room.
    const arena = deserializeGame(bought,loadWorldData(part));
    Object.assign(arena.player,{x:10,y:10,dexterity:100,hp:70,maxHp:80,mana:30,maxMana:30,knownSpells:['x-bedtime']});
    const level = arena.levels.get(0)!;
    level.entities.clear(); level.occupancy.fill(0); level.props = [];
    for (let y=7;y<=14;y++) for(let x=7;x<=15;x++) {level.tiles[idx(x,y)]=TILE_FLOOR;level.flags[idx(x,y)]=FLAG_ROOM;}
    arena.rng = new MSLCG(42); // Fixed hit roll for the assisted shot assertion.
    const bow = arena.inventory.pack.find(i => i.defId === 'x-bow')!;
    equip(arena.inventory,arena.player,bow.uid,arena.data.items);
    const monster = spawnMonsterState('Kobold');
    monster.hp=30;monster.maxHp=40;monster.stats.maxHp=40;monster.sleepTurns=100;monster.slowDenominator=100;
    level.entities.set(240,{id:240,kind:'monster',name:'Kobold',x:13,y:10,monster});level.occupancy[idx(13,10)]=240;
    level.entities.set(241,{id:241,kind:'npc',name:'Mara the Wayfarer',x:10,y:11,npc:{role:'traveler',giftClaimed:false,stock:[]}});level.occupancy[idx(10,11)]=241;
    level.props=[{id:'acceptance-bones',kind:'bones',x:10,y:9,exhausted:false}];
    const mead=pickup(arena.inventory,arena.player,'x-mead',arena.data.items);
    const dye=pickup(arena.inventory,arena.player,'x-dye-purple',arena.data.items);
    const polish=pickup(arena.inventory,arena.player,'x-polish-gold',arena.data.items);
    const helmDef=Object.values(arena.data.items).find(d=>d.slot==='helm')!;
    const helm=pickup(arena.inventory,arena.player,helmDef.id,arena.data.items);equip(arena.inventory,arena.player,helm.uid,arena.data.items);
    deserializeGame(serializeGame(arena),loadWorldData(part));
    await writeFile(file,JSON.stringify(serializeGame(arena)));
    await loadFixture(page,file,part);
    console.log(`part ${part}: arena loaded`);
    await page.keyboard.press('f');
    await page.click('[data-ranged]');
    const before=await page.evaluate(()=>window.__cotw.turn());
    const aim=await mapPoint(page,13,10);
    await page.mouse.move(aim.x,aim.y);
    await page.waitForFunction(()=>window.__cotw.targeting().cell?.x===13);
    await screenshot(page,`docs/e2e/expansion-part${part}-aim-healthbars.png`);
    { const target=await mapPoint(page,13,10); await page.mouse.click(target.x,target.y); }
    assert.equal(await page.evaluate(()=>window.__cotw.turn()),before+1);
    assert.equal(await page.evaluate(()=>window.__cotw.targeting().active),false);
    await page.keyboard.press('c');
    await screenshot(page,`docs/e2e/expansion-part${part}-spellbook.png`);
    await page.click('[data-spell="x-bedtime"] [data-action="cast"]');
    assert.equal(await page.evaluate(()=>window.__cotw.targeting().active),true);
    const manaBefore=await page.evaluate(()=>window.__cotw.mana());
    { const target=await mapPoint(page,13,10); await page.mouse.click(target.x,target.y); }
    assert.equal(await page.evaluate(()=>window.__cotw.targeting().active),false);
    assert.ok(await page.evaluate(()=>window.__cotw.mana())<manaBefore);
    await page.keyboard.press('c');
    await page.click('[data-spell="x-bedtime"] [data-action="cast"]');
    await page.keyboard.press('ArrowRight');
    await page.focus('[data-action="cast-target"]');
    const keyboardTurn=await page.evaluate(()=>window.__cotw.turn());
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>window.__cotw.turn()),keyboardTurn+1,'focused target button casts exactly once');
    assert.equal(await page.evaluate(()=>window.__cotw.targeting().active),false);
    await page.click('[data-action="actions"]');
    const talkTurn=await page.evaluate(()=>window.__cotw.turn());
    const talkPosition=await page.evaluate(()=>window.__cotw.position());
    await page.keyboard.press('t');
    await page.waitForSelector('.interaction-bar');
    assert.equal(await page.$('.modal-overlay'),null);
    await screenshot(page,`docs/e2e/expansion-part${part}-interact.png`);
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.interaction-bar'),null);
    assert.equal(await page.evaluate(()=>window.__cotw.turn()),talkTurn);
    assert.equal(await page.$eval('.action-palette', el => (el as HTMLElement).hidden),false);
    await page.click('.action-palette [data-action="interact"]');await page.keyboard.press('s');
    assert.equal(await page.$eval('.action-palette', el => (el as HTMLElement).hidden),false);
    assert.equal(await page.$('.modal-overlay'),null);
    assert.deepEqual(await page.evaluate(()=>window.__cotw.position()),talkPosition);
    assert.equal(await page.evaluate(()=>window.__cotw.turn()),talkTurn+1);
    await page.keyboard.press('t');
    { const target=await mapPoint(page,10,11); await page.mouse.click(target.x,target.y); }
    assert.equal(await page.$('.interaction-bar'),null);
    assert.equal(await page.$('.modal-overlay'),null);
    await page.keyboard.press('x');await page.keyboard.press('x');
    await useItem(page,mead.uid);await useItem(page,dye.uid);await useItem(page,polish.uid);
    const saved=await saveSnapshot(page,part);
    assert.ok(saved.levels['0']!.entities.find(e=>e.id===240)!.monster!.hp < 30,'ranged shot damages the foe');
    assert.equal(saved.inventory.gold,bought.inventory.gold+3,'traveler pays once');
    assert.equal(saved.inventory.pack.find(i=>i.defId==='x-arrow')?.count,19,'shot spends one arrow');
    assert.equal(saved.inventory.pack.find(i=>i.defId==='x-bone')?.count,1,'search salvage is finite');
    assert.equal(saved.levels['0']!.props!.find(p=>p.id==='acceptance-bones')!.exhausted,true);
    assert.equal(saved.player.underwearColor,'purple');assert.equal(saved.inventory.equipment.helm?.color,'gold');
    assert.ok(saved.player.statuses.some(s=>s.kind==='drunken'));
    await page.reload({waitUntil:'load'});await page.click(`[data-part="${part}"]`);await page.click('[data-action="continue"]');
    await page.waitForFunction(()=>window.__cotw.position()!==null);
    await screenshot(page,`docs/e2e/expansion-part${part}-restored.png`);
    await page.click('[data-action="actions"]');
    assert.equal(await page.$eval('.action-palette', el => (el as HTMLElement).hidden),false);
    await page.click('.action-palette [data-action="interact"]');await page.keyboard.press('s');
    assert.equal(await page.$eval('.action-palette', el => (el as HTMLElement).hidden),false);await page.keyboard.press('x');
    const reloaded=await saveSnapshot(page,part);
    assert.equal(reloaded.inventory.gold,saved.inventory.gold);assert.equal(reloaded.inventory.pack.find(i=>i.defId==='x-bone')?.count,1);
    assert.equal(reloaded.player.underwearColor,'purple');assert.equal(reloaded.inventory.equipment.helm?.color,'gold');
    assert.ok(reloaded.player.statuses.some(s=>s.kind==='drunken'));
    assertNoPageErrors(errors);
    console.log(JSON.stringify({part,assisted:true,freshGame:true,catalogPurchases:true,ranged:true,oneClickSpell:true,focusedKeyboardCast:true,finiteRewardsAcrossReload:true,colorsAndEffectsReload:true,screenshots:`docs/e2e/expansion-part${part}-*.png`}));
    await page.close();
  }
});
