import puppeteer from 'puppeteer-core';
const OUT = process.env.OUT || './out';
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server']});
const page=await b.newPage();
await page.setViewport({width:1280,height:860});
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,200)));
page.on('requestfailed',r=>errs.push('REQFAIL '+r.url().slice(-60)+' '+r.failure()?.errorText));
await page.goto('http://127.0.0.1:8777/index.html',{waitUntil:'networkidle2'});
await (await page.$('#file-input')).uploadFile(`${OUT}/scanned.pdf`);
await new Promise(r=>setTimeout(r,2000));

const t0=Date.now();
const res = await page.evaluate(async () => {
  const ocr = await import('/js/ocr.js');
  const statuses = [];
  const { items, rawText } = await ocr.ocrPage(1, {
    onStatus: (s,p) => { const last = statuses[statuses.length-1]; if (last!==s) statuses.push(s); },
  });
  return {
    statuses,
    count: items.length,
    meanConf: Math.round(ocr.meanConfidence(items)),
    lines: items.map(i => ({
      t: i.str,
      conf: Math.round(i.confidence),
      size: +i.size.toFixed(1),
      pdf: {x:+i.pdf.x.toFixed(1), y:+i.pdf.y.toFixed(1), w:+i.pdf.w.toFixed(1), h:+i.pdf.h.toFixed(1)},
      cjk: i.hasCJK,
    })),
    rawHead: rawText.slice(0,120),
  };
}).catch(e => ({error:String(e).slice(0,400)}));
console.log('elapsed', ((Date.now()-t0)/1000).toFixed(1)+'s');
console.log(JSON.stringify(res,null,1));
console.log('errors:', errs.length? errs.slice(0,4).join(' | '):'(none)');
await b.close();
