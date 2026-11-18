/* export.js — flattens annotations into a real PDF with pdf-lib.
 *
 * Mirrors overlay.js. All annotation coords arrive in PDF user-space points
 * (bottom-left origin, unrotated page), so they go straight to pdf-lib.
 */

import {
  PDFDocument, StandardFonts, rgb, degrees, BlendMode,
} from '../vendor/pdf-lib/pdf-lib.esm.min.js';
import fontkit from './fontkit-compat.js';
import { LINE_HEIGHT, headLenPx, ARROW_BACK, ARROW_SPREAD, hexToRgb01, needsCJK } from './geom.js';

export const CJK_FONT_URL = new URL('../vendor/fonts/NotoSansTC_400Regular.ttf', import.meta.url).href;

const hexRgb = hex => rgb(...hexToRgb01(hex));
export { needsCJK };

/* ---------- CJK font bytes, fetched once and cached ---------- */
let cjkBytesPromise = null;
export function loadCjkBytes(url = CJK_FONT_URL) {
  if (!cjkBytesPromise) {
    cjkBytesPromise = fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .catch(err => {
        cjkBytesPromise = null; // allow a retry
        throw new Error(`無法載入中文字體 (${err.message})`);
      });
  }
  return cjkBytesPromise;
}

/**
 * Lazily resolves pdf-lib font objects, embedding only what is actually used.
 * `fetchCjk` is injectable so this module can be unit-tested outside a browser.
 */
function makeFontResolver(doc, fetchCjk) {
  const cache = new Map();
  const std = {
    'sans:0': StandardFonts.Helvetica,
    'sans:1': StandardFonts.HelveticaBold,
    'serif:0': StandardFonts.TimesRoman,
    'serif:1': StandardFonts.TimesRomanBold,
    'mono:0': StandardFonts.Courier,
    'mono:1': StandardFonts.CourierBold,
  };

  return async function resolve(fontKey, bold, text) {
    // Auto-upgrade: non-Latin-1 text cannot be encoded by the standard 14.
    const key = (fontKey === 'cjk' || needsCJK(text)) ? 'cjk' : fontKey;
    const id = `${key}:${bold ? 1 : 0}`;
    if (cache.has(id)) return { font: cache.get(id), fauxBold: key === 'cjk' && bold, upgraded: key !== fontKey };

    let font;
    if (key === 'cjk') {
      doc.registerFontkit(fontkit);
      const bytes = await fetchCjk();
      font = await doc.embedFont(bytes, { subset: true });
      cache.set('cjk:0', font);
      cache.set('cjk:1', font); // one weight; bold is faked by double-draw
    } else {
      font = await doc.embedFont(std[id] || StandardFonts.Helvetica);
      cache.set(id, font);
    }
    return { font: cache.get(id), fauxBold: key === 'cjk' && bold, upgraded: key !== fontKey };
  };
}

/* ------------------------------------------------------------------ */
/* main entry                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {Uint8Array} originalBytes pristine source PDF
 * @param {Array} annots             annotations, each with .page (1-based)
 * @param {object} opts              { fetchCjk, onProgress }
 * @returns {Promise<{bytes:Uint8Array, usedCjk:boolean, upgradedCount:number}>}
 */
