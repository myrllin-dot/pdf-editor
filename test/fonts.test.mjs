import puppeteer from 'puppeteer-core';
const OUT = process.env.OUT || './out';
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server']});
const page=await b.newPage();
await page.setViewport({width:1440,height:900});
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,200)));
page.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,160));});
const cdp=await page.target().createCDPSession();
await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:`${OUT}/dl4`});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

await page.goto('http://127.0.0.1:8777/index.html',{waitUntil:'networkidle2'});
await sleep(800);
console.log('font dropdown:', JSON.stringify(await page.evaluate(()=>
  [...document.getElementById('font-select').querySelectorAll('optgroup')].map(g=>
    ({group:g.label, opts:[...g.querySelectorAll('option')].map(o=>o.textContent)})))));

await (await page.$('#file-input')).uploadFile(`${OUT}/source.pdf`);
await sleep(2200);

const rect=await page.evaluate(()=>{const r=document.getElementById('overlay-canvas').getBoundingClientRect();return{x:r.left,y:r.top};});
// text in the bundled 粉圓體
await page.click('[data-tool="textbox"]');
await page.select('#font-select','huninn');
await sleep(1200);                                   // let the FontFace load
await page.mouse.click(rect.x+120, rect.y+420); await sleep(500);
await page.keyboard.type('粉圓體測試 Huninn');
await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
await sleep(600);

// add a local font from disk (Canva Sans - licensed, not redistributable)
await (await page.$('#font-file')).uploadFile(process.env.LOCAL_FONT || '/path/to/any.ttf');
await sleep(2500);
const after = await page.evaluate(()=>({
  toast: document.getElementById('toast').textContent,
  selected: document.getElementById('font-select').value,
  removeShown: !document.getElementById('font-remove').hidden,
  local: [...document.querySelectorAll('#font-select optgroup')].filter(g=>g.label==='本機字體').map(g=>[...g.querySelectorAll('option')].map(o=>o.textContent)).flat(),
}));
console.log('after add:', JSON.stringify(after));

await page.mouse.click(rect.x+120, rect.y+500); await sleep(500);
await page.keyboard.type('Canva Sans local test');
await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
await sleep(600);
await page.screenshot({path:`${OUT}/fonts-ui.png`});
await page.click('#btn-save'); await sleep(4000);

// does a local font survive a reload?
await page.reload({waitUntil:'networkidle2'}); await sleep(1500);
console.log('after reload, local fonts:', JSON.stringify(await page.evaluate(()=>
  [...document.querySelectorAll('#font-select optgroup')].filter(g=>g.label==='本機字體')
    .map(g=>[...g.querySelectorAll('option')].map(o=>o.textContent)).flat())));
console.log('errors:', errs.length?errs.slice(0,3).join(' | '):'(none)');
await b.close();
