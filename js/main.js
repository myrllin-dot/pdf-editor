/* main.js — bootstrap and UI wiring. */

import {
  state, undo, redo, canUndo, canRedo, resetHistory, removeAnnot,
} from './state.js';
import { openPdf, renderPage, PdfJsVersion } from './viewer.js';
import { drawOverlay } from './overlay.js';
import { installTools } from './tools.js';
import { applyStamp } from './stamps.js';
import { buildPdf } from './export.js';

const $ = id => document.getElementById(id);

const el = {
  fileInput: $('file-input'), dropzone: $('dropzone'), wrap: $('canvas-wrap'),
  page: $('page-canvas'), overlay: $('overlay-canvas'), editor: $('inline-editor'),
  stage: $('stage'), pageLabel: $('page-label'), zoomLabel: $('zoom-label'),
  toast: $('toast'), busy: $('busy'), busyText: $('busy-text'),
  modal: $('stamp-modal'), hint: $('tool-hint'),
};

const SWATCHES = ['#d81b60', '#1565c0', '#2e7d32', '#ef6c00', '#6a1b9a', '#000000', '#ffffff', '#ffeb3b'];

const HINTS = {
  select: '點一下選取，拖曳可移動。按 Delete 刪除。',
  textedit: '點 PDF 上原有的文字即可修改。原字會被底色方塊蓋住，再疊上新字。',
  textbox: '點任一位置開始打字。Esc 取消，⌘/Ctrl+Enter 完成。',
  pen: '按住拖曳即可手繪。',
  arrow: '從起點拖到終點，箭頭在終點。',
  highlight: '拖出一個矩形。使用色彩增值，底下的字看得見。',
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
  for (const id of ['btn-save', 'btn-prev', 'btn-next', 'btn-zoom-in', 'btn-zoom-out', 'btn-zoom-fit', 'btn-stamps']) {
    $(id).disabled = !on;
  }
}

function refreshHistoryButtons() {
  $('btn-undo').disabled = !canUndo();
  $('btn-redo').disabled = !canRedo();
}

const markDirty = () => { dirty = true; refreshHistoryButtons(); };

/* ---------------- rendering ---------------- */

const redraw = preview => {
  if (state.viewport) drawOverlay(el.overlay, state.viewport, { preview });
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
    resetHistory();
    dirty = false;
    el.dropzone.hidden = true;
    el.wrap.hidden = false;
    setEnabled(true);
    refreshHistoryButtons();
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
    if (tools?.deleteSelected()) toast('已刪除。');
  });

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
    state.fontSize = parseFloat(e.target.value); $('size-out').value = e.target.value;
  });
  $('font-select').addEventListener('change', e => { state.fontKey = e.target.value; });
  $('font-bold').addEventListener('change', e => { state.bold = e.target.checked; });
  $('alpha-range').addEventListener('input', e => {
    state.highlightAlpha = parseFloat(e.target.value) / 100;
    $('alpha-out').value = `${e.target.value}%`;
  });

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
      if (e.shiftKey ? redo() : undo()) { markDirty(); redraw(); }
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault(); save();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedId) { e.preventDefault(); tools?.deleteSelected(); }
    } else if (e.key === 'ArrowLeft') $('btn-prev').click();
    else if (e.key === 'ArrowRight') $('btn-next').click();
    else {
      const map = { v: 'select', e: 'textedit', t: 'textbox', p: 'pen', a: 'arrow', h: 'highlight' };
      const t = map[e.key.toLowerCase()];
      if (t) setTool(t);
    }
  });

  window.addEventListener('beforeunload', e => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.pdfDoc) redraw(); }, 150);
  });
}

/* ---------------- go ---------------- */

buildSwatches();
wire();
setTool('select');
setEnabled(false);

tools = installTools({
  canvas: el.overlay,
  pageCanvas: el.page,
  editor: el.editor,
  redraw,
  onChange: markDirty,
  toast,
});

console.info(`PDF Editor ready · pdf.js ${PdfJsVersion}`);
