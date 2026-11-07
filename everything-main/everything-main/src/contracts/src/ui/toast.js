import { el } from './dom.js';
import { icon } from './icons.js';

let root = null;

/*
 * The container is the live region, not the toast.
 *
 * A region that arrives already holding its message is not announced: screen
 * readers watch regions that were there before the change. Each toast used to
 * carry its own role="status" and land in the page at the same instant, so
 * "Contract deleted" and the Undo beside it were said to nobody. The region
 * waits here from boot and every toast is a change inside it — and atomic is
 * off, so a second toast is read on its own rather than dragging the first
 * one along with it.
 */
function ensureRoot() {
  if (!root) {
    root = el('div.toast-root', { role: 'status', 'aria-atomic': 'false' });
    document.body.append(root);
  }
  return root;
}

if (typeof document !== 'undefined' && document.body) ensureRoot();

/**
 * toast('Saved')
 * toast('Deleted', { icon: 'trash', action: { label: 'Undo', onClick } })
 * With an action the toast lingers longer, and hovering pauses dismissal.
 */
export function toast(message, { icon: name = 'check', duration, action = null } = {}) {
  const ms = duration ?? (action ? 6000 : 2400);
  let timer = null;
  let gone = false;
  let deadline = 0;
  let remaining = ms;

  const dismiss = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    node.classList.add('leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  };

  const node = el('div.toast', { html: icon(name, 16, 2.2) },
    el('span', {}, message),
    action && el('button.toast-action', {
      type: 'button',
      onclick: () => {
        dismiss();
        action.onClick();
      },
    }, action.label)
  );

  const arm = (t) => {
    clearTimeout(timer);
    deadline = Date.now() + t;
    timer = setTimeout(dismiss, t);
  };
  // Hovering pauses the clock; leaving resumes what was left (with a small
  // floor), so a long-lived toast (e.g. an upload) is never cut short.
  node.addEventListener('pointerenter', () => {
    clearTimeout(timer);
    remaining = Math.max(0, deadline - Date.now());
  });
  node.addEventListener('pointerleave', () => { if (!gone) arm(Math.max(1500, remaining)); });

  ensureRoot().append(node);
  arm(ms);
  return { dismiss };
}
