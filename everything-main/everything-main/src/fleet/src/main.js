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
import { app, reloadApp } from './app.js';
import { createStore } from './core/store.js';
import { createMemoryBackend, createPuterBackend } from './core/backend.js';
import { bucketOf } from './core/schema.js';
import { createIdbCache } from './core/cache.js';
import { setMoneyDefaults } from './core/money.js';
import { today } from './core/dates.js';
import * as platform from './platform.js';
import * as team from './team.js';
import { buildShell, REPO_URL } from './ui/shell.js';
import { startViews } from './ui/viewhost.js';
import { showAlphaNotice } from './ui/alpha.js';

const root = document.getElementById('app');

initTheme();
boot();

// Offline app shell (production builds only; dev reloads must stay fresh).
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

function loading(label = 'Loading') {
  mount(root, h('div.boot', { role: 'status', 'aria-label': label }, h('img', { src: './icons/icon-192.png', alt: '' })));
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
    if (!location.hash.startsWith('#/join')) location.hash = '';
    reloadApp();
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
    keepUser(user);
  } catch (err) {
    // Offline (not signed out): open the fleet kept on this device for
    // whoever used it last.
    const offline = navigator.onLine === false || err instanceof TypeError;
    user = offline ? localUser() : null;
    if (!user) {
      console.error(err);
      showWelcome('We could not reach your Puter account. Check your connection and try again.');
      return;
    }
  }
  app.user = { username: user.username, uuid: user.uuid };
  app.avatarUrl = platform.cachedProfilePicture(user.username);

  // Which fleet: the person's own, or one they joined as a team member.
  const kv = globalThis.puter.kv;
  let ws;
  try {
    ws = await team.loadWorkspaces(kv);
  } catch (err) {
    // Guessing "your own fleet" here could open the wrong one.
    console.error('[fleet] could not read workspaces', err);
    showWelcome('We could not load your fleets from Puter. Check your connection and try again.');
    return;
  }
  const join = location.hash.startsWith('#/join') ? team.parseJoin(Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''))) : null;
  if (join) ws = await acceptInvite(kv, ws, join);
  else if (location.hash.startsWith('#/join')) history.replaceState(null, '', location.pathname + location.search + '#/');
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
  // Pick up changes from other devices and teammates when coming back to the tab.
  // In their own storage, an owner may have turned on team access from
  // another device meanwhile: check along with every sync.
  const sync = () => {
    store.sync();
    if (!app.team) {
      team.checkTeamTurnedOn(kv, store).then((on) => {
        if (!on) return;
        toast('Team access was turned on from another device. Switching over...', { type: 'info' });
        setTimeout(reloadApp, 1500);
      });
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') return sync();
    // A phone may freeze or discard a hidden page before the cache timer
    // runs: keep unsent changes on the device now, and try to send them.
    store.persistCache();
    if (store.pendingCount() && store.state.online) store.flush();
  });
  window.addEventListener('online', sync);
  setInterval(() => document.visibilityState === 'visible' && sync(), app.team ? 45000 : 120000);
  if (app.team?.role === 'owner') team.updateWorkerIfNeeded(ws.own);
  // Roles change (the owner makes someone an admin): pick up the current
  // one, and start again so every screen shows what the new role allows.
  if (joined) team.refreshMembership(kv, workerUrl).then((changed) => changed && reloadApp());
  let removed = false;
  window.addEventListener('fleet:removed', () => {
    // Every refused request reports it; say so and switch back only once.
    if (!app.team || app.team.role === 'owner' || removed) return;
    removed = true;
    toast('You no longer have access to this fleet. Switching back to your own.', { type: 'error', duration: 8000 });
    setTimeout(() => team.leaveWorkspace(app.team.url), 2500);
  });
  if (!app.team || app.team.role === 'owner') import('./views/onboarding.js').then((m) => m.maybeOnboard());
}

