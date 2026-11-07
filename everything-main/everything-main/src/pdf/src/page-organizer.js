import { el } from './lib/ui.js';

/**
 * Let the thumbnails in `container` be reordered by dragging with a mouse or pen, which
 * drags once it has moved a little. Fingers scroll the panel instead and reorder through
 * each page's menu. A line shows where the page will land, the panel scrolls along near its
 * edges, and Escape or a lost pointer cancels. `onMove(from, to)` receives page indices once
 * a drag ends somewhere new; `canDrag()` may refuse to start one (while the editor is busy).
 */
export function enableThumbnailReorder(container, { onMove, canDrag = () => true }) {
  const START_PX = 6;
  let pending = null, // a press that may become a drag
    drag = null,
    suppressClick = false;
  const indicator = el('div', { class: 'thumb-drop', 'aria-hidden': 'true' });
  const items = () => [...container.querySelectorAll('.thumb-item')];
  const itemAt = (node) => node?.closest?.('.thumb-item');

  function begin(e) {
    if (e.isPrimary && e.button === 0) suppressClick = false;
    const item = itemAt(e.target);
    if (!item || !e.isPrimary || e.button !== 0 || pending || drag || !canDrag()) return;
    if (e.target.closest('.thumb-menu') || e.pointerType === 'touch') return;
    pending = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, item };
  }
  function start(x, y) {
    if (!pending) return;
    const from = items().indexOf(pending.item);
    drag = {
      pointerId: pending.pointerId,
      item: pending.item,
      from,
      to: from,
      lastX: x,
      lastY: y,
      scroll: 0,
      frame: 0,
    };
    pending = null;
    container.setPointerCapture(drag.pointerId);
    container.classList.add('reordering');
    drag.item.classList.add('dragging');
    place(x, y);
  }
  /** Decide the drop slot from the pointer's height and show the line there. */
  function place(x, y) {
    const list = items();
    let to = list.length;
    for (const [i, item] of list.entries()) {
      const r = item.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        to = i;
        break;
      }
    }
    drag.to = to;
    const before = list[to];
    if (before) container.insertBefore(indicator, before);
    else container.append(indicator);
    // Dropping right where the page already sits changes nothing; say so by hiding the line.
    indicator.hidden = to === drag.from || to === drag.from + 1;
    drag.lastX = x;
    drag.lastY = y;
    // Keep the list moving while the pointer waits at an edge: the pointer sends no more
    // events once it holds still, so a frame loop scrolls until it leaves the edge.
    const bounds = container.getBoundingClientRect();
    const edge = 28;
    drag.scroll = y < bounds.top + edge ? -1 : y > bounds.bottom - edge ? 1 : 0;
    if (drag.scroll && !drag.frame) drag.frame = requestAnimationFrame(autoScroll);
  }
  function autoScroll() {
    if (!drag) return;
    drag.frame = 0;
    if (!drag.scroll) return;
    const before = container.scrollTop;
    container.scrollTop += drag.scroll * 8;
    // At the end of the list there is nothing left to scroll; the slot still updates.
    place(drag.lastX, drag.lastY);
    if (container.scrollTop === before) drag.scroll = 0;
    if (drag?.scroll && !drag.frame) drag.frame = requestAnimationFrame(autoScroll);
  }
  function finish(commit) {
    if (!pending && !drag) return;
    // Escape can precede both the drag threshold and the eventual mouse release.
    // Suppress that release's click until it arrives, or a new pointer press begins.
    suppressClick = true;
    pending = null;
    if (!drag) return;
    const { item, from, to, pointerId, frame } = drag;
    drag = null;
    if (frame) cancelAnimationFrame(frame);
    indicator.remove();
    indicator.hidden = false;
    container.classList.remove('reordering');
    item.classList.remove('dragging');
    try {
      container.releasePointerCapture?.(pointerId);
    } catch {
      /* The capture may already be gone. */
    }
    // Removing the page first shifts everything after it up by one.
    const target = to > from ? to - 1 : to;
    if (commit && target !== from) onMove(from, target);
  }
  // Before dragging starts there is no capture, so a release can land outside the panel.
  const releasePending = (e) => {
    if (pending?.pointerId === e.pointerId) pending = null;
  };
  window.addEventListener('pointerup', releasePending, true);
  window.addEventListener('pointercancel', releasePending, true);
  container.addEventListener('pointerdown', begin);
  container.addEventListener('pointermove', (e) => {
    if (pending && e.pointerId === pending.pointerId) {
      // Also recover if the release happened outside the browser and was never delivered.
      if (!(e.buttons & 1)) {
        pending = null;
        return;
      }
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > START_PX)
        start(e.clientX, e.clientY);
      return;
    }
    if (drag && e.pointerId === drag.pointerId) {
      e.preventDefault();
      drag.lastY = e.clientY;
      place(e.clientX, e.clientY);
    }
  });
  container.addEventListener('pointerup', (e) => {
    if (pending && e.pointerId === pending.pointerId) pending = null;
    else if (drag && e.pointerId === drag.pointerId) {
      place(e.clientX, e.clientY);
      finish(true);
    }
  });
  container.addEventListener('pointercancel', (e) => {
    if (pending?.pointerId === e.pointerId || drag?.pointerId === e.pointerId) finish(false);
  });
  container.addEventListener('lostpointercapture', (e) => {
    if (drag?.pointerId === e.pointerId) finish(false);
  });
  // A drag must not also count as a click on the page it started from.
  container.addEventListener(
    'click',
    (e) => {
      if (suppressClick && e.detail > 0) {
        e.stopPropagation();
        e.preventDefault();
        suppressClick = false;
      }
    },
    true,
  );
  function onKey(e) {
    if (e.key === 'Escape' && (pending || drag)) {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  }
  window.addEventListener('keydown', onKey, true);
  return {
    get active() {
      return !!drag;
    },
    cancel: () => finish(false),
    destroy() {
      finish(false);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerup', releasePending, true);
      window.removeEventListener('pointercancel', releasePending, true);
    },
  };
}
