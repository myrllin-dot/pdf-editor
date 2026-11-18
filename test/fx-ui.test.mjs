import puppeteer from 'puppeteer-core';
const OUT = process.env.OUT || './out';
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server']});
const page=await b.newPage(); await page.setViewport({width:1500,height:980});
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,200)));
page.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,160));});
const cdp=await page.target().createCDPSession();
await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:`${OUT}/dl5`});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await page.goto('http://127.0.0.1:8777/index.html',{waitUntil:'networkidle2'});
await (await page.$('#file-input')).uploadFile(`${OUT}/blank620.pdf`);
await sleep(2200);

const rect=await page.evaluate(()=>{const r=document.getElementById('overlay-canvas').getBoundingClientRect();return{x:r.left,y:r.top};});

// place a text box
await page.click('[data-tool="textbox"]');
await page.mouse.click(rect.x+120, rect.y+120); await sleep(500);
await page.keyboard.type('Style Test 樣式');
await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
await sleep(500);

// it stays selected -> style controls should now edit it
await page.evaluate(()=>{document.getElementById('size-range').value=38;
  document.getElementById('size-range').dispatchEvent(new Event('input',{bubbles:true}));});
await page.click('#st-bold'); await sleep(150);
await page.click('#st-italic'); await sleep(150);
await page.click('#st-underline'); await sleep(150);
await page.evaluate(()=>{const t=document.getElementById('tracking-range');t.value=5;t.dispatchEvent(new Event('input',{bubbles:true}));});
await page.select('#fx-type','outline'); await sleep(200);
await page.evaluate(()=>{const c=document.getElementById('fx-color');c.value='#d81b60';c.dispatchEvent(new Event('input',{bubbles:true}));});
await sleep(400);

const a = await page.evaluate(async()=>{
  const {state}=await import('/js/state.js');
  const t=state.annots.find(x=>x.type==='text');
  return {size:t.size,bold:t.bold,italic:t.italic,underline:t.underline,
          ls:t.letterSpacing,fx:t.effect,align:t.align,anchor:t.anchor};
});
console.log('annotation after styling:', JSON.stringify(a));
console.log('controls reflect it:', JSON.stringify(await page.evaluate(()=>({
  bold:document.getElementById('st-bold').classList.contains('on'),
  italic:document.getElementById('st-italic').classList.contains('on'),
  fxShown:!document.getElementById('fx-opts').hidden}))));

// undo should roll back one style change
await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
await sleep(300);
console.log('after undo, fx color:', await page.evaluate(async()=>{
  const {state}=await import('/js/state.js');
  return state.annots.find(x=>x.type==='text')?.effect?.color;}));

await page.screenshot({path:`${OUT}/fx-ui.png`});
await page.click('#btn-save'); await sleep(3500);
console.log('errors:', errs.length?errs.slice(0,3).join(' | '):'(none)');
await b.close();
