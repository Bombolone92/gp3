import './styles/index.css';
import { el } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { store } from './lib/store.js';
import { applyTheme } from './ui/theme.js';
import { mountShell } from './ui/shell.js';
import { shouldOnboard, openOnboarding } from './ui/onboarding.js';
import { authView } from './views/auth.js';
import { startFeedSync } from './lib/calendar.js';

const appRoot = document.getElementById('app');

/*
 * Signing in and the three reads that follow are the whole boot, and until
 * they came back the page was blank — no title, no spinner, nothing to say the
 * app had even started. On a slow connection that is several seconds of a
 * screen that looks broken. Every path out of here replaces this.
 */
function showBooting() {
  const boot = el('div.boot', {},
    el('span.spinner', { 'aria-hidden': 'true' }),
    el('p', {}, 'Connecting to your Puter cloud…')
  );
  appRoot.replaceChildren(boot);
  // A boot that lands in under half a second should not flash a spinner at
  // anyone. The wait is a timer and being visible is a class, so what ends up
  // on screen never depends on an animation having had the chance to run.
  setTimeout(() => boot.classList.add('shown'), 400);
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
  showBooting();
  if (typeof puter === 'undefined') {
    showError('Could not reach Puter',
      'The Puter SDK failed to load. Check your connection and try again.',
      () => location.reload());
    return;
  }

  let signedIn = false;
  try {
    signedIn = await Promise.resolve(puter.auth.isSignedIn());
  } catch {
    signedIn = false;
  }

  if (!signedIn) {
    // The sign-in view stays on screen until the shell replaces it, which is
    // the whole boot later. Without this the last thing it said — a disabled
    // "Waiting for Puter…" button — stayed up for the seconds the data took
    // to load, after Puter had already answered.
    appRoot.replaceChildren(authView({ onSignedIn: () => { showBooting(); boot(); } }));
    return;
  }
  await boot();
}

async function boot() {
  try {
    await store.init();
  } catch (err) {
    console.error(err);
    showError('Could not load your data',
      'Something went wrong talking to your Puter cloud. Check your connection and try again.',
      () => location.reload());
    return;
  }

  // Settings win over the pre-paint localStorage value (they sync across
  // devices) — and keep winning: a restored backup replaces the theme along
  // with everything else, and a failed save rolls it back. The setting is the
  // truth, so the screen follows it rather than being told once at boot.
  applyTheme(store.settings.theme || 'system');
  store.addEventListener('change', () => applyTheme(store.settings.theme || 'system'));
  mountShell(appRoot);
  // A published calendar feed follows the data without being asked.
  startFeedSync();
  if (shouldOnboard(store)) openOnboarding();
}

// Dev-only handle for console debugging.
if (import.meta.env?.DEV) window.__cm = { store };

start();
