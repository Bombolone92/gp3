import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/views.css';
import './styles/chart.css';
import './styles/print.css';

import { h, mount } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { initTheme } from './ui/theme.js';
import { toast } from './ui/toast.js';
import { confirmDialog } from './ui/dialog.js';
import { app, restoreKioskLock } from './app.js';
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

const REPO_URL = 'https://github.com/heyputer/everything';
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
  const q = new URLSearchParams(location.search);
  if (await platform.isSignedIn()) {
    await startSignedIn();
  } else if (q.has('demo')) {
    await startDemo(q.get('demo') === 'family' ? 'family' : 'director');
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
    if (location.search) location.search = '';
    else location.reload();
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
    platform.rememberUser(user);
  } catch (err) {
    console.error(err);
    // Offline: carry on from this device's copy, if this is the same session.
    // Puter answering that the session is not valid (401, 403) is not offline.
    const refused = [401, 403].includes(Number(err?.status));
    user = refused ? null : await platform.lastUser();
    if (!user) {
      showWelcome('We could not reach your Puter account. Check your connection and try again.');
      return;
    }
  }
  app.user = { username: user.username, uuid: user.uuid };
  app.avatarUrl = platform.cachedProfilePicture(user.username);

  // Which school: the person's own, or one they joined as staff or family.
  const kv = globalThis.puter.kv;
  let ws = { current: 'own', own: {}, joined: [] };
  try {
    ws = await team.loadWorkspaces(kv);
    platform.rememberWorkspaces(user.uuid, ws);
  } catch (err) {
    console.warn('[childcare] could not read workspaces', err);
    // Not the person's own empty school: the list they had last time.
    const last = platform.cachedWorkspaces(user.uuid);
    if (last) {
      const trusted = (o) => o && team.isTrustedWorkerUrl(o.url);
      ws = { current: typeof last.current === 'string' ? last.current : 'own', own: trusted(last.own) ? last.own : {}, joined: Array.isArray(last.joined) ? last.joined.filter(trusted) : [] };
    }
  }
  const join = location.hash.startsWith('#/join') ? team.parseJoin(Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''))) : null;
  if (join) ws = await acceptInvite(kv, ws, join);
  app.workspaces = ws;

  const workerUrl = team.activeWorker(ws);
  const joined = ws.joined.find((j) => j.url === workerUrl);
  app.team = workerUrl ? { url: workerUrl, role: joined ? joined.role : 'owner', school: joined?.school || '' } : null;
  let accessChanged = false;
  if (joined) {
    // Who am I at this school: which family or staff profile.
    try {
      accessChanged = await refreshMe(kv, workerUrl);
    } catch (err) {
      if (err.code === 'not_a_member') {
        toast('You no longer have access to that school. Switching back to your own.', { type: 'error', duration: 8000 });
        await team.leaveWorkspace(workerUrl);
        return;
      }
      // Offline: carry on with what the cache knows.
      app.me = joined.me || app.me;
    }
  }
  const store = createStore({
    backend: workerUrl ? team.createWorkerBackend(workerUrl) : createPuterBackend(globalThis.puter),
    cache: createIdbCache(`user:${user.uuid}${workerUrl ? `:team:${workerUrl}` : ''}`),
  });
  app.store = store;
  await store.init();
  // What this person may see changed (a child linked or unlinked, a new
  // role): versions alone would not reveal it, so read everything again.
  if (accessChanged) store.sync({ force: true });
  setMoneyDefaults({ currency: store.state.settings.currency });
  store.subscribe((c) => c.has('settings') && setMoneyDefaults({ currency: store.state.settings.currency }));
  // A tablet left in kiosk mode opens as the kiosk, whatever the address.
  if (restoreKioskLock()) history.replaceState(null, '', `${location.pathname}${location.search}#/kiosk`);
  startApp();
  platform.fetchProfilePicture(user.username).then((url) => {
    if (url && url !== app.avatarUrl) {
      app.avatarUrl = url;
      shell?.updateAccount();
    }
  });
  // Pick up changes from other devices, staff, and families when coming back to the tab.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (joined && (await refreshMe(kv, workerUrl).catch(() => false))) store.sync({ force: true });
    else store.sync();
  });
  window.addEventListener('online', () => store.sync());
  // Hiding the page may be the last chance before the browser freezes or
  // closes it: send unsaved changes and keep them in the offline cache now.
  const hidden = () => {
    store.persist();
    if (store.pendingCount()) store.flush();
  };
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && hidden());
  window.addEventListener('pagehide', hidden);
  setInterval(() => document.visibilityState === 'visible' && store.sync(), app.team ? 30000 : 120000);
  if (app.team?.role === 'owner') team.updateWorkerIfNeeded(ws.own);
  window.addEventListener('childcare:removed', () => {
    if (!app.team || app.team.role === 'owner') return;
    toast('You no longer have access to this school. Switching back to your own.', { type: 'error', duration: 8000 });
    setTimeout(() => team.leaveWorkspace(app.team.url), 2500);
  });
  if (!app.kioskLock && (!app.team || app.team.role === 'owner')) import('./views/onboarding.js').then((m) => m.maybeOnboard());
}

