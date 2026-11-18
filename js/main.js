/* main.js — bootstrap and UI wiring. */

import {
  state, undo, redo, canUndo, canRedo, resetHistory, removeAnnot,
} from './state.js';
import { openPdf, renderPage, PdfJsVersion } from './viewer.js';
import { drawOverlay } from './overlay.js';
import { installTools } from './tools.js';
import { applyStamp } from './stamps.js';
import { ocrPage, meanConfidence, terminate as terminateOcr } from './ocr.js';
import { buildThumbs, setActiveThumb, refreshThumb, destroyThumbs, thumbsReady } from './thumbs.js';
import { refreshTextItems } from './viewer.js';
import { initFonts, listFonts, getFont, addLocalFont, removeLocalFont } from './fonts.js';
import { findAnnot, commit, reorder } from './state.js';
import { installSelBar, update as updateSelBar } from './selbar.js';
import { guides, MM, IN } from './guides.js';
import { buildPdf } from './export.js';

const $ = id => document.getElementById(id);

const el = {
  fileInput: $('file-input'), dropzone: $('dropzone'), wrap: $('canvas-wrap'),
  page: $('page-canvas'), overlay: $('overlay-canvas'), editor: $('inline-editor'),
  stage: $('stage'), pageLabel: $('page-label'), zoomLabel: $('zoom-label'),
  toast: $('toast'), busy: $('busy'), busyText: $('busy-text'),
  modal: $('stamp-modal'), hint: $('tool-hint'),
  guidesModal: $('guides-modal'), helpModal: $('help-modal'),
  ocrModal: $('ocr-modal'), thumbs: $('thumbs'),
};

const SWATCHES = ['#d81b60', '#1565c0', '#2e7d32', '#ef6c00', '#6a1b9a', '#000000', '#ffffff', '#ffeb3b'];

const HINTS = {
  select: '點一下選取，拖曳可移動。按 Delete 刪除。',
  textedit: '點 PDF 上原有的文字即可修改。原字會被底色方塊蓋住，再疊上新字。',
  textbox: '點任一位置開始打字。Esc 取消，⌘/Ctrl+Enter 完成。',
  pen: '按住拖曳即可手繪。',
  arrow: '從起點拖到終點，箭頭在終點。',
  highlight: '拖出一個矩形。使用色彩增值，底下的字看得見。',
  line: '拖出一條直線。按住 Shift 可鎖定 45 度。',
  rect: '拖出一個矩形。粗細設 0 就只有填滿。按住 Shift 畫正方形。',
  ellipse: '拖出一個橢圓。按住 Shift 畫正圓。',
};

let dirty = false;
let tools = null;
let renderToken = 0;

/* ---------------- small helpers ---------------- */

let toastTimer;
function toast(msg, isError = false) {
  el.toast.textContent = msg;
  el.toast.classList.toggle('err', isError);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, isError ? 7000 : 3800);
}

const busy = (on, text = '處理中…') => {
  el.busyText.textContent = text;
  el.busy.hidden = !on;
};

function setEnabled(on) {
  for (const id of ['btn-save', 'btn-prev', 'btn-next', 'btn-zoom-in', 'btn-zoom-out',
                    'btn-zoom-fit', 'btn-stamps', 'btn-ocr', 'btn-thumbs', 'btn-guides']) {
    $(id).disabled = !on;
  }
}

function refreshHistoryButtons() {
  $('btn-undo').disabled = !canUndo();
  $('btn-redo').disabled = !canRedo();
}

const markDirty = () => {
  dirty = true;
  refreshHistoryButtons();
  if (thumbsReady()) refreshThumb(state.pageNum);
};

/* ---------------- rendering ---------------- */

const redraw = (preview, snap) => {
  if (state.viewport) drawOverlay(el.overlay, state.viewport, { preview, snap });
};

