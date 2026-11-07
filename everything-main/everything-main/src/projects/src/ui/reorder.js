/**
 * Drag-to-reorder for a vertical list of rows, in the same spirit as the
 * board's dnd: pointer events (so mouse, pen, and touch all work), a slop
 * threshold before a drag starts, and Escape to cancel.
 *
 * Rows move live rather than through a placeholder — the lists this drives
 * are short — and the final index is reported once, on drop.
 *
 * initListReorder(container, {
 *   itemSelector: '.checklist-item',   // rows, direct children of container
 *   handleSelector: '.drag-handle',    // where a drag may start
 *   onReorder(id, toIndex),            // id comes from data-id
 * }) → { destroy() }
 */

const SLOP = 4;

export function initListReorder(container, { itemSelector, handleSelector, onReorder }) {
  let candidate = null; // { row, y }
  let drag = null;      // { row, id, startIndex, siblings }

  const rows = () => [...container.querySelectorAll(itemSelector)];

  function onPointerDown(e) {
    if (drag || !e.isPrimary || e.button !== 0) return;
    if (!e.target.closest(handleSelector)) return;
    const row = e.target.closest(itemSelector);
    if (!row) return;
    e.preventDefault(); // a handle drag is never a text selection or scroll
    candidate = { row, y: e.clientY, pointerId: e.pointerId };
  }

  function onPointerMove(e) {
    if (candidate && !drag) {
      if (e.pointerId !== candidate.pointerId) return;
      if (Math.abs(e.clientY - candidate.y) <= SLOP) return;
      start();
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    // Swap with whichever neighbour's midpoint the pointer has crossed.
    for (const other of rows()) {
      if (other === drag.row) continue;
      const r = other.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const below = other.compareDocumentPosition(drag.row) & Node.DOCUMENT_POSITION_FOLLOWING;
      if (below && e.clientY < mid) { container.insertBefore(drag.row, other); break; }
      if (!below && e.clientY > mid) { container.insertBefore(drag.row, other.nextSibling); break; }
    }
  }

  function start() {
    const { row, pointerId } = candidate;
    candidate = null;
    drag = { row, pointerId, id: row.dataset.id, startIndex: rows().indexOf(row) };
    row.classList.add('reordering');
    document.body.classList.add('dnd-active');
  }

  function onPointerUp(e) {
    if (candidate && e.pointerId === candidate.pointerId) candidate = null;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { row, id, startIndex } = drag;
    const index = rows().indexOf(row);
    cleanup();
    if (index >= 0 && index !== startIndex) onReorder(id, index);
  }

  function onKeyDown(e) {
    if (e.key !== 'Escape' || !drag) return;
    // Cancel: put the row back where it started, then let the host re-render.
    const { row, startIndex } = drag;
    const others = rows().filter((r) => r !== row);
    cleanup();
    container.insertBefore(row, others[startIndex] ?? null);
  }

  function cleanup() {
    if (!drag) return;
    drag.row.classList.remove('reordering');
    drag = null;
    document.body.classList.remove('dnd-active');
  }

  container.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('keydown', onKeyDown);

  return {
    destroy() {
      cleanup();
      candidate = null;
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
