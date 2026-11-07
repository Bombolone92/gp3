/** Entry point: authentication gate, backend selection, app boot. */
import './styles/main.css';
import { el, mount } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { createOfflineBackend, createPuterBackend } from './core/backend.js';
import { offline, isNetworkError } from './core/offline.js';
import { createStore } from './core/store.js';
import {
  createPuterSnapshotFS,
  createSnapshotStore,
  watchForDailySnapshot,
} from './core/snapshots.js';
import { startApp } from './ui/app.js';
import { confirmDialog } from './ui/modal.js';
import { shouldOnboard, openOnboarding } from './ui/onboarding.js';
import { toast } from './ui/toast.js';

function authScreen({ puterAvailable }) {
  const signInButton = el(
    'button',
    {
      class: 'btn btn-primary',
      disabled: !puterAvailable,
      onClick: async (e) => {
        const button = e.currentTarget;
        button.disabled = true;
        button.textContent = 'Waiting for Puter…';
        try {
          await puter.auth.signIn();
        } catch {
          // Only a rejected sign-in lands here; boot failures below get
          // the real error screen instead of a misleading "cancelled".
          button.disabled = false;
          button.textContent = 'Sign in';
          toast('Sign-in was cancelled.', 'error');
          return;
        }
        bootSignedIn().catch(showFatalError);
      },
    },
    'Sign in'
  );

  const feature = (iconName, text) =>
    el('div', { class: 'feature-item' }, icon(iconName, 19), el('span', {}, text));

  mount(
    document.body,
    el(
      'div',
      { class: 'auth-screen' },
      el(
        'div',
        { class: 'auth-card' },
        el('img', { class: 'auth-logo', src: './icons/icon-192.png', width: 76, height: 76, alt: 'Shifts logo' }),
        el('h1', {}, 'Shifts'),
        el(
          'p',
          { class: 'tagline' },
          'Schedules, swaps, and attendance. Beautifully simple, on every device.'
        ),
        el(
          'div',
          { class: 'feature-list' },
          feature('cloud', 'Your data lives in your own Puter cloud, not on our servers'),
          feature('calendar-check', 'Availability-aware scheduling that catches conflicts as you assign'),
          feature('arrow-left-right', 'Shift swaps and attendance reviewed and resolved in one place')
        ),
        signInButton,
        !puterAvailable
          ? el(
              'div',
              { class: 'form-error', style: { marginTop: '10px' } },
              icon('circle-alert', 15),
              'Puter.js could not be loaded. Check your connection and reload the page.'
            )
          : null
      ),
      el(
        'p',
        { class: 'auth-footer' },
        'Free • No ads • Powered by ',
        el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noreferrer' }, 'Puter')
      )
    )
  );
}

async function bootSignedIn() {
  // Show the splash only when loading is actually slow; rendering it
  // unconditionally makes fast loads flash it for a frame or two.
  const splashTimer = setTimeout(() => splashScreen('Loading your schedule…'), 250);
  const backend = createOfflineBackend(createPuterBackend(), offline, isNetworkError);
  // Restore points live as files in the user's own storage, and are
  // skipped rather than queued while offline (see core/snapshots.js).
  const snapshots = createSnapshotStore(createPuterSnapshotFS(), {
    online: () => navigator.onLine,
  });
  const store = createStore(backend, {
    beforeReplace: (reason, state) => snapshots.save(state, reason),
  });
  let user = null;
  try {
    // Identity first: the offline mirror is namespaced per user, so a
    // stale cache from another account must be cleared before any load
    // populates it. A failed profile fetch falls back to the cached
    // identity (offline) and is otherwise non-fatal.
    user = await puter.auth.getUser().catch(() => null);
    if (user?.uuid) {
      if (!offline.matches(user)) offline.clearAll();
      offline.setUser(user);
    } else if (offline.hasCache()) {
      user = offline.user;
    }
    await store.init();
  } finally {
    clearTimeout(splashTimer);
  }
  watchForDailySnapshot(store, snapshots, { online: () => navigator.onLine });
  startApp({
    store,
    snapshots,
    user,
    onSignOut: async () => {
      // Writes queued while offline exist only in this device's mirror,
      // which sign-out wipes; don't discard them without explicit consent.
      const pending = backend.pendingWrites();
      if (pending > 0) {
        const ok = await confirmDialog({
          title: 'Discard unsynced changes?',
          message: `${pending} change${pending === 1 ? '' : 's'} saved on this device ${
            pending === 1 ? 'hasn’t' : 'haven’t'
          } reached your cloud yet. Signing out deletes ${pending === 1 ? 'it' : 'them'} permanently.`,
          confirmLabel: 'Sign out anyway',
          danger: true,
        });
        if (!ok) return;
      }
      offline.clearAll();
      puter.auth.signOut();
      location.hash = '';
      location.reload();
    },
  });
  // First run on an empty dataset: guided start (or sample data).
  if (shouldOnboard(store)) openOnboarding(store);
  setupOfflineIndicators(backend);
}