export async function buildPdf(originalBytes, annots, opts = {}) {
  const fetchCjk = opts.fetchCjk || loadCjkBytes;
  const progress = opts.onProgress || (() => {});

  progress('讀取 PDF…');
  const doc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
  const resolve = makeFontResolver(doc, fetchCjk);
  const pages = doc.getPages();

  let usedCjk = false, upgradedCount = 0;

  // Group by page, preserving creation order within each page.
  const byPage = new Map();
  for (const a of annots) {
    if (!byPage.has(a.page)) byPage.set(a.page, []);
    byPage.get(a.page).push(a);
  }

  const pageNums = [...byPage.keys()].sort((x, y) => x - y);
  let done = 0;

  for (const pn of pageNums) {
    const page = pages[pn - 1];
    if (!page) continue;

    const pageRot = page.getRotation().angle % 360;
    progress(`套用第 ${pn} 頁… (${++done}/${pageNums.length})`);

    for (const a of byPage.get(pn)) {
      switch (a.type) {
        case 'whiteout':
          page.drawRectangle({
            x: a.x, y: a.y, width: a.w, height: a.h, color: hexRgb(a.color),
          });
          break;

        case 'highlight':
          page.drawRectangle({
            x: a.x, y: a.y, width: a.w, height: a.h,
            color: hexRgb(a.color),
            opacity: a.alpha ?? 0.35,
            blendMode: BlendMode.Multiply,
          });
          break;

        case 'rect':
          page.drawRectangle({
            x: a.x, y: a.y, width: a.w, height: a.h,
            ...(a.fill ? { color: hexRgb(a.fill), opacity: a.fillAlpha ?? 1 } : {}),
            ...(a.width ? { borderColor: hexRgb(a.color), borderWidth: a.width } : {}),
          });
          break;

        case 'ellipse':
          // pdf-lib takes a centre plus radii, we store a bounding box.
          page.drawEllipse({
            x: a.x + a.w / 2, y: a.y + a.h / 2,
            xScale: a.w / 2, yScale: a.h / 2,
            ...(a.fill ? { color: hexRgb(a.fill), opacity: a.fillAlpha ?? 1 } : {}),
            ...(a.width ? { borderColor: hexRgb(a.color), borderWidth: a.width } : {}),
          });
          break;

        case 'line':
          page.drawLine({
            start: { x: a.x1, y: a.y1 },
            end: { x: a.x2, y: a.y2 },
            thickness: a.width,
            color: hexRgb(a.color),
            lineCap: 1,
          });
          break;

        case 'ink': {
          const pts = a.points;
          if (pts.length < 2) break;
          const col = hexRgb(a.color);
          for (let i = 1; i < pts.length; i++) {
            page.drawLine({
              start: { x: pts[i - 1][0], y: pts[i - 1][1] },
              end: { x: pts[i][0], y: pts[i][1] },
              thickness: a.width,
              color: col,
              lineCap: 1, // round
            });
          }
          break;
        }

        case 'arrow': {
          const col = hexRgb(a.color);
          const head = headLenPx(a.width);
          const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
          const back = head * ARROW_BACK;

          page.drawLine({
            start: { x: a.x1, y: a.y1 },
            end: { x: a.x2 - Math.cos(ang) * back, y: a.y2 - Math.sin(ang) * back },
            thickness: a.width,
            color: col,
            lineCap: 1,
          });

          // Filled head. drawSvgPath takes y-down coords anchored at (x,y),
          // so PDF-space dy is negated when written into the path.
          const spread = ARROW_SPREAD;
          const c1 = [-Math.cos(ang - spread) * head, Math.sin(ang - spread) * head];
          const c2 = [-Math.cos(ang + spread) * head, Math.sin(ang + spread) * head];
          page.drawSvgPath(
            `M 0 0 L ${c1[0].toFixed(3)} ${c1[1].toFixed(3)} L ${c2[0].toFixed(3)} ${c2[1].toFixed(3)} Z`,
            { x: a.x2, y: a.y2, color: col, borderWidth: 0 },
          );
          break;
        }

        case 'text': {
          const { font, fauxBold, upgraded } = await resolve(a.fontKey, a.bold, a.text);
          if (upgraded) upgradedCount++;
          if (font.name && /Noto/i.test(font.name)) usedCjk = true;

          const col = hexRgb(a.color);
          const lines = String(a.text).split('\n');
          const lh = a.size * LINE_HEIGHT;
          const rot = degrees(pageRot + (a.rotate || 0));
          const theta = (pageRot + (a.rotate || 0)) * Math.PI / 180;

          lines.forEach((ln, i) => {
            if (!ln) return;
            // Step down one line *in the rotated frame* so multi-line
            // blocks stay correct on rotated pages and watermarks.
            const off = -i * lh;
            const x = a.x - Math.sin(theta) * off;
            const y = a.y + Math.cos(theta) * off;

            const base = {
              x, y, size: a.size, font, color: col,
              rotate: rot, opacity: a.opacity ?? 1,
            };
            page.drawText(ln, base);
            if (fauxBold) page.drawText(ln, { ...base, x: x + 0.4 });
          });
          break;
        }
      }
    }
  }

  progress('寫出檔案…');
  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, usedCjk, upgradedCount };
}
