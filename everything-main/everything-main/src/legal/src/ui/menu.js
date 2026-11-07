/**
 * Popover menus anchored to a button, with roving keyboard focus (arrows,
 * Home/End, Escape, type-ahead).
 *
 * openMenu(anchor, [
 *   { label: 'Edit', icon: 'pencil', run: fn, hint: 'E' },
 *   { separator: true },
 *   { label: 'Delete', icon: 'trash', danger: true, run: fn },
 *   { heading: 'Section' },
 * ], { align: 'end' })
 */
import { h } from './dom.js';
import { icon } from './icons.js';

let current = null;

export function closeMenu() {
  if (current) current.close();
}

export function openPopover(anchor, content, { align = 'start', role = 'dialog', label, onClose, width, cls = '' } = {}) {
  closeMenu();
  const pop = h(`div.popover${cls ? '.' + cls : ''}`, { role, 'aria-label': label || null, tabindex: '-1' });
  if (width) pop.style.width = typeof width === 'number' ? `${width}px` : width;
  pop.append(typeof content === 'function' ? content({ close: () => api.close() }) : content);
  // Inside a dialog when the anchor is in one (so it stays in the top layer),
  // otherwise inside <main> so it belongs to a landmark.
  const host = anchor?.closest('dialog') || document.querySelector('main') || document.body;
  host.append(pop);
  position(pop, anchor, align);
  anchor?.setAttribute('aria-expanded', 'true');

  const onDoc = (e) => {
    if (!pop.contains(e.target) && !anchor?.contains(e.target)) api.close();
  };
  const onKey = (e) => {
    // An open list of suggestions inside closes first, on its own Escape.
    if (e.key === 'Escape' && pop.contains(e.target) && e.target.getAttribute?.('aria-expanded') === 'true') return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      api.close();
      anchor?.focus();
    }
  };
  const onResize = () => api.close();
  // Any box that holds the button scrolling (the page, a table, a dialog's
  // body) would leave the popover floating away from it.
  const onScroll = (e) => {
    if (e.target === document || (e.target instanceof Node && e.target.contains(anchor))) api.close();
  };
  // Later, so the click that opened it does not close it; not at all if it already closed.
  setTimeout(() => closed || document.addEventListener('pointerdown', onDoc, true));
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  if (anchor) document.addEventListener('scroll', onScroll, { capture: true, passive: true });

  let closed = false;
  const api = {
    el: pop,
    close() {
      if (closed) return;
      closed = true;
      // Focus inside would fall to <body> once the popover is gone (and a
      // dialog opened from a menu item would return focus there). Give it
      // back to the button that opened it.
      const hadFocus = pop.contains(document.activeElement);
      pop.remove();
      if (hadFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
      anchor?.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('scroll', onScroll, { capture: true });
      if (current === api) current = null;
      onClose?.();
    },
    reposition: () => position(pop, anchor, align),
  };
  current = api;
  // The popover sits at the end of <main>, far from its button in tab order.
  // Start keyboard focus inside it (menus then move it to their first item).
  pop.focus({ preventScroll: true });
  return api;
}

function position(pop, anchor, align) {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = align === 'end' ? r.right - pw : r.left;
  left = Math.max(8, Math.min(left, vw - pw - 8));
  let top = r.bottom + 6;
  if (top + ph > vh - 8 && r.top - ph - 6 > 8) top = r.top - ph - 6;
  top = Math.max(8, Math.min(top, vh - ph - 8));
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

export function openMenu(anchor, items, opts = {}) {
  const list = h('div', { role: 'menu', 'aria-label': opts.label || null });
  const buttons = [];
  for (const item of items.filter(Boolean)) {
    if (item.separator) {
      list.append(h('div.menu-sep', { role: 'separator' }));
      continue;
    }
    if (item.heading) {
      list.append(h('div.menu-label', { role: 'presentation' }, item.heading));
      continue;
    }
    const tag = item.href ? 'a' : 'button';
    const btn = h(
      `${tag}.menu-item${item.danger ? '.danger' : ''}`,
      {
        role: item.checked === undefined ? 'menuitem' : 'menuitemradio',
        'aria-checked': item.checked === undefined ? null : String(!!item.checked),
        type: tag === 'button' ? 'button' : null,
        href: item.href || null,
        target: item.external ? '_blank' : null,
        rel: item.external ? 'noopener noreferrer' : null,
        tabindex: '-1',
        disabled: item.disabled || null,
        onClick: (e) => {
          if (item.disabled) return;
          api.close();
          if (!item.href) {
            e.preventDefault();
            item.run?.();
          }
        },
      },
      item.icon ? icon(item.icon, 16) : null,
      item.description ? h('span.grow', item.label, h('span.menu-desc', item.description)) : h('span.grow', item.label),
      item.checked ? icon('check', 16) : null,
      item.hint ? h('kbd.menu-hint', item.hint) : null,
    );
    buttons.push(btn);
    list.append(btn);
  }
  const api = openPopover(anchor, list, { ...opts, role: 'presentation' });
  let idx = -1;
  const focusAt = (i) => {
    if (!buttons.length) return;
    idx = (i + buttons.length) % buttons.length;
    buttons[idx].focus();
  };
  list.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusAt(idx + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusAt(idx - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusAt(buttons.length - 1);
    } else if (e.key === 'Tab') {
      api.close();
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type-ahead owns printable keys here; app shortcuts (N, G then M) must not see them.
      e.preventDefault();
      const k = e.key.toLowerCase();
      const start = idx + 1;
      for (let n = 0; n < buttons.length; n++) {
        const b = buttons[(start + n) % buttons.length];
        if (b.textContent.trim().toLowerCase().startsWith(k)) {
          focusAt((start + n) % buttons.length);
          break;
        }
      }
    }
  });
  anchor?.setAttribute('aria-haspopup', 'menu');
  focusAt(0);
  return api;
}
