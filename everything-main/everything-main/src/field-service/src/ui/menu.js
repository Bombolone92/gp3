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

export function openPopover(anchor, content, { align = 'start', role = 'dialog', label, onClose, width } = {}) {
  // Clicking the button of the open popover closes it (a toggle).
  if (anchor && current?.anchor === anchor) {
    current.close();
    return { el: h('div'), close() {}, reposition() {}, anchor };
  }
  closeMenu();
  const pop = h('div.popover', { role, 'aria-label': label || null, tabindex: '-1' });
  if (width) pop.style.width = typeof width === 'number' ? `${width}px` : width;
  pop.append(typeof content === 'function' ? content({ close: () => api.close() }) : content);
  // Inside <main> so the floating content belongs to a landmark; it is
  // position: fixed, so where it sits in the tree does not move it. From a
  // modal dialog it goes inside the dialog, since everything outside one is
  // inert and drawn underneath it.
  (anchor?.closest('dialog[open]') || document.querySelector('main') || document.body).append(pop);
  position(pop, anchor, align);
  anchor?.setAttribute('aria-expanded', 'true');

  const onDoc = (e) => {
    if (!pop.contains(e.target) && !anchor?.contains(e.target)) api.close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      // preventDefault too: inside a dialog, Escape would also close it.
      e.preventDefault();
      e.stopPropagation();
      api.close();
      anchor?.focus();
    }
  };
  const onResize = () => api.close();
  // Any scroll but the popover's own moves its anchor away (the page, a
  // calendar grid, a dialog body), so close rather than float detached.
  const onScroll = (e) => !pop.contains(e.target) && api.close();
  setTimeout(() => document.addEventListener('pointerdown', onDoc, true));
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });

  let closed = false;
  const api = {
    el: pop,
    anchor,
    close() {
      if (closed) return;
      closed = true;
      // An item was chosen (or Escape): focus would drop to the page top as
      // the popover goes, and a dialog the item opens would return it there.
      if (pop.contains(document.activeElement)) anchor?.focus({ preventScroll: true });
      pop.remove();
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
  if (role === 'dialog') {
    // Take keyboard users into the popover (menus focus their first item
    // themselves), and close it once focus moves elsewhere.
    pop.querySelector('input, button, a[href], select, textarea, [tabindex="0"]')?.focus({ preventScroll: true });
    pop.addEventListener('focusout', (e) => e.relatedTarget && !pop.contains(e.relatedTarget) && e.relatedTarget !== anchor && api.close());
  }
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
    // Disabled items cannot take focus, so arrow keys skip them.
    if (!item.disabled) buttons.push(btn);
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
      // Back to the trigger first, so Tab carries on from there rather than
      // from the top of the page once the menu is gone.
      anchor?.focus();
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
