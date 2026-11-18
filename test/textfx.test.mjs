import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from '../vendor/pdf-lib/pdf-lib.esm.min.js';
import { buildPdf } from '../js/export.js';

const OUT = process.env.OUT || './out';
const FONT = '../vendor/fonts/NotoSansTC_400Regular.ttf';

const FONTS = {
  sans:  { key:'sans',  kind:'builtin', std:{r:'Helvetica',b:'HelveticaBold',i:'HelveticaOblique',bi:'HelveticaBoldOblique'} },
  serif: { key:'serif', kind:'builtin', std:{r:'TimesRoman',b:'TimesRomanBold',i:'TimesRomanItalic',bi:'TimesRomanBoldItalic'} },
  cjk:   { key:'cjk',   kind:'bundled', label:'Noto Sans TC', cjk:true },
};
const getFontInfo = k => FONTS[k] || FONTS.sans;
const getFontBytes = async () => {
  const b = await readFile(FONT);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const defaultCjkKey = () => 'cjk';

const d = await PDFDocument.create();
d.addPage([620, 820]);
const src = await d.save();

let n = 0;
const T = (y, extra) => ({
  id: `t${++n}`, type: 'text', page: 1, x: 40, y, size: 26,
  fontKey: 'sans', color: '#1a1a1a', text: 'Handgloves 長笛 42', ...extra,
});

const annots = [
  T(770, { text: 'plain Handgloves 42' }),
  T(730, { text: 'bold', bold: true }),
  T(730, { text: 'italic', italic: true, x: 160 }),
  T(730, { text: 'bold+italic', bold: true, italic: true, x: 280 }),
  T(730, { text: 'underline', underline: true, x: 460 }),

  T(680, { text: 'OUTLINE', effect: { type: 'outline', width: 1.4, color: '#d81b60' }, size: 34 }),
  T(630, { text: 'HOLLOW', effect: { type: 'hollow', width: 1.2 }, size: 34 }),
  T(580, { text: 'ECHO', effect: { type: 'echo', count: 4, offsetX: 4, offsetY: -4, color: '#90a4ae' }, size: 34 }),

  T(530, { text: 'letterspacing', letterSpacing: 6, size: 22 }),
  T(500, { text: 'letterspacing', letterSpacing: 0, size: 22, x: 330 }),

  // frame + wrap + alignment + anchor, drawn against a reference rectangle
  { id:'box', type:'rect', page:1, x:40, y:300, w:250, h:150, color:'#90caf9', width:0.8, fill:null },
  T(450, { text: 'Wrapped inside a frame: this line is long enough to need breaking, 中文也要能斷行換列。',
           size: 12, frameW: 250, frameH: 150, anchor: 'tl', align: 'left', x: 40, y: 450 }),

  { id:'box2', type:'rect', page:1, x:330, y:300, w:250, h:150, color:'#90caf9', width:0.8, fill:null },
  T(450, { text: 'Centred in the frame,\nboth ways.', size: 14,
           frameW: 250, frameH: 150, anchor: 'tl', align: 'center', x: 330, y: 450 }),

  T(250, { text: 'line spacing 2.2\nsecond line\nthird line', size: 13, lineSpacing: 2.2 }),
  T(250, { text: 'line spacing 1.0\nsecond line\nthird line', size: 13, lineSpacing: 1.0, x: 220 }),

  // anchor check: three blocks all anchored at the SAME point
  { id:'mark', type:'ink', page:1, color:'#e53935', width:1,
    points: [[460,160],[460,200],[460,180],[420,180],[500,180]] },
  T(180, { text: 'anchor tl', size: 12, anchor: 'tl', x: 460, y: 180 }),
  T(180, { text: 'anchor mc', size: 12, anchor: 'mc', x: 460, y: 180, color: '#2e7d32' }),
  T(180, { text: 'anchor br', size: 12, anchor: 'br', x: 460, y: 180, color: '#1565c0' }),

  T(90, { text: '中文效果測試 粉圓', fontKey: 'cjk', size: 28,
          effect: { type:'outline', width:1.2, color:'#6a1b9a' }, letterSpacing: 3 }),
];

const res = await buildPdf(src, annots, { getFontInfo, getFontBytes, defaultCjkKey });
await writeFile(`${OUT}/textfx.pdf`, res.bytes);
console.log(`ok: ${res.bytes.length} bytes, ${annots.length} annots`);
