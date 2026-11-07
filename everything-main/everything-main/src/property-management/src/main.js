import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/views.css';
import './styles/rentals.css';
import './styles/leases.css';
import './styles/leasing.css';
import './styles/accounting.css';
import './styles/maintenance.css';
import './styles/workspace.css';
import './styles/reports.css';
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
import { buildShell } from './ui/shell.js';
import { startViews } from './ui/viewhost.js';
import { showAlphaNotice } from './ui/alpha.js';
import { maybeOnboard } from './views/onboarding.js';
import { startBookkeeping as startPosting } from './bookkeeping.js';

const REPO_URL = 'https://github.com/heyputer/everything';
const root = document.getElementById('app');

initTheme();
boot();

// Offline app shell (production builds only; dev reloads must stay fresh).
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

async function boot() {
  mount(root, h('div.boot', { role: 'status', 'aria-label': 'Loading' }, h('img', { src: './icons/icon-192.png', alt: '' })));
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

  // Which business: the person's own, or one they joined as a team member.
  const kv = globalThis.puter.kv;
  let ws;
  try {
    ws = await team.loadWorkspaces(kv);
  } catch (err) {
    console.error('[property-management] could not read workspaces', err);
    showWelcome('We could not load your companies from your Puter account. Check your connection and try again.');
    return;
  }
  const join = location.hash.startsWith('#/join') ? team.parseJoin(Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''))) : null;
  if (join) ws = await acceptInvite(kv, ws, join);
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
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && store.sync());
  window.addEventListener('online', () => store.sync());
  setInterval(() => document.visibilityState === 'visible' && store.sync(), app.team ? 45000 : 120000);
  if (app.team?.role === 'owner') team.updateWorkerIfNeeded(ws.own);
  window.addEventListener('propertymgmt:removed', () => {
    if (!app.team || app.team.role === 'owner') return;
    toast('You no longer have access to this company. Switching back to your own.', { type: 'error', duration: 8000 });
    setTimeout(() => team.leaveWorkspace(app.team.url), 2500);
  });
  if (!app.team || app.team.role === 'owner') maybeOnboard();
  // A member's role and the company name are saved when they join; pick up
  // any change the owner made since.
  if (joined) {
    team.refreshMembership(kv, ws, workerUrl).then((entry) => {
      if (entry && app.team?.url === workerUrl) Object.assign(app.team, { role: entry.role, business: entry.business });
    });
  }
}