async function showPage() {
  if (!state.pdfDoc) return;
  const token = ++renderToken;
  try {
    const vp = await renderPage(el.page, state.pageNum, state.scale);
    if (token !== renderToken) return;   // a newer render superseded this one
    drawOverlay(el.overlay, vp);
    el.pageLabel.textContent = `${state.pageNum} / ${state.numPages}`;
    el.zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;
    if (thumbsReady()) setActiveThumb(state.pageNum);
    updateSelBar();
  } catch (err) {
    toast(`頁面繪製失敗：${err.message}`, true);
  }
}

async function fitWidth() {
  if (!state.pdfDoc) return;
  const page = await state.pdfDoc.getPage(state.pageNum);
  const base = page.getViewport({ scale: 1 });
  const avail = el.stage.clientWidth - 48;
  state.scale = Math.max(0.2, Math.min(4, avail / base.width));
  await showPage();
}

/* ---------------- opening ---------------- */

async function loadFile(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    toast('請選擇 PDF 檔案。', true);
    return;
  }
  busy(true, '讀取 PDF…');
  try {
    const buf = await file.arrayBuffer();
    await openPdf(buf, file.name);
    state.annots = [];
    state.selectedId = null;
    state.ocrPages = {};
    await terminateOcr();            // a new document invalidates the warm worker
    resetHistory();
    dirty = false;
    destroyThumbs();
    el.dropzone.hidden = true;
    el.wrap.hidden = false;
    setEnabled(true);
    refreshHistoryButtons();
    // Show the rail BEFORE fitting: it takes ~138px out of the stage, and
    // fitting first produced a scale that overflowed by exactly that much.
    el.thumbs.hidden = false;
    buildThumbs(el.thumbs, { onSelect: goToPage });
    await fitWidth();
    toast(`已開啟 ${file.name}（${state.numPages} 頁）`);
  } catch (err) {
    const msg = /password/i.test(err.message || '')
      ? '這個 PDF 有密碼保護，請先解除密碼再開啟。'
      : `無法開啟：${err.message}`;
    toast(msg, true);
  } finally {
    busy(false);
  }
}

function goToPage(n) {
  if (n === state.pageNum || n < 1 || n > state.numPages) return;
  state.pageNum = n;
  state.selectedId = null;
  showPage();
}

/* ---------------- OCR ---------------- */

const OCR_STATUS = {
  'loading tesseract core': '載入辨識引擎',
  'initializing tesseract': '初始化',
  'loading language traineddata': '載入語言資料',
  'initializing api': '準備中',
  'recognizing text': '辨識文字',
};

async function runOcr() {
  const langs = $('ocr-lang').value;
  const scope = $('ocr-scope').value;
  const pages = scope === 'all'
    ? Array.from({ length: state.numPages }, (_, i) => i + 1)
    : [state.pageNum];

  el.ocrModal.hidden = true;
  busy(true, '準備辨識引擎…');

  let totalLines = 0;
  const confidences = [];
  try {
    for (let i = 0; i < pages.length; i++) {
      const pn = pages[i];
      const prefix = pages.length > 1 ? `第 ${pn} 頁 (${i + 1}/${pages.length}) · ` : '';
      const { items } = await ocrPage(pn, {
        langs,
        onStatus: (status, pct) => {
          const label = OCR_STATUS[status] || status;
          busy(true, `${prefix}${label}${pct != null ? ` ${pct}%` : ''}`);
        },
      });
      state.ocrPages[pn] = items;
      totalLines += items.length;
      if (items.length) confidences.push(meanConfidence(items));
    }

    refreshTextItems();
    redraw();

    if (!totalLines) {
      toast('辨識不到文字。可能是解析度太低、頁面是空白的，或語言選錯了。', true);
    } else {
      const conf = Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length);
      setTool('textedit');
      toast(`辨識到 ${totalLines} 行文字（平均信心度 ${conf}%）。現在可以用「改字」點選修改 — 請核對內容，辨識一定有錯。`);
    }
  } catch (err) {
    toast(`辨識失敗：${err.message}`, true);
  } finally {
    busy(false);
  }
}

/* ---------------- saving ---------------- */

