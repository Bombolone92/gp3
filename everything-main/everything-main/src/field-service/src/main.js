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
import { buildShell } from './ui/shell.js';
import { startViews } from './ui/viewhost.js';
import { showAlphaNotice } from './ui/alpha.js';
import { maybeOnboard } from './views/onboarding.js';

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
    // Guessing "your own business" here could open the wrong one.
    console.error('[field-service] could not read workspaces', err);
    showWelcome('We could not load your businesses from Puter. Check your connection and try again.');
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
  // In their own storage, an owner may have turned on team sign-in from
  // another device meanwhile: check along with every sync.
  const sync = () => (store.sync(), app.team || checkTeamTurnedOn(kv, store));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sync());
  window.addEventListener('online', sync);
  setInterval(() => document.visibilityState === 'visible' && sync(), app.team ? 45000 : 120000);
  if (app.team?.role === 'owner') team.updateWorkerIfNeeded(ws.own);
  // Roles change (the owner makes someone an admin): pick up the current one.
  if (joined) refreshMembership(kv, workerUrl);
  let removed = false;
  window.addEventListener('fieldservice:removed', () => {
    // Every request refused from here on reports it again; act once.
    if (!app.team || app.team.role === 'owner' || removed) return;
    removed = true;
    toast('You no longer have access to this business. Switching back to your own.', { type: 'error', duration: 8000 });
    setTimeout(() => team.leaveWorkspace(app.team.url), 2500);
  });
  if (!app.team || app.team.role === 'owner') maybeOnboard();
}

let switchingToTeam = false;
async function checkTeamTurnedOn(kv, store) {
  if (switchingToTeam) return;
  let ws;
  try {
    ws = await team.loadWorkspaces(kv);
  } catch {
    return;
  }
  if (!ws.own?.url || app.workspaces.own?.url) return;
  switchingToTeam = true;
  // Changes made here since then went to storage the team no longer reads.
  try {
    await team.carryOverToTeam(store, team.createWorkerBackend(ws.own.url), ws.own.enabledAt);
  } catch (err) {
    // Switching now would strand them in storage nobody reads; keep
    // working here and try again with the next sync.
    console.warn('[field-service] could not bring changes over to the team server', err);
    switchingToTeam = false;
    return;
  }
  toast('Team sign-in was turned on from another device. Switching over...', { type: 'info' });
  setTimeout(() => location.reload(), 1500);
}

async function refreshMembership(kv, url) {
  try {
    const me = await team.call(url, 'whoami');
    const cur = app.workspaces.joined.find((j) => j.url === url);
    if (!cur || !me?.role || (me.role === cur.role && (!me.business || me.business === cur.business))) return;
    const entry = { ...cur, role: me.role, business: me.business || cur.business };
    app.workspaces = { ...app.workspaces, joined: app.workspaces.joined.map((j) => (j.url === url ? entry : j)) };
    app.team = { ...app.team, role: entry.role, business: entry.business };
    await team.saveWorkspaces(kv, app.workspaces);
  } catch {
    // Offline, or removed (handled by the fieldservice:removed event).
  }
}