// Who signed in last on this device, for opening offline.
const USER_KEY = 'fleet.user';
function keepUser(user) {
  try {
    if (user?.uuid) localStorage.setItem(USER_KEY, JSON.stringify({ username: user.username, uuid: user.uuid }));
  } catch {}
}
function localUser() {
  try {
    const u = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    return u?.uuid ? u : null;
  } catch {
    return null;
  }
}

/** Join a fleet from an invitation link, then continue booting into it. */
async function acceptInvite(kv, ws, { url, token }) {
  history.replaceState(null, '', location.pathname + location.search + '#/');
  if (ws.own?.url === url) return { ...ws, current: 'own' };
  if (ws.joined.some((j) => j.url === url)) {
    // Already in the list: use the link anyway (no need to ask again). A
    // current member just gets their role back; someone removed since is
    // let back in by this new link instead of being bounced out.
    try {
      const res = await team.call(url, 'join', { token });
      const next = { ...ws, joined: ws.joined.map((j) => (j.url === url ? { ...j, role: res.role || j.role, business: res.business || j.business } : j)), current: url };
      await team.saveWorkspaces(kv, next);
      return next;
    } catch {
      return { ...ws, current: url };
    }
  }
  // Joining sends your Puter session to that fleet's server, so ask first.
  const host = new URL(url).hostname;
  const ok = await confirmDialog({
    title: 'Join a fleet?',
    message: `You opened an invitation to a fleet whose team server is ${host}. Joining lets its owner see your Puter username, and what you add there is stored in their account. Only accept invitations from people you know.`,
    confirmLabel: 'Join fleet',
  });
  if (!ok) return ws;
  try {
    const res = await team.call(url, 'join', { token });
    const entry = { url, business: res.business || 'Shared fleet', role: res.role };
    const joined = [...ws.joined.filter((j) => j.url !== url), entry];
    const next = { ...ws, joined, current: url };
    await team.saveWorkspaces(kv, next);
    const as = res.role === 'admin' ? 'an admin' : res.role === 'driver' ? 'a driver' : 'a member';
    setTimeout(() => toast(res.already ? `You are already a member of ${entry.business}.` : `Welcome to ${entry.business}. You joined as ${as}.`), 600);
    return next;
  } catch (err) {
    setTimeout(() => toast(err.message || 'This invitation could not be used.', { type: 'error' }), 600);
    return ws;
  }
}

async function startDemo() {
  app.demo = true;
  const { buildSampleData } = await import('./core/sample.js');
  const store = createStore({ backend: createMemoryBackend(buildSampleData(today()), { bucketOf }) });
  app.store = store;
  await store.init();
  startApp();
}

let shell = null;
function startApp() {
  if (import.meta.env.DEV) globalThis.__fleet = app; // debugging and browser tests
  shell = buildShell({ onSignIn: handleSignIn });
  mount(root, shell.root);
  startViews(shell.main);
}

