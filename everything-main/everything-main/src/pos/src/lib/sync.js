/**
 * Draining the offline outbox in the background.
 *
 * Three triggers, because none of them is reliable alone: the browser's
 * `online` event (fast but fires on captive portals too), a slow interval (for
 * connections that come back without an event), and app start (for sales
 * queued in a previous run).
 */

const RETRY_INTERVAL_MS = 30_000;

export function startAutoSync(store) {
  let timer = null;

  const attempt = () => {
    if (!store.pendingSync && !store.needsConverge) return;
    // syncOutbox never rejects for a network failure - it just leaves the
    // queue alone and reports it through the status bar.
    store.syncOutbox().catch((err) => console.error(err));
  };

  const onOnline = () => attempt();
  window.addEventListener('online', onOnline);
  // Coming back to a tab that slept through the outage is another good moment.
  const onVisible = () => { if (document.visibilityState === 'visible') attempt(); };
  document.addEventListener('visibilitychange', onVisible);
  timer = setInterval(attempt, RETRY_INTERVAL_MS);
  attempt();

  return () => {
    clearInterval(timer);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
