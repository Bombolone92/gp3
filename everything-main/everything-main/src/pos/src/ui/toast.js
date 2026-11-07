import { el } from './dom.js';
import { icon } from './icons.js';

let root = null;

function ensureRoot() {
  if (!root) {
    root = el('div.toast-root');
    document.body.append(root);
  }
  // Born (or reused) while a dialog is up: the toast lives outside the
  // focus trap, so it must not catch Tab until the last modal closes.
  if (document.body.classList.contains('modal-open')) root.setAttribute('inert', '');
  return root;
}

/**
 * toast('Saved')
 * toast('Voided', { icon: 'ban', action: { label: 'Undo', onClick } })
 * With an action the toast lingers longer, and hovering pauses dismissal
 * so the button can't vanish mid-reach.
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

  // Hovering pauses the clock; leaving resumes with the time that was left
  // (never less than a beat). A flat re-arm cut a 6-second Undo window to
  // 1.5s for a cursor that merely brushed past on its way to the tab bar.
  let deadline = 0;
  const arm = (t) => {
    clearTimeout(timer);
    deadline = Date.now() + t;
    timer = setTimeout(dismiss, t);
  };
  /**
   * Why the clock is stopped: a hovering pointer, keyboard focus, or both.
   * Counted rather than toggled, so a cursor resting on the toast while
   * focus moves off it doesn't restart the countdown under the pointer.
   */
  const holds = new Set();
  const hold = (why) => { holds.add(why); clearTimeout(timer); };
  const release = (why) => {
    holds.delete(why);
    if (!holds.size && !gone) arm(Math.max(1500, deadline - Date.now()));
  };
  node.addEventListener('pointerenter', () => hold('pointer'));
  node.addEventListener('pointerleave', () => release('pointer'));
  // A pointer resting on the Undo stopped the clock; reaching the same
  // button with the keyboard did not. Tabbing to it - the only way there
  // without a pointer, and the toast sits last in the tab order - raced a
  // countdown that was already running, and on a plain 2.4-second toast the
  // button was usually gone before it could be pressed.
  node.addEventListener('focusin', () => hold('focus'));
  node.addEventListener('focusout', () => release('focus'));

  ensureRoot().append(node);
  arm(ms);
  return { dismiss };
}
