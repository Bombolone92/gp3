import { el } from '../lib/dom.js';
import { icon } from './icons.js';

/**
 * Anchored popover menu with full keyboard support.
 *
 * openMenu(anchorEl, [item | 'sep'])
 *   item: { label, icon, prefix, danger, disabled, onClick,
 *           checked, keepOpen }
 *
 * `checked` (a boolean or a getter) turns the row into a menuitemcheckbox;
 * combined with `keepOpen` the menu stays put while several values are
 * toggled, which is what multi-select filter facets need.
 *
 * The anchor's `aria-expanded` is owned here rather than by each caller, so
 * every menu button says whether its menu is open without nine of them having
 * to remember to. Callers declare the resting `aria-expanded="false"` beside
 * their `aria-haspopup="menu"`.
 */
export function openMenu(anchor, items) {
  const menu = el('div.menu', { role: 'menu', tabindex: -1 });

  let closed = false;
  function close(refocus = true) {
    if (closed) return;
    closed = true;
    anchor?.setAttribute('aria-expanded', 'false');
    menu.remove();
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', onScroll, true);
    if (refocus && anchor?.isConnected) anchor.focus();
  }

  for (const item of items) {
    if (item === 'sep') { menu.append(el('div.menu-sep', { role: 'separator' })); continue; }
    if (!item) continue;
    const checkable = item.checked !== undefined;
    const isOn = () => (typeof item.checked === 'function' ? !!item.checked() : !!item.checked);
    const btn = el(`button.menu-item${item.danger ? '.danger' : ''}`, {
      type: 'button',
      role: checkable ? 'menuitemcheckbox' : 'menuitem',
      'aria-checked': checkable ? String(isOn()) : null,
      className: `menu-item${item.danger ? ' danger' : ''}${checkable && isOn() ? ' checked' : ''}`,
      disabled: !!item.disabled,
      html: item.icon ? icon(item.icon, 16, 1.9) : '',
      // Refocus the anchor on activation (menu-button pattern); a dialog
      // the action opens then captures it as the opener to return to.
      onclick: () => {
        if (item.keepOpen) {
          item.onClick?.();
          btn.setAttribute('aria-checked', String(isOn()));
          btn.classList.toggle('checked', isOn());
          return;
        }
        close();
        item.onClick?.();
      },
    },
      item.prefix || null,
      el('span.menu-label', {}, item.label),
      checkable && el('span.menu-check', { html: icon('check', 15, 2.6), 'aria-hidden': 'true' })
    );
    menu.append(btn);
  }

  function onOutside(e) {
    if (!menu.contains(e.target)) close(false);
  }

  function focusables() {
    return [...menu.querySelectorAll('.menu-item:not([disabled])')];
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') { close(); return; }
    const list = focusables();
    const idx = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      (list[idx + 1] || list[0])?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      (list[idx - 1] || list[list.length - 1])?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      list[list.length - 1]?.focus();
    }
  }

  // Close when the anchor scrolls away rather than tracking its position.
  function onScroll(e) {
    if (!menu.contains(e.target)) close(false);
  }

  document.body.append(menu);
  anchor.setAttribute('aria-expanded', 'true');

  // Position: below-right of the anchor, flipped when it would overflow.
  const a = anchor.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const pad = 8;
  let left = Math.min(a.right - m.width, window.innerWidth - m.width - pad);
  left = Math.max(pad, Math.max(left, a.left - m.width + Math.min(m.width, a.width)));
  let top = a.bottom + 4;
  if (top + m.height > window.innerHeight - pad) top = Math.max(pad, a.top - m.height - 4);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;

  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', close);
  window.addEventListener('scroll', onScroll, true);

  focusables()[0]?.focus();
  return { close };
}