async function save() {
  if (!state.pdfDoc) return;
  busy(true, '產生 PDF…');
  try {
    const { bytes, usedCjk, upgradedCount } = await buildPdf(
      state.originalBytes, state.annots, { onProgress: m => busy(true, m) },
    );

    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.fileName.replace(/\.pdf$/i, '') + '-edited.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);

    dirty = false;
    const kb = Math.round(bytes.length / 1024);
    toast(upgradedCount
      ? `已儲存（${kb} KB）。有 ${upgradedCount} 段文字含中文，已自動改用中文字體。`
      : `已儲存（${kb} KB）${usedCjk ? '，已嵌入中文字體' : ''}。`);
  } catch (err) {
    toast(`儲存失敗：${err.message}`, true);
  } finally {
    busy(false);
  }
}

/* ---------------- guides ---------------- */

const UNIT = { mm: MM, in: IN, pt: 1 };

function guidesToForm() {
  const u = UNIT[$('gd-unit').value] || MM;
  $('gd-on').checked = guides.on;
  $('gd-bleed').value = +(guides.bleedPt / u).toFixed(3);
  $('gd-safe').value = +(guides.safePt / u).toFixed(3);
  $('gd-center').checked = guides.showCenter;
  $('gd-snap').checked = guides.snap;
  $('gd-baseline').checked = guides.showBaseline;
  $('btn-guides').classList.toggle('primary', guides.on);
}

function formToGuides() {
  const u = UNIT[$('gd-unit').value] || MM;
  guides.on = $('gd-on').checked;
  guides.bleedPt = Math.max(0, parseFloat($('gd-bleed').value) || 0) * u;
  guides.safePt = Math.max(0, parseFloat($('gd-safe').value) || 0) * u;
  guides.showCenter = $('gd-center').checked;
  guides.snap = $('gd-snap').checked;
  guides.showBaseline = $('gd-baseline').checked;
  $('btn-guides').classList.toggle('primary', guides.on);
  redraw();
}

function wireGuides() {
  for (const id of ['gd-on', 'gd-bleed', 'gd-safe', 'gd-center', 'gd-snap', 'gd-baseline']) {
    $(id).addEventListener('input', formToGuides);
    $(id).addEventListener('change', formToGuides);
  }
  $('gd-unit').addEventListener('change', guidesToForm);   // re-express, don't rescale
  $('gd-close').addEventListener('click', () => { el.guidesModal.hidden = true; });
  el.guidesModal.addEventListener('click', e => {
    if (e.target === el.guidesModal) el.guidesModal.hidden = true;
  });
  $('btn-guides').addEventListener('click', () => {
    guides.on = !guides.on;
    guidesToForm();
    redraw();
    if (guides.on) el.guidesModal.hidden = false;
  });
  guidesToForm();
}

function wireHelp() {
  const show = () => { el.helpModal.hidden = false; };
  $('btn-help').addEventListener('click', show);
  $('help-close').addEventListener('click', () => { el.helpModal.hidden = true; });
  el.helpModal.addEventListener('click', e => {
    if (e.target === el.helpModal) el.helpModal.hidden = true;
  });
}

/* ---------------- tool + options UI ---------------- */

function setTool(name) {
  state.tool = name;
  document.querySelectorAll('.tool[data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === name);
  });
  el.overlay.className = `t-${name}`;
  el.hint.textContent = HINTS[name] || '';
  document.querySelectorAll('.opt-row[data-for]').forEach(row => {
    row.hidden = !row.dataset.for.split(' ').includes(name);
  });
}

/* ---------------- text style ---------------- */

/** The selected annotation if it is text, else null. */
function selectedText() {
  const a = state.selectedId ? findAnnot(state.selectedId) : null;
  return a && a.type === 'text' ? a : null;
}

/**
 * Applies a style change. With a text box selected it edits that box (and is
 * undoable); otherwise it sets the default for the next one.
 */
