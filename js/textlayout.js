/* textlayout.js — one implementation of text layout, used by both renderers.
 *
 * overlay.js draws to a canvas and export.js writes PDF operators. If each
 * worked out its own line breaks, alignment and spacing they would drift
 * apart, and the preview would stop predicting the output. So both call this,
 * passing only a way to measure a string in their own world.
 *
 * All geometry is PDF user space: points, origin bottom-left, y up.
 */

import { LINE_HEIGHT } from './geom.js';

/** Fraction of the point size from baseline to the top of the line box. */
export const ASCENT = 0.8;

export const DEFAULTS = {
  letterSpacing: 0,
  lineSpacing: LINE_HEIGHT,
  align: 'left',
  anchor: 'baseline',   // legacy: (x, y) IS the first baseline, left-aligned
  frameW: 0,            // 0 = size to content
  frameH: 0,
};

const get = (a, k) => (a[k] === undefined || a[k] === null ? DEFAULTS[k] : a[k]);

/** Width of one line including letter spacing. */
export function lineWidth(str, measure, letterSpacing) {
  if (!str) return 0;
  return measure(str) + letterSpacing * Math.max(str.length - 1, 0);
}

/**
 * Greedy wrap. Breaks on spaces for Latin and between characters for CJK,
 * which has no spaces and would otherwise never wrap.
 */
function wrapLine(str, maxW, measure, ls) {
  if (!str) return [''];
  const out = [];
  let cur = '';

  const tokens = str.match(/[　-鿿豈-﫿＀-￯]|[^\s　-鿿豈-﫿＀-￯]+\s*|\s+/g) || [str];

  for (const tok of tokens) {
    const next = cur + tok;
    if (cur && lineWidth(next.replace(/\s+$/, ''), measure, ls) > maxW) {
      out.push(cur.replace(/\s+$/, ''));
      cur = /^\s+$/.test(tok) ? '' : tok;
    } else {
      cur = next;
    }
  }
  if (cur.trim() || !out.length) out.push(cur.replace(/\s+$/, ''));
  return out;
}

/**
 * @param {object} a       a text annotation
 * @param {function} measure  (string) => width in points, at the annotation's font+size
 * @returns {{lines:Array<{text:string,x:number,baselineY:number,width:number}>,
 *            blockX:number, blockY:number, blockW:number, blockH:number, lineHeight:number}}
 *          blockY is the BOTTOM of the block.
 */
export function layoutText(a, measure) {
  const ls = get(a, 'letterSpacing');
  const lh = a.size * get(a, 'lineSpacing');
  const align = get(a, 'align');
  const anchor = get(a, 'anchor');
  const frameW = get(a, 'frameW');
  const frameH = get(a, 'frameH');

  // 1. break into lines
  const paras = String(a.text ?? '').split('\n');
  const texts = [];
  for (const p of paras) {
    if (frameW > 0) texts.push(...wrapLine(p, frameW, measure, ls));
    else texts.push(p);
  }

  const widths = texts.map(t => lineWidth(t, measure, ls));
  const contentW = widths.length ? Math.max(...widths) : 0;
  const contentH = texts.length * lh;

  const blockW = frameW > 0 ? frameW : contentW;
  const blockH = frameH > 0 ? frameH : contentH;

  // 2. place the block, and find the first baseline
  let blockLeft, firstBaseline;

  if (anchor === 'baseline') {
    // Legacy anchoring: (x, y) is literally the first line's baseline-left.
    // Keeps every annotation made before frames existed exactly where it was.
    blockLeft = a.x;
    firstBaseline = a.y;
  } else {
    const [vert, horz] = splitAnchor(anchor);
    blockLeft = a.x - (horz === 'c' ? blockW / 2 : horz === 'r' ? blockW : 0);
    const blockTop = a.y + (vert === 'm' ? blockH / 2 : vert === 'b' ? blockH : 0);
    // Vertical alignment of the content inside a taller frame.
    const slack = Math.max(blockH - contentH, 0);
    const shift = vert === 'm' ? slack / 2 : vert === 'b' ? slack : 0;
    firstBaseline = blockTop - shift - a.size * ASCENT;
  }

  const lines = texts.map((text, i) => {
    const w = widths[i];
    const x = align === 'center' ? blockLeft + (blockW - w) / 2
            : align === 'right'  ? blockLeft + blockW - w
            : blockLeft;
    return { text, x, baselineY: firstBaseline - i * lh, width: w };
  });

  const blockTopY = firstBaseline + a.size * ASCENT;
  return {
    lines,
    blockX: blockLeft,
    blockY: blockTopY - blockH,
    blockW,
    blockH,
    lineHeight: lh,
  };
}

/** 'tl' | 'mc' | 'br' … -> ['t'|'m'|'b', 'l'|'c'|'r'] */
function splitAnchor(anchor) {
  const s = String(anchor);
  const vert = 'tmb'.includes(s[0]) ? s[0] : 't';
  const horz = 'lcr'.includes(s[1]) ? s[1] : 'l';
  return [vert, horz];
}

export const ANCHORS = [
  ['tl', '左上'], ['tc', '上中'], ['tr', '右上'],
  ['ml', '左中'], ['mc', '正中'], ['mr', '右中'],
  ['bl', '左下'], ['bc', '下中'], ['br', '右下'],
];

/** Echo effect: offsets drawn behind the text, far to near. */
export function echoOffsets(effect) {
  const n = Math.max(1, Math.min(effect.count ?? 3, 8));
  const dx = effect.offsetX ?? 3;
  const dy = effect.offsetY ?? -3;
  const out = [];
  for (let i = n; i >= 1; i--) out.push({ dx: dx * i, dy: dy * i, alpha: 1 - i / (n + 1) });
  return out;
}
