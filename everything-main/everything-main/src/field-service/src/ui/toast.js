import { h } from './dom.js';
import { icon } from './icons.js';

// While a modal dialog is open everything outside it is inert and drawn
// underneath, so toasts go into a region inside the topmost open dialog.
// Screen readers announce changes to a live region already on the page, not
// one inserted along with its text, so regions are put in place up front:
// the page's now, and a dialog's when it opens.
export function ensureRegion(host = [...document.querySelectorAll('dialog[open]')].at(-1) || document.body) {
  let region = host.querySelector(':scope > .toast-region');
  if (!region) {
    region = h('div.toast-region', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' });
    // First in a dialog, where styles look for the body as the last child.
    if (host === document.body) host.append(region);
    else host.prepend(region);
  }
  return region;
}

if (typeof document !== 'undefined' && document.body) ensureRegion(document.body);

/** Keep a closed dialog's toasts on screen (call before removing it). */
export function moveToastsOut(dialog) {
  const inner = dialog.querySelector(':scope > .toast-region');
  if (!inner?.children.length) return;
  const outer = ensureRegion();
  outer.append(...inner.children);
  trim(outer);
}

function trim(region) {
  while (region.children.length > 3) {
    const oldest = region.firstElementChild;
    if (oldest.closeToast) oldest.closeToast();
    else oldest.remove();
  }
}

/**
 * toast('Client saved') or toast('Deleted', { action: { label: 'Undo', run } })
 * type: 'success' | 'error' | 'info'
 * onDismiss runs once the toast goes away without its action being used.
 */
export function toast(message, { type = 'success', action = null, duration, onDismiss = null } = {}) {
  const r = ensureRegion();
  const ic = type === 'error' ? 'alert' : type === 'info' ? 'info' : 'circle-check';
  let timer;
  let done = false;
  const close = (acted = false) => {
    clearTimeout(timer);
    node.remove();
    if (done) return;
    done = true;
    if (!acted) onDismiss?.();
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
            close(true);
            action.run();
          },
        },
        action.label,
      ),
    h('button.icon-btn.sm.toast-close', { type: 'button', 'aria-label': 'Dismiss', onClick: () => close() }, icon('x', 16)),
  );
  node.closeToast = close;
  r.append(node);
  trim(r);
  timer = setTimeout(() => close(), duration ?? (action ? 8000 : type === 'error' ? 6000 : 3500));
  // Held while the pointer is over it or keyboard focus is in it (say, on
  // Undo), so it does not vanish from under someone about to use it.
  let hovered = false;
  const resume = () => {
    clearTimeout(timer);
    if (!hovered && !node.contains(document.activeElement)) timer = setTimeout(() => close(), 2500);
  };
  node.addEventListener('mouseenter', () => ((hovered = true), clearTimeout(timer)));
  node.addEventListener('mouseleave', () => ((hovered = false), resume()));
  node.addEventListener('focusin', () => clearTimeout(timer));
  node.addEventListener('focusout', (e) => !node.contains(e.relatedTarget) && setTimeout(resume));
  return () => close();
}
