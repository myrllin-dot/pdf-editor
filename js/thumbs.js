/* thumbs.js — the page-thumbnail rail.
 *
 * Each page is rendered once at thumbnail size and cached; annotations are
 * composited on top every repaint, so the rail shows where your edits are
 * without re-rendering the page itself. Rendering is driven by an
 * IntersectionObserver, so a 300-page file costs almost nothing until you
 * scroll.
 */

import { state } from './state.js';
import { drawOverlayTo } from './overlay.js';

const THUMB_W = 108;

let root = null;
let onSelect = null;
let observer = null;
const entries = new Map();     // pageNum -> { el, canvas, bitmap, viewport, rendering }

export function destroyThumbs() {
  observer?.disconnect();
  observer = null;
  entries.clear();
  if (root) root.innerHTML = '';
}

export function buildThumbs(container, opts = {}) {
  destroyThumbs();
  root = container;
  onSelect = opts.onSelect;
  if (!state.pdfDoc) return;

  const frag = document.createDocumentFragment();
  for (let n = 1; n <= state.numPages; n++) {
    const el = document.createElement('button');
    el.className = 'thumb';
    el.dataset.page = String(n);
    el.title = `第 ${n} 頁`;

    const cv = document.createElement('canvas');
    cv.className = 'thumb-canvas';
    const label = document.createElement('span');
    label.className = 'thumb-label';
    label.textContent = String(n);

    el.append(cv, label);
    el.addEventListener('click', () => onSelect?.(n));
    frag.appendChild(el);
    entries.set(n, { el, canvas: cv, bitmap: null, viewport: null, rendering: false });
  }
  root.appendChild(frag);

  observer = new IntersectionObserver(obs => {
    for (const o of obs) {
      if (!o.isIntersecting) continue;
      const n = Number(o.target.dataset.page);
      renderThumb(n);
    }
  }, { root, rootMargin: '300px 0px' });

  for (const { el } of entries.values()) observer.observe(el);
  setActiveThumb(state.pageNum);
}

/** Renders the page image once, then paints it. */
async function renderThumb(n) {
  const e = entries.get(n);
  if (!e || e.bitmap || e.rendering) { if (e?.bitmap) paintThumb(n); return; }
  e.rendering = true;
  try {
    const page = await state.pdfDoc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = THUMB_W / base.width;
    const viewport = page.getViewport({ scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.floor(viewport.width * dpr));
    off.height = Math.max(1, Math.floor(viewport.height * dpr));
    const ctx = off.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, off.width, off.height);
    await page.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    }).promise;

    e.bitmap = off;
    e.viewport = viewport;
    e.canvas.width = off.width;
    e.canvas.height = off.height;
    e.canvas.style.width = `${Math.round(viewport.width)}px`;
    e.canvas.style.height = `${Math.round(viewport.height)}px`;
    paintThumb(n);
  } catch {
    e.el.classList.add('thumb-failed');
  } finally {
    e.rendering = false;
  }
}

/** Composites the cached page image plus that page's annotations. */
export function paintThumb(n) {
  const e = entries.get(n);
  if (!e?.bitmap) return;
  const ctx = e.canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(e.bitmap, 0, 0);

  const has = state.annots.some(a => a.page === n);
  e.el.classList.toggle('has-marks', has);
  if (!has) return;

  const dpr = e.canvas.width / e.viewport.width;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawOverlayTo(ctx, e.viewport, n);
  ctx.restore();
}

/** Repaints one page's thumbnail (after its annotations changed). */
export const refreshThumb = n => paintThumb(n);

export function setActiveThumb(n) {
  for (const [p, e] of entries) e.el.classList.toggle('active', p === n);
  const e = entries.get(n);
  if (e) e.el.scrollIntoView({ block: 'nearest' });
}

export const thumbsReady = () => entries.size > 0;
