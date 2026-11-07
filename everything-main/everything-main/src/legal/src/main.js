import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/views.css';
import './styles/print.css';

import { h, mount } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { initTheme } from './ui/theme.js';
import { toast } from './ui/toast.js';
import { confirmDialog } from './ui/dialog.js';
import { app } from './app.js';
import { createStore } from './core/store.js';
import { createMemoryBackend, createPuterBackend } from './core/backend.js';
import { createIdbCache } from './core/cache.js';
import { setMoneyDefaults } from './core/money.js';
import { today } from './core/dates.js';
import * as platform from './platform.js';
import * as team from './team.js';
import { buildShell, REPO_URL } from './ui/shell.js';
import { startViews, APP_NAME } from './ui/viewhost.js';
import { showAlphaNotice } from './ui/alpha.js';

const root = document.getElementById('app');

initTheme();
boot();

// Offline app shell (production builds only; dev reloads must stay fresh).
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

function loading(label = 'Loading') {
  mount(root, h('div.boot', { role: 'status', 'aria-label': label }, h('img', { src: './icons/icon.svg', alt: '' }), h('span.boot-bar')));
}

async function boot() {
  loading();
  app.env = platform.puterEnv();
  if (await platform.isSignedIn()) {
    await startSignedIn();
  } else if (new URLSearchParams(location.search).has('demo')) {
    await startDemo();
  } else {
    showWelcome();
  }
  showAlphaNotice();
}

async function handleSignIn() {
  try {
    await platform.signIn();
    // Keep an invitation link so it is accepted right after signing in.
    const hash = location.hash.startsWith('#/join') ? location.hash : '';
    // Drop ?demo so the reload opens the signed-in firm.
    history.replaceState(null, '', location.pathname + hash);
    location.reload();
  } catch (err) {
    const code = err?.error || err?.code || err?.message;
    if (code === 'auth_window_closed') return;
    toast(code === 'popup_blocked' ? 'Allow pop-ups for this site to sign in.' : 'Sign in did not complete. Please try again.', { type: 'error' });
  }
}

async function startSignedIn() {
  let user;
  try {
    user = await platform.getUser();
  } catch (err) {
    console.error(err);
    showWelcome('We could not reach your Puter account. Check your connection and try again.');
    return;
  }
  app.user = { username: user.username, uuid: user.uuid };
  app.avatarUrl = platform.cachedProfilePicture(user.username);

  // Which firm: the person's own, or one they joined as a member.
  const kv = globalThis.puter.kv;
  let ws = { current: 'own', own: {}, joined: [] };
  try {
    ws = await team.loadWorkspaces(kv);
  } catch (err) {
    console.warn('[legal] could not read workspaces', err);
    // Unknown, not empty: saving this list would drop the person's firms.
    ws.unverified = true;
  }
  const join = location.hash.startsWith('#/join') ? team.parseJoin(Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''))) : null;
  if (join && ws.unverified) {
    history.replaceState(null, '', location.pathname + location.search + '#/');
    setTimeout(() => toast('The invitation could not be opened because Puter did not answer. Open the link again in a moment.', { type: 'error', duration: 8000 }), 600);
  } else if (join) ws = await acceptInvite(kv, ws, join);
  app.workspaces = ws;

  const workerUrl = team.activeWorker(ws);
  const joined = ws.joined.find((j) => j.url === workerUrl);
  app.team = workerUrl ? { url: workerUrl, role: joined ? joined.role : 'owner', business: joined?.business || '' } : null;
  const store = createStore({
    backend: workerUrl ? team.createWorkerBackend(workerUrl) : createPuterBackend(globalThis.puter),
    cache: createIdbCache(`user:${user.uuid}${workerUrl ? `:team:${workerUrl}` : ''}`),
  });
  app.store = store;
  await store.init();
  setMoneyDefaults({ currency: store.state.settings.currency });
  store.subscribe((c) => c.has('settings') && setMoneyDefaults({ currency: store.state.settings.currency }));
  startApp();
  platform.fetchProfilePicture(user.username).then((url) => {
    if (url && url !== app.avatarUrl) {
      app.avatarUrl = url;
      shell?.updateAccount();
    }
  });
  // Pick up changes from other devices and colleagues when returning to the tab.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && store.sync());
  window.addEventListener('online', () => store.sync());
  setInterval(() => document.visibilityState === 'visible' && store.sync(), app.team ? 45000 : 120000);
  if (app.team?.role === 'owner') team.updateWorkerIfNeeded(ws.own);
  else if (joined)
    team.refreshJoined(kv, ws, workerUrl).then((next) => {
      const entry = next?.joined.find((j) => j.url === workerUrl);
      if (!entry || app.team?.url !== workerUrl) return;
      app.workspaces = next;
      app.team = { ...app.team, role: entry.role, business: entry.business };
    });
  // Every refused request reports the removal; act on it once at a time.
  let leaving = false;
  window.addEventListener('legal:removed', () => {
    if (leaving || !app.team || app.team.role === 'owner') return;
    leaving = true;
    toast('You no longer have access to this firm. Switching back to your own.', { type: 'error', duration: 8000 });
    setTimeout(
      () =>
        team.leaveWorkspace(app.team.url, { removed: true }).catch((err) => {
          console.warn('[legal] could not leave the firm', err);
          // The next refused request tries again.
          leaving = false;
          toast('Could not switch back to your own firm. Check your connection; it will be tried again.', { type: 'error', duration: 8000 });
        }),
      2500,
    );
  });
  if (!app.team || app.team.role === 'owner') import('./views/onboarding.js').then((m) => m.maybeOnboard());
}

