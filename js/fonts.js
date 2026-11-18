/* fonts.js — the font registry.
 *
 * Three kinds of font, deliberately kept apart:
 *
 *   built-in  PDF's standard 14 (Helvetica/Times/Courier). No file, no
 *             embedding, Latin-1 only.
 *   bundled   Listed in vendor/fonts/fonts.json and committed to the repo.
 *             Available to everyone who opens the deployed app. Only put a
 *             font here if its licence allows redistribution.
 *   local     Added by the user from their own machine at runtime. Stored in
 *             this browser (IndexedDB) and never uploaded or committed — the
 *             right home for a font you are licensed to use but not to
 *             redistribute.
 *
 * TO ADD A FONT PERMANENTLY: drop the .ttf/.otf in vendor/fonts/ and add an
 * entry to vendor/fonts/fonts.json. Nothing else needs editing.
 */

const DIR = new URL('../vendor/fonts/', import.meta.url).href;

/** PDF's standard 14. `std` names match pdf-lib's StandardFonts keys. */
const BUILT_IN = [
  { key: 'sans',  label: '無襯線 Helvetica', std: 'Helvetica',  stdBold: 'HelveticaBold',  css: 'Helvetica, Arial, sans-serif' },
  { key: 'serif', label: '襯線 Times',       std: 'TimesRoman', stdBold: 'TimesRomanBold', css: '"Times New Roman", Times, serif' },
  { key: 'mono',  label: '等寬 Courier',     std: 'Courier',    stdBold: 'CourierBold',    css: '"Courier New", Courier, monospace' },
];

const registry = new Map();      // key -> descriptor
const bytesCache = new Map();    // key -> Promise<ArrayBuffer>
const faceState = new Map();     // key -> 'loading' | 'ready' | 'failed'

let onFaceReady = null;          // called when a face finishes loading, to redraw

/* ------------------------------------------------------------------ */
/* IndexedDB for locally added fonts                                   */
/* ------------------------------------------------------------------ */

const DB_NAME = 'pdf-editor-fonts';
const STORE = 'fonts';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbAll() {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly').objectStore(STORE);
      const out = [];
      const cur = tx.openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve(out);
        out.push({ key: c.key, ...c.value });
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    });
  } catch {
    return [];   // private mode, blocked storage, etc. — local fonts just won't persist
  }
}

async function idbPut(key, value) {
  try {
    const db = await idb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch { return false; }
}

async function idbDelete(key) {
  try {
    const db = await idb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* nothing to clean up */ }
}

/* ------------------------------------------------------------------ */

/** CSS family name used for the on-screen preview of an embedded font. */
const familyOf = key => `pdfedit-${key.replace(/[^a-z0-9]+/gi, '-')}`;

export async function initFonts(opts = {}) {
  onFaceReady = opts.onFaceReady || null;
  registry.clear();

  for (const f of BUILT_IN) registry.set(f.key, { ...f, kind: 'builtin' });

  // bundled
  try {
    const res = await fetch(`${DIR}fonts.json`, { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      for (const f of data.fonts || []) {
        if (!f.key || !f.file) continue;
        registry.set(f.key, {
          ...f, kind: 'bundled',
          url: `${DIR}${f.file}`,
          css: `"${familyOf(f.key)}", sans-serif`,
        });
      }
    }
  } catch { /* no registry file: built-ins still work */ }

  // local
  for (const rec of await idbAll()) {
    registry.set(rec.key, {
      key: rec.key, label: rec.label, cjk: rec.cjk, kind: 'local',
      bytes: rec.bytes, css: `"${familyOf(rec.key)}", sans-serif`,
    });
  }
  return listFonts();
}

export const listFonts = () => [...registry.values()].map(f => ({
  key: f.key, label: f.label, kind: f.kind, cjk: !!f.cjk,
}));

export const getFont = key => registry.get(key) || registry.get('sans');

/** Default face for text the standard 14 cannot encode. */
export function defaultCjkKey() {
  for (const f of registry.values()) if (f.cjk && f.kind !== 'builtin') return f.key;
  return null;
}

/** Raw bytes for embedding. Null for the standard 14, which need no file. */
export function fontBytes(key) {
  const f = getFont(key);
  if (f.kind === 'builtin') return null;
  if (!bytesCache.has(key)) {
    bytesCache.set(key, f.bytes
      ? Promise.resolve(f.bytes)
      : fetch(f.url).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        }).catch(err => {
          bytesCache.delete(key);
          throw new Error(`無法載入字體 ${f.label}：${err.message}`);
        }));
  }
  return bytesCache.get(key);
}

