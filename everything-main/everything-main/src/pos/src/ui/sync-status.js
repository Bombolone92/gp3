/**
 * The offline / pending-sync indicator.
 *
 * Silent when there's nothing to say. Otherwise it states plainly what is
 * happening and how many sales are affected, because "did that sale save?" is
 * the question a cashier will otherwise ask all day.
 */

import { el, clear, append, keepFocus } from './dom.js';
import { icon } from './icons.js';
import { store } from '../lib/store.js';
import { plural } from '../lib/util.js';

export function syncStatusBar() {
  const bar = el('div.sync-bar', { role: 'status', 'aria-live': 'polite' });
  let syncing = false;

  const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

  // "Sync now" rebuilds the bar it sits in - twice, since the attempt
  // repaints on the way in and on the way out.
  function render() {
    keepFocus(bar, paint);
  }

  function paint() {
    const pending = store.pendingSync;
    const off = !online();
    clear(bar);
    bar.classList.toggle('shown', off || pending > 0);
    if (!off && !pending) return;

    let tone = 'warn';
    let name = 'wifiOff';
    let message;
    let action = null;

    if (off && pending) {
      message = `Offline · ${plural(pending, 'sale')} waiting to sync`;
    } else if (off) {
      // An offline *boot* runs on the device's copy of the store - say so.
      message = store.offlineBoot
        ? 'Offline. The register opened from this device’s copy; history and edits need a connection'
        : 'Offline. Sales are saved on this device and sync when you’re back';
    } else if (syncing) {
      tone = 'accent';
      name = 'cloudUp';
      message = `Syncing ${plural(pending, 'sale')}…`;
    } else if (store.syncFailed) {
      tone = 'danger';
      name = 'alert';
      message = `${plural(pending, 'sale')} couldn’t sync`;
      action = 'Try again';
    } else {
      tone = 'accent';
      name = 'cloudUp';
      message = `${plural(pending, 'sale')} waiting to sync`;
      action = 'Sync now';
    }

    bar.className = `sync-bar shown sync-${tone}`;
    // append() (not bar.append) so a missing action drops out instead of
    // stringifying into the message.
    append(bar, [
      el('span.sync-ic', { html: icon(name, 15, 2) }),
      el('span.grow', {}, message),
      action && el('button', {
        type: 'button',
        onclick: async () => {
          syncing = true;
          render();
          await store.syncOutbox().catch(() => {});
          syncing = false;
          render();
        },
      }, action),
    ]);
  }

  const onChange = () => render();
  store.addEventListener('sync', onChange);
  store.addEventListener('change', onChange);
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  render();

  return {
    node: bar,
    destroy: () => {
      store.removeEventListener('sync', onChange);
      store.removeEventListener('change', onChange);
      window.removeEventListener('online', onChange);
      window.removeEventListener('offline', onChange);
    },
  };
}
