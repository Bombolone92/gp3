import './styles/index.css';
import { el } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { store } from './lib/store.js';
import { setCurrency } from './lib/format.js';
import { applyTheme } from './ui/theme.js';
import { mountShell } from './ui/shell.js';
import { shouldOnboard, openOnboarding } from './ui/onboarding.js';
import { bottomStack, toast } from './ui/toast.js';
import { authView } from './views/auth.js';
import { recoveryView } from './views/recovery.js';
import { isPuterApp } from './lib/env.js';

const appRoot = document.getElementById('app');
let landing;
const landingLifecycle = new AbortController();

function showLanding() {
  // Reuse the enhanced page when the asynchronous SDK finishes loading.
  // Mounting authView twice would register duplicate sign-in listeners.
  landing ||= authView({ onSignedIn: boot, signal: landingLifecycle.signal });
  if (!appRoot.contains(landing)) appRoot.replaceChildren(landing);
  return landing;
}

function showError(title, message, onRetry, iconName = 'wifiOff') {
  appRoot.replaceChildren(el('div.auth-view', {},
    el('div.empty-icon', { html: icon(iconName, 30) }),
    el('h1.auth-title', { style: { fontSize: '22px' } }, title),
    el('p.auth-sub', {}, message),
    el('button.btn.btn-primary.auth-cta', { onclick: onRetry }, 'Try again')
  ));
}

/**
 * The load stopped on a record: one that came back unreadable, or one this
 * version's sanitizers refuse. Shown with the ways back that need nothing of
 * that record - see recoveryView. Before this it was the plain error above,
 * telling the user to restore from a backup export in an app whose Settings
 * screen, where restoring lives, never mounts while the load fails.
 */
function showRecovery(title, message) {
  appRoot.replaceChildren(recoveryView({
    title, message,
    onRetry: () => location.reload(),
    // Through the ordinary load, so the company comes back the way every boot brings it.
    onRecovered: () => location.reload(),
  }));
}

async function start() {
  const sdk = document.querySelector('script[data-puter-sdk]');
  /* Wait only for a script still in flight. One that already fired load
     without defining `puter` (a proxy's block page, a stub) fires nothing
     more, and the wait below never ended: the landing kept its buttons
     disabled and said nothing. Read as loaded, it falls through to the
     sign-in path, which says the connection failed. */
  if (sdk && !globalThis.puter && sdk.dataset.failed !== 'true' && sdk.dataset.loaded !== 'true') {
    const view = showLanding();
    const buttons = [...view.querySelectorAll('[data-sign-in]')];
    buttons.forEach((button) => { button.disabled = true; });
    view.setAttribute('data-sign-in-loading', '');
    await new Promise((resolve) => {
      const finish = () => {
        sdk.removeEventListener('load', finish);
        sdk.removeEventListener('error', finish);
        resolve();
      };
      sdk.addEventListener('load', finish);
      sdk.addEventListener('error', finish);
    });
    view.removeAttribute('data-sign-in-loading');
    buttons.forEach((button) => { button.disabled = false; });
  }
  // Once the SDK identifies the Puter shell, the platform owns the session,
  // even when the web auth check reports false. Continue into the workspace.
  if (isPuterApp()) {
    await boot();
    return;
  }

  let signedIn = false;
  try {
    signedIn = await Promise.resolve(puter.auth.isSignedIn());
  } catch {
    signedIn = false;
  }

  if (!signedIn) {
    showLanding();
    return;
  }
  await boot();
}

