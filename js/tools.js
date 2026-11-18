/* tools.js — pointer interaction. Turns gestures into annotations.
 * Input arrives as screen pixels and is converted to PDF points immediately,
 * so nothing downstream has to think about zoom.
 */

import { state, nextId, commit, findAnnot, removeAnnot } from './state.js';
import { screenToPdf, screenBoxToPdf } from './viewer.js';
import { hitTest, moveAnnot, textMetrics, cssFont, CANVAS_FONTS } from './overlay.js';
import { LINE_HEIGHT } from './geom.js';

/** Ramer–Douglas–Peucker: keeps strokes smooth without thousands of points. */
export function simplify(points, tol = 0.6) {
  if (points.length < 3) return points;
  let maxD = 0, idx = 0;
  const [ax, ay] = points[0], [bx, by] = points[points.length - 1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [points[0], points[points.length - 1]];
  return [
    ...simplify(points.slice(0, idx + 1), tol).slice(0, -1),
    ...simplify(points.slice(idx), tol),
  ];
}

/**
 * Wires pointer + keyboard handling to the overlay canvas.
 * @param {object} deps { canvas, pageCanvas, editor, redraw, onChange, toast }
 */
export function installTools(deps) {
  const { canvas, redraw } = deps;

  let drag = null;       // in-progress gesture
  let editing = null;    // active inline text edit

  const localPt = ev => {
    const r = canvas.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  };

  /* ---------------- pointer ---------------- */

  canvas.addEventListener('pointerdown', ev => {
    if (editing) { commitEdit(); return; }
    if (!state.viewport) return;
    // Without this the canvas takes focus on the follow-up click, the inline
    // editor blurs the instant it opens, and typing goes nowhere.
    ev.preventDefault();
    const [sx, sy] = localPt(ev);
    if (state.tool !== 'textbox' && state.tool !== 'textedit') {
      canvas.setPointerCapture(ev.pointerId);
    }

    switch (state.tool) {
      case 'select': {
        const hit = hitTest(sx, sy);
        state.selectedId = hit ? hit.id : null;
        if (hit) drag = { kind: 'move', id: hit.id, last: [sx, sy], moved: false };
        redraw();
        break;
      }
      case 'pen':
        drag = { kind: 'pen', pts: [screenToPdf([sx, sy])] };
        break;
      case 'arrow':
      case 'highlight':
        drag = { kind: state.tool, from: [sx, sy], to: [sx, sy] };
        break;
      case 'textbox':
        startEdit({ screen: [sx, sy] });
        break;
      case 'textedit':
        startTextEdit(sx, sy);
        break;
    }
  });

  canvas.addEventListener('pointermove', ev => {
    if (!drag) return;
    const [sx, sy] = localPt(ev);

    if (drag.kind === 'move') {
      const a = findAnnot(drag.id);
      if (a) {
        if (!drag.moved) { commit(); drag.moved = true; }  // one history entry per drag
        moveAnnot(a, sx - drag.last[0], sy - drag.last[1]);
        drag.last = [sx, sy];
        redraw();
      }
      return;
    }
    if (drag.kind === 'pen') {
      drag.pts.push(screenToPdf([sx, sy]));
      redraw(previewOf(drag));
      return;
    }
    drag.to = [sx, sy];
    redraw(previewOf(drag));
  });

  const endDrag = () => {
    if (!drag) return;
    const d = drag; drag = null;

    if (d.kind === 'move') { deps.onChange?.(); redraw(); return; }

    const made = previewOf(d, true);
    if (made) {
      commit();
      state.annots.push(made);
      state.selectedId = made.id;
      deps.onChange?.();
    }
    redraw();
  };

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  /** Builds the annotation a gesture represents (also used for live preview). */
  function previewOf(d, final = false) {
    if (d.kind === 'pen') {
      const pts = final ? simplify(d.pts) : d.pts;
      if (pts.length < 2) return null;
      return {
        id: nextId(), type: 'ink', page: state.pageNum,
        points: pts, color: state.color, width: state.lineWidth,
      };
    }
    if (d.kind === 'arrow') {
      const [x1, y1] = screenToPdf(d.from);
      const [x2, y2] = screenToPdf(d.to);
      if (final && Math.hypot(x2 - x1, y2 - y1) < 4) return null;
      return {
        id: nextId(), type: 'arrow', page: state.pageNum,
        x1, y1, x2, y2, color: state.color, width: state.lineWidth,
      };
    }
    if (d.kind === 'highlight') {
      const box = screenBoxToPdf({
        x: Math.min(d.from[0], d.to[0]), y: Math.min(d.from[1], d.to[1]),
        w: Math.abs(d.to[0] - d.from[0]), h: Math.abs(d.to[1] - d.from[1]),
      });
      if (final && (box.w < 3 || box.h < 3)) return null;
      return {
        id: nextId(), type: 'highlight', page: state.pageNum,
        ...box, color: state.color, alpha: state.highlightAlpha,
      };
    }
    return null;
  }

  /* ---------------- inline text editing ---------------- */

  /**
   * Opens the floating textarea.
   * `opts.replacing` carries the whiteout + metrics when editing existing text.
   */
  function startEdit(opts) {
    const ed = deps.editor;
    const scale = state.viewport.scale;
    const size = opts.size ?? state.fontSize;
    const fontKey = opts.fontKey ?? state.fontKey;
    const bold = opts.bold ?? state.bold;
    const color = opts.color ?? state.color;

    const [sx, sy] = opts.screen;
    editing = { ...opts, size, fontKey, bold, color, screen: [sx, sy] };

    ed.value = opts.initial || '';
    ed.style.left = `${sx - 2}px`;
    ed.style.top = `${sy - size * scale}px`;
    ed.style.font = cssFont({ size, fontKey, bold }, scale);
    ed.style.color = color;
    ed.style.lineHeight = `${size * LINE_HEIGHT * scale}px`;
    ed.style.width = `${Math.max((opts.widthPx ?? 0), 120)}px`;
    ed.style.height = `${size * LINE_HEIGHT * scale * 1.1}px`;
    ed.hidden = false;
    autoGrow();

    // Focus after the current event has finished unwinding, then arm the blur
    // handler. Any blur before that point is the browser settling, not the user
    // clicking away, so it must not commit.
    editing.armed = false;
    requestAnimationFrame(() => {
      if (!editing) return;
      ed.focus();
      if (opts.initial) ed.select();                       // replacing: type over it
      else ed.setSelectionRange(ed.value.length, ed.value.length);
      requestAnimationFrame(() => { if (editing) editing.armed = true; });
    });
  }

  function autoGrow() {
    const ed = deps.editor;
    ed.style.height = 'auto';
    ed.style.height = `${ed.scrollHeight}px`;
  }

  function commitEdit() {
    if (!editing) return;
    const ed = deps.editor;
    const text = ed.value.replace(/\s+$/, '');
    const e = editing;
    editing = null;
    ed.hidden = true;
    ed.value = '';

    const added = [];
    const groupId = e.whiteout ? `g${nextId()}` : undefined;

    // Keep the cover rectangle even if the replacement is empty: an empty
    // replacement is how you delete a word.
    if (e.whiteout) added.push({ ...e.whiteout, groupId });

    if (text) {
      const [px, py] = screenToPdf(e.screen);
      added.push({
        id: nextId(), groupId, type: 'text', page: state.pageNum,
        x: px, y: py, text,
        size: e.size, fontKey: e.fontKey, bold: e.bold, color: e.color,
      });
    }

    if (added.length) {
      commit();
      state.annots.push(...added);
      state.selectedId = added[added.length - 1].id;
      deps.onChange?.();
    }
    redraw();
  }

  function cancelEdit() {
    editing = null;
    deps.editor.hidden = true;
    deps.editor.value = '';
    redraw();
  }

  deps.editor.addEventListener('input', autoGrow);
  deps.editor.addEventListener('blur', () => {
    if (!editing) return;
    if (!editing.armed) { deps.editor.focus(); return; }   // spurious, re-take focus
    commitEdit();
  });
  deps.editor.addEventListener('keydown', ev => {
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); cancelEdit(); }
    else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); commitEdit(); }
  });

  /* ---------------- "edit existing text" ---------------- */

  /**
   * Finds the PDF text run under the cursor, covers it with a rectangle
   * matched to the surrounding background, and opens the editor pre-filled.
   */
  function startTextEdit(sx, sy) {
    const item = state.textItems.find(t => {
      const b = t.screen;
      return sx >= b.x - 2 && sx <= b.x + b.w + 2 && sy >= b.y - 2 && sy <= b.y + b.h + 2;
    });

    if (!item) {
      deps.toast?.('這裡沒有可編輯的文字 — 掃描的 PDF 需要先做 OCR，可改用「加字」工具覆蓋。');
      return;
    }

    const pad = Math.max(item.pdf.h * 0.12, 0.6);
    const box = {
      x: item.pdf.x - pad, y: item.pdf.y - pad,
      w: item.pdf.w + pad * 2, h: item.pdf.h + pad * 2,
    };

    const whiteout = {
      id: nextId(), type: 'whiteout', page: state.pageNum,
      ...box, color: sampleBg(item.screen),
    };

    const fontKey = item.hasCJK ? 'cjk'
      : /serif|times|roman|song|ming/i.test(item.fontFamily) ? 'serif'
      : /mono|courier/i.test(item.fontFamily) ? 'mono' : 'sans';

    startEdit({
      screen: [item.screen.x, item.screen.y + item.screen.h - item.size * state.viewport.scale * 0.22],
      initial: item.str,
      size: item.size,
      fontKey,
      bold: item.bold,
      color: '#000000',
      widthPx: item.screen.w + 40,
      whiteout,
    });
  }

  /**
   * Samples the page just above-left of the text box to match the paper
   * colour, so the cover rectangle disappears on cream scans and tinted pages.
   */
  function sampleBg(screenBox) {
    try {
      const pc = deps.pageCanvas;
      const dpr = pc.width / parseFloat(pc.style.width);
      const x = Math.round((screenBox.x + 1) * dpr);
      const y = Math.round(Math.max(screenBox.y - 3, 1) * dpr);
      const d = pc.getContext('2d', { willReadFrequently: true })
        .getImageData(Math.max(0, x), Math.max(0, y), 1, 1).data;
      const hex = n => n.toString(16).padStart(2, '0');
      return `#${hex(d[0])}${hex(d[1])}${hex(d[2])}`;
    } catch {
      return '#ffffff';
    }
  }

  return {
    deleteSelected() {
      if (state.selectedId && removeAnnot(state.selectedId)) {
        deps.onChange?.();
        redraw();
        return true;
      }
      return false;
    },
    cancelEdit,
    isEditing: () => !!editing,
  };
}
