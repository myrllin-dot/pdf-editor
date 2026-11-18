import puppeteer from 'puppeteer-core';
const OUT = process.env.OUT || './out';
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server']});
const page=await b.newPage(); await page.setViewport({width:1500,height:980});
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,200)));
page.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,160));});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await page.goto('http://127.0.0.1:8777/index.html',{waitUntil:'networkidle2'});
await (await page.$('#file-input')).uploadFile(`${OUT}/blank620.pdf`);
await sleep(2200);
const rect=await page.evaluate(()=>{const r=document.getElementById('overlay-canvas').getBoundingClientRect();return{x:r.left,y:r.top,w:r.width,h:r.height};});

// shortcut remap: A should now be 加字
await page.keyboard.press('a'); await sleep(150);
console.log('A ->', await page.evaluate(()=>document.querySelector('.tool.active')?.dataset.tool));
await page.keyboard.press('w'); await sleep(150);
console.log('W ->', await page.evaluate(()=>document.querySelector('.tool.active')?.dataset.tool));
await page.keyboard.press('v'); await sleep(150);
console.log('V ->', await page.evaluate(()=>document.querySelector('.tool.active')?.dataset.tool));

// guides on via G
await page.keyboard.press('g'); await sleep(400);
console.log('G -> guides on:', await page.evaluate(async()=>(await import('/js/guides.js')).guides.on),
            '| modal open:', await page.evaluate(()=>!document.getElementById('guides-modal').hidden));
if (await page.evaluate(()=>!document.getElementById('guides-modal').hidden)) { await page.click('#gd-close'); await sleep(200); }

// place text -> selection bar should appear with centre + size
await page.keyboard.press('a'); await sleep(150);
await page.mouse.click(rect.x+150, rect.y+200); await sleep(400);
await page.keyboard.type('Bar test');
await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
await sleep(500);
console.log('sel-bar:', JSON.stringify(await page.evaluate(()=>{
  const b=document.getElementById('sel-bar');
  return {shown:!b.hidden, size:document.getElementById('sb-size').value,
          sizeRowShown:!document.getElementById('sb-size-text').hidden,
          depth:document.getElementById('sb-depth').textContent};})));

// centre horizontally
await page.click('[data-center="h"]'); await sleep(300);
console.log('after centre-h:', await page.evaluate(async()=>{
  const {state}=await import('/js/state.js');
  const {annotScreenBox}=await import('/js/overlay.js');
  const t=state.annots.find(a=>a.type==='text');
  const bx=annotScreenBox(t,state.viewport);
  return `box centre ${Math.round(bx.x+bx.w/2)} vs page centre ${Math.round(state.viewport.width/2)}`;}));

// opacity + layers
await page.evaluate(()=>{const o=document.getElementById('sb-opacity');o.value=40;o.dispatchEvent(new Event('input',{bubbles:true}));});
await sleep(250);
await page.keyboard.press('r'); await sleep(100);
await page.mouse.move(rect.x+300,rect.y+400); await page.mouse.down();
await page.mouse.move(rect.x+480,rect.y+520); await page.mouse.up(); await sleep(300);
await page.keyboard.down('Alt'); await page.keyboard.press('BracketLeft'); await page.keyboard.up('Alt'); await sleep(300);
console.log('after send-to-back:', await page.evaluate(async()=>{
  const {state}=await import('/js/state.js');
  return state.annots.map(a=>`${a.type}:${(a.opacity??1).toFixed(2)}`).join(' , ');}));

await page.screenshot({path:`${OUT}/v3-ui.png`});
console.log('errors:', errs.length?errs.slice(0,3).join(' | '):'(none)');
await b.close();