function applyTextStyle(patch) {
  const sel = selectedText();
  if (sel) {
    commit();
    for (const [k, v] of Object.entries(patch)) {
      sel[k] = (k === 'effect') ? { ...(sel.effect || {}), ...v } : v;
    }
    markDirty();
    redraw();
  } else {
    for (const [k, v] of Object.entries(patch)) {
      state.textStyle[k] = (k === 'effect')
        ? { ...state.textStyle.effect, ...v }
        : v;
    }
    if ('bold' in patch) state.bold = patch.bold;
  }
}

/** Mirrors the selected text box (or the defaults) into the controls. */
function syncTextControls() {
  const sel = selectedText();
  const st = state.textStyle;
  const v = k => (sel && sel[k] !== undefined ? sel[k] : st[k]);
  const fx = (sel?.effect) || st.effect;

  $('st-bold').classList.toggle('on', !!v('bold'));
  $('st-italic').classList.toggle('on', !!v('italic'));
  $('st-underline').classList.toggle('on', !!v('underline'));

  const align = v('align') || 'left';
  document.querySelectorAll('#align-bar .seg').forEach(b =>
    b.classList.toggle('on', b.dataset.align === align));

  $('tracking-range').value = v('letterSpacing') ?? 0;
  $('tracking-out').value = $('tracking-range').value;
  $('leading-range').value = v('lineSpacing') ?? 1.2;
  $('leading-out').value = Number($('leading-range').value).toFixed(2);
  $('frame-w').value = Math.round(v('frameW') || 0);
  $('frame-h').value = Math.round(v('frameH') || 0);
  $('anchor-select').value = v('anchor') || 'baseline';

  $('fx-type').value = fx.type || 'none';
  $('fx-opts').hidden = (fx.type || 'none') === 'none';
  $('fx-echo-opts').hidden = fx.type !== 'echo';
  $('fx-color-label').textContent = fx.type === 'echo' ? '回聲顏色' : '外框顏色';
  $('fx-width').value = fx.width ?? 1.5;
  $('fx-width-out').value = $('fx-width').value;
  $('fx-color').value = fx.color || '#000000';
  $('fx-count').value = fx.count ?? 3;
  $('fx-count-out').value = $('fx-count').value;

  if (sel) {
    $('size-range').value = sel.size;
    $('size-out').value = sel.size;
    $('font-select').value = listFonts().some(f => f.key === sel.fontKey) ? sel.fontKey : 'sans';
  }
}

function wireTextStyle() {
  const toggle = (id, key) => $(id).addEventListener('click', () => {
    const cur = $(id).classList.contains('on');
    applyTextStyle({ [key]: !cur });
    syncTextControls();
  });
  toggle('st-bold', 'bold');
  toggle('st-italic', 'italic');
  toggle('st-underline', 'underline');

  document.querySelectorAll('#align-bar .seg').forEach(btn =>
    btn.addEventListener('click', () => {
      applyTextStyle({ align: btn.dataset.align });
      syncTextControls();
    }));

  $('tracking-range').addEventListener('input', e => {
    $('tracking-out').value = e.target.value;
    applyTextStyle({ letterSpacing: parseFloat(e.target.value) });
  });
  $('leading-range').addEventListener('input', e => {
    $('leading-out').value = Number(e.target.value).toFixed(2);
    applyTextStyle({ lineSpacing: parseFloat(e.target.value) });
  });
  for (const [id, key] of [['frame-w', 'frameW'], ['frame-h', 'frameH']]) {
    $(id).addEventListener('input', e =>
      applyTextStyle({ [key]: Math.max(0, parseFloat(e.target.value) || 0) }));
  }
  $('anchor-select').addEventListener('change', e => applyTextStyle({ anchor: e.target.value }));

  $('fx-type').addEventListener('change', e => {
    applyTextStyle({ effect: { type: e.target.value } });
    syncTextControls();
  });
  $('fx-width').addEventListener('input', e => {
    $('fx-width-out').value = e.target.value;
    applyTextStyle({ effect: { width: parseFloat(e.target.value) } });
  });
  $('fx-color').addEventListener('input', e =>
    applyTextStyle({ effect: { color: e.target.value } }));
  $('fx-count').addEventListener('input', e => {
    $('fx-count-out').value = e.target.value;
    applyTextStyle({ effect: { count: parseInt(e.target.value, 10) } });
  });
}

