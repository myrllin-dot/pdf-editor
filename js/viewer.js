/* viewer.js — pdf.js document loading and page rendering. */

import * as pdfjs from '../vendor/pdfjs/pdf.min.js';
import { state } from './state.js';

const V = '../vendor/pdfjs/';
pdfjs.GlobalWorkerOptions.workerSrc = new URL(V + 'pdf.worker.min.js', import.meta.url).href;

const assetUrl = p => new URL(V + p, import.meta.url).href;

/** Everything pdf.js may lazily fetch, served from our own vendor/ dir (works offline). */
const DOC_ASSETS = {
  cMapUrl: assetUrl('cmaps/'),
  cMapPacked: true,
  standardFontDataUrl: assetUrl('standard_fonts/'),
  wasmUrl: assetUrl('wasm/'),
  iccUrl: assetUrl('iccs/'),
};

export const PdfJsVersion = pdfjs.version;

/**
 * Opens a PDF. Keeps a pristine copy of the bytes for export, because pdf.js
 * transfers/detaches the buffer it is given.
 */
export async function openPdf(arrayBuffer, fileName) {
  const pristine = new Uint8Array(arrayBuffer.slice(0));
  const forPdfJs = new Uint8Array(arrayBuffer.slice(0));

  const doc = await pdfjs.getDocument({ data: forPdfJs, ...DOC_ASSETS }).promise;

  state.pdfDoc = doc;
  state.originalBytes = pristine;
  state.fileName = fileName || 'document.pdf';
  state.numPages = doc.numPages;
  state.pageNum = 1;
  return doc;
}

/**
 * Renders a page into `canvas` and returns the viewport used.
 * Renders at devicePixelRatio for a crisp image, then scales back via CSS.
 */
export async function renderPage(canvas, pageNum, scale) {
  const page = await state.pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const dpr = Math.min(window.devicePixelRatio || 1, 3);

  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  await page.render({
    canvasContext: ctx,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
  }).promise;

  state.viewport = viewport;
  state.nativeTextItems = await extractTextItems(page, viewport);
  refreshTextItems(viewport);
  return viewport;
}

/**
 * Rebuilds `state.textItems` for the current page from the two possible
 * sources — the PDF's own text layer and anything OCR has recognised — and
 * re-projects every box into the current viewport, so zooming stays accurate.
 * OCR items come last, meaning a real text run wins a tie on hit-testing.
 */
export function refreshTextItems(viewport = state.viewport) {
  const native = state.nativeTextItems || [];
  const ocr = state.ocrPages?.[state.pageNum] || [];
  const all = [...native, ...ocr];
  for (const it of all) it.screen = pdfBoxToScreen(it.pdf, viewport);
  state.textItems = all;
  return all;
}

/**
 * Text runs for the current page, each with a bounding box in BOTH spaces.
 * Used by the "edit existing text" tool for hit-testing and for guessing
 * the original size / family so the replacement looks close.
 */
async function extractTextItems(page, viewport) {
  let tc;
  try {
    tc = await page.getTextContent({ includeMarkedContent: false });
  } catch {
    return [];
  }

  const raw = [];
  for (const it of tc.items) {
    if (!it.str || !it.transform) continue;
    if (!it.str.trim()) { raw.push({ spaceOnly: true, hasEOL: it.hasEOL }); continue; }

    const [a, b, c, d, e, f] = it.transform;
    // Glyph size = length of the transformed unit-y vector.
    const size = Math.hypot(c, d) || Math.hypot(a, b) || 10;
    const style = tc.styles?.[it.fontName];

    raw.push({
      str: it.str,
      size,
      baseline: f,
      x: e,
      w: it.width || 0,
      h: it.height || size,
      hasEOL: it.hasEOL,
      fontFamily: style?.fontFamily || 'sans-serif',
      bold: /bold|black|heavy|semibold/i.test(style?.fontFamily || it.fontName || ''),
      italic: /italic|oblique/i.test(style?.fontFamily || it.fontName || ''),
    });
  }

  return mergeRuns(raw).map(r => {
    const pdf = {
      x: r.x,
      y: r.baseline - r.size * 0.22,     // down to roughly the descender line
      w: r.w,
      h: (r.h || r.size) * 1.18,
    };
    return {
      str: r.str,
      size: r.size,
      pdf,
      screen: pdfBoxToScreen(pdf, viewport),
      fontFamily: r.fontFamily,
      bold: r.bold,
      italic: r.italic,
      hasCJK: /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(r.str),
      source: 'native',
    };
  });
}

