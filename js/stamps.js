/* stamps.js — batch text across a page range.
 *
 * Page numbers, footers and watermarks all produce ordinary `text`
 * annotations, so they are undoable, individually movable afterwards, and
 * travel through exactly the same export path as hand-placed text.
 */

import { state, nextId, commit } from './state.js';
import { pageSizePts } from './viewer.js';
import { textMetrics } from './overlay.js';
import { LINE_HEIGHT } from './geom.js';

const MARGIN = 28; // points from the page edge

/**
 * Parses "all", "1-5,8", "3-" into a sorted list of 1-based page numbers.
 * Out-of-range and malformed parts are ignored rather than throwing.
 */
export function parseRange(spec, total) {
  const s = String(spec || '').trim().toLowerCase();
  if (!s || s === 'all' || s === '*') {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const out = new Set();
  for (const part of s.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d+)\s*-\s*(\d*)$/);
    if (m) {
      const a = Math.max(1, parseInt(m[1], 10));
      const b = m[2] ? Math.min(total, parseInt(m[2], 10)) : total;
      for (let i = a; i <= b; i++) out.add(i);
    } else if (/^\d+$/.test(p)) {
      const n = parseInt(p, 10);
      if (n >= 1 && n <= total) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Anchor for a corner code.
 *
 * Corners are what the *reader* sees, so they are computed on the displayed
 * page (which is the unrotated page turned by /Rotate) and then mapped back
 * into unrotated user space, where pdf-lib draws. Without this step a footer
 * on a /Rotate 90 page lands along the left edge instead of the bottom.
 */
function anchor(pos, W, H, rot, textW, size) {
  const swapped = rot === 90 || rot === 270;
  const Wd = swapped ? H : W;          // displayed width
  const Hd = swapped ? W : H;          // displayed height

  // Baseline position in displayed space; dy measured from the top edge.
  const dx =
    pos[1] === 'l' ? MARGIN :
    pos[1] === 'r' ? Wd - MARGIN - textW :
    (Wd - textW) / 2;
  const dy = pos[0] === 't' ? MARGIN + size : Hd - MARGIN;

  switch (rot) {
    case 90:  return { x: dy,     y: dx };
    case 180: return { x: W - dx, y: dy };
    case 270: return { x: W - dy, y: H - dx };
    default:  return { x: dx,     y: H - dy };
  }
}

async function sizesFor(pages) {
  const out = new Map();
  for (const p of pages) out.set(p, await pageSizePts(p));
  return out;
}

/**
 * @param {object} cfg
 *   kind: 'pagenum' | 'footer' | 'watermark'
 *   range, color, cjk, plus per-kind fields
 * @returns {Promise<number>} how many pages were stamped
 */
export async function applyStamp(cfg) {
  const pages = parseRange(cfg.range, state.numPages);
  if (!pages.length) return 0;

  const sizes = await sizesFor(pages);
  const made = [];

  pages.forEach((pn, i) => {
    const { w: pw, h: ph, rotation: rot } = sizes.get(pn);

    if (cfg.kind === 'pagenum') {
      const label = String(cfg.format || '{n}')
        .replace(/\{n\}/g, String(cfg.start + i))
        .replace(/\{total\}/g, String(pages.length))
        .replace(/\{page\}/g, String(pn))
        .replace(/\{pages\}/g, String(state.numPages));
      if (!label) return;
      const probe = { text: label, size: cfg.size, fontKey: cfg.cjk ? 'cjk' : 'sans', bold: false };
      const { x, y } = anchor(cfg.pos, pw, ph, rot, textMetrics(probe).w, cfg.size);
      made.push({
        id: nextId(), type: 'text', page: pn, x, y, text: label,
        size: cfg.size, fontKey: probe.fontKey, bold: false, color: cfg.color,
      });

    } else if (cfg.kind === 'footer') {
      if (!cfg.text) return;
      const probe = { text: cfg.text, size: cfg.size, fontKey: cfg.cjk ? 'cjk' : 'sans', bold: false };
      const { x, y } = anchor(cfg.pos, pw, ph, rot, textMetrics(probe).w, cfg.size);
      made.push({
        id: nextId(), type: 'text', page: pn, x, y, text: cfg.text,
        size: cfg.size, fontKey: probe.fontKey, bold: false, color: cfg.color,
      });

    } else if (cfg.kind === 'watermark') {
      if (!cfg.text) return;
      const fontKey = cfg.cjk ? 'cjk' : 'sans';
      const m = textMetrics({ text: cfg.text, size: cfg.size, fontKey, bold: false });
      // Glyphs are drawn at (pageRotation + angle), so the centring offset has
      // to be taken along that same direction.
      const rad = (rot + (cfg.angle || 0)) * Math.PI / 180;
      // Centre the rotated text block on the page: step back half its length
      // along the baseline, and half its height perpendicular to it.
      const halfW = m.w / 2, halfH = (cfg.size * LINE_HEIGHT) / 2;
      made.push({
        id: nextId(), type: 'text', page: pn,
        x: pw / 2 - Math.cos(rad) * halfW + Math.sin(rad) * halfH,
        y: ph / 2 - Math.sin(rad) * halfW - Math.cos(rad) * halfH,
        text: cfg.text, size: cfg.size, fontKey, bold: false,
        color: cfg.color, rotate: cfg.angle || 0, opacity: cfg.alpha,
      });
    }
  });

  if (!made.length) return 0;
  commit();
  state.annots.push(...made);
  return pages.length;
}
