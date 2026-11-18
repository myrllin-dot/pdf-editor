/* ocr.js — optical character recognition for scanned pages.
 *
 * A scanned PDF has no text layer, so the "改字" tool has nothing to grab.
 * OCR supplies one: it finds where the text sits and what it says, which is
 * exactly the two things that tool needs. Recognised lines are shaped to match
 * the items viewer.js extracts from a real text layer, so everything
 * downstream (hit-testing, cover-and-retype, size matching) works unchanged.
 *
 * Note this does NOT make scanned text deletable in any deeper sense than
 * before: the words are pixels inside an image, and covering them leaves those
 * pixels in the file. See README.
 */

import { state } from './state.js';

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;

/** Recognition quality tracks resolution; ~300 DPI is the usual sweet spot. */
const TARGET_DPI = 300;
/** Beyond this the wasm slows down sharply for very little accuracy gain. */
const MAX_EDGE_PX = 3500;

let workerPromise = null;
let currentLangs = '';

/** Languages are loaded into the worker up front; both are vendored. */
export const LANGS = 'chi_tra+eng';

async function getWorker(langs, onStatus, opts = {}) {
  const key = `${langs}|${opts.langPath || ''}`;
  if (workerPromise && currentLangs === key) return workerPromise;
  if (workerPromise) await terminate();

  currentLangs = key;
  workerPromise = (async () => {
    // The ESM build exposes everything on a single default export, not as
    // named exports, so destructure off `.default` rather than the namespace.
    const tesseract = (await import('../vendor/tesseract/tesseract.esm.min.js')).default;
    const { createWorker } = tesseract;
    return createWorker(langs, 1, {
      workerPath: `${BASE}worker.min.js`,
      corePath: `${BASE}core`,
      langPath: opts.langPath || `${BASE}lang`,
      gzip: true,
      logger: m => {
        if (!onStatus) return;
        const pct = m.progress != null ? Math.round(m.progress * 100) : null;
        onStatus(m.status, pct);
      },
    });
  })();

  try {
    return await workerPromise;
  } catch (err) {
    workerPromise = null;
    throw new Error(`OCR 引擎載入失敗：${err.message}`);
  }
}

export async function terminate() {
  const p = workerPromise;
  workerPromise = null;
  currentLangs = '';
  try { (await p)?.terminate?.(); } catch { /* already gone */ }
}

export const isWarm = () => !!workerPromise;

/* ------------------------------------------------------------------ */

/** Renders one page to an offscreen canvas at a resolution good for OCR. */
async function renderForOcr(pageNum) {
  const page = await state.pdfDoc.getPage(pageNum);
  let scale = TARGET_DPI / 72;
  const base = page.getViewport({ scale: 1 });
  const longest = Math.max(base.width, base.height) * scale;
  if (longest > MAX_EDGE_PX) scale *= MAX_EDGE_PX / longest;

  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  return { canvas, viewport };
}

/** Tesseract bbox (image px, top-left origin) -> PDF rect (points, bottom-left). */
function bboxToPdf(b, viewport) {
  const [x1, y1] = viewport.convertToPdfPoint(b.x0, b.y0);
  const [x2, y2] = viewport.convertToPdfPoint(b.x1, b.y1);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

const CJK_CLASS = '　-鿿豈-﫿＀-￯';
const CJK = new RegExp(`[${CJK_CLASS}]`);
const CJK_GAP = new RegExp(`([${CJK_CLASS}])[ \t]+(?=[${CJK_CLASS}])`, 'g');

/**
 * Tesseract treats every CJK glyph as its own word and rejoins them with
 * spaces, so "長笛" comes back as "長 笛". A space between two CJK characters
 * is essentially always an artefact; a space between CJK and Latin usually
 * is not, so only the former is collapsed.
 */
export function tidyText(input) {
  let out = String(input).replace(/\s+/g, ' ').trim();
  let prev;
  do { prev = out; out = out.replace(CJK_GAP, '$1'); } while (out !== prev);
  return out;
}

/** Walks the nested blocks → paragraphs → lines structure Tesseract returns. */
function collectLines(data) {
  const out = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const text = tidyText(line.text || '');
        if (!text) continue;
        out.push({ text, bbox: line.bbox, confidence: line.confidence ?? 0 });
      }
    }
  }
  return out;
}

/**
 * Recognises one page and returns items in the same shape viewer.js produces
 * for a real text layer.
 *
 * @param {number} pageNum
 * @param {object} opts { onStatus(status, pct), minConfidence }
 */
export async function ocrPage(pageNum, opts = {}) {
  const minConfidence = opts.minConfidence ?? 30;
  const worker = await getWorker(opts.langs || LANGS, opts.onStatus, opts);

  const { canvas, viewport } = await renderForOcr(pageNum);
  let data;
  try {
    ({ data } = await worker.recognize(canvas, {}, { blocks: true, text: true }));
  } finally {
    canvas.width = canvas.height = 0;   // release the bitmap promptly
  }

  const items = [];
  for (const line of collectLines(data)) {
    if (line.confidence < minConfidence) continue;
    const pdf = bboxToPdf(line.bbox, viewport);
    if (pdf.w <= 0 || pdf.h <= 0) continue;

    const hasCJK = CJK.test(line.text);
    // CJK glyphs fill their em box; Latin caps reach only ~0.72 of it, so the
    // same ink height implies a larger point size.
    const size = hasCJK ? pdf.h * 0.95 : pdf.h * 1.05;

    items.push({
      str: line.text,
      size,
      pdf,
      screen: null,                 // filled in by viewer.projectTextItems()
      fontFamily: hasCJK ? 'cjk' : 'sans-serif',
      bold: false,
      italic: false,
      hasCJK,
      source: 'ocr',
      confidence: line.confidence,
    });
  }

  return { items, rawText: data.text || '' };
}

/** Average confidence, for telling the user how much to trust a page. */
export const meanConfidence = items =>
  items.length ? items.reduce((s, i) => s + (i.confidence || 0), 0) / items.length : 0;