/**
 * CSS font-family for the canvas preview. Embedded faces are registered with
 * the browser on first use so the preview matches the exported PDF; until that
 * finishes we fall back, then repaint.
 */
export function cssFamily(key) {
  const f = getFont(key);
  if (f.kind !== 'builtin') ensureFace(key);
  return f.css;
}

export function ensureFace(key) {
  const f = getFont(key);
  if (f.kind === 'builtin' || faceState.has(key)) return;
  faceState.set(key, 'loading');

  Promise.resolve(fontBytes(key))
    .then(buf => {
      const face = new FontFace(familyOf(key), buf instanceof ArrayBuffer ? buf : buf.buffer);
      return face.load().then(loaded => {
        document.fonts.add(loaded);
        faceState.set(key, 'ready');
        onFaceReady?.(key);
      });
    })
    .catch(() => faceState.set(key, 'failed'));
}

export const faceReady = key => getFont(key).kind === 'builtin' || faceState.get(key) === 'ready';

/* ------------------------------------------------------------------ */

const CJK_RE = /[　-鿿豈-﫿＀-￯]/;

/**
 * Adds a font from the user's own machine. Kept in this browser only.
 * @param {File} file a .ttf / .otf
 */
export async function addLocalFont(file) {
  const name = file.name.replace(/\.(ttf|otf|ttc)$/i, '');
  const key = `local:${name}`.slice(0, 80);
  const bytes = await file.arrayBuffer();

  // Cheap sanity check: reject anything that isn't an sfnt container.
  const tag = new DataView(bytes).getUint32(0);
  const ok = tag === 0x00010000 || tag === 0x4f54544f || tag === 0x74727565;
  if (!ok) throw new Error('這不像是 TTF/OTF 字體檔。');

  const cjk = await probeCjk(bytes).catch(() => false);
  const rec = { label: `${name}（本機）`, cjk, bytes };
  registry.set(key, { key, ...rec, kind: 'local', css: `"${familyOf(key)}", sans-serif` });
  bytesCache.delete(key);
  faceState.delete(key);

  const persisted = await idbPut(key, rec);
  ensureFace(key);
  return { key, label: rec.label, cjk, persisted };
}

export async function removeLocalFont(key) {
  if (getFont(key).kind !== 'local') return false;
  registry.delete(key);
  bytesCache.delete(key);
  faceState.delete(key);
  await idbDelete(key);
  return true;
}

/**
 * Does this font actually carry CJK glyphs?
 *
 * Measuring glyph widths does NOT work here: a font missing the character
 * silently falls back to another family, and the fallback's CJK glyph measures
 * like a real one — which reported a Latin-only font as having Chinese. So ask
 * the font's own cmap instead, via the fontkit we already ship for embedding.
 */
async function probeCjk(bytes) {
  const fontkit = await import('../vendor/fontkit/fontkit.bundle.js');
  const font = fontkit.create(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
  );
  // A few common characters rather than one, so a font carrying a stray glyph
  // isn't mistaken for a usable CJK face.
  const probes = ['長', '笛', '工', '作', '室', '第', '三', '號'];
  const hits = probes.filter(ch => font.hasGlyphForCodePoint(ch.codePointAt(0))).length;
  return hits >= probes.length - 1;
}
