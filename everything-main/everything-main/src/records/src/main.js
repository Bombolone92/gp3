import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/views.css';
import { h } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { applyTheme } from './ui/prefs.js';
import { Store } from './data/store.js';
import { puterBackend, puterKv, indexedDbBackend, localKv } from './data/backend.js';
import { indexedDbJournal, journalName } from './data/journal.js';
import { App } from './ui/app.js';

const root = document.getElementById('app');
applyTheme();

const logo = () => h('img.splash-logo', { src: './icon-192.png', alt: '', width: 56, height: 56 });

function screen(...children) {
  root.removeAttribute('aria-busy');
  root.replaceChildren(h('main.splash', { id: 'main' }, ...children));
}

function loading(text = 'Opening Records...') {
  root.setAttribute('aria-busy', 'true');
  root.replaceChildren(h('div.splash', { role: 'status' }, logo(), h('div.spinner', { 'aria-hidden': 'true' }), h('p.splash-sub', text)));
}

function errorScreen(title, message, retry) {
  screen(h('div.splash-icon', icon('cloudOff', 28)), h('h1.splash-title', title), h('p.splash-sub', message), retry ? h('button.btn.primary.splash-cta', { type: 'button', onclick: retry }, 'Try again') : null);
}

function signInScreen(onSignedIn) {
  const btn = h('button.btn.primary.splash-cta', { type: 'button' }, 'Sign in');
  const error = h('p.field-error', { role: 'alert' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Waiting for Puter...';
    error.textContent = '';
    try {
      await puter.auth.signIn();
      onSignedIn();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Sign in';
      if (err?.error === 'popup_blocked') error.textContent = 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
      else if (err?.error !== 'auth_window_closed') error.textContent = 'Could not sign in. Try again.';
    }
  });
  const feature = (ic, text) => h('li', icon(ic, 18), h('span', text));
  screen(
    logo(),
    h('h1.splash-title', 'Records'),
    h('p.splash-sub', 'Organize anything in connected tables, then see it as a grid, board, calendar, gallery or form.'),
    h(
      'ul.splash-features',
      feature('vGrid', 'A fast spreadsheet-style grid with rich field types'),
      feature('fLink', 'Link records across tables, with lookups and rollups'),
      feature('fFormula', 'Formulas, filters, sorts, groups and summaries'),
      feature('cloud', 'Stored as files in your own Puter cloud'),
    ),
    btn,
    error,
  );
  btn.focus();
}

async function profilePicture() {
  try {
    return (await puter.auth.getProfilePicture?.()) || null;
  } catch {
    return null;
  }
}

async function start({ backend, kv, journal, user, env, onSignOut, picture }) {
  loading();
  const store = new Store({ backend, kv, journal, user: user?.username || '' });
  try {
    await store.init();
  } catch (err) {
    console.error(err);
    errorScreen('Could not open Records', 'Check your connection and try again.', () => location.reload());
    return;
  }
  const app = new App(root, { store, user, env, onSignOut });
  window.recordsApp = app;
  app.start();
  Promise.resolve(picture).then((p) => p && app.setPicture(p));
  // Opened from the Puter desktop with CSV files ("Open with Records").
  if (env === 'app' && typeof puter !== 'undefined' && puter.ui?.onLaunchedWithItems) {
    puter.ui.onLaunchedWithItems(async (items) => {
      for (const item of items || []) {
        if (!/\.(csv|tsv|txt)$/i.test(item.name || '')) continue;
        try {
          const blob = await (item.read ? item.read() : puter.fs.read(item.path));
          app.importFile(new File([blob], item.name, { type: blob.type || 'text/csv' }));
        } catch (err) {
          console.error(err);
        }
      }
    });
  }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  if (import.meta.env.DEV && params.has('local')) {
    // Development sandbox: everything stays in this browser, no Puter account.
    const backend = await indexedDbBackend('records-local');
    start({ backend, kv: localKv('records-local:'), journal: await indexedDbJournal('records-local-journal'), user: { username: 'you' }, env: 'web', onSignOut: null, picture: null });
    return;
  }
  if (typeof puter === 'undefined') {
    errorScreen('Could not reach Puter', 'Records keeps your bases in your Puter cloud. Check your connection and try again.', () => location.reload());
    return;
  }
  const env = puter.env;
  const begin = async () => {
    loading();
    let user = null;
    try {
      user = await puter.auth.getUser();
    } catch {
      /* the avatar falls back to initials */
    }
    start({
      backend: puterBackend(puter),
      kv: puterKv(puter),
      journal: await indexedDbJournal(journalName(user)),
      user,
      env,
      // Inside the Puter desktop the session belongs to Puter, so there is no sign-out.
      onSignOut: env === 'app' ? null : async () => {
        await puter.auth.signOut();
        location.hash = '';
        location.reload();
      },
      picture: profilePicture(),
    });
  };
  if (env === 'app' || puter.auth.isSignedIn()) begin();
  else signInScreen(begin);
}

boot();
