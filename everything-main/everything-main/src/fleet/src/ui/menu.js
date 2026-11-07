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

export function openPopover(anchor, content, { align = 'start', role = 'dialog', label, onClose, width, focus = true } = {}) {
  // Clicking the button of the popover that is open closes it (a toggle).
  if (anchor && current?.anchor === anchor) {
    const open = current;
    open.close();
    return open;
  }
  closeMenu();
  const pop = h('div.popover', { role, 'aria-label': label || null, tabindex: '-1' });
  if (width) pop.style.width = typeof width === 'number' ? `${width}px` : width;
  pop.append(typeof content === 'function' ? content({ close: () => api.close() }) : content);
  // Inside an open modal dialog everything else is inert, so the popover
  // must live in the dialog. Otherwise it goes in <main> so the floating
  // content belongs to a landmark. Where supported it is shown in the top
  // layer, which keeps it above dialogs and free of their clipping.
  const host = anchor?.closest('dialog[open]') || document.querySelector('main') || document.body;
  host.append(pop);
  if (typeof pop.showPopover === 'function') {
    pop.setAttribute('popover', 'manual');
    try {
      pop.showPopover();
    } catch {
      /* already shown or unsupported */
    }
  }
  position(pop, anchor, align);
  anchor?.setAttribute('aria-expanded', 'true');
  const returnFocus = document.activeElement;

  const onDoc = (e) => {
    if (!pop.contains(e.target) && !anchor?.contains(e.target)) api.close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      // Close only the popover, not a dialog it sits in.
      e.preventDefault();
      e.stopPropagation();
      api.close();
      anchor?.focus();
    }
  };
  const onResize = () => api.close();
  setTimeout(() => document.addEventListener('pointerdown', onDoc, true));
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  const scroller = anchor?.closest('.content, .dialog-body');
  scroller?.addEventListener('scroll', onResize, { passive: true });

  let closed = false;
  const api = {
    el: pop,
    anchor,
    close() {
      if (closed) return;
      closed = true;
      const hadFocus = pop.contains(document.activeElement);
      pop.remove();
      anchor?.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      scroller?.removeEventListener('scroll', onResize);
      if (current === api) current = null;
      if (hadFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      onClose?.();
    },
    reposition: () => position(pop, anchor, align),
  };
  current = api;
  // Keyboard users land inside the popover (menus manage their own focus).
  if (focus) (pop.querySelector('input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])') || pop).focus({ preventScroll: true });
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
      item.hint ? h('span.menu-hint', item.hint) : null,
    );
    buttons.push(btn);
    list.append(btn);
  }
  const api = openPopover(anchor, list, { ...opts, role: 'presentation', focus: false });
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
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
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
