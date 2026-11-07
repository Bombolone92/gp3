import { h } from './dom.js';
import { icon } from './icons.js';

let region = null;

/**
 * Where toasts live: inside the top-most open modal dialog when there is
 * one (everything outside a modal is inert, hidden from screen readers and
 * unclickable, and under its backdrop), otherwise in the page.
 */
function host(except = null) {
  // Every dialog in the app is opened as a modal.
  const open = [...document.querySelectorAll('dialog[open]')].filter((d) => d !== except);
  return open.pop() || document.body;
}

function ensureRegion() {
  if (!region) region = h('div.toast-region', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' });
  const target = host();
  if (region.parentNode !== target) target.append(region);
  return region;
}

/**
 * Put the (empty) live region in the page ahead of the first message:
 * screen readers announce changes to a live region that already exists,
 * and often miss one inserted together with its first message.
 */
export function initToasts() {
  ensureRegion();
}

/** A dialog is closing: move toasts shown in it back out so they stay up. */
export function releaseToasts(dialog) {
  if (region && dialog.contains(region)) host(dialog).append(region);
}

/**
 * toast('Client saved') or toast('Deleted', { action: { label: 'Undo', run } })
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
    h('span', message),
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
  // Held open while pointed at or focused (reaching Undo by keyboard takes
  // longer than by mouse).
  const hold = () => clearTimeout(timer);
  const release = () => {
    clearTimeout(timer);
    if (!node.matches(':hover') && !node.contains(document.activeElement)) timer = setTimeout(close, 2500);
  };
  node.addEventListener('mouseenter', hold);
  node.addEventListener('mouseleave', release);
  node.addEventListener('focusin', hold);
  node.addEventListener('focusout', () => setTimeout(release));
  return close;
}
