import puppeteer from 'puppeteer-core';
const OUT = process.env.OUT || './out';
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server']});
const page=await b.newPage();
await page.setViewport({width:1440,height:900});
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,200)));
const cdp=await page.target().createCDPSession();
await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:`${OUT}/dl3`});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

await page.goto('http://127.0.0.1:8777/index.html',{waitUntil:'networkidle2'});
await (await page.$('#file-input')).uploadFile(`${OUT}/scanned.pdf`);
await sleep(2200);

// 改字 on a scan with no OCR yet -> should tell the user to run OCR
await page.click('[data-tool="textedit"]');
const r0 = await page.evaluate(()=>{const c=document.getElementById('overlay-canvas').getBoundingClientRect();return {x:c.left,y:c.top,w:c.width,h:c.height};});
await page.mouse.click(r0.x+r0.w*0.3, r0.y+r0.h*0.2);
await sleep(400);
console.log('pre-OCR toast:', await page.evaluate(()=>document.getElementById('toast').textContent));

// run OCR via the real UI
await page.click('#btn-ocr'); await sleep(300);
await page.select('#ocr-lang','chi_tra');
await page.click('#ocr-run');
for (let i=0;i<120 && await page.evaluate(()=>!document.getElementById('busy').hidden); i++) await sleep(500);
await sleep(600);
console.log('post-OCR toast:', await page.evaluate(()=>document.getElementById('toast').textContent));
console.log('active tool:', await page.evaluate(()=>document.querySelector('.tool.active')?.dataset.tool));

const items = await page.evaluate(async()=>{
  const {state}=await import('/js/state.js');
  return state.textItems.map(i=>({s:i.str,src:i.source,sc:{x:+i.screen.x.toFixed(0),y:+i.screen.y.toFixed(0),w:+i.screen.w.toFixed(0),h:+i.screen.h.toFixed(0)}}));
});
console.log('recognised lines:'); items.forEach(i=>console.log('   ',JSON.stringify(i.s),i.src,JSON.stringify(i.sc)));

// click the title line and correct it
const target = items[0];
await page.mouse.click(r0.x+target.sc.x+target.sc.w/2, r0.y+target.sc.y+target.sc.h/2);
await sleep(500);
const ed = await page.evaluate(()=>({hidden:document.getElementById('inline-editor').hidden, value:document.getElementById('inline-editor').value}));
console.log('editor:', JSON.stringify(ed));
if(!ed.hidden){
  await page.evaluate(()=>document.getElementById('inline-editor').select());
  await page.keyboard.type('長笛練習曲 第三號');
  await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
}
await sleep(600);
await page.screenshot({path:`${OUT}/ocr-edited.png`});
await page.click('#btn-save'); await sleep(4000);
console.log('errors:', errs.length?errs.slice(0,3).join(' | '):'(none)');
await b.close();
