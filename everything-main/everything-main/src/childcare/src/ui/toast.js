import { h } from './dom.js';
import { icon } from './icons.js';

let region = null;

function ensureRegion() {
  region ||= h('div.toast-region', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' });
  rehomeToasts();
  return region;
}

/**
 * While a modal dialog is open, everything outside it is inert and drawn
 * under its backdrop, so toasts live in the topmost open dialog. Dialogs call
 * this as they close, to hand the toasts back.
 */
export function rehomeToasts() {
  if (!region) return;
  const host = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
  if (region.parentNode !== host) host.append(region);
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
  node.addEventListener('mouseenter', () => clearTimeout(timer));
  node.addEventListener('mouseleave', () => (timer = setTimeout(close, 2500)));
  return close;
}
