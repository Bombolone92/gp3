/**
 * The menu bar under the document title: File, Edit, View, Insert, Format.
 * Each name opens its menu through the function given for it; the bar adds
 * what a menu bar is expected to do on its own. It is one tab stop, with Left
 * and Right (or Home and End) moving between the names and Down or Enter
 * opening one. While a menu is open, Left and Right switch to the neighboring
 * menu, and so does sliding the mouse along the bar. Clicking the open menu's
 * name closes it instead of reopening it (see menu.js).
 *
 * createMenubar([{ label, open(anchor) }], { label }) -> { el, buttons, destroy }
 */

import { el } from './dom.js';
import { closeMenu, menuAnchor, menuTakesArrow } from './menu.js';

export function createMenubar(entries, { label = 'Menu bar' } = {}) {
  const bar = el('nav.menubar', { role: 'menubar', 'aria-label': label });
  const buttons = [];

  const wrap = (i) => ((i % buttons.length) + buttons.length) % buttons.length;
  const openIndex = () => buttons.indexOf(menuAnchor());
  const setTabStop = (i) => buttons.forEach((b, k) => b.setAttribute('tabindex', k === i ? '0' : '-1'));
  // A name hidden by the layout (a narrow screen) is passed over.
  const shown = (i) => getComputedStyle(buttons[wrap(i)]).display !== 'none';
  const step = (i, delta) => { for (let k = 1; k <= buttons.length; k++) if (shown(i + delta * k)) return wrap(i + delta * k); return wrap(i); };
  const focusAt = (i) => buttons[wrap(i)].focus({ preventScroll: true });

  // The open menu goes first so that focus returning to its name does not
  // outlive the move to the new one; Escape then brings focus back here.
  // `pointer` says the mouse or a tap opened it, as opposed to the keyboard.
  function open(i, { pointer = false } = {}) {
    closeMenu();
    focusAt(i);
    entries[wrap(i)].open(buttons[wrap(i)], { pointer });
  }

  entries.forEach((entry, i) => {
    const btn = el('button.menu-btn', {
      type: 'button', role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false', tabindex: i === 0 ? 0 : -1,
      onclick: (e) => open(i, { pointer: e.detail > 0 }),
      onfocus: () => setTabStop(i),
      // A tap raises pointerenter before the press that would close the menu again, so only the mouse sweeps.
      onpointerenter: (e) => { if (e.pointerType === 'mouse' || !e.pointerType) { const at = openIndex(); if (at !== -1 && at !== i) open(i, { pointer: true }); } },
      onkeydown: (e) => {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(i); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); focusAt(step(i, 1)); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); focusAt(step(i, -1)); }
        else if (e.key === 'Home') { e.preventDefault(); focusAt(step(-1, 1)); }
        else if (e.key === 'End') { e.preventDefault(); focusAt(step(0, -1)); }
      },
    }, entry.label);
    if (entry.className) btn.classList.add(entry.className);
    buttons.push(btn);
    bar.append(btn);
  });

  // With a menu open, focus is in the popup; Left and Right there move along the bar.
  function onKey(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const at = openIndex();
    if (at === -1) return;
    // Fields, color grids, and radio groups in the popup use Left and Right themselves.
    if (document.activeElement?.matches?.('input, select, textarea')) return;
    if (document.activeElement?.closest?.('.menu-custom-grid, [role="radiogroup"]')) return;
    // So does a submenu: Right opens one and Left goes back out of it.
    if (menuTakesArrow(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    open(step(at, e.key === 'ArrowRight' ? 1 : -1));
  }
  document.addEventListener('keydown', onKey, true);

  return {
    el: bar,
    buttons,
    destroy: () => document.removeEventListener('keydown', onKey, true),
  };
}
