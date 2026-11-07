import { el } from '../lib/dom.js';

/**
 * Pointer rescheduling for the timeline. Four gestures, all snapping to
 * whole days (dates in this app are date-only strings by design):
 *
 *   move   drag a bar's body          → shifts start and due together
 *   start  drag a bar's left handle   → moves the start date
 *   end    drag a bar's right handle  → moves the due date
 *   chip   drag an unscheduled task onto the chart → gives it a due date
 *
 * The gesture rules follow the board's (src/ui/dnd.js): a mouse drag starts
 * after 4px, a touch drag after a 300ms hold (moving earlier stays a
 * scroll), Escape cancels, and the click that closes a drag is swallowed so
 * a reschedule never also opens the task sheet.
 *
 * DOM contract (built by views/timeline.js):
 *   .tl-bar[data-task-id]              draggable bar; [data-locked] opts out
 *   .tl-bar-handle[data-edge]          edge handle inside a bar
 *   .tl-unscheduled-item[data-task-id] backlog chip
 *
 * All date arithmetic stays in the view: this module reports a day delta and
 * asks the host to clamp it, label it, and mark the day it would land on.
 */

const MOUSE_SLOP = 4;
const TOUCH_SLOP = 10;
const HOLD_MS = 300;
const EDGE = 56;
const MAX_SPEED = 18;

