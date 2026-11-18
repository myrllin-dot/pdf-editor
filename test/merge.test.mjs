import puppeteer from 'puppeteer-core';
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server']});
const page=await b.newPage(); await page.setViewport({width:1440,height:900});
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,160)));
await page.goto('http://127.0.0.1:8777/index.html',{waitUntil:'networkidle2'});
await (await page.$('#file-input')).uploadFile(`${process.env.OUT || './out'}/split.pdf');
await new Promise(r=>setTimeout(r,2200));
const r = await page.evaluate(async()=>{
  const {state}=await import('/js/state.js');
  return {
    zoom: document.getElementById('zoom-label').textContent,
    stageW: document.getElementById('stage').clientWidth,
    canvasW: Math.round(document.getElementById('page-canvas').getBoundingClientRect().width),
    items: state.textItems.map(i=>({s:i.str, x:+i.pdf.x.toFixed(1), w:+i.pdf.w.toFixed(1), size:+i.size.toFixed(1)})),
  };
});
console.log('zoom', r.zoom, '| stage', r.stageW, '| canvas', r.canvasW,
            '| overflows:', r.canvasW > r.stageW);
r.items.forEach(i=>console.log('   ', JSON.stringify(i)));
console.log('errors:', errs.length?errs.join(' | '):'(none)');
await b.close();
