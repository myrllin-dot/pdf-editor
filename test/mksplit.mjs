import { writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from '../vendor/pdf-lib/pdf-lib.esm.min.js';

const d = await PDFDocument.create();
const f = await d.embedFont(StandardFonts.TimesRoman);
const p = d.addPage([595, 842]);

// A letterspaced cover title, emitted the way a layout tool does it:
// one show-text operation per chunk, with the gaps baked into positions.
const title = 'THE LITTLE LIGHTS';
let x = 60;
const size = 30;
for (const ch of title) {
  p.drawText(ch, { x, y: 700, size, font: f });
  x += f.widthOfTextAtSize(ch, size) + 4.5;      // 4.5pt of tracking
}

// A normal paragraph line, for contrast: should NOT be merged with the title.
p.drawText('A Wordless Story Coloring Book', { x: 60, y: 640, size: 12, font: f });
// Two columns on one baseline: a gap big enough that they must stay separate.
p.drawText('left column', { x: 60, y: 580, size: 11, font: f });
p.drawText('right column', { x: 400, y: 580, size: 11, font: f });

await writeFile(`${process.env.OUT || './out'}/split.pdf', await d.save());
console.log('split.pdf written');
