import puppeteer from 'puppeteer-core';
const OUT = process.env.OUT || './out';
const browser = await puppeteer.launch({
  executablePath:'/usr/bin/google-chrome', headless:'new',
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server'],
});
const page = await browser.newPage();
await page.setViewport({width:1280,height:860,deviceScaleFactor:1});
const errors=[];
page.on('pageerror',e=>errors.push(String(e).slice(0,200)));
page.on('console',m=>{ if(m.type()==='error') errors.push('console: '+m.text().slice(0,200)); });

const client = await page.target().createCDPSession();
await client.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:`${OUT}/dl`});

await page.goto('http://127.0.0.1:8777/index.html',{waitUntil:'networkidle2'});
await (await page.$('#file-input')).uploadFile(`${OUT}/source.pdf`);
await new Promise(r=>setTimeout(r,2000));

const rect = await page.evaluate(()=>{const r=document.getElementById('overlay-canvas').getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height};});
const at=(cx,cy)=>({x:rect.x+cx,y:rect.y+cy});
const step=async(ms=450)=>new Promise(r=>setTimeout(r,ms));

// 1. edit existing text
await page.click('[data-tool="textedit"]');
let p=at(155,105); await page.mouse.click(p.x,p.y); await step();
const editorOpen = await page.evaluate(()=>{const e=document.getElementById('inline-editor');return {hidden:e.hidden, value:e.value};});
console.log('textedit editor:', JSON.stringify(editorOpen));
if(!editorOpen.hidden){
  await page.evaluate(()=>{document.getElementById('inline-editor').select();});
  await page.keyboard.type('改寫後的文字 REPLACED');
  await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
}
await step();

// 2. pen
await page.click('[data-tool="pen"]');
p=at(120,330); await page.mouse.move(p.x,p.y); await page.mouse.down();
for(let i=0;i<24;i++){const q=at(120+i*14,330+Math.sin(i/3)*34); await page.mouse.move(q.x,q.y);}
await page.mouse.up(); await step();

// 3. arrow
await page.click('[data-tool="arrow"]');
p=at(600,520); await page.mouse.move(p.x,p.y); await page.mouse.down();
p=at(820,400); await page.mouse.move(p.x,p.y); await page.mouse.up(); await step();

// 4. highlight
await page.click('[data-tool="highlight"]');
p=at(100,620); await page.mouse.move(p.x,p.y); await page.mouse.down();
p=at(560,660); await page.mouse.move(p.x,p.y); await page.mouse.up(); await step();

// 5. add text box
await page.click('[data-tool="textbox"]');
p=at(120,690); await page.mouse.click(p.x,p.y); await step();
await page.keyboard.type('長笛玩家工作室 test');
await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
await step();

const annotCount = await page.evaluate(()=>document.querySelectorAll('canvas').length);
await page.screenshot({path:`${OUT}/ui-3-annotated.png`});

// 6. batch footer in Chinese, all pages
await page.click('#btn-stamps'); await step(300);
await page.click('.tab[data-tab="footer"]');
await page.type('#ft-text','長笛玩家工作室 Flute Gamer Studio');
await page.click('#stamp-apply'); await step(1200);

// 7. save
await page.click('#btn-save');
await new Promise(r=>setTimeout(r,4000));
await page.screenshot({path:`${OUT}/ui-4-saved.png`});

console.log('errors:', errors.length? errors.join(' | '):'(none)');
await browser.close();
