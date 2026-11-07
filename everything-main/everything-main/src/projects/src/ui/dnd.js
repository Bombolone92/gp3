/**
 * Pointer-based drag and drop for the board. Handles two draggables:
 *
 *   cards    .card[data-task-id]   → vertical within / across .col-body
 *   columns  .col-head drag area   → horizontal across the board
 *
 * Mouse drags start after a 5px move; touch drags start after a 300ms
 * hold (moving earlier stays a native scroll). While a drag is live a
 * non-passive touchmove listener suppresses scrolling, and an rAF loop
 * auto-scrolls the board / column edges under the pointer.
 *
 * DOM contract (built by board.js):
 *   board                 horizontal scroll container, .board
 *   .col[data-col-id]     column; .col-head inside is the column handle
 *   .col-body[data-col-id] vertical scroll area holding .card elements
 *
 * Keyboard users get the same moves via card shortcuts and the task
 * sheet's column picker (see board.js) — this module is pointer-only.
 */

const MOUSE_SLOP = 5;
const TOUCH_SLOP = 10;
const HOLD_MS = 300;
const EDGE = 48;
const MAX_SPEED = 14;

export function initBoardDnd(board, { onDropCard, onDropColumn }) {
  let candidate = null; // { kind, el, x, y, holdTimer }
  let drag = null;      // { kind, el, ghost, placeholder, pointerId, raf }
  let lastX = 0;
  let lastY = 0;

  const isInteractive = (target) =>
    !!target.closest('button, a, input, textarea, select, [contenteditable]');

  /**
   * A drag's closing pointerup still produces a browser click — most
   * visibly after an Escape cancel, where the restored card receives it
   * and would pop open the task sheet. Swallow the click that follows a
   * drag; the listener disarms itself immediately after.
   */
  function swallowNextClick() {
    const swallow = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, true), 150);
  }

  function onPointerDown(e) {
    if (drag || !e.isPrimary || e.button !== 0 || isInteractive(e.target)) return;
    const card = e.target.closest('.card[data-task-id]');
    const head = card ? null : e.target.closest('.col-head');
    const kind = card ? 'card' : head ? 'col' : null;
    if (!kind) return;
    const dragEl = card || head.closest('.col');
    if (!dragEl) return;

    candidate = { kind, el: dragEl, x: e.clientX, y: e.clientY, pointerId: e.pointerId, holdTimer: null };
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
      positionGhost(e.clientX, e.clientY);
      updateTarget(e.clientX, e.clientY);
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
    if (e.key === 'Escape' && drag) cleanup();
  }

  // Android fires contextmenu on long-press, which would interrupt the
  // hold-to-drag gesture. Right-click (mouse) never arms a candidate, so
  // regular context menus are unaffected.
  function onContextMenu(e) {
    if (drag || candidate) e.preventDefault();
  }

  const blockTouchScroll = (e) => { if (drag) e.preventDefault(); };

  function cancelCandidate() {
    if (candidate?.holdTimer) clearTimeout(candidate.holdTimer);
    candidate = null;
  }

  function startDrag() {
    const { kind, el, pointerId } = candidate;
    cancelCandidate();
    if (!el.isConnected) return;

    const rect = el.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.append(ghost);

    const placeholder = document.createElement('div');
    placeholder.className = kind === 'card' ? 'card-placeholder' : 'col-placeholder';
    if (kind === 'card') placeholder.style.height = `${rect.height}px`;
    else placeholder.style.width = `${rect.width}px`;
    el.parentNode.insertBefore(placeholder, el);
    el.classList.add('drag-hidden');

    drag = {
      kind, el, ghost, placeholder, pointerId,
      offsetX: lastX - rect.left,
      offsetY: lastY - rect.top,
      raf: 0,
    };
    board.classList.add('is-dragging');
    document.body.classList.add('dnd-active');
    positionGhost(lastX, lastY);
    autoScrollLoop();
  }

  function positionGhost(x, y) {
    drag.ghost.style.transform =
      `translate(${x - drag.offsetX}px, ${y - drag.offsetY}px) rotate(2deg)`;
  }

  function updateTarget(x, y) {
    if (drag.kind === 'card') placeCardPlaceholder(x, y);
    else placeColPlaceholder(x);
  }

  /** Column whose horizontal band contains x (pointer may be off any body). */
  function columnAt(x) {
    let best = null;
    let bestDist = Infinity;
    for (const col of board.querySelectorAll('.col:not(.drag-hidden)')) {
      const r = col.getBoundingClientRect();
      if (x >= r.left && x <= r.right) return col;
      const d = x < r.left ? r.left - x : x - r.right;
      if (d < bestDist) { bestDist = d; best = col; }
    }
    return best;
  }

  function placeCardPlaceholder(x, y) {
    const col = columnAt(x);
    const body = col?.querySelector('.col-body');
    if (!body) return;
    const cards = [...body.querySelectorAll('.card:not(.drag-hidden)')];
    let beforeEl = null;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (y < r.top + r.height / 2) { beforeEl = c; break; }
    }
    if (beforeEl) body.insertBefore(drag.placeholder, beforeEl);
    else body.append(drag.placeholder);
  }

  function placeColPlaceholder(x) {
    const cols = [...board.querySelectorAll('.col:not(.drag-hidden)')];
    let beforeEl = null;
    for (const c of cols) {
      const r = c.getBoundingClientRect();
      if (x < r.left + r.width / 2) { beforeEl = c; break; }
    }
    const track = drag.el.parentNode;
    if (beforeEl) track.insertBefore(drag.placeholder, beforeEl);
    else {
      // Keep the placeholder before the trailing "add column" rail.
      const addCol = track.querySelector('.add-col');
      if (addCol) track.insertBefore(drag.placeholder, addCol);
      else track.append(drag.placeholder);
    }
  }

  function autoScrollLoop() {
    if (!drag) return;
    const b = board.getBoundingClientRect();
    const speed = (dist) => Math.round(MAX_SPEED * Math.min(1, (EDGE - dist) / EDGE));
    if (lastX < b.left + EDGE) board.scrollLeft -= speed(lastX - b.left);
    else if (lastX > b.right - EDGE) board.scrollLeft += speed(b.right - lastX);

    if (drag.kind === 'card') {
      const body = columnAt(lastX)?.querySelector('.col-body');
      if (body) {
        const r = body.getBoundingClientRect();
        if (lastY < r.top + EDGE) body.scrollTop -= speed(lastY - r.top);
        else if (lastY > r.bottom - EDGE) body.scrollTop += speed(r.bottom - lastY);
      }
    }
    drag.raf = requestAnimationFrame(autoScrollLoop);
  }

  function drop() {
    const { kind, el, placeholder } = drag;
    if (kind === 'card') {
      const body = placeholder.closest('.col-body');
      if (body) {
        const toColumnId = body.dataset.colId;
        let index = 0;
        for (const child of body.children) {
          if (child === placeholder) break;
          if (child.classList.contains('card') && !child.classList.contains('drag-hidden')) index++;
        }
        cleanup();
        onDropCard(el.dataset.taskId, toColumnId, index);
        return;
      }
    } else {
      const track = placeholder.parentNode;
      let index = 0;
      for (const child of track.children) {
        if (child === placeholder) break;
        if (child.classList.contains('col') && !child.classList.contains('drag-hidden')) index++;
      }
      cleanup();
      onDropColumn(el.dataset.colId, index);
      return;
    }
    cleanup();
  }

  function cleanup() {
    cancelAnimationFrame(drag.raf);
    drag.ghost.remove();
    drag.placeholder.remove();
    drag.el.classList.remove('drag-hidden');
    drag = null;
    swallowNextClick();
    board.classList.remove('is-dragging');
    document.body.classList.remove('dnd-active');
  }

  board.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('touchmove', blockTouchScroll, { passive: false });

  return {
    destroy() {
      if (drag) cleanup();
      cancelCandidate();
      board.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('touchmove', blockTouchScroll);
    },
  };
}
