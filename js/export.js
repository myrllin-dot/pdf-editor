/* export.js — flattens annotations into a real PDF with pdf-lib.
 *
 * Mirrors overlay.js. All annotation coords arrive in PDF user-space points
 * (bottom-left origin, unrotated page), so they go straight to pdf-lib.
 */

import {
  PDFDocument, StandardFonts, rgb, degrees, BlendMode,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix,
  setCharacterSpacing, setTextRenderingMode, setLineWidth, setStrokingRgbColor,
  TextRenderingMode,
} from '../vendor/pdf-lib/pdf-lib.esm.min.js';
import fontkit from './fontkit-compat.js';
import { LINE_HEIGHT, headLenPx, ARROW_BACK, ARROW_SPREAD, hexToRgb01, needsCJK } from './geom.js';
import { layoutText, echoOffsets } from './textlayout.js';
import * as fontRegistry from './fonts.js';

const hexRgb = hex => rgb(...hexToRgb01(hex));
export { needsCJK };

/**
 * Resolves a font key to a pdf-lib font, embedding only what is actually used.
 *
 * The lookups are injectable so this module can be exercised headlessly: in a
 * browser they come from the font registry, in tests from plain fixtures.
 */
function makeFontResolver(doc, opts) {
  const info = opts.getFontInfo || fontRegistry.getFont;
  const bytesFor = opts.getFontBytes || fontRegistry.fontBytes;
  const cjkDefault = opts.defaultCjkKey || fontRegistry.defaultCjkKey;
  const cache = new Map();

  return async function resolve(fontKey, bold, italic, text) {
    let key = fontKey;
    let upgraded = false;

    // The standard 14 cannot encode anything outside Latin-1, so text that
    // needs more is moved onto an embedded face automatically.
    if (info(key).kind === 'builtin' && needsCJK(text)) {
      const fallback = cjkDefault();
      if (!fallback) {
        throw new Error('這段文字含有標準字體無法編碼的字元，但找不到可用的中文字體。');
      }
      key = fallback;
      upgraded = true;
    }

    const desc = info(key);
    const embedded = desc.kind !== 'builtin';
    const variant = bold && italic ? 'bi' : bold ? 'b' : italic ? 'i' : 'r';
    const id = `${key}:${embedded ? 'x' : variant}`;

    if (!cache.has(id)) {
      if (embedded) {
        doc.registerFontkit(fontkit);
        const bytes = await bytesFor(key);
        const font = await doc.embedFont(bytes, { subset: true });
        // One weight per file; bold is faked by drawing twice.
        cache.set(`${key}:x`, font);     // one file serves every variant
      } else {
        const names = desc.std || {};
        const name = names[variant] || names.r || 'Helvetica';
        cache.set(id, await doc.embedFont(StandardFonts[name] || StandardFonts.Helvetica));
      }
    }

    return { font: cache.get(id), fauxBold: embedded && bold, upgraded, embedded };
  };
}

/* ------------------------------------------------------------------ */
/* text                                                                */
/* ------------------------------------------------------------------ */

const ITALIC_SHEAR = Math.tan(12 * Math.PI / 180);

/**
 * Writes one text annotation. Mirrors drawTextAnnot in overlay.js.
 *
 * Everything is drawn inside a single transform anchored at (a.x, a.y), which
 * is what keeps rotation, page rotation and faux italic from fighting each
 * other: lines are positioned relative to the anchor and the matrix does the
 * rest.
 */
function drawTextAnnot(page, a, font, { fauxBold, embedded, pageRot }) {
  const measure = str => font.widthOfTextAtSize(str, a.size);
  const L = layoutText(a, measure);

  const theta = ((pageRot || 0) + (a.rotate || 0)) * Math.PI / 180;
  const shear = a.italic && embedded ? ITALIC_SHEAR : 0;
  const cos = Math.cos(theta), sin = Math.sin(theta);

  // rotate · shear, then translated to the anchor
  const m = [cos, sin, cos * shear - sin, sin * shear + cos, a.x, a.y];

  const eff = a.effect || { type: 'none' };
  const ls = a.letterSpacing || 0;
  const col = hexRgb(a.color);
  const opacity = a.opacity ?? 1;

  const stateOps = [pushGraphicsState(), concatTransformationMatrix(...m)];
  if (ls) stateOps.push(setCharacterSpacing(ls));
  page.pushOperators(...stateOps);

  const at = ln => ({ x: ln.x - a.x, y: ln.baselineY - a.y });
  const base = { size: a.size, font, color: col, opacity };

  // echo copies sit behind everything else
  if (eff.type === 'echo') {
    const echoCol = hexRgb(eff.color || a.color);
    for (const o of echoOffsets(eff)) {
      for (const ln of L.lines) {
        if (!ln.text) continue;
        const p = at(ln);
        page.drawText(ln.text, { ...base, color: echoCol, opacity: opacity * o.alpha,
                                 x: p.x + o.dx, y: p.y + o.dy });
      }
    }
  }

  // Tr 1 = stroke only, Tr 2 = fill then stroke.
  const strokeMode = eff.type === 'hollow' ? TextRenderingMode.Outline
                   : eff.type === 'outline' ? TextRenderingMode.FillAndOutline
                   : null;
  if (strokeMode !== null) {
    const sc = hexToRgb01(eff.type === 'hollow' ? a.color : (eff.color || '#000000'));
    page.pushOperators(
      setTextRenderingMode(strokeMode),
      setLineWidth(Math.max(eff.width ?? (eff.type === 'hollow' ? 1 : 1.5), 0.1)),
      setStrokingRgbColor(sc[0], sc[1], sc[2]),
    );
  }

  for (const ln of L.lines) {
    if (!ln.text) continue;
    const p = at(ln);
    page.drawText(ln.text, { ...base, x: p.x, y: p.y });
    if (fauxBold && strokeMode === null) {
      page.drawText(ln.text, { ...base, x: p.x + 0.4, y: p.y });
    }
  }

  if (strokeMode !== null) page.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));

  if (a.underline) {
    const th = Math.max(a.size * 0.055, 0.3);
    for (const ln of L.lines) {
      if (!ln.text) continue;
      const p = at(ln);
      page.drawRectangle({
        x: p.x, y: p.y - a.size * 0.13 - th, width: ln.width, height: th,
        color: col, opacity,
      });
    }
  }

  page.pushOperators(popGraphicsState());
}

