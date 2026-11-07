import './styles/index.css';
import { el } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { store } from './lib/store.js';
import { signlinks } from './lib/services.js';
import { applyTheme } from './ui/theme.js';
import { mountShell } from './ui/shell.js';
import { shouldOnboard, openOnboarding } from './ui/onboarding.js';
import { afterPull, runTimers } from './ui/actions.js';
import { authView } from './views/auth.js';

const appRoot = document.getElementById('app');

// A file dropped anywhere outside the upload dropzone would otherwise
// navigate the tab to the file, replacing the app mid-task. Dropzones
// handle their own drop before this bubbles.
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (!e.target.closest?.('.dropzone')) e.dataTransfer.dropEffect = 'none';
});
window.addEventListener('drop', (e) => e.preventDefault());

function showError(title, message, onRetry) {
  appRoot.replaceChildren(el('div.auth-view', {},
    el('div.empty-icon', { html: icon('wifiOff', 30) }),
    el('h1.auth-title', { style: { fontSize: '22px' } }, title),
    el('p.auth-sub', {}, message),
    el('button.btn.btn-primary.auth-cta', { type: 'button', onclick: onRetry }, 'Try again')
  ));
}

async function start() {
  // Dev-only mock harness: http://localhost:5173/?mock=1 runs the whole app
  // (including the sign worker) against an in-memory Puter.
  if (import.meta.env?.DEV && new URLSearchParams(location.search).has('mock')) {
    const { installMockPuter } = await import('../dev/puter-mock.js');
    installMockPuter();
  }
  if (typeof puter === 'undefined') {
    showError('Could not reach Puter', 'The Puter SDK failed to load. Check your connection and try again.', () => location.reload());
    return;
  }

  let signedIn = false;
  try {
    signedIn = await Promise.resolve(puter.auth.isSignedIn());
  } catch {
    signedIn = false;
  }

  if (!signedIn) {
    appRoot.replaceChildren(authView({ onSignedIn: boot }));
    return;
  }
  await boot();
}

async function boot() {
  try {
    await store.init();
  } catch (err) {
    console.error(err);
    showError('Could not load your documents', 'Something went wrong talking to your Puter cloud.', () => location.reload());
    return;
  }

  // Settings win over the pre-paint localStorage value (they sync across devices).
  applyTheme(store.settings.theme || 'system');
  mountShell(appRoot);
  if (shouldOnboard(store)) openOnboarding();

  // Catch up on what happened while the app was closed: signer activity, and
  // anything the clock did (expiry, reminders that came due).
  if (store.listDocs().some((d) => (d.status === 'sent' || d.status === 'expired') && !d.sample)) {
    signlinks.pull({ force: true }).then(afterPull).catch(() => {});
    runTimers().catch(() => {});
  }
}

// Dev-only handle for console debugging.
if (import.meta.env?.DEV) window.__sig = { store, signlinks };

start();
