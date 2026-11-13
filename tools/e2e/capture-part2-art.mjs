import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:'/usr/bin/brave-browser-stable',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage();await page.setViewport({width:1000,height:500});
 await page.goto(process.env.COTW_GRAPHICS_URL||'http://127.0.0.1:5176');
 await page.evaluate(async()=>{
  const {loadActorSprites,actorSpriteName}=await import('/src/app/render/actor-art.ts');
  const {default:one}=await import('/src/data/monsters.json');const {default:two}=await import('/src/data/part2/monsters.json');
  const names=new Set(one.records.map(m=>m.name));const sprites=await loadActorSprites();
  document.body.innerHTML='';document.body.style.cssText='background:#20272c;color:#e9dfc7;display:grid;grid-template-columns:repeat(5,1fr);gap:12px;padding:20px;font:12px sans-serif';
  for(const {name} of two.records.filter(m=>!names.has(m.name))){const item=document.createElement('div');item.style.textAlign='center';const c=sprites[actorSpriteName(name)];c.style.cssText='width:80px;height:80px;image-rendering:pixelated';item.append(c,document.createElement('br'),name);document.body.append(item);}
 });
 await page.screenshot({path:'/tmp/cotw-part2-art.png',fullPage:true});
} finally {await browser.close();}
