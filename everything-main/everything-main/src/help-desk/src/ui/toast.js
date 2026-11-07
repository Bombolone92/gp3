/**
 * Toasts: short, non-blocking messages in a polite live region. A toast can
 * carry one action (for example Undo) and stays while hovered or focused.
 */
import { h } from './dom.js';
import { icon } from './icons.js';

let region = null;

// The container is the live region: screen readers announce what is added
// to a region that already exists, and often miss a region that arrives
// already filled in.
const makeRegion = () => h('div.toasts', { role: 'region', 'aria-label': 'Notifications', 'aria-live': 'polite' });

/**
 * A toast region for a modal dialog, added as it opens. A modal dialog makes
 * the rest of the page inert and draws over it, so toasts shown meanwhile
 * go in the dialog, where they can be read and clicked.
 */
export const dialogToasts = makeRegion;

function ensureRegion() {
  const dlg = [...document.querySelectorAll('dialog[open]')].pop();
  const inDialog = dlg?.querySelector(':scope > .toasts');
  if (inDialog) return inDialog;
  if (region && region.isConnected) return region;
  region = makeRegion();
  document.body.appendChild(region);
  return region;
}

/** Keep a closing dialog's toasts on screen, without reading them out again. */
export function keepToasts(from) {
  const items = [...from.children];
  if (!items.length) return;
  const to = ensureRegion();
  to.setAttribute('aria-live', 'off');
  to.append(...items);
  setTimeout(() => to.setAttribute('aria-live', 'polite'), 0);
}

export function toast(message, { kind = 'info', action = null, timeout = 5000, title = null, persistent = false, onClose = null } = {}) {
  const root = ensureRegion();
  // Quiet only while a closing dialog's toasts moved in (keepToasts): a new
  // toast is read out.
  root.setAttribute('aria-live', 'polite');
  const glyph = { info: 'info', success: 'circle-check', error: 'triangle-alert', warning: 'triangle-alert' }[kind] || 'info';
  const close = () => {
    clearTimeout(timer);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 160);
    onClose?.();
  };
  const el = h(
    `div.toast.toast-${kind}`,
    { role: kind === 'error' ? 'alert' : undefined },
    h('span.toast-icon', icon(glyph, { size: 16 })),
    h('div.toast-body', title ? h('strong.toast-title', title) : null, h('div.toast-text', message)),
    action
      ? h('button.btn.btn-ghost.btn-sm.toast-action', { type: 'button', onclick: () => { action.run(); close(); } }, action.label)
      : null,
    h('button.icon-btn.toast-close', { type: 'button', 'aria-label': 'Dismiss', onclick: close }, icon('x', { size: 14 })),
  );
  root.appendChild(el);
  let timer = persistent ? null : setTimeout(close, timeout);
  const pause = () => clearTimeout(timer);
  const resume = () => {
    if (!persistent) timer = setTimeout(close, 2500);
  };
  el.addEventListener('mouseenter', pause);
  el.addEventListener('focusin', pause);
  el.addEventListener('mouseleave', resume);
  el.addEventListener('focusout', resume);
  return { close };
}

export function toastError(e, fallback = 'Something went wrong') {
  const message = (e && (e.message || e.error)) || fallback;
  return toast(String(message), { kind: 'error', timeout: 7000 });
}
