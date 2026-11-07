/**
 * Pointer-based card dragging between drop zones (kanban stacks, calendar
 * days). Works with a mouse right away and with touch after a short press,
 * so scrolling a board on a phone still scrolls.
 *
 * Zones are elements with data-drop; cards are elements with data-id (a
 * card may itself be a button). onDrop({ id, zone, beforeId, from }) runs
 * when a card lands; from is the zone it was picked up in.
 */
export function enableCardDrag(root, { onDrop, onClick, scrollers = () => [], canDrag = () => true }) {
  let st = null;
  // Controls inside a card do their own thing; the card itself is not one.
  const onControl = (target, card) => {
    const ctl = target.closest('button, a, input, textarea, select');
    return !!ctl && ctl !== card;
  };

  const cleanup = () => {
    if (!st) return;
    clearTimeout(st.timer);
    st.ghost?.remove();
    st.line?.remove();
    st.card?.classList.remove('drag-source');
    root.classList.remove('dragging-cards');
    document.querySelectorAll('[data-drop].drop-over').forEach((z) => z.classList.remove('drop-over'));
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', onKey, true);
    cancelAnimationFrame(st.raf);
    st = null;
  };

  const begin = () => {
    const r = st.card.getBoundingClientRect();
    st.dragging = true;
    st.dx = st.x - r.left;
    st.dy = st.y - r.top;
    st.ghost = st.card.cloneNode(true);
    st.ghost.classList.add('drag-ghost');
    st.ghost.style.width = `${r.width}px`;
    st.ghost.removeAttribute('tabindex');
    st.ghost.setAttribute('aria-hidden', 'true');
    document.body.append(st.ghost);
    st.card.classList.add('drag-source');
    root.classList.add('dragging-cards');
    st.line = document.createElement('div');
    st.line.className = 'drop-line';
    place();
    const tick = () => {
      if (!st) return;
      for (const s of scrollers()) {
        const b = s.getBoundingClientRect();
        // Only the container the pointer is over (stacks side by side share their top edge).
        if (st.x >= b.left && st.x <= b.right) {
          if (st.y < b.top + 40 && st.y > b.top - 20) s.scrollTop -= 10;
          else if (st.y > b.bottom - 40 && st.y < b.bottom + 20) s.scrollTop += 10;
        }
        if (st.y >= b.top && st.y <= b.bottom) {
          if (st.x < b.left + 40 && st.x > b.left - 20) s.scrollLeft -= 12;
          else if (st.x > b.right - 40 && st.x < b.right + 20) s.scrollLeft += 12;
        }
      }
      st.raf = requestAnimationFrame(tick);
    };
    st.raf = requestAnimationFrame(tick);
    window.addEventListener('keydown', onKey, true);
  };

  // A drag is not a click: swallow the click that may follow, but only that one.
  const swallowClick = () => {
    const swallow = (ev) => ev.stopPropagation();
    root.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => root.removeEventListener('click', swallow, { capture: true }), 0);
  };

  // Escape puts the card back; letting go afterwards does nothing.
  const onKey = (e) => {
    if (e.key !== 'Escape' || !st?.dragging) return;
    e.preventDefault();
    e.stopPropagation();
    cleanup();
    window.addEventListener('pointerup', swallowClick, { capture: true, once: true });
  };

  const place = () => {
    st.ghost.style.transform = `translate(${st.x - st.dx}px, ${st.y - st.dy}px) rotate(1.5deg)`;
    const under = document.elementFromPoint(st.x, st.y);
    const zone = under?.closest?.('[data-drop]');
    document.querySelectorAll('[data-drop].drop-over').forEach((z) => z !== zone && z.classList.remove('drop-over'));
    st.zone = zone && root.contains(zone) ? zone : null;
    if (!st.zone) {
      st.line.remove();
      return;
    }
    st.zone.classList.add('drop-over');
    const list = st.zone.querySelector('[data-cards]') || st.zone;
    const cards = [...list.querySelectorAll(':scope > [data-id]')].filter((c) => c !== st.card);
    let before = null;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (st.y < r.top + r.height / 2) {
        before = c;
        break;
      }
    }
    st.beforeId = before?.dataset.id || null;
    if (list.dataset.cards !== 'unordered') {
      if (before) list.insertBefore(st.line, before);
      else list.append(st.line);
    }
  };

  const move = (e) => {
    if (!st) return;
    st.x = e.clientX;
    st.y = e.clientY;
    if (!st.dragging) {
      const far = Math.hypot(e.clientX - st.x0, e.clientY - st.y0) > 6;
      if (st.touch) {
        if (far) cleanup();
        return;
      }
      if (far) begin();
      return;
    }
    e.preventDefault();
    place();
  };

  const up = (e) => {
    if (!st) return;
    const s = st;
    if (s.dragging) {
      e.preventDefault();
      const zone = s.zone?.dataset.drop;
      const id = s.card.dataset.id;
      const beforeId = s.beforeId;
      const from = s.card.closest('[data-drop]')?.dataset.drop;
      cleanup();
      if (zone !== undefined) onDrop({ id, zone, beforeId, from });
      swallowClick();
      return;
    }
    cleanup();
  };

  const cancel = () => cleanup();

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const card = e.target.closest('[data-id]');
    if (!card || !root.contains(card) || onControl(e.target, card) || !canDrag(card)) return;
    st = { card, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' };
    if (st.touch) {
      st.timer = setTimeout(() => {
        if (st && !st.dragging) {
          begin();
          navigator.vibrate?.(10);
        }
      }, 380);
    }
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  });
  // Touch drags must not scroll the page once they started.
  root.addEventListener('touchmove', (e) => {
    if (st?.dragging) e.preventDefault();
  }, { passive: false });
  if (onClick) {
    root.addEventListener('click', (e) => {
      const card = e.target.closest('[data-id]');
      if (card && root.contains(card) && !onControl(e.target, card)) onClick(card.dataset.id, e);
    });
  }
  return { cancel: cleanup };
}
