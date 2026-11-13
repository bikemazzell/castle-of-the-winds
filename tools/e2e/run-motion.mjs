import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
const browser = await puppeteer.launch({executablePath:'/usr/bin/brave-browser-stable',headless:true,args:['--no-sandbox']});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try {
  const page=await browser.newPage();
  await page.setViewport({width:1280,height:800});
  await page.goto(process.env.COTW_GRAPHICS_URL||'http://127.0.0.1:5176');
  await page.evaluate(()=>{window.__cotw.newGame(42);document.querySelector('[data-action="skip-story"]')?.click();document.querySelector('[data-action="hint-skip"]')?.click();});
  await wait(350);
  await page.evaluate(()=>{
    window.__motionFrames=[];
    const draw=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(...args){
      if(this.canvas.matches('.map canvas'))window.__lastActor={x:args[1],y:args[2]};
      return draw.apply(this,args);
    };
    function sample(t){window.__motionFrames.push({t,camera:window.__cotw.camera(),actor:window.__lastActor});window.__motionRaf=requestAnimationFrame(sample);}
    window.__motionRaf=requestAnimationFrame(sample);
  });
  const start=await page.evaluate(()=>window.__cotw.position());
  for(let n=0;n<3;n++){await page.keyboard.press('ArrowRight');await wait(75);}
  await wait(220);
  const result=await page.evaluate(()=>{cancelAnimationFrame(window.__motionRaf);return {frames:window.__motionFrames,end:window.__cotw.position()};});
  assert.equal(result.end.x,start.x+3,'three real steps accepted');
  const frames=result.frames.filter(f=>f.actor&&f.camera);
  assert.ok(frames.length>10);
  const xs=new Set(frames.map(f=>f.actor.x));
  assert.ok(xs.size>8,'hero draws intermediate positions');
  for(let i=1;i<frames.length;i++){
    const a=frames[i-1],b=frames[i];
    if(b.t-a.t>40)continue;
    assert.ok(Math.abs(b.actor.x-a.actor.x)<b.camera.tile*.7,'no tile-sized hero jumps');
    assert.ok(Math.abs(b.camera.originX-a.camera.originX)<.7,'no tile-sized camera jumps');
  }
  console.log(JSON.stringify({frames:frames.length,distinctHeroPositions:xs.size,start,end:result.end}));
} finally {await browser.close();}
