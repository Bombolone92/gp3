/**
 * Small UI primitives: toasts, popover menus and dialogs. All keyboard
 * accessible: menus follow the WAI-ARIA menu pattern (arrow keys, Home/End,
 * type-ahead, Escape returns focus), dialogs use native <dialog> (focus trap
 * and Escape for free).
 */
import { h, announce, liveContainer } from './dom.js';
import { icon } from './icons.js';

/* ---- Toasts ---- */

let toastHost = null;

/** Show a short message. `action` = { label, run } adds a button (Undo). */
export function toast(message, { action = null, error = false, duration = 4000 } = {}) {
  if (!toastHost) toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
  // Inside an open modal dialog, or it would sit under the backdrop, inert.
  const host = liveContainer();
  const moved = toastHost.parentNode !== host;
  if (moved) host.append(toastHost);
  const el = h('div', { class: `toast${error ? ' toast-error' : ''}` }, h('span', null, message));
  let timer = null;
  const close = () => {
    clearTimeout(timer);
    el.remove();
  };
  if (action) {
    el.append(
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => (close(), action.run()) }, action.label),
    );
  }
  el.append(h('button', { class: 'btn btn-sm btn-icon', type: 'button', 'aria-label': 'Dismiss', onclick: close }, icon('x', { size: 14 })));
  // A live region that just moved is read out reliably only from the next
  // change on: add the message a moment later.
  if (moved) setTimeout(() => toastHost.append(el), 30);
  else toastHost.append(el);
  while (toastHost.children.length > 3) toastHost.firstChild.remove();
  timer = setTimeout(close, action ? Math.max(duration, 6000) : duration);
  if (error) announce(message);
  return close;
}

export const toastError = (message) => toast(message, { error: true, duration: 6000 });

/* ---- Radio groups (segmented controls, presets) ---- */

/** The button radios of `group` (not native inputs, not nested groups'). */
function radiosOf(group) {
  return [...group.querySelectorAll('[role=radio]')].filter(
    (r) => !(r instanceof HTMLInputElement) && !r.disabled && r.closest('[role=radiogroup]') === group,
  );
}

/** One Tab stop per group: its checked radio (or the first). */
function rove(group) {
  const radios = radiosOf(group);
  if (!radios.length) return;
  const on = radios.find((r) => r.getAttribute('aria-checked') === 'true') || radios[0];
  for (const r of radios) r.tabIndex = r === on ? 0 : -1;
}

/**
 * Give every button-based radio group the keyboard of a radio group (the
 * WAI-ARIA pattern): arrow keys, Home and End move to an option and pick
 * it, and Tab enters and leaves the group at the picked option. Installed
 * once for the app; groups are found as they are drawn.
 */
export function installRadioGroups(root = document.body) {
  const MOVES = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  root.addEventListener('keydown', (e) => {
    const radio = e.target.closest && e.target.closest('[role=radio]');
    if (!radio || radio instanceof HTMLInputElement || e.altKey || e.metaKey || e.ctrlKey) return;
    const group = radio.closest('[role=radiogroup]');
    const radios = group ? radiosOf(group) : [];
    let i = radios.indexOf(radio);
    if (i < 0) return;
    if (e.key in MOVES) i = (i + MOVES[e.key] + radios.length) % radios.length;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = radios.length - 1;
    else return;
    e.preventDefault();
    const next = radios[i];
    next.focus();
    next.click();
    // Picking may redraw the group: keep focus on the picked option.
    if (!next.isConnected && group.isConnected) group.querySelector('[role=radio][aria-checked="true"]')?.focus();
  });
  const groups = new Set();
  const collect = (node) => {
    if (node.nodeType !== 1) return;
    if (node.matches('[role=radiogroup]')) groups.add(node);
    else if (node.closest && node.closest('[role=radiogroup]')) groups.add(node.closest('[role=radiogroup]'));
    for (const g of node.querySelectorAll('[role=radiogroup]')) groups.add(g);
  };
  const flush = () => {
    for (const g of groups) rove(g);
    groups.clear();
  };
  collect(root);
  flush();
  new MutationObserver((records) => {
    for (const m of records) {
      if (m.type === 'attributes') collect(m.target);
      else for (const n of m.addedNodes) collect(n);
    }
    flush();
  }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-checked'] });
}

/* ---- Menus ---- */

let openMenu = null;

export function closeMenu() {
  if (openMenu) openMenu.close();
}

function placeNear(menu, anchor, { align = 'start', point = null } = {}) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const m = menu.getBoundingClientRect();
  let x;
  let y;
  if (point) {
    x = point.x;
    y = point.y;
  } else {
    const r = anchor.getBoundingClientRect();
    x = align === 'end' ? r.right - m.width : r.left;
    y = r.bottom + 4;
    if (y + m.height > vh - 8 && r.top - m.height - 4 > 8) y = r.top - m.height - 4;
  }
  x = Math.max(8, Math.min(x, vw - m.width - 8));
  y = Math.max(8, Math.min(y, vh - m.height - 8));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}

