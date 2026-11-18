/* overlay.js — draws annotations onto the transparent canvas above the page,
 * and does hit-testing. Deliberately mirrors export.js so what you see on
 * screen is what lands in the PDF.
 */

import { state, findAnnot } from './state.js';
import { pdfToScreen, pdfBoxToScreen } from './viewer.js';
import { LINE_HEIGHT, headLenPx, ARROW_BACK, ARROW_SPREAD } from './geom.js';

export const CANVAS_FONTS = {
  sans: 'Helvetica, Arial, sans-serif',
  serif: '"Times New Roman", Times, serif',
  mono: '"Courier New", Courier, monospace',
  cjk: '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif',
};

export function cssFont(a, scale) {
  const px = a.size * scale;
  return `${a.bold ? '700 ' : ''}${px}px ${CANVAS_FONTS[a.fontKey] || CANVAS_FONTS.sans}`;
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

  for (const a of state.annots) {
    if (a.page !== state.pageNum) continue;
    drawAnnot(ctx, a, viewport);
  }

  if (preview) drawAnnot(ctx, preview, viewport, true);

  if (state.selectedId) {
    const sel = findAnnot(state.selectedId);
    if (sel && sel.page === state.pageNum) drawSelection(ctx, sel, viewport);
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
    case 'text': {
      const [x, y] = pdfToScreen([a.x, a.y], viewport);
      ctx.globalAlpha *= a.opacity ?? 1;
      ctx.fillStyle = rgba(a.color, 1);
      ctx.font = cssFont(a, viewport.scale);
      ctx.textBaseline = 'alphabetic';
      ctx.translate(x, y);
      if (a.rotate) ctx.rotate(-a.rotate * Math.PI / 180);

      const lines = String(a.text).split('\n');
      const lh = a.size * LINE_HEIGHT * viewport.scale;
      lines.forEach((ln, i) => {
        ctx.fillText(ln, 0, i * lh);
        if (a.bold && a.fontKey === 'cjk') ctx.fillText(ln, 0.4, i * lh); // faux bold
      });
      break;
    }
  }
  ctx.restore();
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
  const ctx = measurer();
  ctx.font = cssFont(a, 1); // scale 1 => result already in points
  const lines = String(a.text).split('\n');
  let w = 0;
  for (const ln of lines) w = Math.max(w, ctx.measureText(ln).width);
  const h = a.size * LINE_HEIGHT * Math.max(lines.length, 1);
  return { w, h, lines: lines.length };
}

/** Screen-space bounding box for any annotation. */
export function screenBBox(a, viewport = state.viewport) {
  switch (a.type) {
    case 'whiteout':
    case 'highlight':
      return pdfBoxToScreen(a, viewport);

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
      const m = textMetrics(a);
      const [x, y] = pdfToScreen([a.x, a.y], viewport);
      const s = viewport.scale;
      // ignore rotation for the box; good enough for picking
      return {
        x: x - 2, y: y - a.size * s,
        w: m.w * s + 4, h: m.h * s + a.size * s * 0.3,
      };
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
    } else if (a.type === 'arrow') {
      if (nearSegment(a, x, y, viewport)) return a;
    } else if (inBox(screenBBox(a, viewport), x, y, 2)) {
      return a;
    }
  }
  return null;
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
      a.x += dx; a.y += dy; break;
    case 'text':
      a.x += dx; a.y += dy; break;
    case 'ink':
      a.points = a.points.map(([x, y]) => [x + dx, y + dy]); break;
    case 'arrow':
      a.x1 += dx; a.y1 += dy; a.x2 += dx; a.y2 += dy; break;
  }
}

export { LINE_HEIGHT, headLenPx };