/**
 * Joins adjacent runs that belong to the same visual line.
 *
 * A PDF has no concept of a line of text: a title can be emitted as a dozen
 * separate show-text operations, and generators split runs whenever spacing,
 * kerning or encoding changes. Editing one run meant covering a fragment and
 * leaving the rest of the word on the page, which is not what anyone sees or
 * expects. So runs sharing a baseline with no meaningful horizontal gap are
 * treated as one editable line.
 */
function mergeRuns(raw) {
  const out = [];
  let cur = null;

  const flush = () => { if (cur) out.push(cur); cur = null; };

  for (const r of raw) {
    if (r.spaceOnly) {                 // whitespace-only run: a soft separator
      if (cur) cur.pendingSpace = true;
      if (r.hasEOL) flush();
      continue;
    }

    if (cur) {
      const sameLine = Math.abs(r.baseline - cur.baseline) <= Math.max(cur.size, r.size) * 0.3;
      const sizeClose = Math.min(r.size, cur.size) / Math.max(r.size, cur.size) > 0.6;
      const gap = r.x - (cur.x + cur.w);
      // A generous gap still counts as one line: wide letter-spacing and
      // justified text legitimately leave space between runs. Anything past
      // this is a separate block (a column, or a different field).
      const adjacent = gap > -Math.max(cur.size, r.size) && gap < Math.max(cur.size, r.size) * 2.5;

      if (sameLine && sizeClose && adjacent) {
        const needsSpace = cur.pendingSpace
          || (gap > cur.size * 0.22 && !/\s$/.test(cur.str) && !/^\s/.test(r.str));
        cur.str += (needsSpace ? ' ' : '') + r.str;
        cur.w = (r.x + r.w) - cur.x;
        cur.size = Math.max(cur.size, r.size);
        cur.h = Math.max(cur.h, r.h);
        cur.bold = cur.bold || r.bold;
        cur.pendingSpace = false;
        if (r.hasEOL) flush();
        continue;
      }
    }

    flush();
    cur = { ...r, pendingSpace: false };
    if (r.hasEOL) flush();
  }
  flush();
  return out;
}

/* ---------- coordinate conversion ---------- */

/** PDF point -> CSS pixel within the page element. */
export function pdfToScreen([x, y], viewport = state.viewport) {
  const [sx, sy] = viewport.convertToViewportPoint(x, y);
  return [sx, sy];
}

/** CSS pixel within the page element -> PDF point. */
export function screenToPdf([x, y], viewport = state.viewport) {
  const [px, py] = viewport.convertToPdfPoint(x, y);
  return [px, py];
}

/** PDF-space rect (bottom-left origin) -> screen rect (top-left origin). */
export function pdfBoxToScreen(box, viewport = state.viewport) {
  const [x1, y1] = viewport.convertToViewportPoint(box.x, box.y);
  const [x2, y2] = viewport.convertToViewportPoint(box.x + box.w, box.y + box.h);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

/** Screen rect -> PDF-space rect. */
export function screenBoxToPdf(box, viewport = state.viewport) {
  const [x1, y1] = viewport.convertToPdfPoint(box.x, box.y);
  const [x2, y2] = viewport.convertToPdfPoint(box.x + box.w, box.y + box.h);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

/** Scale factor from PDF points to CSS pixels (used for stroke widths / font sizes). */
export const pdfScale = (viewport = state.viewport) => viewport.scale;

/** Page size in PDF points (unrotated) plus the page's /Rotate value. */
export async function pageSizePts(pageNum) {
  const page = await state.pdfDoc.getPage(pageNum);
  const vp = page.getViewport({ scale: 1, rotation: 0 });
  return { w: vp.width, h: vp.height, rotation: ((page.rotate || 0) % 360 + 360) % 360 };
}
