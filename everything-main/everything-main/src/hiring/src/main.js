/** Entry point: authentication gate, backend selection, app boot. */
import './styles/main.css';
import { el, mount } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { brandMark } from './ui/components.js';
import { createPuterBackend } from './core/backend.js';
import { createStore } from './core/store.js';
import { startApp } from './ui/app.js';
import { shouldOnboard, openOnboarding } from './ui/onboarding.js';
import { primeToastRegion, toast } from './ui/toast.js';

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
          button.disabled = false;
          button.textContent = 'Sign in';
          toast('Sign-in was cancelled.', 'error');
          return;
        }
        try {
          await bootSignedIn();
        } catch (err) {
          // Signed in, but loading failed (a dropped connection mid-init).
          // The splash may have replaced this screen; render a fresh auth
          // screen so the user is never stranded without a button.
          console.error(err);
          authScreen({ puterAvailable: true });
          toast(err.message ?? 'Couldn’t load your data. Try again.', 'error');
        }
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
        el('div', { class: 'auth-mark' }, brandMark(76)),
        el('h1', {}, 'Hiring'),
        el(
          'p',
          { class: 'tagline' },
          'Job pages, candidate pipeline, interviews, scorecards, offers, and onboarding, all in one calm place.'
        ),
        el(
          'div',
          { class: 'feature-list' },
          feature('kanban', 'A pipeline that shows every candidate, stage by stage, per job'),
          feature('calendar-check', 'Interviews export as calendar invites and carry video-call links'),
          feature('signature', 'Offer letters generated for you, with recorded e-signatures'),
          feature('cloud', 'Your data lives in your own Puter cloud, not on our servers')
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
        'Free · No ads · Powered by ',
        el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noreferrer' }, 'Puter')
      )
    )
  );
  // Mounting replaced document.body's children; put the (empty) toast
  // region back before anything toasts, so the first one is announced.
  primeToastRegion();
}

async function bootSignedIn() {
  // Show the splash only when loading is actually slow; rendering it
  // unconditionally makes fast loads flash it for a frame or two.
  const splashTimer = setTimeout(() => splashScreen('Loading your pipeline…'), 250);
  const backend = createPuterBackend();
  // Snapshots on: the app keeps its own copies of the whole dataset in the
  // user's drive, so a wipe, a mistaken restore, or a purge has something
  // behind it. Tests build stores without them.
  const store = createStore(backend, { snapshots: true });
  let user = null;
  try {
    [user] = await Promise.all([
      // A failed profile fetch is non-fatal: the sidebar shows a generic account.
      puter.auth.getUser().catch(() => null),
      store.init(),
    ]);
  } finally {
    clearTimeout(splashTimer);
  }
  // Inside Puter itself the platform owns the session, so the app must not
  // offer its own sign-out (https://docs.puter.com/Utils/env/).
  const canSignOut = puter.env !== 'app';
  const ctx = startApp({
    store,
    user,
    canSignOut,
    onSignOut: () => {
      puter.auth.signOut();
      location.hash = '';
      location.reload();
    },
  });
  // First run on an empty dataset: guided start (or sample data).
  if (shouldOnboard(store)) openOnboarding(store, ctx);
  // Yesterday's copy, taken now that the app is up. Deliberately not
  // awaited and deliberately quiet: a snapshot is insurance, and nothing
  // about it should delay or interrupt the work on screen.
  store.snapshotIfStale().catch((err) => console.error('Snapshot failed', err));
}

/** Resolves once document.body exists, regardless of load-event timing. */
function domReady() {
  if (document.body) return Promise.resolve();
  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
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
        el('div', { class: 'auth-mark' }, brandMark(76)),
        el('h1', {}, 'Hiring'),
        el('p', { class: 'tagline' }, message)
      )
    )
  );
  primeToastRegion();
}

// Safety net: an action whose persistence fails outside a try/catch (a
// dropped connection mid-save, for example) must never fail silently.
window.addEventListener('unhandledrejection', (event) => {
  console.error(event.reason);
  if (!document.body) return;
  event.preventDefault();
  toast(event.reason?.message ?? 'Something went wrong. Check your connection.', 'error');
});

async function boot() {
  await domReady();
  // Local development without a Puter session: `npm run dev` then open
  // http://localhost:5173/?mock — data persists in localStorage.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('mock')) {
    await import('../dev/puter-mock.js');
  }
  const puterAvailable = typeof globalThis.puter !== 'undefined';
  if (puterAvailable && (await Promise.resolve(puter.auth.isSignedIn()))) {
    await bootSignedIn();
  } else {
    authScreen({ puterAvailable });
  }
}

boot().catch((err) => {
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
        el('p', { class: 'tagline' }, err.message ?? 'Unknown error'),
        el('button', { class: 'btn btn-primary', onClick: () => location.reload() }, 'Reload')
      )
    )
  );
});
