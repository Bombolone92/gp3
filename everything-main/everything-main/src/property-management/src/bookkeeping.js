/**
 * Automatic posting. Once the first load from the cloud has finished (not
 * just the cached snapshot), make sure the chart of accounts exists and
 * post recurring charges and late fees that have come due. Runs again when
 * the day changes, and when automatic posting is turned back on.
 */
import { ensureDefaults } from './core/bootstrap.js';
import { postDue } from './core/leases.js';
import { ledgerIndex } from './core/ledger.js';

export function startBookkeeping(store, { today, onPosted = () => {}, every = 10 * 60 * 1000 } = {}) {
  let lastDay = null;
  const run = () => {
    if (!store.state.synced || !store.state.lastSyncedAt || store.state.syncing) return;
    const day = today();
    if (day === lastDay) return;
    ensureDefaults(store);
    // Turned off: nothing is marked done, so turning it on posts right away.
    if (store.state.settings.accounting?.autoPost === false) return;
    try {
      const n = postDue(store, { index: ledgerIndex(store), settings: store.state.settings, today: day });
      lastDay = day;
      if (n) onPosted(n);
    } catch (err) {
      console.error('[property-management] posting failed', err);
    }
  };
  run();
  const unsubscribe = store.subscribe((c) => (c.has('sync') || c.has('settings')) && run());
  const timer = setInterval(run, every);
  return () => {
    unsubscribe();
    clearInterval(timer);
  };
}
