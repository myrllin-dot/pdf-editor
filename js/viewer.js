/* viewer.js — pdf.js document loading and page rendering. */

import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';
import { state } from './state.js';

const V = '../vendor/pdfjs/';
pdfjs.GlobalWorkerOptions.workerSrc = new URL(V + 'pdf.worker.min.mjs', import.meta.url).href;

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
  state.textItems = await extractTextItems(page, viewport);
  return viewport;
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

  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim() || !it.transform) continue;

    const [a, b, c, d, e, f] = it.transform;
    // Glyph size = length of the transformed unit-y vector.
    const size = Math.hypot(c, d) || Math.hypot(a, b) || 10;
    const width = it.width || 0;
    const height = it.height || size;

    // pdf.js text transform origin is the baseline-left of the run.
    const pdfBox = {
      x: e,
      y: f - size * 0.22,         // drop to roughly the descender line
      w: width,
      h: height * 1.18 || size * 1.18,
    };

    const style = tc.styles?.[it.fontName];
    items.push({
      str: it.str,
      size,
      pdf: pdfBox,
      screen: pdfBoxToScreen(pdfBox, viewport),
      fontFamily: style?.fontFamily || 'sans-serif',
      bold: /bold|black|heavy|semibold/i.test(style?.fontFamily || it.fontName || ''),
      italic: /italic|oblique/i.test(style?.fontFamily || it.fontName || ''),
      hasCJK: /[　-鿿豈-﫿＀-￯]/.test(it.str),
    });
  }
  return items;
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
