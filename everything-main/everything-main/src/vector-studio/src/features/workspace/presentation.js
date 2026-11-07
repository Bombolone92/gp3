/**
 * Presentation Mode: the artboards as full-screen slides on black. Right,
 * Down, Page Down, Space or a click go forward; Left, Up, Page Up or
 * Backspace go back; Home and End jump to the first and last; Esc ends.
 * Swipes work on touch screens. It opens on the active artboard.
 */
import { h } from '../../lib/dom.js';
import { drawArtwork, LayerPool } from '../../render/draw.js';
import { icon } from '../../ui/icons.js';

/** Fit rect (CSS pixels) of an artboard in a w x h screen. */
export function slideFit(board, w, hgt, margin = 0) {
  const s = Math.min((w - margin * 2) / board.w, (hgt - margin * 2) / board.h);
  const dw = board.w * s;
  const dh = board.h * s;
  return { s, x: (w - dw) / 2, y: (hgt - dh) / 2, w: dw, h: dh };
}

/** Next slide index for a key, or null when the key does nothing. */
export function slideKey(key, index, count) {
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(key)) return Math.min(count - 1, index + 1);
  if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(key)) return Math.max(0, index - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

export function startPresentation(app, editor, start = editor?.activeArtboard ?? 0) {
  if (!editor || !editor.doc.artboards.length) return null;
  const doc = editor.doc;
  let index = Math.max(0, Math.min(doc.artboards.length - 1, start));
  const canvas = h('canvas.pres-canvas', { role: 'img' });
  const counter = h('div.pres-counter', { 'aria-live': 'polite' });
  const close = h('button.icon-btn.pres-close', { type: 'button', 'aria-label': 'End presentation', 'data-tip': 'End presentation (Esc)', onclick: () => end() }, icon('x', 18));
  const dialog = h('dialog.presentation', { 'aria-label': 'Presentation' }, canvas, counter, close);
  let hideTimer = 0;
  const showChrome = () => {
    dialog.classList.add('show-chrome');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => dialog.classList.remove('show-chrome'), 1800);
  };

  const render = () => {
    const board = doc.artboards[index];
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, dialog.clientWidth || window.innerWidth);
    const hh = Math.max(1, dialog.clientHeight || window.innerHeight);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hh * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${hh}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const f = slideFit(board, w, hh);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(f.x, f.y, f.w, f.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x, f.y, f.w, f.h);
    ctx.clip();
    const s = f.s * dpr;
    ctx.setTransform(s, 0, 0, s, (f.x - board.x * f.s) * dpr, (f.y - board.y * f.s) * dpr);
    drawArtwork(ctx, doc, { viewRect: board, outline: false, hairline: 1 / s, scale: s, layerPool: new LayerPool(canvas.width, canvas.height), layerFilter: (l) => !l.template && !l.pattern });
    ctx.restore();
    canvas.setAttribute('aria-label', `${board.name || `Artboard ${index + 1}`}, slide ${index + 1} of ${doc.artboards.length}`);
    counter.textContent = `${index + 1} / ${doc.artboards.length}`;
  };
  const go = (i) => {
    if (i == null || i === index) return;
    index = i;
    render();
    showChrome();
  };
  const onKey = (e) => {
    const next = slideKey(e.key, index, doc.artboards.length);
    if (next != null) {
      e.preventDefault();
      go(next);
    }
  };
  let touch = null;
  dialog.addEventListener('keydown', onKey);
  dialog.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    touch = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  dialog.addEventListener('pointerup', (e) => {
    if (!touch || e.target.closest('button')) return;
    const dx = e.clientX - touch.x;
    touch = null;
    if (Math.abs(dx) > 40) go(dx < 0 ? Math.min(doc.artboards.length - 1, index + 1) : Math.max(0, index - 1));
    else go(Math.min(doc.artboards.length - 1, index + 1));
  });
  dialog.addEventListener('pointermove', showChrome);
  const onResize = () => render();
  window.addEventListener('resize', onResize);
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    window.removeEventListener('resize', onResize);
    document.removeEventListener('fullscreenchange', onFs);
    clearTimeout(hideTimer);
    if (document.fullscreenElement === dialog) document.exitFullscreen?.().catch(() => {});
    if (dialog.open) dialog.close();
    dialog.remove();
    editor.setActiveArtboard(index);
    app.canvasHost?.focus();
  };
  const onFs = () => {
    if (!document.fullscreenElement) end();
  };
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    end();
  });
  document.body.append(dialog);
  dialog.showModal();
  // Full screen where the browser allows it; leaving full screen ends the show.
  dialog.requestFullscreen?.()?.then(() => document.addEventListener('fullscreenchange', onFs)).catch(() => {});
  render();
  showChrome();
  dialog.focus();
  return { dialog, go, end, get index() {
    return index;
  } };
}
