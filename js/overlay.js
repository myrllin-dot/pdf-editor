/* overlay.js — draws annotations onto the transparent canvas above the page,
 * and does hit-testing. Deliberately mirrors export.js so what you see on
 * screen is what lands in the PDF.
 */

import { state, findAnnot } from './state.js';
import { pdfToScreen, pdfBoxToScreen } from './viewer.js';
import { LINE_HEIGHT, headLenPx, ARROW_BACK, ARROW_SPREAD } from './geom.js';
import { cssFamily, getFont, defaultCjkKey } from './fonts.js';
import { needsCJK } from './geom.js';
import { layoutText, lineWidth, echoOffsets, ASCENT } from './textlayout.js';

/** Kept for callers that still import it; the registry is the real source. */
export const CANVAS_FONTS = {
  sans: 'Helvetica, Arial, sans-serif',
  serif: '"Times New Roman", Times, serif',
  mono: '"Courier New", Courier, monospace',
};

/**
 * The export auto-upgrades a whole run to a CJK face when the standard fonts
 * cannot encode it, so the preview has to make the same substitution or the
 * Latin half of a mixed string would be previewed in the wrong typeface.
 */
export function effectiveFontKey(a) {
  if (getFont(a.fontKey).kind === 'builtin' && needsCJK(a.text)) {
    return defaultCjkKey() || a.fontKey;
  }
  return a.fontKey;
}

export function cssFont(a, scale) {
  const px = a.size * scale;
  return `${a.italic ? 'italic ' : ''}${a.bold ? '700 ' : ''}${px}px ${cssFamily(effectiveFontKey(a))}`;
}

let measureCanvas = null;
/**
 * Measuring function for layoutText, in PDF points.
 * With letter spacing on we sum per character, because that is how the text
 * is then drawn here and how Tc lays it out in the PDF; measuring the whole
 * string instead would include kerning the output does not have.
 */
export function makeMeasure(a) {
  if (!measureCanvas) measureCanvas = document.createElement('canvas').getContext('2d');
  const ctx = measureCanvas;
  ctx.font = cssFont(a, 1);                 // scale 1 => result is already points
  if (!a.letterSpacing) return str => ctx.measureText(str).width;
  return str => {
    let w = 0;
    for (const ch of str) w += ctx.measureText(ch).width;
    return w;
  };
}

