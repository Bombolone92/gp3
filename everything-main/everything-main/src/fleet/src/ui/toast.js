import { h } from './dom.js';
import { icon } from './icons.js';

let region = null;

// While a modal dialog is open everything outside it is inert: a toast
// there sits under the backdrop, cannot be clicked, and is not announced.
// So the region lives in the topmost open dialog, else in <body>.
function host() {
  return [...document.querySelectorAll('dialog[open]')].at(-1) || document.body;
}

function ensureRegion() {
  if (!region) region = h('div.toast-region', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' });
  const target = host();
  if (region.parentNode !== target) target.append(region);
  return region;
}

/** Called by a closing dialog so its toasts outlive it. */
export function rehomeToasts(dialog) {
  if (region && dialog.contains(region)) host().append(region);
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
  // Hold the toast while the pointer or keyboard focus is on it, so its
  // action (Undo) cannot vanish under the user.
  const pause = () => clearTimeout(timer);
  const resume = () => {
    clearTimeout(timer);
    timer = setTimeout(close, 2500);
  };
  node.addEventListener('mouseenter', pause);
  node.addEventListener('mouseleave', () => !node.contains(document.activeElement) && resume());
  node.addEventListener('focusin', pause);
  node.addEventListener('focusout', (e) => !node.contains(e.relatedTarget) && !node.matches(':hover') && resume());
  return close;
}
