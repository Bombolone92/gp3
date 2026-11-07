import './styles/index.css';
import { el } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { toast } from './ui/toast.js';
import { store } from './lib/store.js';
import { isTransportError } from './lib/outbox.js';
import { startAutoSync } from './lib/sync.js';
import { shouldOnboard, openOnboarding } from './ui/onboarding.js';
import { applyTheme } from './ui/theme.js';
import { mountShell } from './ui/shell.js';
import { authView } from './views/auth.js';

const appRoot = document.getElementById('app');

// The shell must open with no network: a service worker keeps the built app
// and a copy of the Puter SDK on disk. Registered after load so it never
// competes with first paint; in dev, Vite's module server stays untouched.
if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.error(err));
  });
}

function showError(title, message, onRetry) {
  appRoot.replaceChildren(el('div.auth-view', {},
    el('div.empty-icon', { html: icon('wifiOff', 30) }),
    el('h1.auth-title', { style: { fontSize: '22px' } }, title),
    el('p.auth-sub', {}, message),
    el('button.btn.btn-primary.auth-cta', { onclick: onRetry }, 'Try again')
  ));
}

async function start() {
  if (typeof puter === 'undefined') {
    showError('Couldn’t reach Puter', 'The Puter SDK failed to load. Check your connection and try again.', () => location.reload());
    return;
  }

  let signedIn = false;
  try {
    signedIn = await Promise.resolve(puter.auth.isSignedIn());
  } catch {
    signedIn = false;
  }

  if (!signedIn) {
    appRoot.replaceChildren(authView({ onSignedIn: () => boot({ freshSignIn: true }) }));
    return;
  }
  await boot();
}

async function boot({ freshSignIn = false } = {}) {
  try {
    await store.init();
  } catch (err) {
    console.error(err);
    // The cloud being unreachable is the one failure a register must survive:
    // open from the local snapshot, sell into the outbox, sync later. Real
    // rejections still stop the boot - a snapshot can't fix a broken account.
    if (isTransportError(err) && store.initFromBootCache()) {
      applyTheme(store.settings.theme || 'system');
      mountShell(appRoot);
      startAutoSync(store);
      toast('Offline. Selling works from this device’s copy; history and edits need a connection.', {
        icon: 'wifiOff', duration: 8000,
      });
      return;
    }
    showError('Couldn’t load your store', 'Something went wrong talking to your Puter cloud.', () => location.reload());
    return;
  }

  // The documented recovery for a forgotten manager PIN: signing out and
  // back in with the account clears it - the account is the real authority,
  // the PIN only a counter-height barrier. A plain reload never lands here.
  if (freshSignIn && store.settings.pin) {
    store.updateSettings({ pin: null }).catch((err) => console.error(err));
  }

  // Settings win over the pre-paint localStorage value (they sync across devices).
  applyTheme(store.settings.theme || 'system');
  mountShell(appRoot);
  // Sales queued in a previous run go out as soon as there's a network.
  startAutoSync(store);
  // First run on an empty dataset → guided start (or sample data).
  if (shouldOnboard(store)) openOnboarding();

  // Today's restore point, if today hasn't got one. Deferred well past first
  // paint and never awaited: it reads every month file, and a register must
  // open now. A failure is remembered for Settings to warn about, not shown.
  setTimeout(() => {
    store.dailySnapshot().catch((err) => console.error(err));
  }, 4000);
}

// Dev-only handle for the mock harness and console debugging.
if (import.meta.env?.DEV) window.__pos = { store };

start();
