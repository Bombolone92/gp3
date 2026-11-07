/**
 * Popover menus anchored to a button, with roving keyboard focus
 * (arrows, Home/End, Esc, type-ahead).
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

export function openPopover(anchor, content, { align = 'start', role = 'dialog', label, onClose, width, side = 'bottom' } = {}) {
  closeMenu();
  const pop = h('div.popover', { role, 'aria-label': label || null, tabindex: '-1' });
  if (width) pop.style.width = typeof width === 'number' ? `${width}px` : width;
  pop.append(typeof content === 'function' ? content({ close: () => api.close() }) : content);
  // Inside <main> so the floating content belongs to a landmark; it is
  // position: fixed, so where it sits in the tree does not move it.
  (document.querySelector('main') || document.body).append(pop);
  position(pop, anchor, align, side);
  anchor?.setAttribute('aria-expanded', 'true');

  const onDoc = (e) => {
    if (!pop.contains(e.target) && !anchor?.contains(e.target)) api.close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      api.close();
      anchor?.focus();
    }
  };
  const onResize = () => api.close();
  setTimeout(() => document.addEventListener('pointerdown', onDoc, true));
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  const scroller = anchor?.closest('.content');
  scroller?.addEventListener('scroll', onResize, { passive: true });

  let closed = false;
  const api = {
    el: pop,
    close() {
      if (closed) return;
      closed = true;
      // Focus inside the popover would fall to <body> when it goes; send it
      // back to the button that opened it (where a dialog opened from a menu
      // item also returns it on closing).
      const hadFocus = pop.contains(document.activeElement);
      pop.remove();
      if (hadFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
      anchor?.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      scroller?.removeEventListener('scroll', onResize);
      if (current === api) current = null;
      onClose?.();
    },
    reposition: () => position(pop, anchor, align, side),
  };
  current = api;
  // A popover that is not a menu (menus focus their first item) takes focus
  // itself: it sits at the end of the page, out of reach of Tab otherwise.
  if (role !== 'presentation') {
    // Skip controls taken out of the tab order (the unselected options of a
    // radio group): focusing one would let Space change the setting.
    const first = pop.querySelector(['input:not([disabled])', 'select', 'textarea', 'button:not([disabled])', 'a[href]', '[tabindex]'].map((x) => `${x}:not([tabindex="-1"])`).join(', '));
    (first || pop).focus({ preventScroll: true });
  }
  return api;
}

function position(pop, anchor, align, side = 'bottom') {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (side === 'right') {
    pop.style.left = `${Math.min(r.right + 8, vw - pw - 8)}px`;
    pop.style.top = `${Math.max(8, Math.min(r.top, vh - ph - 8))}px`;
    return;
  }
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
    if (item.node) {
      list.append(item.node);
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
        // Unavailable items stay focusable so the keyboard reaches them and
        // their reason ("Has leases...") is read out.
        'aria-disabled': item.disabled ? 'true' : null,
        onClick: (e) => {
          if (item.disabled) {
            e.preventDefault();
            return;
          }
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
      item.hint ? h('span.menu-hint', item.hint) : null,
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
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // The letter jumps within the menu and goes no further (it would
      // otherwise also trigger the app's single-key shortcuts).
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