function populateFonts() {
  const sel = $('font-select');
  sel.innerHTML = '';
  const groups = { builtin: '標準字體', bundled: '內建字體', local: '本機字體' };
  for (const kind of ['builtin', 'bundled', 'local']) {
    const fonts = listFonts().filter(f => f.kind === kind);
    if (!fonts.length) continue;
    const g = document.createElement('optgroup');
    g.label = groups[kind];
    for (const f of fonts) {
      const o = document.createElement('option');
      o.value = f.key;
      o.textContent = f.label;
      g.appendChild(o);
    }
    sel.appendChild(g);
  }
  const add = document.createElement('option');
  add.value = '__add__';
  add.textContent = '＋ 從這台電腦加入字體…';
  sel.appendChild(add);

  if (!listFonts().some(f => f.key === state.fontKey)) state.fontKey = 'sans';
  sel.value = state.fontKey;
  syncFontControls();
}

function syncFontControls() {
  $('font-remove').hidden = getFont(state.fontKey).kind !== 'local';
}

function buildSwatches() {
  const box = $('swatches');
  SWATCHES.forEach(c => {
    const b = document.createElement('button');
    b.className = 'sw';
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => {
      state.color = c;
      $('color-custom').value = c;
      syncSwatches();
    });
    box.appendChild(b);
  });
  syncSwatches();
}

function syncSwatches() {
  [...$('swatches').children].forEach(b => {
    b.classList.toggle('on', b.title.toLowerCase() === state.color.toLowerCase());
  });
}

/* ---------------- stamps modal ---------------- */

function openStamps() {
  el.modal.hidden = false;
  $('st-range').value = 'all';
}

async function applyStampFromForm() {
  const tab = document.querySelector('.tab.active').dataset.tab;
  const common = {
    range: $('st-range').value,
    color: $('st-color').value,
    cjk: $('st-cjk').checked,
  };

  let cfg;
  if (tab === 'pagenum') {
    cfg = {
      ...common, kind: 'pagenum',
      format: $('pn-format').value || '{n}',
      start: parseInt($('pn-start').value, 10) || 1,
      size: parseFloat($('pn-size').value) || 10,
      pos: $('pn-pos').value,
    };
  } else if (tab === 'footer') {
    cfg = {
      ...common, kind: 'footer',
      text: $('ft-text').value.trim(),
      size: parseFloat($('ft-size').value) || 8,
      pos: $('ft-pos').value,
    };
    if (!cfg.text) { toast('請先輸入頁尾文字。', true); return; }
  } else {
    cfg = {
      ...common, kind: 'watermark',
      text: $('wm-text').value.trim(),
      size: parseFloat($('wm-size').value) || 60,
      angle: parseFloat($('wm-angle').value) || 0,
      alpha: (parseFloat($('wm-alpha').value) || 12) / 100,
    };
    if (!cfg.text) { toast('請先輸入浮水印文字。', true); return; }
  }

  // Auto-detect Chinese so the user doesn't have to tick the box.
  if (!cfg.cjk && /[^\x00-\xFF]/.test(cfg.text || cfg.format || '')) cfg.cjk = true;

  busy(true, '套用中…');
  try {
    const n = await applyStamp(cfg);
    el.modal.hidden = true;
    if (n) { markDirty(); redraw(); toast(`已套用到 ${n} 頁。`); }
    else toast('頁面範圍沒有符合的頁。', true);
  } catch (err) {
    toast(`套用失敗：${err.message}`, true);
  } finally {
    busy(false);
  }
}

/* ---------------- wiring ---------------- */

