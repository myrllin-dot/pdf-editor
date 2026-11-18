import puppeteer from 'puppeteer-core';
import { writeFile } from 'node:fs/promises';

const OUT = process.env.OUT || './out';
const URL_ = 'http://127.0.0.1:8777/index.html';

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server',
         '--allow-file-access-from-files', '--font-render-hinting=none'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });

const errors = [], logs = [];
page.on('console', m => logs.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
page.on('requestfailed', r => errors.push(`REQFAIL ${r.url().slice(0,120)} ${r.failure()?.errorText}`));

await page.goto(URL_, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise(r => setTimeout(r, 800));

console.log('--- load errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
console.log('--- console ---');
console.log(logs.filter(l => !l.startsWith('log: ')).slice(0,8).join('\n') || '(clean)');
console.log('ready log:', logs.find(l => l.includes('PDF Editor ready')) || '(MISSING)');

await page.screenshot({ path: `${OUT}/ui-1-empty.png` });

// load the test PDF through the real file input
const input = await page.$('#file-input');
await input.uploadFile(`${OUT}/source.pdf`);
await new Promise(r => setTimeout(r, 2500));

console.log('--- after open ---');
console.log('errors:', errors.length ? errors.join('\n') : '(none)');
const st = await page.evaluate(() => ({
  pages: document.getElementById('page-label').textContent,
  zoom: document.getElementById('zoom-label').textContent,
  canvasW: document.getElementById('page-canvas').width,
  overlayW: document.getElementById('overlay-canvas').width,
  saveEnabled: !document.getElementById('btn-save').disabled,
}));
console.log(JSON.stringify(st));
await page.screenshot({ path: `${OUT}/ui-2-opened.png` });
await browser.close();