/** Offline banner plus sync of queued writes when connectivity returns. */
function setupOfflineIndicators(backend) {
  let banner = null;
  const updateBanner = () => {
    if (!navigator.onLine && !banner) {
      banner = el(
        'div',
        { class: 'offline-banner' },
        icon('wifi-off', 14),
        'Offline. Changes save here and sync when you’re back.'
      );
      document.body.append(banner);
    } else if (navigator.onLine && banner) {
      banner.remove();
      banner = null;
    }
    // Toasts share the banner's bottom-center slot; the class lifts them
    // clear of it (see .offline-banner in styles/main.css).
    document.body.classList.toggle('is-offline', banner !== null);
  };

  let syncing = false;
  const syncPending = async () => {
    if (syncing || !navigator.onLine || backend.pendingWrites() === 0) return;
    syncing = true;
    try {
      const flushed = await backend.flushPending();
      if (flushed > 0) toast(`Back online. ${flushed} change${flushed === 1 ? '' : 's'} synced.`);
    } catch (err) {
      console.error(err); // still offline or a real error: the queue is kept
    } finally {
      syncing = false;
    }
  };

  window.addEventListener('online', () => {
    updateBanner();
    syncPending();
  });
  window.addEventListener('offline', updateBanner);
  updateBanner();
  syncPending();
}

/** Resolves once document.body exists, regardless of load-event timing. */
function domReady() {
  if (document.body) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      observer.disconnect();
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (document.body) done();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', done, { once: true });
    if (document.body) done();
  });
}

function splashScreen(message) {
  mount(
    document.body,
    el(
      'div',
      { class: 'auth-screen' },
      el(
        'div',
        { class: 'auth-card' },
        el('img', { class: 'auth-logo', src: './icons/icon-192.png', width: 76, height: 76, alt: 'Shifts logo' }),
        el('h1', {}, 'Shifts'),
        el('p', { class: 'tagline' }, message)
      )
    )
  );
}

/**
 * Dev-only preview harness (stripped from production builds): boots against
 * an in-memory store so screens can be exercised without a Puter account.
 * `?dev-preview` starts empty (onboarding), `?dev-preview=sample` seeds data.
 */
async function devPreview(mode) {
  const [{ createMemoryBackend }, { buildSeedData }] = await Promise.all([
    import('./core/backend.js'),
    import('./core/seed.js'),
  ]);
  const store = createStore(createMemoryBackend());
  await store.init();
  if (mode === 'sample') await store.loadSampleData(buildSeedData());
  startApp({ store, user: { username: 'dev' }, onSignOut: () => location.reload() });
  if (shouldOnboard(store)) openOnboarding(store);
}

async function boot() {
  await domReady();
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(location.search);
    if (params.has('dev-preview')) {
      await devPreview(params.get('dev-preview'));
      return;
    }
  }
  const puterAvailable = typeof globalThis.puter !== 'undefined';

  // The SDK couldn't load but this device holds a signed-in user's local
  // mirror: boot from it (reads from cache, writes queue) and pick up the
  // real SDK with a reload once the network returns.
  if (!puterAvailable && offline.hasCache() && !navigator.onLine) {
    offline.installStub();
    window.addEventListener('online', () => location.reload(), { once: true });
    await bootSignedIn();
    return;
  }

  let signedIn = false;
  if (puterAvailable) {
    try {
      // Defensive await: depending on SDK state this can be a promise,
      // and a bare truthy check would treat signed-out users as signed in.
      signedIn = (await Promise.resolve(puter.auth.isSignedIn())) === true;
    } catch {
      signedIn = false;
    }
  }
  // Offline, the auth check can fail even though this device has a
  // signed-in user's data: their local mirror is the session.
  if (!signedIn && !navigator.onLine && offline.hasCache()) signedIn = true;

  if (signedIn) {
    await bootSignedIn();
  } else {
    authScreen({ puterAvailable });
  }
}

function showFatalError(err) {
  console.error(err);
  mount(
    document.body,
    el(
      'div',
      { class: 'auth-screen' },
      el(
        'div',
        { class: 'card auth-card' },
        el('h1', {}, 'Something went wrong'),
        el('p', { class: 'tagline' }, err?.message ?? 'Unknown error'),
        el('button', { class: 'btn btn-primary', onClick: () => location.reload() }, 'Reload')
      )
    )
  );
}

/* PWA service worker, skipped on local dev hosts where a registered
   worker would serve stale caches over the dev server. */
const isDevHost =
  ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname) ||
  location.hostname.endsWith('.localhost');
if ('serviceWorker' in navigator && !isDevHost) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

boot().catch(showFatalError);