function wire() {
  $('btn-open').addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', e => loadFile(e.target.files[0]));
  $('btn-save').addEventListener('click', save);

  // drag & drop anywhere on the stage
  ['dragenter', 'dragover'].forEach(t => el.stage.addEventListener(t, e => {
    e.preventDefault(); el.dropzone.classList.add('hot');
  }));
  ['dragleave', 'drop'].forEach(t => el.stage.addEventListener(t, e => {
    e.preventDefault(); el.dropzone.classList.remove('hot');
  }));
  el.stage.addEventListener('drop', e => loadFile(e.dataTransfer?.files?.[0]));

  document.querySelectorAll('.tool[data-tool]').forEach(b => {
    b.addEventListener('click', () => setTool(b.dataset.tool));
  });
  $('btn-delete').addEventListener('click', () => {
    if (tools?.deleteSelected()) { updateSelBar(); toast('已刪除。'); }
  });
  el.stage.addEventListener('scroll', () => updateSelBar(), { passive: true });

  $('btn-prev').addEventListener('click', () => {
    if (state.pageNum > 1) { state.pageNum--; state.selectedId = null; showPage(); }
  });
  $('btn-next').addEventListener('click', () => {
    if (state.pageNum < state.numPages) { state.pageNum++; state.selectedId = null; showPage(); }
  });

  const zoom = f => { state.scale = Math.max(0.2, Math.min(5, state.scale * f)); showPage(); };
  $('btn-zoom-in').addEventListener('click', () => zoom(1.25));
  $('btn-zoom-out').addEventListener('click', () => zoom(0.8));
  $('btn-zoom-fit').addEventListener('click', fitWidth);

  $('btn-undo').addEventListener('click', () => { if (undo()) { markDirty(); redraw(); } });
  $('btn-redo').addEventListener('click', () => { if (redo()) { markDirty(); redraw(); } });

  $('color-custom').addEventListener('input', e => { state.color = e.target.value; syncSwatches(); });
  $('width-range').addEventListener('input', e => {
    state.lineWidth = parseFloat(e.target.value); $('width-out').value = e.target.value;
  });
  $('size-range').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    $('size-out').value = e.target.value;
    const sel = selectedText();
    if (sel) applyTextStyle({ size: v }); else state.fontSize = v;
  });
  $('font-select').addEventListener('change', e => {
    if (e.target.value === '__add__') {
      e.target.value = state.fontKey;      // don't leave the picker selected
      $('font-file').click();
      return;
    }
    state.fontKey = e.target.value;
    const sel = selectedText();
    if (sel) applyTextStyle({ fontKey: state.fontKey });
    syncFontControls();
    redraw();
  });
  $('font-file').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { key, label, cjk, persisted } = await addLocalFont(file);
      state.fontKey = key;
      populateFonts();
      redraw();
      toast(persisted
        ? `已加入「${label}」${cjk ? '（含中文字）' : ''}。字體只存在這台瀏覽器裡，不會上傳也不會進 repo。`
        : `已加入「${label}」，但這個瀏覽器不允許儲存，重新整理後需要再加一次。`);
    } catch (err) {
      toast(`無法加入字體：${err.message}`, true);
    }
  });
  $('font-remove').addEventListener('click', async () => {
    const key = state.fontKey;
    const label = getFont(key).label;
    if (await removeLocalFont(key)) {
      state.fontKey = 'sans';
      populateFonts();
      redraw();
      toast(`已移除「${label}」。用到它的文字會改用預設字體。`);
    }
  });
  $('alpha-range').addEventListener('input', e => {
    state.highlightAlpha = parseFloat(e.target.value) / 100;
    $('alpha-out').value = `${e.target.value}%`;
  });

  $('fill-on').addEventListener('change', e => { state.shapeFill = e.target.checked; });
  $('fill-color').addEventListener('input', e => {
    state.fillColor = e.target.value;
    if (!state.shapeFill) { state.shapeFill = true; $('fill-on').checked = true; }
  });
  $('fill-alpha').addEventListener('input', e => {
    state.fillAlpha = parseFloat(e.target.value) / 100;
    $('fill-alpha-out').value = `${e.target.value}%`;
  });

  $('btn-thumbs').addEventListener('click', () => {
    el.thumbs.hidden = !el.thumbs.hidden;
    if (!el.thumbs.hidden) {
      if (!thumbsReady()) buildThumbs(el.thumbs, { onSelect: goToPage });
      else setActiveThumb(state.pageNum);
    }
  });

  $('btn-ocr').addEventListener('click', () => { el.ocrModal.hidden = false; });
  $('ocr-cancel').addEventListener('click', () => { el.ocrModal.hidden = true; });
  $('ocr-run').addEventListener('click', runOcr);
  el.ocrModal.addEventListener('click', e => { if (e.target === el.ocrModal) el.ocrModal.hidden = true; });
  $('ocr-lang').addEventListener('change', e => {
    $('ocr-lang-note').textContent = e.target.value === 'chi_tra+eng'
      ? '兩種語言一起辨識時，中文的正確率會明顯下降。只有真的中英夾雜才建議用。'
      : e.target.value === 'eng'
        ? '純英文文件用這個最準。'
        : '中文文件請用這個。同時載入英文會明顯拉低中文辨識率。';
  });

  wireGuides();
  wireHelp();
  wireTextStyle();
  $('btn-stamps').addEventListener('click', openStamps);
  $('stamp-cancel').addEventListener('click', () => { el.modal.hidden = true; });
  $('stamp-apply').addEventListener('click', applyStampFromForm);
  $('wm-alpha').addEventListener('input', e => { $('wm-alpha-out').value = `${e.target.value}%`; });
  el.modal.addEventListener('click', e => { if (e.target === el.modal) el.modal.hidden = true; });
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    document.querySelectorAll('.tabpane').forEach(p => { p.hidden = p.dataset.pane !== t.dataset.tab; });
  }));

  window.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey ? redo() : undo()) { markDirty(); redraw(); updateSelBar(); }
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault(); save();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedId) { e.preventDefault(); tools?.deleteSelected(); }
    } else if (e.key === 'ArrowLeft') $('btn-prev').click();
    else if (e.key === 'ArrowRight') $('btn-next').click();
    else {
      const k = e.key.toLowerCase();
      if (k === 'f') { e.preventDefault(); $('btn-thumbs').click(); return; }
      if (k === 'g') { e.preventDefault(); $('btn-guides').click(); return; }
      if (e.key === '?' || (e.shiftKey && k === '/')) { e.preventDefault(); $('btn-help').click(); return; }
      if (k === '[' || k === ']') {
        if (!state.selectedId) return;
        e.preventDefault();
        const where = k === ']'
          ? (e.altKey ? 'front' : 'forward')
          : (e.altKey ? 'back' : 'backward');
        if (reorder(state.selectedId, where)) { markDirty(); redraw(); updateSelBar(); }
        return;
      }
      const map = {
        v: 'select', a: 'textbox', t: 'textbox', e: 'textedit', p: 'pen',
        w: 'arrow', h: 'highlight', l: 'line', r: 'rect', o: 'ellipse',
      };
      const t = map[k];
      if (t) setTool(t);
    }
  });

  window.addEventListener('beforeunload', e => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.pdfDoc) { redraw(); updateSelBar(); } }, 150);
  });
}

/* ---------------- go ---------------- */

buildSwatches();
wire();
setTool('select');
setEnabled(false);

// Faces load lazily; repaint when one arrives so the preview catches up.
await initFonts({ onFaceReady: () => redraw() });
populateFonts();

tools = installTools({
  canvas: el.overlay,
  pageCanvas: el.page,
  editor: el.editor,
  redraw,
  onChange: markDirty,
  onSelect: () => { syncTextControls(); updateSelBar(); },
  toast,
});

installSelBar({
  redraw,
  onChange: markDirty,
  onDelete: () => { if (tools?.deleteSelected()) { updateSelBar(); toast('已刪除。'); } },
});
syncTextControls();
updateSelBar();

console.info(`PDF Editor ready · pdf.js ${PdfJsVersion}`);