/** Join a business from an invitation link, then continue booting into it. */
async function acceptInvite(kv, ws, { url, token }) {
  history.replaceState(null, '', location.pathname + location.search + '#/');
  if (ws.own?.url === url) return { ...ws, current: 'own' };
  const known = ws.joined.find((j) => j.url === url);
  if (known) {
    // Already in the list: join anyway (no need to ask again). A current
    // member just gets their role back; someone removed since is let back
    // in by this new link instead of being bounced out.
    try {
      const res = await team.call(url, 'join', { token });
      const next = { ...ws, joined: ws.joined.map((j) => (j.url === url ? { ...j, role: res.role || j.role, business: res.business || j.business } : j)), current: url };
      await team.saveWorkspaces(kv, next);
      return next;
    } catch {
      return { ...ws, current: url };
    }
  }
  // Joining sends your Puter session to that business's server, so ask first.
  const host = new URL(url).hostname;
  const ok = await confirmDialog({
    title: 'Join a business?',
    message: `You opened an invitation to a business whose team server is ${host}. While you work in it, that server receives your Puter sign-in with every request, and what you add there is stored in its owner's account. Only accept invitations from people you know and trust.`,
    confirmLabel: 'Join business',
  });
  if (!ok) return ws;
  try {
    const res = await team.call(url, 'join', { token });
    const entry = { url, business: res.business || 'Team business', role: res.role };
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
  if (import.meta.env.DEV) globalThis.__fieldService = app; // debugging and browser tests
  shell = buildShell({ onSignIn: handleSignIn });
  mount(root, shell.root);
  startViews(shell.main);
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
    'Explore the demo',
  );
  mount(
    root,
    h(
      'div.welcome',
      h(
        'main.welcome-main',
        h('div.brand', h('img', { src: './icons/icon-192.png', alt: '' }), 'Field Service'),
        h('h1', 'Run your service business from one place.'),
        h(
          'p.lead',
          'Win work with clear quotes, schedule your crew, track every visit, and get paid faster. Free and open source.',
        ),
        error ? h('div.notice.danger', { role: 'alert' }, icon('alert'), h('span', error)) : null,
        location.hash.startsWith('#/join') ? h('div.notice.accent', icon('users'), h('span', 'You have been invited to join a business. Sign in with Puter to accept the invitation.')) : null,
        !available ? h('div.notice.warning', { role: 'alert' }, icon('warning'), h('span', 'Puter could not be loaded, so signing in is unavailable right now. You can still explore the demo.')) : null,
        h('div.cta', signInBtn, demoBtn),
        h(
          'ul.welcome-points',
          [
            ['users', 'Clients, properties, and full work history in one profile'],
            ['file-pen', 'Quotes with optional items, deposits, and one-click conversion to jobs'],
            ['calendar-days', 'Drag-and-drop schedule for one-off and recurring visits'],
            ['receipt-text', 'Invoices, payments, and reports that show what you are owed'],
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
  document.title = 'Field Service';
}

// Illustration: a simplified week schedule with visit blocks. Uses theme
// tokens so it adapts to light and dark mode.
const WELCOME_ART = `
<svg viewBox="0 0 520 420" xmlns="http://www.w3.org/2000/svg" role="presentation">
  <rect x="1" y="1" width="518" height="418" rx="18" fill="var(--surface)" stroke="var(--border-strong)"/>
  <rect x="24" y="24" width="140" height="14" rx="7" fill="var(--text)" opacity=".85"/>
  <rect x="24" y="48" width="90" height="10" rx="5" fill="var(--text-3)" opacity=".5"/>
  <rect x="396" y="22" width="100" height="32" rx="8" fill="var(--accent)"/>
  <rect x="414" y="34" width="64" height="8" rx="4" fill="var(--on-accent)"/>
  <g fill="var(--text-3)" opacity=".55">
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="${70 + i * 88}" y="84" width="40" height="8" rx="4"/>`).join('')}
  </g>
  <g stroke="var(--border)">
    ${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="${60 + i * 88}" y1="104" x2="${60 + i * 88}" y2="396"/>`).join('')}
    ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<line x1="24" y1="${104 + i * 48}" x2="496" y2="${104 + i * 48}"/>`).join('')}
  </g>
  <g>
    <rect x="66" y="112" width="76" height="62" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <rect x="74" y="122" width="46" height="7" rx="3.5" fill="var(--accent-text)"/>
    <rect x="74" y="136" width="56" height="6" rx="3" fill="var(--accent-text)" opacity=".5"/>
    <rect x="154" y="160" width="76" height="86" rx="8" fill="var(--success-soft)" stroke="var(--success)"/>
    <rect x="162" y="170" width="50" height="7" rx="3.5" fill="var(--success)"/>
    <rect x="162" y="184" width="40" height="6" rx="3" fill="var(--success)" opacity=".5"/>
    <rect x="242" y="112" width="76" height="110" rx="8" fill="var(--warning-soft)" stroke="var(--warning)"/>
    <rect x="250" y="122" width="44" height="7" rx="3.5" fill="var(--warning)"/>
    <rect x="250" y="136" width="56" height="6" rx="3" fill="var(--warning)" opacity=".5"/>
    <rect x="330" y="208" width="76" height="62" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <rect x="338" y="218" width="52" height="7" rx="3.5" fill="var(--accent-text)"/>
    <rect x="418" y="136" width="72" height="62" rx="8" fill="var(--info-soft)" stroke="var(--info)"/>
    <rect x="426" y="146" width="40" height="7" rx="3.5" fill="var(--info)"/>
    <rect x="66" y="256" width="76" height="86" rx="8" fill="var(--info-soft)" stroke="var(--info)"/>
    <rect x="74" y="266" width="50" height="7" rx="3.5" fill="var(--info)"/>
    <rect x="242" y="280" width="76" height="62" rx="8" fill="var(--success-soft)" stroke="var(--success)"/>
    <rect x="250" y="290" width="44" height="7" rx="3.5" fill="var(--success)"/>
    <rect x="418" y="300" width="72" height="62" rx="8" fill="var(--warning-soft)" stroke="var(--warning)"/>
    <rect x="426" y="310" width="48" height="7" rx="3.5" fill="var(--warning)"/>
  </g>
  <line x1="24" y1="232" x2="496" y2="232" stroke="var(--danger)" stroke-width="2"/>
  <circle cx="24" cy="232" r="5" fill="var(--danger)"/>
</svg>`;
