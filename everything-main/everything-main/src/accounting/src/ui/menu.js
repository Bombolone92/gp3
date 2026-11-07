/**
 * Popup menus anchored to a button, with the WAI-ARIA menu keyboard model:
 * arrows move, Home/End jump, Enter/Space activate, Escape closes and returns
 * focus to the button, typing a letter jumps to the next matching item.
 */
import { el } from './dom.js';
import { icon } from './icons.js';

let open = null;

export function closeMenus() {
  if (open) open.close();
}

/** Place a fixed popup below (or above) an anchor, inside the viewport. */
export function place(popup, anchor, { align = 'start', gap = 4, matchWidth = false } = {}) {
  const r = anchor.getBoundingClientRect();
  if (matchWidth) popup.style.minWidth = `${r.width}px`;
  popup.style.left = '0px';
  popup.style.top = '0px';
  const pw = popup.offsetWidth;
  const ph = popup.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = align === 'end' ? r.right - pw : r.left;
  left = Math.max(8, Math.min(left, vw - pw - 8));
  let top = r.bottom + gap;
  if (top + ph > vh - 8 && r.top - gap - ph > 8) top = r.top - gap - ph;
  top = Math.max(8, Math.min(top, vh - ph - 8));
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

/**
 * items: [{ label, icon, onClick, danger, kbd, checked, disabled, href }]
 *        | 'sep' | { header: 'Label' }
 */
export function openMenu(anchor, items, { align = 'start', label = 'Menu', className = '' } = {}) {
  if (open && open.anchor === anchor) { open.close(); return null; }
  closeMenus();
  const menu = el(`div.menu${className ? `.${className}` : ''}`, { role: 'menu', 'aria-label': label });
  const buttons = [];
  for (const item of items) {
    if (!item) continue;
    if (item === 'sep') { menu.append(el('div.menu-sep', { role: 'separator' })); continue; }
    if (item.header) { menu.append(el('div.menu-label', { role: 'presentation' }, item.header)); continue; }
    const role = item.checked !== undefined ? 'menuitemradio' : 'menuitem';
    const b = el(item.href ? 'a.menu-item' : 'button.menu-item', {
      type: item.href ? null : 'button',
      href: item.href || null,
      role,
      tabIndex: -1,
      class: item.danger ? 'danger' : '',
      'aria-checked': item.checked !== undefined ? String(!!item.checked) : null,
      'aria-disabled': item.disabled ? 'true' : null,
      onclick: (e) => {
        if (item.disabled) return;
        if (!item.href) e.preventDefault();
        close();
        item.onClick?.();
      },
    },
    item.icon && el('span', { html: icon(item.icon, 16) }),
    el('span.grow', {}, item.label),
    item.kbd && el('span.menu-kbd', {}, item.kbd));
    buttons.push(b);
    menu.append(b);
  }
  document.body.append(menu);
  place(menu, anchor, { align });
  anchor.setAttribute('aria-expanded', 'true');

  const focusAt = (i) => {
    if (!buttons.length) return;
    const n = (i + buttons.length) % buttons.length;
    buttons[n].focus();
  };
  const current = () => buttons.indexOf(document.activeElement);
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(current() + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(current() - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
    else if (e.key === 'End') { e.preventDefault(); focusAt(buttons.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); anchor.focus(); }
    else if (e.key === 'Tab') { close(); }
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const start = current() + 1;
      for (let k = 0; k < buttons.length; k++) {
        const b = buttons[(start + k) % buttons.length];
        if (b.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase())) { b.focus(); break; }
      }
    }
  };
  const onDown = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onResize = () => close();
  menu.addEventListener('keydown', onKey);
  document.addEventListener('mousedown', onDown, true);
  window.addEventListener('resize', onResize);
  const main = document.querySelector('.main');
  main?.addEventListener('scroll', onResize, { passive: true });

  function close() {
    if (!menu.isConnected) return;
    menu.remove();
    anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onDown, true);
    window.removeEventListener('resize', onResize);
    main?.removeEventListener('scroll', onResize);
    if (open?.menu === menu) open = null;
  }
  open = { anchor, menu, close };
  requestAnimationFrame(() => focusAt(0));
  return open;
}

/** A free-form popover (used for the Create menu). */
export function openPopover(anchor, content, { align = 'start', label = 'Menu', className = '' } = {}) {
  if (open && open.anchor === anchor) { open.close(); return null; }
  closeMenus();
  const pop = el(`div.menu${className ? `.${className}` : ''}`, { role: 'dialog', 'aria-label': label }, content);
  document.body.append(pop);
  place(pop, anchor, { align });
  anchor.setAttribute('aria-expanded', 'true');
  const links = () => [...pop.querySelectorAll('.menu-item')];
  const onKey = (e) => {
    const list = links();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); anchor.focus(); }
  };
  const onDown = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  pop.addEventListener('keydown', onKey);
  pop.addEventListener('click', (e) => { if (e.target.closest('.menu-item')) close(); });
  document.addEventListener('mousedown', onDown, true);
  function close() {
    if (!pop.isConnected) return;
    pop.remove();
    anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onDown, true);
    if (open?.menu === pop) open = null;
  }
  open = { anchor, menu: pop, close };
  requestAnimationFrame(() => links()[0]?.focus());
  return open;
}
