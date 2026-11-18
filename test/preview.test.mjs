import puppeteer from 'puppeteer-core';
import { readFile } from 'node:fs/promises';
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server']});
const page=await b.newPage(); await page.setViewport({width:1500,height:1100});
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,200)));
await page.goto('http://127.0.0.1:8777/index.html',{waitUntil:'networkidle2'});
await (await page.$('#file-input')).uploadFile(`${process.env.OUT || './out'}/blank620.pdf');
await new Promise(r=>setTimeout(r,2000));

// the exact annotation set from test/textfx.test.mjs
const src = await readFile('/home/claude/pdf-editor/test/textfx.test.mjs','utf8');
const body = src.slice(src.indexOf('let n = 0;'), src.indexOf('const res = await buildPdf'));

await page.evaluate(async (body) => {
  const { state } = await import('/js/state.js');
  const fn = new Function(body + '; return annots;');
  state.annots = fn();
  state.scale = 1.4;
  const { renderPage } = await import('/js/viewer.js');
  const vp = await renderPage(document.getElementById('page-canvas'), 1, 1.4);
  const { drawOverlay } = await import('/js/overlay.js');
  // give embedded faces a chance to register first
  const fonts = await import('/js/fonts.js');
  fonts.ensureFace('cjk');
  await new Promise(r=>setTimeout(r,2500));
  drawOverlay(document.getElementById('overlay-canvas'), vp);
}, body);
await new Promise(r=>setTimeout(r,500));
const el = await page.$('#page-holder');
await el.screenshot({path:`${process.env.OUT || './out'}/preview-fx.png'});
console.log('errors:', errs.length?errs.slice(0,3).join(' | '):'(none)');
await b.close();