/** Join a firm from an invitation link, then continue booting into it. */
async function acceptInvite(kv, ws, { url, token }) {
  history.replaceState(null, '', location.pathname + location.search + '#/');
  if (ws.own?.url === url) return { ...ws, current: 'own' };
  // Joining sends your Puter session to that firm's server, so ask first.
  // A firm already on the list is joined again without asking: the person
  // may have been removed and invited back since they last opened it.
  if (!ws.joined.some((j) => j.url === url)) {
    const host = new URL(url).hostname;
    const ok = await confirmDialog({
      title: 'Join a firm?',
      message: `You opened an invitation to a firm whose server is ${host}. While you work in that firm, its server acts with your Puter sign-in, so its owner could reach what this app keeps in your Puter account, including your own firm. What you add there is stored in their account. Only accept invitations from people you trust.`,
      confirmLabel: 'Join firm',
    });
    if (!ok) return ws;
  }
  try {
    const res = await team.call(url, 'join', { token });
    const entry = { url, business: res.business || 'Shared firm', role: res.role };
    const next = { ...ws, joined: [...ws.joined.filter((j) => j.url !== url), entry], current: url };
    await team.saveWorkspaces(kv, next);
    setTimeout(() => toast(res.already ? `You are already a member of ${entry.business}.` : `Welcome to ${entry.business}. You joined as ${res.role === 'admin' ? 'an admin' : 'a member'}.`), 600);
    return next;
  } catch (err) {
    // Already on the list (an old link opened again, or no connection): just open that firm.
    if (ws.joined.some((j) => j.url === url)) return { ...ws, current: url };
    setTimeout(() => toast(err.message || 'This invitation could not be used.', { type: 'error' }), 600);
    return ws;
  }
}

async function startDemo() {
  app.demo = true;
  const { buildSampleData } = await import('./core/sample.js');
  const store = createStore({ backend: createMemoryBackend(buildSampleData(today())) });
  app.store = store;
  await store.init();
  setMoneyDefaults({ currency: store.state.settings.currency });
  startApp();
}

let shell = null;
function startApp() {
  if (import.meta.env.DEV) globalThis.__legal = app; // debugging and browser tests
  shell = buildShell({ onSignIn: handleSignIn });
  mount(root, shell.root);
  startViews(shell.main);
}

