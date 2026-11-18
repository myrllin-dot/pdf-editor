import puppeteer from 'puppeteer-core';
const OUT = process.env.OUT || './out';
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server']});
const page=await b.newPage(); await page.setViewport({width:1400,height:900});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await page.goto('http://127.0.0.1:8777/index.html',{waitUntil:'networkidle2'});
await (await page.$('#file-input')).uploadFile(`${OUT}/blank620.pdf`);
await sleep(2000);
await page.evaluate(async()=>{
  const {state}=await import('/js/state.js');
  const g=await import('/js/guides.js');
  g.guides.on=true;
  state.annots=[{id:'t1',type:'text',page:1,x:60,y:700,size:30,fontKey:'sans',
                 color:'#111111',text:'Baseline 基準線\nsecond line',lineSpacing:1.4}];
  state.selectedId='t1';
  const {renderPage}=await import('/js/viewer.js');
  const vp=await renderPage(document.getElementById('page-canvas'),1,1.3);
  await new Promise(r=>setTimeout(r,1200));
  const {drawOverlay}=await import('/js/overlay.js');
  drawOverlay(document.getElementById('overlay-canvas'),vp);
});
await sleep(400);
const el=await page.$('#page-holder');
const box=await el.boundingBox();
await page.screenshot({path:`${OUT}/baseline.png`,
  clip:{x:box.x,y:box.y,width:Math.min(box.width,620),height:200}});
await b.close();
console.log('ok');
