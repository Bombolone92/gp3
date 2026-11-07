import { h } from './dom.js';
import { icon } from './icons.js';

let region = null;

/** An empty live region (dialogs carry their own; see ensureRegion). */
export function toastRegion() {
  return h('div.toast-region', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' });
}

function ensureRegion() {
  // While a modal dialog is open, everything outside it is inert (hidden from
  // screen readers, not clickable) and painted under its backdrop, so toasts
  // go to the topmost dialog's own region.
  const open = document.querySelectorAll('dialog[open]');
  const inDialog = open[open.length - 1]?.querySelector(':scope > .toast-region');
  if (inDialog) return inDialog;
  if (region && document.body.contains(region)) return region;
  region = toastRegion();
  document.body.append(region);
  return region;
}

/** A dialog closed: keep its toasts on screen in the region now on top. */
export function adoptToasts(from) {
  if (!from?.children.length) return;
  ensureRegion().append(...from.children);
}

/**
 * toast('Matter saved') or toast('Deleted', { action: { label: 'Undo', run } }).
 * type: 'success' | 'error' | 'info'
 */
export function toast(message, { type = 'success', action = null, duration } = {}) {
  const r = ensureRegion();
  const ic = type === 'error' ? 'alert' : type === 'info' ? 'info' : 'circle-check';
  let timer;
  const close = () => {
    clearTimeout(timer);
    node.remove();
  };
  const node = h(
    `div.toast.${type}`,
    icon(ic),
    h('span.grow', message),
    action &&
      h(
        'button.toast-action',
        {
          type: 'button',
          onClick: () => {
            close();
            action.run();
          },
        },
        action.label,
      ),
    h('button.icon-btn.sm.toast-close', { type: 'button', 'aria-label': 'Dismiss', onClick: close }, icon('x', 16)),
  );
  r.append(node);
  while (r.children.length > 3) r.firstElementChild.remove();
  timer = setTimeout(close, duration ?? (action ? 8000 : type === 'error' ? 6000 : 3500));
  // Hold the toast while the pointer or keyboard focus is on it.
  const hold = () => clearTimeout(timer);
  const release = () => {
    clearTimeout(timer);
    timer = setTimeout(close, 2500);
  };
  node.addEventListener('mouseenter', hold);
  node.addEventListener('mouseleave', () => node.contains(document.activeElement) || release());
  node.addEventListener('focusin', hold);
  node.addEventListener('focusout', (e) => node.contains(e.relatedTarget) || release());
  return close;
}

// Screen readers announce changes to a live region that is already in the
// page; a region inserted together with its first message stays silent.
if (typeof document !== 'undefined' && document.body) ensureRegion();