function showWelcome(error) {
  const available = platform.puterAvailable();
  mount(
    root,
    h(
      'div.welcome',
      h(
        'main.welcome-main',
        h('div.welcome-brand', h('img', { src: './icons/icon.svg', alt: '' }), h('span', APP_NAME)),
        h('h1', 'Run your law practice from one place.'),
        h('p.lead', 'Matters, contacts, time tracking, billing, trust accounting, calendar, tasks, and documents in a fast, focused workspace. Free and open source.'),
        error ? h('div.notice.danger', { role: 'alert' }, icon('alert', 16), h('span', error)) : null,
        location.hash.startsWith('#/join') ? h('div.notice.info', icon('users', 16), h('span', 'You have been invited to join a firm. Sign in with Puter to accept the invitation.')) : null,
        !available
          ? h('div.notice.warning', { role: 'alert' }, icon('warning', 16), h('span', 'Puter could not be loaded, so signing in is unavailable right now. You can still explore the sample firm.'))
          : null,
        h(
          'div.cta',
          h('button.btn.primary.lg', { type: 'button', disabled: !available || null, onClick: handleSignIn }, icon('log-in', 18), 'Sign in'),
          h(
            'button.btn.lg',
            {
              type: 'button',
              onClick: async () => {
                loading('Loading the sample firm');
                await startDemo();
              },
            },
            'Explore a sample firm',
          ),
        ),
        h(
          'ul.welcome-points',
          [
            ['briefcase', 'Matters with stages, deadlines, related parties, and a full activity history'],
            ['timer', 'One-click timer and fast time entry in tenths of an hour'],
            ['receipt-text', 'Bills generated from unbilled work, with payments and aging'],
            ['vault', 'Trust ledgers per matter that can never be overdrawn'],
          ].map(([ic, text]) => h('li', icon(ic, 18), h('span', text))),
        ),
        h(
          'div.welcome-foot',
          h('a', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, icon('github', 16), 'Source on GitHub'),
          h('span', 'Your data is stored in your own Puter account.'),
        ),
      ),
      h('div.welcome-art', { 'aria-hidden': 'true', html: WELCOME_ART }),
    ),
  );
  document.title = APP_NAME;
}

// A stylized matter workspace drawn with theme tokens, so it adapts to light
// and dark mode.
const WELCOME_ART = `
<svg viewBox="0 0 520 420" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="518" height="418" rx="16" fill="var(--surface)" stroke="var(--border-strong)"/>
  <rect x="1" y="1" width="96" height="418" rx="16" fill="var(--rail-bg)"/>
  <rect x="80" y="1" width="17" height="418" fill="var(--rail-bg)"/>
  <rect x="20" y="24" width="28" height="28" rx="7" fill="var(--accent)"/>
  <g fill="var(--rail-text)" opacity=".55">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="20" y="${82 + i * 30}" width="${40 + ((i * 13) % 20)}" height="8" rx="4"/>`).join('')}</g>
  <rect x="14" y="134" width="68" height="22" rx="6" fill="var(--rail-active)"/>
  <rect x="120" y="26" width="170" height="14" rx="7" fill="var(--text)" opacity=".85"/>
  <rect x="120" y="50" width="110" height="10" rx="5" fill="var(--text-3)" opacity=".5"/>
  <rect x="404" y="22" width="94" height="30" rx="8" fill="var(--accent)"/>
  <rect x="420" y="33" width="62" height="8" rx="4" fill="var(--on-accent)"/>
  ${[0, 1, 2].map((i) => `<rect x="${120 + i * 128}" y="80" width="118" height="64" rx="10" fill="var(--surface-2)" stroke="var(--border)"/><rect x="${134 + i * 128}" y="94" width="50" height="7" rx="3.5" fill="var(--text-3)" opacity=".6"/><rect x="${134 + i * 128}" y="112" width="${70 - i * 10}" height="14" rx="5" fill="${['var(--accent)', 'var(--success)', 'var(--warning)'][i]}"/>`).join('')}
  <rect x="120" y="164" width="378" height="232" rx="10" fill="var(--surface)" stroke="var(--border)"/>
  <rect x="120" y="164" width="378" height="34" rx="10" fill="var(--surface-2)"/>
  ${[0, 1, 2, 3, 4].map((i) => `<line x1="120" y1="${232 + i * 36}" x2="498" y2="${232 + i * 36}" stroke="var(--border)"/><rect x="136" y="${210 + i * 36}" width="${90 + ((i * 37) % 60)}" height="8" rx="4" fill="var(--text-2)" opacity=".7"/><rect x="300" y="${210 + i * 36}" width="60" height="8" rx="4" fill="var(--text-3)" opacity=".45"/><rect x="432" y="${206 + i * 36}" width="50" height="16" rx="8" fill="${['var(--success-soft)', 'var(--warning-soft)', 'var(--accent-soft)', 'var(--success-soft)', 'var(--neutral-soft)'][i]}"/>`).join('')}
</svg>`;