export function initTimelineDnd(root, {
  scroll, chartOrigin, preview, dayPreview, markDay, onCommit, onSchedule,
}) {
  let candidate = null; // { kind, mode, el, taskId, x, y, pointerId, holdTimer }
  let drag = null;
  let lastX = 0;
  let lastY = 0;

  /** A drag's closing pointerup still produces a click; the bar would open. */
  function swallowNextClick() {
    const swallow = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, true), 150);
  }

  function cancelCandidate() {
    if (candidate?.holdTimer) clearTimeout(candidate.holdTimer);
    candidate = null;
  }

  function onPointerDown(e) {
    if (drag || !e.isPrimary || e.button !== 0) return;
    const bar = e.target.closest('.tl-bar[data-task-id]:not([data-locked])');
    const chip = bar ? null : e.target.closest('.tl-unscheduled-item[data-task-id]');
    const node = bar || chip;
    if (!node) return;

    candidate = {
      kind: bar ? 'bar' : 'chip',
      mode: e.target.closest('.tl-bar-handle')?.dataset.edge || 'move',
      el: node,
      taskId: node.dataset.taskId,
      x: e.clientX,
      y: e.clientY,
      pointerId: e.pointerId,
      holdTimer: null,
    };
    lastX = e.clientX;
    lastY = e.clientY;
    if (e.pointerType !== 'mouse') {
      candidate.holdTimer = setTimeout(() => { if (candidate) startDrag(); }, HOLD_MS);
    }
  }

  function onPointerMove(e) {
    lastX = e.clientX;
    lastY = e.clientY;
    if (drag) {
      if (e.pointerId !== drag.pointerId) return;
      update();
      return;
    }
    if (!candidate || e.pointerId !== candidate.pointerId) return;
    const dist = Math.hypot(e.clientX - candidate.x, e.clientY - candidate.y);
    if (candidate.holdTimer) {
      // Touch: early movement means the user is scrolling, not dragging.
      if (dist > TOUCH_SLOP) cancelCandidate();
    } else if (dist > MOUSE_SLOP) {
      startDrag();
    }
  }

  function onPointerUp(e) {
    if (drag && e.pointerId === drag.pointerId) { drop(); return; }
    if (candidate && e.pointerId === candidate.pointerId) cancelCandidate();
  }

  function onPointerCancel() {
    if (drag) cleanup();
    cancelCandidate();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && drag) {
      e.stopPropagation();
      cleanup();
    }
  }

  // Android fires contextmenu on long-press, which would interrupt the
  // hold-to-drag gesture. Right-click never arms a candidate.
  function onContextMenu(e) {
    if (drag || candidate) e.preventDefault();
  }

  const blockTouchScroll = (e) => { if (drag) e.preventDefault(); };

  function startDrag() {
    const c = candidate;
    cancelCandidate();
    if (!c.el.isConnected) return;
    const geo = chartOrigin();
    if (!geo) return;

    drag = { ...c, geo, delta: 0, day: null, over: false, raf: 0 };
    // The pill is a pointer affordance; the view announces the committed
    // result on its own live region, so a live pill would only double up.
    drag.pill = el('div.tl-drag-pill', { 'aria-hidden': 'true' });
    document.body.append(drag.pill);

    if (c.kind === 'bar') {
      // Grab point measured from the chart's day-0 origin, not the viewport:
      // auto-scrolling moves that origin, and a viewport-anchored grab would
      // stop counting days the moment the chart started scrolling.
      drag.grabX = c.x - geo.left;
      drag.baseLeft = parseFloat(c.el.style.left) || 0;
      drag.baseWidth = parseFloat(c.el.style.width) || 0;
      c.el.classList.add('tl-bar-dragging');
    } else {
      const rect = c.el.getBoundingClientRect();
      drag.ghost = c.el.cloneNode(true);
      drag.ghost.classList.add('tl-chip-ghost');
      drag.ghost.setAttribute('aria-hidden', 'true');
      drag.ghost.style.width = `${rect.width}px`;
      drag.offsetX = lastX - rect.left;
      drag.offsetY = lastY - rect.top;
      document.body.append(drag.ghost);
      c.el.classList.add('tl-chip-source');
    }

    root.classList.add('tl-dragging');
    document.body.classList.add('dnd-active');
    update();
    autoScrollLoop();
  }

  function positionPill(x, y, text) {
    drag.pill.textContent = text;
    const w = drag.pill.offsetWidth;
    const left = Math.max(8, Math.min(x - w / 2, window.innerWidth - w - 8));
    drag.pill.style.transform = `translate(${Math.round(left)}px, ${Math.round(y - 42)}px)`;
  }

  function update() {
    // The chart scrolls under the pointer while auto-scrolling, so the
    // origin is re-read rather than captured at drag start.
    const geo = chartOrigin();
    if (!geo) return;
    drag.geo = geo;

    if (drag.kind === 'bar') {
      const raw = Math.round((lastX - geo.left - drag.grabX) / geo.dw);
      const { delta, label } = preview(drag.taskId, drag.mode, raw);
      drag.delta = delta;
      const px = delta * geo.dw;
      if (drag.mode === 'move') {
        drag.el.style.transform = `translateX(${px}px)`;
      } else if (drag.mode === 'start') {
        drag.el.style.left = `${drag.baseLeft + px}px`;
        drag.el.style.width = `${Math.max(geo.dw, drag.baseWidth - px)}px`;
      } else {
        drag.el.style.width = `${Math.max(geo.dw, drag.baseWidth + px)}px`;
      }
      positionPill(lastX, lastY, label);
      return;
    }

    // Chip: snap to the day column under the pointer.
    drag.ghost.style.transform =
      `translate(${lastX - drag.offsetX}px, ${lastY - drag.offsetY}px) rotate(2deg)`;
    const chartRight = geo.left + geo.days * geo.dw;
    const inChart = lastX >= geo.left && lastX <= chartRight && overChart(lastX, lastY);
    drag.over = inChart;
    if (!inChart) {
      drag.day = null;
      markDay(null);
      positionPill(lastX, lastY, 'Drop on the chart to set a due date');
      return;
    }
    const day = Math.max(0, Math.min(geo.days - 1, Math.floor((lastX - geo.left) / geo.dw)));
    drag.day = day;
    markDay(day);
    positionPill(lastX, lastY, dayPreview(day));
  }

  /**
   * Whether the pointer is visibly over a day column. A rectangle test is not
   * enough: the app header overlays the top of the scroll box once the page
   * scrolls, and the sticky label column overlays its left edge — both would
   * otherwise accept a drop on a day the pointer is not pointing at. Hit
   * testing asks the browser what is actually on top instead. Everything the
   * drag itself adds is pointer-events: none, so it never answers.
   */
  function overChart(x, y) {
    const node = document.elementFromPoint(x, y);
    return !!node && scroll.contains(node) && !node.closest('.tl-label');
  }

  function autoScrollLoop() {
    if (!drag) return;
    const r = scroll.getBoundingClientRect();
    const speed = (dist) => Math.round(MAX_SPEED * Math.min(1, (EDGE - dist) / EDGE));
    if (lastX < r.left + EDGE) {
      scroll.scrollLeft -= speed(lastX - r.left);
      update();
    } else if (lastX > r.right - EDGE) {
      scroll.scrollLeft += speed(r.right - lastX);
      update();
    }
    drag.raf = requestAnimationFrame(autoScrollLoop);
  }

  function drop() {
    const { kind, taskId, mode, delta, day, over } = drag;
    cleanup();
    if (kind === 'bar') {
      if (delta) onCommit(taskId, mode, delta);
    } else if (over && day !== null) {
      onSchedule(taskId, day);
    }
  }

  function cleanup() {
    cancelAnimationFrame(drag.raf);
    drag.pill?.remove();
    drag.ghost?.remove();
    if (drag.kind === 'bar') {
      // A committed drag re-renders the row away; restoring the node it
      // replaced is harmless and covers the cancelled and no-op cases.
      drag.el.classList.remove('tl-bar-dragging');
      drag.el.style.transform = '';
      drag.el.style.left = `${drag.baseLeft}px`;
      drag.el.style.width = `${drag.baseWidth}px`;
    } else {
      drag.el.classList.remove('tl-chip-source');
      markDay(null);
    }
    drag = null;
    swallowNextClick();
    root.classList.remove('tl-dragging');
    document.body.classList.remove('dnd-active');
  }

  root.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('touchmove', blockTouchScroll, { passive: false });

  return {
    destroy() {
      if (drag) cleanup();
      cancelCandidate();
      root.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('touchmove', blockTouchScroll);
    },
  };
}
