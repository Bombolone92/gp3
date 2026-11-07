import { el, clear } from '../lib/dom.js';
import { icon } from './icons.js';
import { store } from '../lib/store.js';

/**
 * "You are offline, and this is what that means here." Every view that shows
 * stored work says it the same way — which copy is on screen, how much of it
 * has not reached Puter yet, and a way to try now — so the message cannot
 * drift between the board and the cross-project list.
 *
 * offlineNotice() → node with .destroy()
 */
export function offlineNotice() {
  const wrap = el('div');

  function render() {
    clear(wrap);
    if (!store.offline) return;
    const pending = store.pendingUploads;
    wrap.append(el('div.offline-bar', { role: 'status' },
      el('span.offline-ic', { html: icon('cloudOff', 15, 2), 'aria-hidden': 'true' }),
      el('span.grow', {}, pending
        ? `Offline. ${pending} project${pending === 1 ? '' : 's'} saved on this device, `
          + 'waiting to reach Puter'
        : 'Offline. Showing the last version saved on this device'),
      el('button.btn.btn-ghost.btn-sm', {
        type: 'button',
        onclick: () => store.syncOutbox().catch((err) => console.error(err)),
      }, 'Try now')
    ));
  }

  store.addEventListener('connection', render);
  store.addEventListener('outbox', render);
  wrap.destroy = () => {
    store.removeEventListener('connection', render);
    store.removeEventListener('outbox', render);
  };

  // The bar has to speak for the state the view is *mounted* in, not only for
  // the next event: arriving here already offline is the common case.
  render();
  return wrap;
}
