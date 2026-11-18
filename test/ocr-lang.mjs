import puppeteer from 'puppeteer-core';
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',
  args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server']});
const page=await b.newPage();
await page.goto('http://127.0.0.1:8777/index.html',{waitUntil:'networkidle2'});
await (await page.$('#file-input')).uploadFile(`${OUT}/scanned.pdf`);
await new Promise(r=>setTimeout(r,1500));

for (const langs of ['chi_tra+eng','eng+chi_tra','chi_tra']) {
  const r = await page.evaluate(async (L) => {
    const ocr = await import('/js/ocr.js');
    await ocr.terminate();
    const t0 = performance.now();
    const { items } = await ocr.ocrPage(1, { langs: L });
    return { ms: Math.round(performance.now()-t0),
             conf: Math.round(ocr.meanConfidence(items)),
             lines: items.map(i => i.str) };
  }, langs).catch(e=>({error:String(e).slice(0,200)}));
  console.log(`\n=== ${langs} === ${r.ms}ms conf=${r.conf}`);
  (r.lines||[]).forEach(l => console.log('   ', JSON.stringify(l)));
  if (r.error) console.log('   ERR', r.error);
}
await b.close();
