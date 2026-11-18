import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, degrees } from '../vendor/pdf-lib/pdf-lib.esm.min.js';
import { buildPdf } from '../js/export.js';

const OUT = process.env.OUT || './out';
const FONT = '../vendor/fonts/NotoSansTC_400Regular.ttf';

/* ---- 1. build a source PDF: p1 normal, p2 rotated 90 ---- */
async function makeSource() {
  const d = await PDFDocument.create();
  const helv = await d.embedFont(StandardFonts.Helvetica);
  const p1 = d.addPage([400, 300]);
  p1.drawText('ORIGINAL TEXT TO COVER', { x: 40, y: 250, size: 14, font: helv });
  p1.drawText('baseline marker at y=40', { x: 40, y: 40, size: 9, font: helv });
  const p2 = d.addPage([400, 300]);
  p2.drawText('PAGE TWO ROTATED', { x: 40, y: 250, size: 14, font: helv });
  p2.setRotation(degrees(90));
  return d.save();
}

const src = await makeSource();
await writeFile(`${OUT}/source.pdf`, src);

/* ---- 2. one annotation of every type ---- */
const annots = [
  // whiteout + replacement, as the text-edit tool emits them
  { id:'w1', groupId:'g1', type:'whiteout', page:1, x:38, y:244, w:200, h:20, color:'#ffffff' },
  { id:'t1', groupId:'g1', type:'text', page:1, x:40, y:250, text:'REPLACED TEXT', size:14, fontKey:'sans', bold:false, color:'#c62828' },

  { id:'h1', type:'highlight', page:1, x:40, y:200, w:160, h:18, color:'#ffeb3b', alpha:0.35 },
  { id:'t2', type:'text', page:1, x:44, y:205, text:'highlighted words', size:12, fontKey:'sans', bold:false, color:'#000000' },

  { id:'i1', type:'ink', page:1, color:'#1565c0', width:2,
    points: Array.from({length:40}, (_,k) => [40 + k*4, 150 + Math.sin(k/4)*18]) },

  // arrow pointing up-right; tip must land exactly at (340,180)
  { id:'r1', type:'arrow', page:1, x1:240, y1:110, x2:340, y2:180, color:'#2e7d32', width:2.5 },

  // multi-line + CJK (fontKey sans on purpose -> must auto-upgrade)
  { id:'t3', type:'text', page:1, x:40, y:95, text:'第一行 中文測試\nsecond line ASCII', size:11, fontKey:'sans', bold:false, color:'#000000' },

  // bold CJK -> faux bold path
  { id:'t4', type:'text', page:1, x:40, y:60, text:'長笛玩家工作室', size:13, fontKey:'cjk', bold:true, color:'#4a148c' },

  // rotated page: text must still read upright
  { id:'t5', type:'text', page:2, x:40, y:200, text:'UPRIGHT ON ROTATED\nsecond line', size:13, fontKey:'sans', bold:false, color:'#ad1457' },
  { id:'r2', type:'arrow', page:2, x1:60, y1:120, x2:200, y2:120, color:'#00695c', width:2 },

  // watermark: rotated 45, low opacity
  { id:'t6', type:'text', page:2, x:80, y:60, text:'SAMPLE', size:46, fontKey:'sans', bold:false,
    color:'#555555', rotate:45, opacity:0.18 },
];

const fetchCjk = () => readFile(FONT).then(b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

const t0 = Date.now();
const res = await buildPdf(src, annots, { fetchCjk, onProgress: m => process.stdout.write(`  · ${m}\n`) });
await writeFile(`${OUT}/edited.pdf`, res.bytes);

console.log(`\nbuildPdf: ${Date.now()-t0}ms`);
console.log(`usedCjk=${res.usedCjk} upgradedCount=${res.upgradedCount} bytes=${res.bytes.length}`);