async function boot() {
  landingLifecycle.abort();
  landing = null;
  // Remove landing anchors while preserving incoming app routes.
  if (['#landing-top', '#features', '#ownership', '#equity', '#fundraising', '#your-data', '#faq', '#landing-main'].includes(location.hash)) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  appRoot.replaceChildren(el('div.boot-splash', { role: 'status', 'aria-label': 'Loading Cap Table' },
    el('img.boot-mark', { src: './icon-192.png', width: 56, height: 56, alt: '' })));
  window.scrollTo(0, 0);
  try {
    await store.init();
  } catch (err) {
    console.error(err);
    if (err?.name === 'CorruptDataError') {
      // Nothing has been written at this point, and nothing will be: starting
      // on an empty cap table is what would overwrite the damaged record.
      showRecovery('Couldn’t read your saved data',
        'One of your records came back unreadable, so Cap Table stopped instead of '
        + 'starting on an empty cap table and saving over it. Nothing has been changed.');
      return;
    }
    /* The journal refused the load in its own words: its index is damaged,
       an unfinished transaction's record is missing, or the company kept
       changing in another session while this one read it. Shown as it was
       said - read as a connection problem, "check your connection" sent the
       user to their network over a record that would come back the same. */
    if (err?.name === 'AuditRecoveryError') {
      showError('Couldn’t load your history', `${err.message} Nothing has been changed.`, () => location.reload(), 'alert');
      return;
    }
    /* A record the sanitizers refuse to read - a saved scenario or a term
       carrying a field this version does not know, from a newer tab or a
       hand-edited backup. Said in its own words: read as a connection
       problem, it sent the user to their network over a record that would
       come back the same on every retry. */
    if (err?.refused) {
      showRecovery('Couldn’t read your saved data', `${err.message} Nothing has been changed. Open this company in the app version that wrote it.`);
      return;
    }
    showError('Couldn’t load your data',
      'Something went wrong talking to your Puter cloud. Check your connection and try again.',
      () => location.reload());
    return;
  }

  // Settings win over the pre-paint localStorage value (they sync across devices).
  applyTheme(store.settings.theme || 'system');
  // Before anything renders, including the onboarding sheet below.
  setCurrency(store.company.currency);
  mountShell(appRoot);
  // First run on an empty dataset → guided start (or sample data).
  if (shouldOnboard(store)) openOnboarding();

  /* A load that found securities whose holder record was missing kept them
     under a stand-in - see Store.recoverHolders. Said on every load that
     finds them, since the condition stands until the holder is put right,
     and written to the activity log once, so the "Unknown holder" on the
     stakeholders page has an explanation after the toast is gone. */
  const announceRecovered = () => {
    if (!store.recoveredHolders.length) return;
    const standIns = new Set(store.recoveredHolders.map((h) => h.id));
    const n = store.securities.filter((s) => standIns.has(s.stakeholderId)).length;
    const text = `${n} ${n === 1 ? 'security' : 'securities'} had no holder record, so `
      + `${n === 1 ? 'it was' : 'they were'} kept under “Unknown holder”.`;
    toast(text, { icon: 'alert' });
    if (!store.activity.some((a) => a.text === text)) store.logActivity(text, 'alert');
  };
  announceRecovered();
  store.addEventListener('recovered', announceRecovered);

  /* Losing the connection is the one status change nobody asked for, so it is
     announced. The region stays in the document and only its contents change -
     inserting a live region and its text together is announced inconsistently.
     It joins the toast stack rather than being positioned on its own: the two
     used to sit at the same spot, and the toast that fires while the banner is
     up is the one about the very connection the banner is explaining. */
  const offlineText = el('span');
  const offline = el('div.offline-banner', {
    role: 'status', 'aria-live': 'polite',
    html: icon('wifiOff', 15, 2),
  }, offlineText);
  bottomStack().append(offline);

  /* The other standing condition, and it stands for good: once a save has
     been refused for landing on a change made in another tab, everything
     held here is behind and no further save can be trusted. The refusal
     itself surfaces as an ordinary "couldn't save" toast, which is true but
     says nothing about why - this is the explanation, and the way out. */
  const staleBanner = el('div.offline-banner', {
    role: 'status', 'aria-live': 'polite', hidden: true,
    html: icon('alert', 15, 2),
  },
    /* "A change", not "your last change": the refusal is per collection, so
       a save to another collection can land while the banner is up, and the
       banner then contradicted the "Stakeholder updated" toast beside it. */
    el('span', {}, ' This cap table was changed in another tab or device, and a change here wasn’t saved. Reload to pick up the latest.'),
    el('button.toast-action', { onclick: () => location.reload() }, 'Reload'));
  bottomStack().append(staleBanner);
  store.addEventListener('stale', () => { staleBanner.hidden = false; });
  staleBanner.hidden = !store.isStale;

  /* The mirror image of the stale banner. There, storage moved on and this
     session is behind it; here, a save failed part-way and the rollback that
     put memory right could not reach storage, so storage is behind this
     session - see the store's #owed. Reloading would load the half-applied
     change, so the way out is to stay: the rewrite is retried when the
     connection returns, on a timer meanwhile, and on demand. */
  const retryUnsaved = async (recoverPending = true) => {
    if (await store.retryUnsaved({ recoverPending }) && !store.isStale) toast('Your cap table is back in sync with your Puter cloud.');
  };
  const unsavedBanner = el('div.offline-banner', {
    role: 'status', 'aria-live': 'polite', hidden: true,
    html: icon('alert', 15, 2),
  },
    el('span', {}, ' A change is unfinished. Its last confirmed state is shown. Retry to recover it; a save still running in another tab may be cancelled.'),
    el('button.toast-action', { onclick: () => retryUnsaved(true) }, 'Retry now'));
  bottomStack().append(unsavedBanner);
  let retryTimer = null;
  const updateUnsaved = () => {
    unsavedBanner.hidden = !store.unsaved;
    clearInterval(retryTimer);
    retryTimer = store.unsaved ? setInterval(() => retryUnsaved(false), 30_000) : null;
  };
  store.addEventListener('unsaved', updateUnsaved);
  updateUnsaved();
  window.addEventListener('online', () => { if (store.unsaved) retryUnsaved(false); });
  window.addEventListener('beforeunload', (event) => {
    if (!store.owesStorage) return;
    event.preventDefault();
    event.returnValue = '';
  });
  const updateOffline = () => {
    offline.hidden = navigator.onLine;
    offlineText.textContent = navigator.onLine
      ? '' : ' You’re offline. Changes may not save until you’re back';
  };
  window.addEventListener('online', updateOffline);
  window.addEventListener('offline', updateOffline);
  updateOffline();
}

// Dev-only handle for console debugging.
if (import.meta.env?.DEV) window.__cap = { store };

start();
