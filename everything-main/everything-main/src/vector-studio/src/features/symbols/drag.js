/**
 * Dragging symbols out of the Symbols panel or a library onto the canvas:
 * a small preview follows the pointer and dropping on the canvas places an
 * instance with its registration point under the pointer.
 */
import { h } from '../../lib/dom.js';

/** The document point under a client position, or null when it is not over the canvas. */
export function canvasPointAt(app, clientX, clientY) {
  const host = app.canvasHost;
  const ed = app.editor;
  if (!host || !ed) return null;
  const under = document.elementFromPoint?.(clientX, clientY);
  if (!under || !host.contains(under)) return null;
  const r = host.getBoundingClientRect();
  return ed.view.toDoc(clientX - r.left, clientY - r.top);
}

/**
 * Start watching a pointerdown on `el` for a drag. `preview()` returns an
 * element shown under the pointer; `onDrop(point)` runs with the document
 * point when dropped on the canvas. Returns nothing; a plain click is left
 * alone (and a click right after a drag is swallowed).
 */
export function dragToCanvas(app, el, down, { preview, onDrop, onStart }) {
  if (down.button !== 0) return;
  const x0 = down.clientX;
  const y0 = down.clientY;
  let ghost = null;
  const move = (e) => {
    if (!ghost && Math.hypot(e.clientX - x0, e.clientY - y0) > 5) {
      ghost = h('div.sym-drag-ghost', { 'aria-hidden': 'true' }, preview());
      document.body.append(ghost);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic or already released pointer.
      }
      onStart?.();
    }
    if (!ghost) return;
    ghost.style.left = `${e.clientX + 8}px`;
    ghost.style.top = `${e.clientY + 8}px`;
    ghost.classList.toggle('over-canvas', Boolean(canvasPointAt(app, e.clientX, e.clientY)));
  };
  const up = (e) => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
    if (!ghost) return;
    ghost.remove();
    ghost = null;
    const p = canvasPointAt(app, e.clientX, e.clientY);
    if (p) onDrop(p);
    const stop = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    el.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => el.removeEventListener('click', stop, { capture: true }), 0);
  };
  const cancel = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
    ghost?.remove();
    ghost = null;
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
}