/** Join a business from an invitation link, then continue booting into it. */
async function acceptInvite(kv, ws, { url, token }) {
  history.replaceState(null, '', location.pathname + location.search + '#/');
  if (ws.own?.url === url) return { ...ws, current: 'own' };
  // A company already joined still gets the invitation (a member who was
  // removed and invited back); joining again is harmless for a member.
  if (!ws.joined.some((j) => j.url === url)) {
    // Joining sends your Puter session to that business's server, so ask first.
    const host = new URL(url).hostname;
    const ok = await confirmDialog({
      title: 'Join a company?',
      message: `You opened an invitation to a company whose team server is ${host}. Its owner will see your Puter username, and what you add there is stored in their account. While you work in it, their server acts with your Puter session, so a dishonest owner could use it to read this app's data in your own account or use up your Puter allowance. Only accept invitations from people you trust.`,
      confirmLabel: 'Join company',
    });
    if (!ok) return ws;
  }
  try {
    const res = await team.call(url, 'join', { token });
    const entry = { url, business: res.business || 'Team company', role: res.role };
    const joined = [...ws.joined.filter((j) => j.url !== url), entry];
    const next = { ...ws, joined, current: url };
    await team.saveWorkspaces(kv, next);
    setTimeout(() => toast(res.already ? `You are already a member of ${entry.business}.` : `Welcome to ${entry.business}. You joined as ${res.role === 'admin' ? 'an admin' : 'a team member'}.`), 600);
    return next;
  } catch (err) {
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
  startApp();
}

let shell = null;
function startApp() {
  if (import.meta.env.DEV) globalThis.__propertyMgmt = app; // debugging and browser tests
  shell = buildShell({ onSignIn: handleSignIn });
  mount(root, shell.root);
  startViews(shell.main);
  startBookkeeping();
}

function startBookkeeping() {
  startPosting(app.store, {
    today: () => app.today(),
    onPosted: (n) => app.demo || toast(`Posted ${n} recurring ${n === 1 ? 'charge' : 'charges'} that came due.`),
  });
}

function showWelcome(error) {
  const available = platform.puterAvailable();
  const signInBtn = h(
    'button.btn.primary.lg',
    { type: 'button', disabled: !available || null, onClick: handleSignIn },
    icon('log-in', 18),
    'Sign in',
  );
  const demoBtn = h(
    'button.btn.lg',
    {
      type: 'button',
      onClick: async () => {
        mount(root, h('div.boot', { role: 'status', 'aria-label': 'Loading demo' }, h('img', { src: './icons/icon-192.png', alt: '' })));
        await startDemo();
      },
    },
    'Explore a sample portfolio',
  );
  mount(
    root,
    h(
      'div.welcome',
      h(
        'main.welcome-main',
        h('div.brand', h('img', { src: './icons/icon-192.png', alt: '' }), 'Property Management'),
        h('h1', 'Every property, lease and dollar in one place.'),
        h('p.lead', 'Collect rent, track leases and renewals, handle maintenance, pay bills, and keep owner-ready books. Free and open source.'),
        error ? h('div.notice.danger', { role: 'alert' }, icon('alert'), h('span', error)) : null,
        location.hash.startsWith('#/join') ? h('div.notice.accent', icon('users'), h('span', 'You have been invited to join a company. Sign in with Puter to accept the invitation.')) : null,
        !available ? h('div.notice.warning', { role: 'alert' }, icon('warning'), h('span', 'Puter could not be loaded, so signing in is unavailable right now. You can still explore the sample portfolio.')) : null,
        h('div.cta', signInBtn, demoBtn),
        h(
          'ul.welcome-points',
          [
            ['building', 'Properties, units, tenants and owners, with full history'],
            ['hand-coins', 'Rent roll, automatic monthly charges, late fees and receipts'],
            ['landmark', 'Double-entry accounting: bills, banking, owner statements'],
            ['wrench', 'Work orders, vendors, inspections and resident requests'],
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
  document.title = 'Property Management';
}

// Illustration: a simplified rent roll beside a building. Uses theme tokens
// so it adapts to light and dark mode.
const WELCOME_ART = `
<svg viewBox="0 0 520 420" xmlns="http://www.w3.org/2000/svg" role="presentation">
  <rect x="1" y="1" width="518" height="418" rx="16" fill="var(--surface)" stroke="var(--border-strong)"/>
  <rect x="24" y="24" width="150" height="14" rx="7" fill="var(--text)" opacity=".85"/>
  <rect x="24" y="48" width="96" height="10" rx="5" fill="var(--text-3)" opacity=".5"/>
  <rect x="380" y="22" width="116" height="32" rx="8" fill="var(--accent)"/>
  <rect x="398" y="34" width="80" height="8" rx="4" fill="var(--on-accent)"/>
  <g>
    <rect x="24" y="78" width="148" height="70" rx="10" fill="var(--surface-2)" stroke="var(--border)"/>
    <rect x="38" y="92" width="60" height="8" rx="4" fill="var(--text-3)" opacity=".6"/>
    <rect x="38" y="112" width="96" height="16" rx="5" fill="var(--text)" opacity=".85"/>
    <rect x="186" y="78" width="148" height="70" rx="10" fill="var(--surface-2)" stroke="var(--border)"/>
    <rect x="200" y="92" width="70" height="8" rx="4" fill="var(--text-3)" opacity=".6"/>
    <rect x="200" y="112" width="70" height="16" rx="5" fill="var(--success)"/>
    <rect x="348" y="78" width="148" height="70" rx="10" fill="var(--surface-2)" stroke="var(--border)"/>
    <rect x="362" y="92" width="54" height="8" rx="4" fill="var(--text-3)" opacity=".6"/>
    <rect x="362" y="112" width="84" height="16" rx="5" fill="var(--danger)" opacity=".85"/>
  </g>
  <g>
    <line x1="24" y1="176" x2="496" y2="176" stroke="var(--border)"/>
    ${[0, 1, 2, 3, 4].map((i) => `
    <g transform="translate(0 ${190 + i * 44})">
      <rect x="24" y="4" width="28" height="28" rx="7" fill="var(--accent-soft)" stroke="var(--accent)"/>
      <rect x="64" y="8" width="${120 + ((i * 37) % 60)}" height="9" rx="4.5" fill="var(--text)" opacity=".8"/>
      <rect x="64" y="23" width="${70 + ((i * 23) % 40)}" height="7" rx="3.5" fill="var(--text-3)" opacity=".5"/>
      <rect x="300" y="10" width="${i === 2 ? 74 : 58}" height="18" rx="9" fill="${i === 2 ? 'var(--warning-soft)' : 'var(--success-soft)'}"/>
      <rect x="310" y="16" width="${i === 2 ? 54 : 38}" height="6" rx="3" fill="${i === 2 ? 'var(--warning)' : 'var(--success)'}"/>
      <rect x="420" y="12" width="76" height="10" rx="5" fill="var(--text)" opacity=".75"/>
      <line x1="24" y1="40" x2="496" y2="40" stroke="var(--border)"/>
    </g>`).join('')}
  </g>
</svg>`;