const rgba = (hex, alpha = 1) => {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(f, 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${alpha})`;
};

/* ------------------------------------------------------------------ */
/* main draw                                                           */
/* ------------------------------------------------------------------ */

export function drawOverlay(canvas, viewport, { preview = null } = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);

  drawOverlayTo(ctx, viewport, state.pageNum, { preview, showSelection: true });
}

/**
 * Draws one page's annotations into an arbitrary 2D context. The main canvas
 * and the thumbnail rail both go through here, which is why a mark always
 * looks the same in the rail as it does full size.
 */
export function drawOverlayTo(ctx, viewport, pageNum, { preview = null, showSelection = false } = {}) {
  for (const a of state.annots) {
    if (a.page !== pageNum) continue;
    drawAnnot(ctx, a, viewport);
  }

  if (preview) drawAnnot(ctx, preview, viewport, true);

  if (showSelection && state.selectedId) {
    const sel = findAnnot(state.selectedId);
    if (sel && sel.page === pageNum) drawSelection(ctx, sel, viewport);
  }
}

function drawAnnot(ctx, a, viewport, isPreview = false) {
  ctx.save();
  if (isPreview) ctx.globalAlpha = 0.75;

  switch (a.type) {
    case 'whiteout': {
      const r = pdfBoxToScreen(a, viewport);
      ctx.fillStyle = rgba(a.color, 1);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      break;
    }
    case 'highlight': {
      const r = pdfBoxToScreen(a, viewport);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = rgba(a.color, a.alpha ?? 0.35);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      break;
    }
    case 'rect':
    case 'ellipse': {
      const r = pdfBoxToScreen(a, viewport);
      const lw = Math.max((a.width || 0) * viewport.scale, a.width ? 0.75 : 0);
      ctx.lineWidth = lw;
      ctx.strokeStyle = rgba(a.color, 1);
      if (a.fill) ctx.fillStyle = rgba(a.fill, a.fillAlpha ?? 1);

      ctx.beginPath();
      if (a.type === 'rect') {
        ctx.rect(r.x + lw / 2, r.y + lw / 2, Math.max(r.w - lw, 0), Math.max(r.h - lw, 0));
      } else {
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2,
                    Math.max(r.w / 2 - lw / 2, 0), Math.max(r.h / 2 - lw / 2, 0),
                    0, 0, Math.PI * 2);
      }
      if (a.fill) ctx.fill();
      if (lw > 0) ctx.stroke();
      break;
    }
    case 'line': {
      const [x1, y1] = pdfToScreen([a.x1, a.y1], viewport);
      const [x2, y2] = pdfToScreen([a.x2, a.y2], viewport);
      ctx.strokeStyle = rgba(a.color, 1);
      ctx.lineWidth = Math.max(a.width * viewport.scale, 0.75);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      break;
    }
    case 'ink': {
      if (a.points.length < 2) break;
      ctx.strokeStyle = rgba(a.color, 1);
      ctx.lineWidth = Math.max(a.width * viewport.scale, 0.75);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      a.points.forEach((p, i) => {
        const [x, y] = pdfToScreen(p, viewport);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
      break;
    }
    case 'arrow': {
      const [x1, y1] = pdfToScreen([a.x1, a.y1], viewport);
      const [x2, y2] = pdfToScreen([a.x2, a.y2], viewport);
      const w = Math.max(a.width * viewport.scale, 0.75);
      const head = headLenPx(a.width) * viewport.scale;
      const ang = Math.atan2(y2 - y1, x2 - x1);

      ctx.strokeStyle = rgba(a.color, 1);
      ctx.fillStyle = rgba(a.color, 1);
      ctx.lineWidth = w;
      ctx.lineCap = 'round';

      // stop the shaft short so the head tip is the true endpoint
      const back = Math.max(head * ARROW_BACK, 0);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2 - Math.cos(ang) * back, y2 - Math.sin(ang) * back);
      ctx.stroke();

      const spread = ARROW_SPREAD;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - Math.cos(ang - spread) * head, y2 - Math.sin(ang - spread) * head);
      ctx.lineTo(x2 - Math.cos(ang + spread) * head, y2 - Math.sin(ang + spread) * head);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'text':
      drawTextAnnot(ctx, a, viewport);
      break;
  }
  ctx.restore();
}

/**
 * Draws a text annotation: layout, then effects, then the glyphs.
 * Mirrors the writer in export.js step for step.
 */
function drawTextAnnot(ctx, a, viewport) {
  const scale = viewport.scale;
  const L = layoutText(a, makeMeasure(a));
  const [ax, ay] = pdfToScreen([a.x, a.y], viewport);

  ctx.globalAlpha *= a.opacity ?? 1;
  ctx.font = cssFont(a, scale);
  ctx.textBaseline = 'alphabetic';
  ctx.translate(ax, ay);
  if (a.rotate) ctx.rotate(-a.rotate * Math.PI / 180);

  const eff = a.effect || { type: 'none' };
  const ls = (a.letterSpacing || 0) * scale;

  // Positions are worked out in PDF space, then expressed relative to the
  // anchor so rotation stays about the anchor point.
  const place = ln => [(ln.x - a.x) * scale, -(ln.baselineY - a.y) * scale];

  const paint = (mode, color, lineW) => {
    for (const ln of L.lines) {
      if (!ln.text) continue;
      const [x, y] = place(ln);
      if (mode === 'fill') { ctx.fillStyle = color; drawRun(ctx, ln.text, x, y, ls); }
      else {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(lineW, 0.2);
        ctx.lineJoin = 'round';
        drawRun(ctx, ln.text, x, y, ls, true);
      }
    }
  };

  if (eff.type === 'echo') {
    for (const o of echoOffsets(eff)) {
      const save = ctx.globalAlpha;
      ctx.globalAlpha = save * o.alpha;
      ctx.fillStyle = rgba(eff.color || a.color, 1);
      for (const ln of L.lines) {
        if (!ln.text) continue;
        const [x, y] = place(ln);
        drawRun(ctx, ln.text, x + o.dx * scale, y - o.dy * scale, ls);
      }
      ctx.globalAlpha = save;
    }
  }

  if (eff.type === 'hollow') {
    paint('stroke', rgba(a.color, 1), (eff.width ?? 1) * scale);
  } else {
    if (eff.type === 'outline') {
      paint('stroke', rgba(eff.color || '#000000', 1), (eff.width ?? 1.5) * scale * 2);
    }
    paint('fill', rgba(a.color, 1));
    if (a.bold && !/^(sans|serif|mono)$/.test(a.fontKey)) {
      // faux bold for single-weight embedded faces
      ctx.fillStyle = rgba(a.color, 1);
      for (const ln of L.lines) {
        if (!ln.text) continue;
        const [x, y] = place(ln);
        drawRun(ctx, ln.text, x + 0.4 * scale, y, ls);
      }
    }
  }

  if (a.underline) {
    ctx.fillStyle = rgba(a.color, 1);
    const th = Math.max(a.size * 0.055 * scale, 0.6);
    for (const ln of L.lines) {
      if (!ln.text) continue;
      const [x, y] = place(ln);
      ctx.fillRect(x, y + a.size * 0.13 * scale, ln.width * scale, th);
    }
  }
}

/** One line, drawn per character only when letter spacing demands it. */
function drawRun(ctx, text, x, y, ls, stroke = false) {
  if (!ls) {
    stroke ? ctx.strokeText(text, x, y) : ctx.fillText(text, x, y);
    return;
  }
  let cx = x;
  for (const ch of text) {
    stroke ? ctx.strokeText(ch, cx, y) : ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + ls;
  }
}

function drawSelection(ctx, a, viewport) {
  const b = screenBBox(a, viewport);
  if (!b) return;
  ctx.save();
  ctx.strokeStyle = '#6aa3ff';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* bounding boxes & hit-testing                                        */
/* ------------------------------------------------------------------ */

let measureCtx = null;
function measurer() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

/** Width/height of a text annotation in PDF points. */
export function textMetrics(a) {
  const L = layoutText(a, makeMeasure(a));
  return { w: L.blockW, h: L.blockH, lines: L.lines.length };
}

/** Screen-space bounding box for any annotation. */
export function screenBBox(a, viewport = state.viewport) {
  switch (a.type) {
    case 'whiteout':
    case 'highlight':
    case 'rect':
    case 'ellipse': {
      const b = pdfBoxToScreen(a, viewport);
      const pad = ((a.width || 0) * viewport.scale) / 2;
      return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    }

    case 'line': {
      const [x1, y1] = pdfToScreen([a.x1, a.y1], viewport);
      const [x2, y2] = pdfToScreen([a.x2, a.y2], viewport);
      const pad = Math.max(a.width * viewport.scale, 4);
      return {
        x: Math.min(x1, x2) - pad, y: Math.min(y1, y2) - pad,
        w: Math.abs(x2 - x1) + pad * 2, h: Math.abs(y2 - y1) + pad * 2,
      };
    }

    case 'rect':
    case 'ellipse': {
      const r = pdfBoxToScreen(a, viewport);
      const lw = Math.max((a.width || 0) * viewport.scale, a.width ? 0.75 : 0);
      ctx.lineWidth = lw;
      ctx.strokeStyle = rgba(a.color, 1);
      if (a.fill) ctx.fillStyle = rgba(a.fill, a.fillAlpha ?? 1);

      ctx.beginPath();
      if (a.type === 'rect') {
        ctx.rect(r.x + lw / 2, r.y + lw / 2, Math.max(r.w - lw, 0), Math.max(r.h - lw, 0));
      } else {
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2,
                    Math.max(r.w / 2 - lw / 2, 0), Math.max(r.h / 2 - lw / 2, 0),
                    0, 0, Math.PI * 2);
      }
      if (a.fill) ctx.fill();
      if (lw > 0) ctx.stroke();
      break;
    }
    case 'line': {
      const [x1, y1] = pdfToScreen([a.x1, a.y1], viewport);
      const [x2, y2] = pdfToScreen([a.x2, a.y2], viewport);
      ctx.strokeStyle = rgba(a.color, 1);
      ctx.lineWidth = Math.max(a.width * viewport.scale, 0.75);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      break;
    }
    case 'ink': {
      if (!a.points.length) return null;
      const pts = a.points.map(p => pdfToScreen(p, viewport));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const pad = (a.width * viewport.scale) / 2 + 1;
      return {
        x: Math.min(...xs) - pad, y: Math.min(...ys) - pad,
        w: Math.max(...xs) - Math.min(...xs) + pad * 2,
        h: Math.max(...ys) - Math.min(...ys) + pad * 2,
      };
    }

    case 'arrow': {
      const [x1, y1] = pdfToScreen([a.x1, a.y1], viewport);
      const [x2, y2] = pdfToScreen([a.x2, a.y2], viewport);
      const pad = headLenPx(a.width) * viewport.scale;
      return {
        x: Math.min(x1, x2) - pad, y: Math.min(y1, y2) - pad,
        w: Math.abs(x2 - x1) + pad * 2, h: Math.abs(y2 - y1) + pad * 2,
      };
    }

    case 'text': {
      const L = layoutText(a, makeMeasure(a));
      return pdfBoxToScreen(
        { x: L.blockX, y: L.blockY, w: Math.max(L.blockW, 1), h: Math.max(L.blockH, 1) },
        viewport,
      );
    }
  }
  return null;
}

const inBox = (b, x, y, slack = 0) =>
  b && x >= b.x - slack && x <= b.x + b.w + slack && y >= b.y - slack && y <= b.y + b.h + slack;

/** Topmost annotation under a screen point, or null. */
export function hitTest(x, y, viewport = state.viewport) {
  const onPage = state.annots.filter(a => a.page === state.pageNum);
  for (let i = onPage.length - 1; i >= 0; i--) {
    const a = onPage[i];
    if (a.type === 'ink') {
      if (nearPolyline(a, x, y, viewport)) return a;
    } else if (a.type === 'arrow' || a.type === 'line') {
      const seg = a.type === 'line'
        ? { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, width: a.width }
        : a;
      if (nearSegment(seg, x, y, viewport)) return a;
    } else if ((a.type === 'rect' || a.type === 'ellipse') && !a.fill) {
      // Hollow shape: only the stroke is clickable, so you can still reach
      // whatever sits inside it.
      if (nearOutline(a, x, y, viewport)) return a;
    } else if (inBox(screenBBox(a, viewport), x, y, 2)) {
      return a;
    }
  }
  return null;
}

/** True near the border of an unfilled rect/ellipse, false well inside it. */
function nearOutline(a, x, y, viewport) {
  const tol = Math.max((a.width || 1) * viewport.scale, 5);
  const b = pdfBoxToScreen(a, viewport);
  if (!inBox(b, x, y, tol)) return false;

  if (a.type === 'rect') {
    const inner = { x: b.x + tol, y: b.y + tol, w: b.w - tol * 2, h: b.h - tol * 2 };
    return !(inner.w > 0 && inner.h > 0 && inBox(inner, x, y, 0));
  }
  const rx = b.w / 2, ry = b.h / 2;
  if (rx <= 0 || ry <= 0) return false;
  const nx = (x - (b.x + rx)) / rx, ny = (y - (b.y + ry)) / ry;
  const d = Math.hypot(nx, ny);                     // 1 == on the ellipse
  const band = tol / Math.min(rx, ry);
  return Math.abs(d - 1) <= band;
}

function nearPolyline(a, x, y, viewport) {
  const tol = Math.max(a.width * viewport.scale, 6);
  const pts = a.points.map(p => pdfToScreen(p, viewport));
  for (let i = 1; i < pts.length; i++) {
    if (distToSeg(x, y, pts[i - 1], pts[i]) <= tol) return true;
  }
  return false;
}

function nearSegment(a, x, y, viewport) {
  const tol = Math.max(a.width * viewport.scale, 6);
  const p1 = pdfToScreen([a.x1, a.y1], viewport);
  const p2 = pdfToScreen([a.x2, a.y2], viewport);
  return distToSeg(x, y, p1, p2) <= tol;
}

function distToSeg(px, py, [x1, y1], [x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Moves an annotation by a screen-space delta, converted to PDF points. */
export function moveAnnot(a, dxScreen, dyScreen, viewport = state.viewport) {
  const s = viewport.scale;
  const dx = dxScreen / s;
  const dy = -dyScreen / s; // screen y grows down, PDF y grows up

  switch (a.type) {
    case 'whiteout':
    case 'highlight':
    case 'rect':
    case 'ellipse':
      a.x += dx; a.y += dy; break;
    case 'line':
      a.x1 += dx; a.y1 += dy; a.x2 += dx; a.y2 += dy; break;
    case 'text':
      a.x += dx; a.y += dy; break;
    case 'ink':
      a.points = a.points.map(([x, y]) => [x + dx, y + dy]); break;
    case 'arrow':
      a.x1 += dx; a.y1 += dy; a.x2 += dx; a.y2 += dy; break;
  }
}

export { LINE_HEIGHT, headLenPx };
