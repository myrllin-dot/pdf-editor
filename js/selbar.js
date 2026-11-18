/* selbar.js — the toolbar that appears next to whatever is selected.
 *
 * The sidebar holds the full set of options; this is the handful you reach for
 * constantly on every object: centre it, resize it, change its stacking, fade
 * it, delete it.
 */

import { state, findAnnot, commit, reorder, layerInfo } from './state.js';
import { annotScreenBox, moveAnnot } from './overlay.js';

const $ = id => document.getElementById(id);

const BOXY = new Set(['rect', 'ellipse', 'highlight', 'whiteout']);

let deps = null;

export function installSelBar(d) {
  deps = d;
  const bar = $('sel-bar');

  // keep clicks inside the bar from reaching the canvas and clearing selection
  bar.addEventListener('pointerdown', e => e.stopPropagation());

  bar.querySelectorAll('[data-center]').forEach(b =>
    b.addEventListener('click', () => centerOnPage(b.dataset.center)));

  bar.querySelectorAll('[data-layer]').forEach(b =>
    b.addEventListener('click', () => {
      if (state.selectedId && reorder(state.selectedId, b.dataset.layer)) {
        deps.onChange?.();
        deps.redraw();
        update();
      }
    }));

  $('sb-size').addEventListener('input', e => {
    const a = current();
    if (!a || a.type !== 'text') return;
    const v = Math.max(1, parseFloat(e.target.value) || 1);
    commit();
    a.size = v;
    deps.onChange?.();
    deps.redraw();
  });

  for (const [id, key] of [['sb-w', 'w'], ['sb-h', 'h']]) {
    $(id).addEventListener('input', e => {
      const a = current();
      if (!a || !BOXY.has(a.type)) return;
      const v = Math.max(1, parseFloat(e.target.value) || 1);
      commit();
      a[key] = v;
      deps.onChange?.();
      deps.redraw();
      update();
    });
  }

  $('sb-opacity').addEventListener('input', e => {
    const a = current();
    if (!a) return;
    const v = Math.max(0.05, parseInt(e.target.value, 10) / 100);
    $('sb-opacity-out').textContent = `${e.target.value}%`;
    commit();
    a.opacity = v;
    deps.onChange?.();
    deps.redraw();
  });

  $('sb-delete').addEventListener('click', () => deps.onDelete?.());
}

const current = () => (state.selectedId ? findAnnot(state.selectedId) : null);

/** Moves the selection so its box is centred on the page, in screen space. */
function centerOnPage(axis) {
  const a = current();
  if (!a || !state.viewport) return;
  const box = annotScreenBox(a, state.viewport);
  if (!box) return;
  commit();
  const dx = axis === 'h' ? state.viewport.width / 2 - (box.x + box.w / 2) : 0;
  const dy = axis === 'v' ? state.viewport.height / 2 - (box.y + box.h / 2) : 0;
  moveAnnot(a, dx, dy);
  deps.onChange?.();
  deps.redraw();
  update();
}

/** Shows, fills and positions the bar for the current selection. */
export function update() {
  const bar = $('sel-bar');
  const a = current();

  if (!a || a.page !== state.pageNum || !state.viewport) {
    bar.hidden = true;
    return;
  }

  const isText = a.type === 'text';
  $('sb-size-text').hidden = !isText;
  $('sb-size-box').hidden = !BOXY.has(a.type);
  if (isText && document.activeElement !== $('sb-size')) $('sb-size').value = round(a.size);
  if (BOXY.has(a.type)) {
    if (document.activeElement !== $('sb-w')) $('sb-w').value = round(a.w);
    if (document.activeElement !== $('sb-h')) $('sb-h').value = round(a.h);
  }

  const pct = Math.round((a.opacity ?? 1) * 100);
  if (document.activeElement !== $('sb-opacity')) $('sb-opacity').value = pct;
  $('sb-opacity-out').textContent = `${pct}%`;

  const li = layerInfo(a.id);
  $('sb-depth').textContent = li ? `${li.index + 1}/${li.total}` : '—';

  bar.hidden = false;
  position(bar, a);
}

const round = v => Math.round((v + Number.EPSILON) * 10) / 10;

function position(bar, a) {
  const box = annotScreenBox(a, state.viewport);
  const canvas = document.getElementById('overlay-canvas').getBoundingClientRect();
  if (!box) return;

  // measure once visible, then clamp inside the viewport
  const bw = bar.offsetWidth || 420;
  const bh = bar.offsetHeight || 36;
  const GAP = 10;

  let left = canvas.left + box.x + box.w / 2 - bw / 2;
  let top = canvas.top + box.y - bh - GAP;

  if (top < 62) top = canvas.top + box.y + box.h + GAP;      // flip below
  top = Math.min(top, window.innerHeight - bh - 8);
  left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));

  bar.style.left = `${Math.round(left)}px`;
  bar.style.top = `${Math.round(top)}px`;
}