/**
 * Open a menu. `items`: { label, icon, hint, danger, checked, disabled, run }
 * or 'sep' or { heading }. Returns a close function.
 */
export function showMenu(anchor, items, { align = 'start', point = null, label = '' } = {}) {
  // The button of the menu already open closes it, like any menu button.
  if (openMenu && anchor && !point && openMenu.anchor === anchor) {
    openMenu.close(true);
    return () => {};
  }
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': label || undefined, tabindex: '-1' });
  const buttons = [];
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') {
      menu.append(h('div', { class: 'menu-sep', role: 'separator' }));
      continue;
    }
    if (it.heading) {
      menu.append(h('div', { class: 'menu-label', role: 'presentation' }, it.heading));
      continue;
    }
    const role = it.checked != null ? 'menuitemradio' : 'menuitem';
    const b = h(
      'button',
      {
        type: 'button',
        class: `menu-item${it.danger ? ' danger' : ''}`,
        role,
        'aria-checked': it.checked != null ? String(!!it.checked) : undefined,
        disabled: it.disabled,
        tabindex: '-1',
        onclick: () => {
          close();
          it.run && it.run();
        },
      },
      it.icon ? icon(it.icon) : null,
      h('span', null, it.label),
      it.hint ? h('span', { class: 'menu-hint' }, it.hint) : null,
    );
    buttons.push(b);
    menu.append(b);
  }
  document.body.append(menu);
  placeNear(menu, anchor, { align, point });
  if (anchor && anchor.setAttribute) anchor.setAttribute('aria-expanded', 'true');

  const focusAt = (i) => {
    const enabled = buttons.filter((b) => !b.disabled);
    if (!enabled.length) return;
    enabled[(i + enabled.length) % enabled.length].focus();
  };
  const current = () => buttons.filter((b) => !b.disabled).indexOf(document.activeElement);
  let typed = '';
  let typedAt = 0;
  const onKey = (e) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), focusAt(current() + 1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), focusAt(current() - 1));
    else if (e.key === 'Home') (e.preventDefault(), focusAt(0));
    else if (e.key === 'End') (e.preventDefault(), focusAt(-1));
    else if (e.key === 'Escape') (e.preventDefault(), close(true));
    // Back on the button, Tab then moves on from it, as from any menu
    // button: focus must not fall to the page while the menu goes away.
    else if (e.key === 'Tab') close(true);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now();
      typed = now - typedAt > 600 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
      typedAt = now;
      const enabled = buttons.filter((b) => !b.disabled);
      const hit = enabled.findIndex((b) => b.textContent.trim().toLowerCase().startsWith(typed));
      if (hit >= 0) enabled[hit].focus();
    }
  };
  const onDown = (e) => {
    if (!menu.contains(e.target) && !(anchor && anchor.contains && anchor.contains(e.target))) close(false);
  };
  // Follow the anchor when something scrolls; close once it is gone.
  const onScroll = (e) => {
    if (menu.contains(e.target)) return;
    if (point || !anchor || !anchor.getBoundingClientRect) return close(false);
    const r = anchor.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || (!r.width && !r.height)) close(false);
    else placeNear(menu, anchor, { align });
  };
  function close(restore = true) {
    if (!menu.isConnected) return;
    menu.remove();
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('resize', onScrollClose);
    document.removeEventListener('scroll', onScroll, true);
    if (anchor && anchor.setAttribute) anchor.setAttribute('aria-expanded', 'false');
    if (restore && anchor && anchor.focus) anchor.focus();
    if (openMenu && openMenu.menu === menu) openMenu = null;
  }
  const onScrollClose = () => close(false);
  menu.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('resize', onScrollClose);
  document.addEventListener('scroll', onScroll, true);
  openMenu = { menu, close, anchor };
  requestAnimationFrame(() => focusAt(Math.max(0, buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true'))));
  return close;
}

/* ---- Dialogs ---- */

/**
 * Open a modal dialog. `build(close)` returns { body, foot } nodes (or just
 * body). Resolves with whatever close(value) is called with (undefined on
 * Escape or the close button).
 */
export function openDialog({ title, build, wide = false, full = false, className = '', describedBy = '' }) {
  return new Promise((resolve) => {
    const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
    const dlg = h('dialog', {
      class: `dialog${wide ? ' dialog-wide' : ''}${full ? ' dialog-full' : ''}${className ? ` ${className}` : ''}`,
      'aria-labelledby': titleId,
      'aria-describedby': describedBy || undefined,
    });
    let result;
    const close = (value) => {
      result = value;
      dlg.close();
    };
    const parts = build(close) || {};
    const body = parts instanceof Node ? parts : parts.body;
    const foot = parts instanceof Node ? null : parts.foot;
    dlg.append(
      ...[h(
        'div',
        { class: 'dialog-head' },
        h('h2', { id: titleId }, title),
        h('button', { type: 'button', class: 'btn btn-ghost btn-icon', 'aria-label': 'Close', onclick: () => close() }, icon('x')),
      ),
      h('div', { class: 'dialog-body' }, body),
      foot ? h('div', { class: 'dialog-foot' }, foot) : null,
    ].filter(Boolean));
    dlg.addEventListener('close', () => {
      // Messages shown while the dialog was open live inside it: hand them
      // back to the page (or a dialog still open) so they stay up.
      const live = [...dlg.querySelectorAll(':scope > .toasts, :scope > #sr-live')];
      dlg.remove();
      for (const n of live) liveContainer().append(n);
      resolve(result);
    });
    // A click on the backdrop (outside the box) closes, like Escape.
    dlg.addEventListener('pointerdown', (e) => {
      if (e.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
    });
    document.body.append(dlg);
    dlg.showModal();
    // A body that scrolls must be reachable to scroll it by keyboard: Safari
    // does not let Tab stop on a scrolling area by itself.
    const bodyNode = dlg.querySelector('.dialog-body');
    const scrollable = () => {
      const on = bodyNode.scrollHeight > bodyNode.clientHeight + 1;
      if (on && !bodyNode.hasAttribute('tabindex')) {
        bodyNode.tabIndex = 0;
        bodyNode.setAttribute('role', 'region');
        bodyNode.setAttribute('aria-labelledby', titleId);
      } else if (!on && bodyNode.getAttribute('tabindex') === '0') {
        bodyNode.removeAttribute('tabindex');
        bodyNode.removeAttribute('role');
        bodyNode.removeAttribute('aria-labelledby');
      }
    };
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(scrollable);
      ro.observe(bodyNode);
      if (bodyNode.firstElementChild) ro.observe(bodyNode.firstElementChild);
      dlg.addEventListener('close', () => ro.disconnect());
    }
    const auto = dlg.querySelector('[autofocus]');
    if (auto) auto.focus();
  });
}

export function confirmDialog({ title, message, confirm = 'Confirm', danger = false, cancel = 'Cancel' }) {
  return openDialog({
    title,
    build: (close) => ({
      body: h('p', { class: 'muted' }, message),
      foot: [
        h('button', { type: 'button', class: 'btn', onclick: () => close(false) }, cancel),
        h(
          'button',
          { type: 'button', class: `btn ${danger ? 'btn-danger btn-solid' : 'btn-primary'}`, autofocus: true, onclick: () => close(true) },
          confirm,
        ),
      ],
    }),
  }).then((v) => v === true);
}

export function promptDialog({ title, label, value = '', confirm = 'Save', placeholder = '', maxLength = 200 }) {
  return openDialog({
    title,
    build: (close) => {
      const input = h('input', { class: 'input', value, placeholder, maxlength: maxLength, autofocus: true, 'aria-label': label });
      const form = h(
        'form',
        {
          class: 'field',
          onsubmit: (e) => {
            e.preventDefault();
            const v = input.value.trim();
            if (v) close(v);
          },
        },
        h('label', { class: 'field-label' }, label),
        input,
        h('button', { type: 'submit', hidden: true }),
      );
      requestAnimationFrame(() => input.select());
      return {
        body: form,
        foot: [
          h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Cancel'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => form.requestSubmit() }, confirm),
        ],
      };
    },
  });
}
