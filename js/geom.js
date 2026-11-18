/* geom.js — pure geometry/typography constants shared by the on-screen
 * renderer and the PDF writer. No DOM, no library imports: keeping these
 * here is what lets the export path be tested headlessly.
 */

/** Multiple of font size used as line spacing, everywhere. */
export const LINE_HEIGHT = 1.2;

/** Arrow head length in PDF points for a given stroke width. */
export const headLenPx = width => Math.max(width * 3.4, 5);

/** How far back along the shaft the line stops, so the tip is the endpoint. */
export const ARROW_BACK = 0.82;

/** Half-angle of the arrow head, radians. */
export const ARROW_SPREAD = 0.42;

/** '#rrggbb' | '#rgb' -> [r,g,b] in 0..1 */
export function hexToRgb01(hex) {
  const h = String(hex).replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(f, 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

/** Characters outside Latin-1 cannot be encoded by PDF's standard 14 fonts. */
export const needsCJK = s => /[^\x00-\xFF]/.test(String(s));
