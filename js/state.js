/* state.js — single source of truth + undo/redo.
 *
 * COORDINATE CONTRACT (important):
 * Every annotation is stored in **PDF user-space points**, origin bottom-left,
 * on the *unrotated* page. Screen<->PDF conversion happens only at the edges
 * (overlay.js for drawing, tools.js for input) via pdf.js viewport helpers.
 * export.js can therefore hand coordinates straight to pdf-lib.
 */

let uid = 0;
export const nextId = () => `a${++uid}`;

export const state = {
  // document
  pdfDoc: null,            // pdf.js PDFDocumentProxy
  originalBytes: null,     // Uint8Array of the file as opened (pristine)
  fileName: 'document.pdf',
  numPages: 0,

  // view
  pageNum: 1,
  scale: 1,
  viewport: null,          // pdf.js viewport for the current page+scale
  textItems: [],           // text runs for the current page (native layer + OCR)
  ocrPages: {},            // pageNum -> OCR'd items, cached for the session

  // tools
  tool: 'select',
  color: '#d81b60',
  lineWidth: 2,
  fontSize: 12,
  fontKey: 'sans',
  bold: false,
  highlightAlpha: 0.35,
  shapeFill: false,
  fillColor: '#ffeb3b',
  fillAlpha: 1,

  // content
  annots: [],              // flat list; each has .page
  selectedId: null,
};

/* ---------- history ---------- */
const past = [], future = [];
const MAX = 60;

const snapshot = () => JSON.stringify(state.annots);

/** Call immediately BEFORE mutating state.annots. */
export function commit() {
  past.push(snapshot());
  if (past.length > MAX) past.shift();
  future.length = 0;
}

export function undo() {
  if (!past.length) return false;
  future.push(snapshot());
  state.annots = JSON.parse(past.pop());
  state.selectedId = null;
  return true;
}

export function redo() {
  if (!future.length) return false;
  past.push(snapshot());
  state.annots = JSON.parse(future.pop());
  state.selectedId = null;
  return true;
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

export function resetHistory() {
  past.length = 0;
  future.length = 0;
}

/* ---------- annotation helpers ---------- */
export const pageAnnots = (p = state.pageNum) => state.annots.filter(a => a.page === p);
export const findAnnot = id => state.annots.find(a => a.id === id) || null;

export function addAnnots(list) {
  commit();
  state.annots.push(...list);
}

/** Removes an annotation and anything sharing its groupId (whiteout + replacement text). */
export function removeAnnot(id) {
  const a = findAnnot(id);
  if (!a) return false;
  commit();
  state.annots = a.groupId
    ? state.annots.filter(x => x.groupId !== a.groupId)
    : state.annots.filter(x => x.id !== id);
  if (state.selectedId === id) state.selectedId = null;
  return true;
}

/* ---------- colour utils ---------- */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(f, 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

export function rgbToHex([r, g, b]) {
  const h = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
