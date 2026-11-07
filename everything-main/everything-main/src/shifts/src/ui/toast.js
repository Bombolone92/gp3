import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

let region = null;

function ensureRegion() {
  // Full-body mounts (auth screen -> app shell, fatal error screen) detach
  // a previously created region, so a cached node is not enough.
  if (!region || !region.isConnected) {
    region = el('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(region);
  }
  return region;
}

/**
 * Shows a toast. `action` ({ label, onClick }) adds a button and keeps
 * the toast up longer so there is time to reach it.
 */
export function toast(message, type = 'success', { action = null, duration } = {}) {
  let timer;
  function dismiss() {
    clearTimeout(timer);
    node.remove();
  }
  const node = el(
    'div',
    { class: `toast${type === 'error' ? ' is-error' : ''}` },
    icon(type === 'error' ? 'circle-alert' : 'circle-check', 16),
    message,
    action
      ? el(
          'button',
          {
            class: 'toast-action',
            onClick: () => {
              dismiss();
              action.onClick();
            },
          },
          action.label
        )
      : null
  );
  ensureRegion().appendChild(node);
  timer = setTimeout(dismiss, duration ?? (action ? 8000 : 3600));
}

/** Success toast with an Undo button wired to a store undo function. */
export function undoToast(message, undo) {
  toast(message, 'success', {
    action: {
      label: 'Undo',
      onClick: async () => {
        try {
          await undo();
          toast('Restored');
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    },
  });
}