function showWelcome(error) {
  const available = platform.puterAvailable();
  const signInBtn = h('button.btn.primary.lg', { type: 'button', disabled: !available || null, onClick: handleSignIn }, icon('log-in', 18), 'Sign in');
  const demoBtn = h(
    'button.btn.lg',
    {
      type: 'button',
      onClick: async () => {
        loading('Loading the sample fleet');
        await startDemo();
      },
    },
    'Explore a sample fleet',
  );
  mount(
    root,
    h(
      'div.welcome',
      h(
        'main.welcome-main',
        h('div.brand', h('img', { src: './icons/icon-192.png', alt: '' }), 'Fleet'),
        h('h1', 'Keep every vehicle on the road.'),
        h('p.lead', 'Track vehicles, inspections, issues, maintenance, fuel, and costs for your whole fleet in one place. Free and open source.'),
        error ? h('div.notice.danger', { role: 'alert' }, icon('alert'), h('span', error)) : null,
        location.hash.startsWith('#/join') ? h('div.notice.accent', icon('users'), h('span', 'You have been invited to join a fleet. Sign in with Puter to accept the invitation.')) : null,
        !available ? h('div.notice.warning', { role: 'alert' }, icon('warning'), h('span', 'Puter could not be loaded, so signing in is unavailable right now. You can still explore the sample fleet.')) : null,
        h('div.cta', signInBtn, demoBtn),
        h(
          'ul.welcome-points',
          [
            ['clipboard-check', 'Mobile inspections that open issues for anything that fails'],
            ['bell', 'Service and renewal reminders by date, mileage, or hours'],
            ['wrench', 'Work orders, service history, parts, and inventory'],
            ['fuel', 'Fuel economy, cost per mile, and total cost of ownership'],
          ].map(([ic, text]) => h('li', icon(ic), h('span', text))),
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
  document.title = 'Fleet';
}

// Illustration: a simplified dashboard with a cost chart and reminder rows.
// Uses theme tokens so it adapts to light and dark mode.
const WELCOME_ART = `
<svg viewBox="0 0 520 420" xmlns="http://www.w3.org/2000/svg" role="presentation">
  <rect x="1" y="1" width="518" height="418" rx="16" fill="var(--surface)" stroke="var(--border-strong)"/>
  <rect x="1" y="1" width="96" height="418" rx="16" fill="var(--nav-bg)"/>
  <rect x="80" y="1" width="17" height="418" fill="var(--nav-bg)"/>
  <rect x="18" y="22" width="28" height="28" rx="7" fill="var(--nav-accent)"/>
  <g fill="var(--nav-text)" opacity=".55">
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="18" y="${78 + i * 30}" width="${i === 1 ? 62 : 52}" height="8" rx="4"/>`).join('')}
  </g>
  <rect x="12" y="102" width="74" height="22" rx="6" fill="var(--nav-active)"/>
  <rect x="120" y="26" width="150" height="14" rx="7" fill="var(--text)" opacity=".85"/>
  <g>
    ${[0, 1, 2].map((i) => `<rect x="${120 + i * 128}" y="60" width="116" height="66" rx="10" fill="var(--surface-2)" stroke="var(--border)"/>
    <rect x="${134 + i * 128}" y="74" width="54" height="7" rx="3.5" fill="var(--text-3)" opacity=".6"/>
    <rect x="${134 + i * 128}" y="92" width="${[36, 48, 30][i]}" height="16" rx="5" fill="${['var(--danger)', 'var(--warning)', 'var(--success)'][i]}"/>`).join('')}
  </g>
  <rect x="120" y="144" width="372" height="132" rx="10" fill="var(--surface-2)" stroke="var(--border)"/>
  <g stroke="var(--grid)">${[0, 1, 2, 3].map((i) => `<line x1="136" y1="${172 + i * 26}" x2="476" y2="${172 + i * 26}"/>`).join('')}</g>
  <g>
    ${[60, 74, 52, 88, 70, 96].map((v, i) => `<rect x="${150 + i * 54}" y="${250 - v}" width="18" height="${v}" rx="3" fill="var(--series-1)"/><rect x="${170 + i * 54}" y="${250 - v * 0.55}" width="18" height="${v * 0.55}" rx="3" fill="var(--series-2)"/>`).join('')}
  </g>
  ${[0, 1, 2].map((i) => `<rect x="120" y="${294 + i * 40}" width="372" height="32" rx="8" fill="var(--surface)" stroke="var(--border)"/>
  <circle cx="138" cy="${310 + i * 40}" r="5" fill="${['var(--danger)', 'var(--warning)', 'var(--info)'][i]}"/>
  <rect x="152" y="${306 + i * 40}" width="${[150, 120, 170][i]}" height="8" rx="4" fill="var(--text-2)" opacity=".7"/>
  <rect x="420" y="${306 + i * 40}" width="56" height="8" rx="4" fill="var(--text-3)" opacity=".5"/>`).join('')}
</svg>`;
