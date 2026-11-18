import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from '../vendor/pdf-lib/pdf-lib.esm.min.js';
const d = await PDFDocument.create();
const png = await d.embedPng(await readFile(`${OUT}/scan.png`));
const p = d.addPage([595, 315]);                     // image-only page: no text layer
p.drawImage(png, { x: 0, y: 0, width: 595, height: 315 });
await writeFile(`${OUT}/scanned.pdf`, await d.save());
console.log('scanned.pdf written');
