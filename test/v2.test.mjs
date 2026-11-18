import puppeteer from 'puppeteer-core';
const OUT = process.env.OUT || './out';
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server']});
const page=await b.newPage();
await page.setViewport({width:1440,height:900});
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,200)));
page.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,160));});
const cdp=await page.target().createCDPSession();
await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:`${OUT}/dl2`});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

await page.goto('http://127.0.0.1:8777/index.html',{waitUntil:'networkidle2'});
await (await page.$('#file-input')).uploadFile(`${OUT}/source.pdf`);
await sleep(2500);

// --- thumbnails ---
const th = await page.evaluate(()=>{
  const t=document.getElementById('thumbs');
  const items=[...t.querySelectorAll('.thumb')];
  return { hidden:t.hidden, count:items.length,
           active:items.findIndex(e=>e.classList.contains('active'))+1,
           painted:items.map(e=>{const c=e.querySelector('canvas');return c.width>0&&c.height>0;}) };
});
console.log('thumbs:', JSON.stringify(th));

const rect = await page.evaluate(()=>{const r=document.getElementById('overlay-canvas').getBoundingClientRect();
  return {x:r.left,y:r.top,w:r.width,h:r.height};});
console.log('canvas', Math.round(rect.w)+'x'+Math.round(rect.h));
const at=(cx,cy)=>({x:rect.x+cx,y:rect.y+cy});
const drag=async(x1,y1,x2,y2,shift=false)=>{
  let p=at(x1,y1); await page.mouse.move(p.x,p.y);
  if(shift) await page.keyboard.down('Shift');
  await page.mouse.down(); p=at(x2,y2); await page.mouse.move(p.x,p.y); await page.mouse.up();
  if(shift) await page.keyboard.up('Shift');
  await sleep(300);
};

// --- shapes ---
await page.click('[data-tool="rect"]');
await page.click('#fill-on');                       // filled rectangle
await drag(80,80,300,180);
await page.click('[data-tool="ellipse"]');
await page.click('#fill-on');                       // back to hollow
await drag(340,80,540,200);
await page.click('[data-tool="line"]');
await drag(80,240,540,300,true);                    // shift -> snapped

const annots = await page.evaluate(async()=>{
  const {state}=await import('/js/state.js');
  return state.annots.map(a=>({t:a.type,fill:a.fill||null,
    ...(a.type==='line'?{dy:+(a.y2-a.y1).toFixed(2),dx:+(a.x2-a.x1).toFixed(2)}:{}) }));
});
console.log('annots:', JSON.stringify(annots));

const thAfter = await page.evaluate(()=>{
  const e=document.querySelector('.thumb[data-page="1"]');
  return e?e.classList.contains('has-marks'):null;});
console.log('page-1 thumb marked:', thAfter);

await page.screenshot({path:`${OUT}/v2-shapes.png`});
await page.click('#btn-save');
await sleep(3500);
console.log('errors:', errs.length?errs.slice(0,3).join(' | '):'(none)');
await b.close();