/* ------------------------------------------------------------------ */
/* main entry                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {Uint8Array} originalBytes pristine source PDF
 * @param {Array} annots             annotations, each with .page (1-based)
 * @param {object} opts              { onProgress, getFontInfo, getFontBytes, defaultCjkKey }
 * @returns {Promise<{bytes:Uint8Array, usedCjk:boolean, upgradedCount:number}>}
 */
export async function buildPdf(originalBytes, annots, opts = {}) {
  const progress = opts.onProgress || (() => {});

  progress('讀取 PDF…');
  const doc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
  const resolve = makeFontResolver(doc, opts);
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
            opacity: a.opacity ?? 1,
          });
          break;

        case 'highlight':
          page.drawRectangle({
            x: a.x, y: a.y, width: a.w, height: a.h,
            color: hexRgb(a.color),
            opacity: (a.alpha ?? 0.35) * (a.opacity ?? 1),
            blendMode: BlendMode.Multiply,
          });
          break;

        case 'rect':
          page.drawRectangle({
            x: a.x, y: a.y, width: a.w, height: a.h,
            ...(a.fill ? { color: hexRgb(a.fill), opacity: (a.fillAlpha ?? 1) * (a.opacity ?? 1) } : {}),
            ...(a.width ? { borderColor: hexRgb(a.color), borderWidth: a.width, borderOpacity: a.opacity ?? 1 } : {}),
          });
          break;

        case 'ellipse':
          // pdf-lib takes a centre plus radii, we store a bounding box.
          page.drawEllipse({
            x: a.x + a.w / 2, y: a.y + a.h / 2,
            xScale: a.w / 2, yScale: a.h / 2,
            ...(a.fill ? { color: hexRgb(a.fill), opacity: (a.fillAlpha ?? 1) * (a.opacity ?? 1) } : {}),
            ...(a.width ? { borderColor: hexRgb(a.color), borderWidth: a.width, borderOpacity: a.opacity ?? 1 } : {}),
          });
          break;

        case 'line':
          page.drawLine({
            start: { x: a.x1, y: a.y1 },
            end: { x: a.x2, y: a.y2 },
            thickness: a.width,
            color: hexRgb(a.color),
            opacity: a.opacity ?? 1,
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
              opacity: a.opacity ?? 1,
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
            opacity: a.opacity ?? 1,
            lineCap: 1,
          });

          // Filled head. drawSvgPath takes y-down coords anchored at (x,y),
          // so PDF-space dy is negated when written into the path.
          const spread = ARROW_SPREAD;
          const c1 = [-Math.cos(ang - spread) * head, Math.sin(ang - spread) * head];
          const c2 = [-Math.cos(ang + spread) * head, Math.sin(ang + spread) * head];
          page.drawSvgPath(
            `M 0 0 L ${c1[0].toFixed(3)} ${c1[1].toFixed(3)} L ${c2[0].toFixed(3)} ${c2[1].toFixed(3)} Z`,
            { x: a.x2, y: a.y2, color: col, opacity: a.opacity ?? 1, borderWidth: 0 },
          );
          break;
        }

        case 'text': {
          const { font, fauxBold, upgraded, embedded } = await resolve(a.fontKey, a.bold, a.italic, a.text);
          if (upgraded) upgradedCount++;
          if (embedded) usedCjk = true;
          drawTextAnnot(page, a, font, { fauxBold, embedded, pageRot });
          break;
        }
      }
    }
  }

  progress('寫出檔案…');
  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, usedCjk, upgradedCount };
}
