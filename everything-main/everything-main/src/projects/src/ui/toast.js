import { el } from '../lib/dom.js';
import { icon } from './icons.js';

let root = null;

function ensureRoot() {
  if (!root) {
    root = el('div.toast-root');
    document.body.append(root);
  }
  return root;
}

/**
 * toast('Saved')
 * toast('Deleted', { icon: 'trash', action: { label: 'Undo', onClick } })
 * With an action the toast lingers longer, and hovering it — or focusing the
 * action — pauses dismissal.
 */
export function toast(message, { icon: name = 'check', duration, action = null } = {}) {
  const ms = duration ?? (action ? 6000 : 2400);
  let timer = null;
  let gone = false;

  const dismiss = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    node.classList.add('leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    /* An animation is not a guarantee. A tab that is not being rendered does
       not advance one, so `animationend` never arrives and the toast stays in
       the document — and toasts raised while the app is in the background (a
       connection coming back, a failed write, a done column archiving itself)
       stack up there without limit, each still taking pointer events. The
       animation gets its 200ms; after that the node goes either way, exactly
       as a dialog's does. */
    setTimeout(() => node.remove(), 400);
  };

  const node = el('div.toast', { role: 'status', html: icon(name, 16, 2.2) },
    el('span', {}, message),
    action && el('button.toast-action', {
      type: 'button',
      onclick: () => {
        dismiss();
        action.onClick();
      },
    }, action.label)
  );

  const arm = (t) => { clearTimeout(timer); timer = setTimeout(dismiss, t); };
  const hold = () => clearTimeout(timer);
  const release = () => { if (!gone) arm(1500); };
  node.addEventListener('pointerenter', hold);
  node.addEventListener('pointerleave', release);
  /* An Undo reached with the keyboard has to wait as patiently as one under
     the pointer: the countdown used to run on regardless, so tabbing to the
     action raced a toast that could vanish mid-press. */
  node.addEventListener('focusin', hold);
  node.addEventListener('focusout', release);

  ensureRoot().append(node);
  arm(ms);
  return { dismiss };
}
