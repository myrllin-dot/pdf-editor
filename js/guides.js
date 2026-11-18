/* guides.js — non-printing layout guides.
 *
 * Aimed at print work like colouring books, where the page you export already
 * carries bleed and the thing you must not do is put artwork where it will be
 * trimmed off. These lines are drawn on the overlay and never written to the
 * PDF.
 *
 * Everything here works in SCREEN space. That sounds lazy but it is the
 * correct choice: the guides must line up with the page as displayed, and on a
 * /Rotate 90 page a "vertical" guide is a horizontal line in user space.
 * Working from the viewport box keeps rotation handled for free, and snapping
 * is applied as a screen-space delta, which is exactly what moveAnnot takes.
 */

export const MM = 72 / 25.4;    // points per millimetre
export const IN = 72;           // points per inch

export const guides = {
  on: false,
  bleedPt: 0.125 * IN,   // 0.125in / 3.18mm — the KDP and Lulu default
  safePt: 0.25 * IN,                           // 0.25in in from the trim
  showCenter: true,
  showBaseline: true,
  snap: true,
};

export const SNAP_PX = 6;

const COL = {
  bleed: 'rgba(233,30,99,0.85)',
  safe: 'rgba(41,121,255,0.8)',
  center: 'rgba(120,144,156,0.75)',
  baseline: 'rgba(255,152,0,0.95)',
};

/**
 * Guide positions in screen pixels for the current viewport.
 * The page edge IS the bleed edge: trim sits `bleedPt` inside it.
 */
export function guideGeometry(viewport) {
  const s = viewport.scale;
  const W = viewport.width, H = viewport.height;
  const b = guides.bleedPt * s;
  const m = (guides.bleedPt + guides.safePt) * s;

  return {
    page: { x: 0, y: 0, w: W, h: H },
    trim: { x: b, y: b, w: Math.max(W - b * 2, 0), h: Math.max(H - b * 2, 0) },
    safe: { x: m, y: m, w: Math.max(W - m * 2, 0), h: Math.max(H - m * 2, 0) },
    centerX: W / 2,
    centerY: H / 2,
  };
}

function dashedRect(ctx, r, color, dash) {
  if (r.w <= 0 || r.h <= 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash(dash);
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  ctx.restore();
}

export function drawGuides(ctx, viewport) {
  if (!guides.on) return;
  const g = guideGeometry(viewport);

  dashedRect(ctx, g.trim, COL.bleed, [6, 4]);
  dashedRect(ctx, g.safe, COL.safe, [3, 3]);

  if (guides.showCenter) {
    ctx.save();
    ctx.strokeStyle = COL.center;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.moveTo(g.centerX + 0.5, 0); ctx.lineTo(g.centerX + 0.5, g.page.h);
    ctx.moveTo(0, g.centerY + 0.5); ctx.lineTo(g.page.w, g.centerY + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  // a small legend so the colours aren't a guessing game
  ctx.save();
  ctx.font = '10px -apple-system, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillStyle = COL.bleed;
  ctx.fillText('裁切線 trim', g.trim.x + 4, g.trim.y + 3);
  ctx.fillStyle = COL.safe;
  ctx.fillText('安全範圍 safe', g.safe.x + 4, g.safe.y + 3);
  ctx.restore();
}

/** Draws the baseline of each line of a selected text annotation. */
export function drawBaselines(ctx, lines, place, widthScale) {
  if (!guides.showBaseline || !lines?.length) return;
  ctx.save();
  ctx.strokeStyle = COL.baseline;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  for (const ln of lines) {
    if (!ln.text) continue;
    const [x, y] = place(ln);
    ctx.moveTo(x - 6, y + 0.5);
    ctx.lineTo(x + ln.width * widthScale + 6, y + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Snaps a moving box to the guides.
 * @param {{x,y,w,h}} box   the annotation's screen bbox after the raw drag
 * @param {object} viewport
 * @returns {{dx:number, dy:number, hitX:number|null, hitY:number|null}}
 *          a correction in screen pixels, plus the lines that caught it.
 */
export function snapBox(box, viewport) {
  if (!guides.snap || !guides.on) return { dx: 0, dy: 0, hitX: null, hitY: null };
  const g = guideGeometry(viewport);

  const xTargets = [g.centerX, g.trim.x, g.trim.x + g.trim.w, g.safe.x, g.safe.x + g.safe.w];
  const yTargets = [g.centerY, g.trim.y, g.trim.y + g.trim.h, g.safe.y, g.safe.y + g.safe.h];

  // left / centre / right of the box may each catch a guide
  const xCandidates = [box.x, box.x + box.w / 2, box.x + box.w];
  const yCandidates = [box.y, box.y + box.h / 2, box.y + box.h];

  let dx = 0, dy = 0, hitX = null, hitY = null, bestX = SNAP_PX + 1, bestY = SNAP_PX + 1;

  for (const c of xCandidates) {
    for (const t of xTargets) {
      const d = t - c;
      if (Math.abs(d) < Math.abs(bestX)) { bestX = d; hitX = t; }
    }
  }
  for (const c of yCandidates) {
    for (const t of yTargets) {
      const d = t - c;
      if (Math.abs(d) < Math.abs(bestY)) { bestY = d; hitY = t; }
    }
  }

  if (Math.abs(bestX) <= SNAP_PX) dx = bestX; else hitX = null;
  if (Math.abs(bestY) <= SNAP_PX) dy = bestY; else hitY = null;
  return { dx, dy, hitX, hitY };
}

/** Highlights the guide a drag just snapped to. */
export function drawSnapHints(ctx, viewport, hitX, hitY) {
  if (hitX == null && hitY == null) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,193,7,0.95)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  if (hitX != null) { ctx.moveTo(hitX + 0.5, 0); ctx.lineTo(hitX + 0.5, viewport.height); }
  if (hitY != null) { ctx.moveTo(0, hitY + 0.5); ctx.lineTo(viewport.width, hitY + 0.5); }
  ctx.stroke();
  ctx.restore();
}