/**
 * Ask the school server who this person is there (role, family or staff
 * profile, children) and remember it for offline starts. Resolves true when
 * it differs from what was known before.
 */
async function refreshMe(kv, url) {
  const me = await team.call(url, 'whoami');
  const ws = app.workspaces || (await team.loadWorkspaces(kv));
  const entry = ws.joined.find((j) => j.url === url) || {};
  const next = { guardianId: me.guardianId || null, staffId: me.staffId || null, studentIds: me.studentIds || null };
  const before = JSON.stringify({ role: entry.role, me: entry.me || null });
  const after = JSON.stringify({ role: me.role, me: next });
  app.team.role = me.role || app.team.role;
  app.me = next;
  if (before !== after || me.school !== entry.school) {
    const updated = { ...ws, joined: ws.joined.map((j) => (j.url === url ? { ...j, role: me.role, school: me.school || j.school, me: next } : j)) };
    app.workspaces = updated;
    team.saveWorkspaces(kv, updated).catch(() => {});
  }
  return Boolean(entry.me) && before !== after;
}

/** Join a school from an invitation link, then continue booting into it. */
async function acceptInvite(kv, ws, { url, token }) {
  history.replaceState(null, '', location.pathname + location.search + '#/');
  if (ws.own?.url === url) return { ...ws, current: 'own' };
  // A school already in the list still gets the new token: it is how a
  // member who was removed comes back.
  const listed = ws.joined.some((j) => j.url === url);
  if (!listed) {
    // Joining sends your Puter session to that school's server, so ask first.
    const host = new URL(url).hostname;
    const ok = await confirmDialog({
      title: 'Join a school?',
      message: `You opened an invitation from a school whose server is ${host}. Joining lets the school see your Puter username, and what you add there is stored in the school's account. Only accept invitations you were expecting.`,
      confirmLabel: 'Join school',
    });
    if (!ok) return ws;
  }
  try {
    const res = await team.call(url, 'join', { token });
    const entry = { url, school: res.school || 'School', role: res.role };
    const joined = [...ws.joined.filter((j) => j.url !== url), entry];
    const next = { ...ws, joined, current: url };
    await team.saveWorkspaces(kv, next);
    const as = res.role === 'parent' ? 'a family member' : res.role === 'admin' ? 'an admin' : 'staff';
    setTimeout(() => toast(res.already ? `You are already a member of ${entry.school}.` : `Welcome to ${entry.school}. You joined as ${as}.`), 600);
    return next;
  } catch (err) {
    if (listed) return { ...ws, current: url }; // still a member: just open it
    setTimeout(() => toast(err.message || 'This invitation could not be used.', { type: 'error' }), 600);
    return ws;
  }
}

async function startDemo(as = 'director') {
  app.demo = true;
  app.demoRole = as;
  const [{ buildSampleData }, files] = await Promise.all([import('./core/sample.js'), import('./files.js')]);
  const sample = buildSampleData(today());
  for (const f of sample.files) files.putDemoFile(f.path, new Blob([f.svg], { type: 'image/svg+xml' }));
  if (as === 'family') app.me = { guardianId: sample.demoFamily.guardianId, staffId: null, studentIds: sample.demoFamily.studentIds };
  else app.me = { guardianId: null, staffId: 'staff-1', studentIds: null };
  const store = createStore({ backend: createMemoryBackend({ settings: sample.settings, collections: sample.collections }) });
  app.store = store;
  await store.init();
  startApp();
}

