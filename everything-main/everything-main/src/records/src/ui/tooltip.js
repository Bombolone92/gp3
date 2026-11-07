/**
 * Tooltips for elements with data-tip (and optional data-kbd for a
 * shortcut). Shown on hover after a short delay and on keyboard focus.
 * They repeat what the element's accessible name says, so they stay hidden
 * from screen readers.
 */
import { h, overlayRoot } from '../lib/dom.js';

let tip = null;
let timer = 0;
let current = null;

function show(el) {
  const text = el.dataset.tip;
  if (!text) return;
  // A toolbar button's tip repeats its label: only shown when the label is hidden.
  const label = el.querySelector(':scope > .tool-label');
  if (label && label.getClientRects().length) return;
  current = el;
  if (!tip || !tip.isConnected) tip = h('div.tooltip', { 'aria-hidden': 'true', 'data-floating': '' });
  const root = overlayRoot();
  if (tip.parentNode !== root) root.append(tip);
  tip.replaceChildren(text);
  if (el.dataset.kbd) tip.append(h('kbd', el.dataset.kbd));
  tip.style.display = 'block';
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const ht = tip.offsetHeight;
  let top = r.bottom + 6;
  if (top + ht > window.innerHeight - 4) top = r.top - ht - 6;
  const left = Math.max(4, Math.min(window.innerWidth - w - 4, r.left + r.width / 2 - w / 2));
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hide() {
  clearTimeout(timer);
  current = null;
  if (tip) tip.style.display = 'none';
}

export function installTooltips() {
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest?.('[data-tip]');
    if (el === current) return;
    hide();
    if (el) timer = setTimeout(() => show(el), 450);
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[data-tip]');
    hide();
    if (el && el.matches(':focus-visible')) timer = setTimeout(() => show(el), 300);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  window.addEventListener('scroll', hide, true);
}
