import { el } from './dom.js';
import { icon } from './icons.js';

let root = null;

function ensureRoot() {
  if (!root) {
    // The persistent container is the live region, not each toast: ARIA
    // announces mutations *inside* an existing live region, and inserting
    // a new element that already carries role="status" and its text is a
    // pattern VoiceOver in particular routinely stays silent on.
    root = el('div.toast-root', { role: 'status', 'aria-live': 'polite' });
    // Born under an open dialog: start inert, exactly as openModal would
    // have left it; the dialog's close lifts it.
    if (document.body.classList.contains('modal-open')) root.setAttribute('inert', '');
    document.body.append(root);
  }
  return root;
}

/**
 * Create the empty live region at boot: a region born together with its
 * first message is a mutation nothing was watching yet.
 */
export function mountToastRoot() {
  ensureRoot();
}

/**
 * toast('Saved')
 * toast('Deleted', { icon: 'trash', action: { label: 'Undo', onClick } })
 * With an action the toast lingers longer, and hovering pauses dismissal.
 */
export function toast(message, { icon: name = 'check', duration, action = null } = {}) {
  const ms = duration ?? (action ? 6000 : 2400);
  let timer = null;
  let gone = false;

  const dismiss = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    // Removing the node while its action button holds focus would drop a
    // keyboard user onto <body>; park focus on the main region instead.
    if (node.contains(document.activeElement)) {
      const main = document.getElementById('main');
      main?.setAttribute('tabindex', '-1');
      main?.focus({ preventScroll: true });
    }
    node.classList.add('leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  };

  const node = el('div.toast', { html: icon(name, 16, 1.8) },
    el('span', {}, message),
    action && el('button.toast-action', {
      type: 'button',
      onclick: () => {
        dismiss();
        action.onClick();
      },
    }, action.label)
  );

  // Hovering (or focusing) pauses the clock; leaving resumes it with what
  // was left, never less than a moment to reach the button. Re-arming a
  // flat 1.5 s cut an Undo's six seconds to under two whenever the pointer
  // merely crossed the toast on its way from the dialog that caused it.
  let due = 0;
  const arm = (t) => { clearTimeout(timer); due = Date.now() + t; timer = setTimeout(dismiss, t); };
  const resume = () => { if (!gone) arm(Math.max(1500, due - Date.now())); };
  node.addEventListener('pointerenter', () => clearTimeout(timer));
  node.addEventListener('pointerleave', resume);
  // A keyboard user has to Tab across the whole shell to reach an Undo;
  // the timer waits for them the same way it waits for a hovering pointer.
  node.addEventListener('focusin', () => clearTimeout(timer));
  node.addEventListener('focusout', resume);

  ensureRoot().append(node);
  arm(ms);
  return { dismiss };
}