let shell = null;
function startApp() {
  if (import.meta.env.DEV) globalThis.__childcare = app; // debugging and browser tests
  shell = buildShell({ onSignIn: handleSignIn });
  mount(root, shell.root);
  startViews(shell.main);
}

function showWelcome(error) {
  const available = platform.puterAvailable();
  const demo = (as) => async () => {
    loading('Loading demo');
    history.replaceState(null, '', `?demo=${as === 'family' ? 'family' : '1'}${location.hash}`);
    await startDemo(as);
  };
  mount(
    root,
    h(
      'div.welcome',
      h(
        'main.welcome-main',
        h('div.brand', h('img', { src: './icons/icon-192.png', alt: '' }), 'Childcare'),
        h('h1', 'Everything your center does in a day, in one calm place.'),
        h('p.lead', 'Check children in and out, log meals, naps, and photos, keep families in the loop, and get tuition paid. Free and open source.'),
        error ? h('div.notice.danger', { role: 'alert' }, icon('alert'), h('span', error)) : null,
        location.hash.startsWith('#/join') ? h('div.notice.accent', icon('users'), h('span', 'You have been invited to a school. Sign in with Puter to accept the invitation.')) : null,
        !available ? h('div.notice.warning', { role: 'alert' }, icon('warning'), h('span', 'Puter could not be loaded, so signing in is unavailable right now. You can still explore the demo.')) : null,
        h(
          'div.cta',
          h('button.btn.primary.lg', { type: 'button', disabled: !available || null, onClick: handleSignIn }, icon('log-in', 18), 'Sign in'),
          h('button.btn.lg', { type: 'button', onClick: demo('director') }, 'Explore the demo'),
        ),
        h('p.welcome-alt', 'Or ', h('button.link-btn', { type: 'button', onClick: demo('family') }, 'preview the family app'), ' to see what parents see.'),
        h(
          'ul.welcome-points',
          [
            ['user-check', 'Fast check-in and out, live room ratios, and a tablet kiosk for families'],
            ['camera', 'Meals, naps, diapers, photos, and learning notes logged for a whole room at once'],
            ['messages', 'Daily reports and two-way messages that families actually read'],
            ['receipt', 'Tuition plans, statements, payments, and balances at a glance'],
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
  document.title = 'Childcare';
}

// Illustration: a classroom day at a glance. Uses theme tokens so it adapts
// to light and dark mode.
const WELCOME_ART = `
<svg viewBox="0 0 520 440" xmlns="http://www.w3.org/2000/svg" role="presentation">
  <rect x="1" y="1" width="518" height="438" rx="18" fill="var(--surface)" stroke="var(--border-strong)"/>
  <rect x="24" y="24" width="150" height="14" rx="7" fill="var(--text)" opacity=".85"/>
  <rect x="24" y="48" width="96" height="10" rx="5" fill="var(--text-3)" opacity=".5"/>
  <rect x="380" y="22" width="116" height="34" rx="8" fill="var(--accent)"/>
  <rect x="398" y="35" width="80" height="8" rx="4" fill="var(--on-accent)"/>
  ${[0, 1, 2, 3].map((i) => `
  <g transform="translate(${24 + i * 120} 80)">
    <rect width="108" height="62" rx="10" fill="var(--surface-2)" stroke="var(--border)"/>
    <rect x="12" y="14" width="40" height="8" rx="4" fill="var(--text-3)" opacity=".6"/>
    <rect x="12" y="32" width="${[52, 30, 64, 44][i]}" height="16" rx="5" fill="var(--text)" opacity=".8"/>
  </g>`).join('')}
  ${[0, 1, 2, 3, 4].map((i) => {
    const tones = ['violet', 'green', 'indigo', 'sky', 'amber'];
    const y = 168 + i * 50;
    return `
  <g transform="translate(24 ${y})">
    <circle cx="20" cy="20" r="18" fill="var(--t-${tones[i]}-bg)"/>
    <circle cx="20" cy="20" r="7" fill="var(--t-${tones[i]})"/>
    <rect x="52" y="9" width="${[150, 120, 170, 100, 140][i]}" height="9" rx="4.5" fill="var(--text)" opacity=".75"/>
    <rect x="52" y="25" width="${[210, 180, 120, 230, 160][i]}" height="7" rx="3.5" fill="var(--text-3)" opacity=".5"/>
    <rect x="420" y="12" width="52" height="16" rx="8" fill="var(--surface-3)"/>
  </g>`;
  }).join('')}
</svg>`;
