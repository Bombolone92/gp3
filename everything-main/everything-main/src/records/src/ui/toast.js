/**
 * Short confirmations at the bottom of the screen, announced politely.
 * toast('Record deleted', { action: { label: 'Undo', onClick } })
 */
import { h, overlayRoot } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

let host = null;

function container() {
  if (!host || !host.isConnected) host = h('div.toasts', { role: 'status', 'aria-live': 'polite', 'data-floating': '' });
  const root = overlayRoot();
  if (host.parentNode !== root) root.append(host);
  return host;
}

export function toast(message, { action, timeout = 4500, error = false } = {}) {
  const el = h(`div.toast${error ? '.error' : ''}`, h('span.toast-msg', message));
  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    el.remove();
  };
  if (action) {
    el.append(
      h('button.btn.small', {
        type: 'button',
        onclick: () => {
          close();
          action.onClick();
        },
      }, action.label),
    );
  }
  el.append(h('button.icon-btn', { type: 'button', 'aria-label': 'Dismiss', onclick: close }, icon('x', 14)));
  const c = container();
  while (c.children.length >= 3) c.firstChild.remove();
  c.append(el);
  if (timeout) {
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(close, timeout);
    };
    // It waits while pointed at or focused, and counts down again once left.
    el.addEventListener('pointerenter', () => clearTimeout(timer));
    el.addEventListener('pointerleave', () => {
      if (!el.contains(document.activeElement)) arm();
    });
    el.addEventListener('focusin', () => clearTimeout(timer));
    el.addEventListener('focusout', (e) => {
      if (!el.contains(e.relatedTarget) && !el.matches(':hover')) arm();
    });
    arm();
  }
  return { close };
}
