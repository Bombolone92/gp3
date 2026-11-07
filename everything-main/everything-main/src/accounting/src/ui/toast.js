import { el } from './dom.js';
import { icon } from './icons.js';

let region;

function ensureRegion() {
  if (!region) {
    region = el('div.toast-region', { role: 'status', 'aria-live': 'polite' });
    document.body.append(region);
  }
  return region;
}

// The live region is put on the page up front: screen readers announce
// changes to a region that already exists, and often miss a message that
// arrives together with its region, which was the case for the first toast.
if (document.body) ensureRegion();
else document.addEventListener('DOMContentLoaded', ensureRegion, { once: true });

/**
 * Show a short message at the bottom of the screen. An action (Undo, View)
 * keeps it up longer. Returns a function that dismisses it.
 */
export function toast(message, { action = null, duration } = {}) {
  const r = ensureRegion();
  const ms = duration ?? (action ? 7000 : 3500);
  const close = () => {
    clearTimeout(timer);
    node.remove();
  };
  const node = el('div.toast', {},
    el('span', {}, message),
    action && el('button.btn-link', { type: 'button', onclick: () => { close(); action.onClick(); } }, action.label),
    el('button.icon-btn', { type: 'button', 'aria-label': 'Dismiss', html: icon('x', 16), onclick: close }));
  r.append(node);
  while (r.children.length > 3) r.firstChild.remove();
  const timer = setTimeout(close, ms);
  return close;
}

export function toastError(err) {
  const msg = typeof err === 'string' ? err : err?.message || 'Something went wrong.';
  return toast(msg, { duration: 6000 });
}
