/**
 * App context and shell: wires storage, the collector client and the
 * response store together, routes between screens, and draws the app bar.
 *
 * Routes (hash based, so the app works from any static host):
 *   #/                      surveys home (#/?folder=<id> for a folder)
 *   #/s/<id>/design         build the survey
 *   #/s/<id>/collect        share links and collector settings
 *   #/s/<id>/analyze        results (…/analyze/responses for one by one)
 */
import { h, replace, clear } from './lib/dom.js';
import { icon, brandMark, githubMark, REPO_URL } from './lib/icons.js';
import { showMenu, toast, toastError, openDialog, installRadioGroups, confirmDialog } from './lib/ui.js';
import { applyTheme, currentTheme } from './lib/theme.js';
import { createRepo } from './data/repo.js';
import { createCollectorClient, coerce } from './data/collector-client.js';
import { createResponseStore } from './data/responses.js';
import { createSession } from './data/session.js';
import { collectorsStatus } from './data/publish.js';
import { shortcutsDialog, setSingleKeys, singleKeysOn } from './views/shortcuts.js';

export function parseRoute(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const q = new URLSearchParams(query);
  if (parts[0] === 's' && /^[a-z0-9]{6,32}$/i.test(parts[1] || '')) {
    const step = ['design', 'collect', 'analyze'].includes(parts[2]) ? parts[2] : 'design';
    return { name: 'survey', sid: parts[1], step, sub: parts[3] || '', query: q };
  }
  return { name: 'home', folder: q.get('folder') || '', query: q };
}

export function go(path) {
  const target = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (location.hash !== target) location.hash = target;
}

/** The public link respondents open for a collector. */
export function shareUrl(label, cid, { embed = false } = {}) {
  const base = new URL('./r/', location.href);
  base.hash = '';
  base.search = embed ? '?embed=1' : '';
  return `${base.href}#${label}/${cid}`;
}

export function createApp({ backend, root }) {
  const repo = createRepo(backend);
  const workerStatus = new Set();
  const client = createCollectorClient({
    kv: backend.kv,
    fs: backend.fs,
    workers: backend.workers,
    getUser: () => backend.auth.getUser(),
    fetchFn: backend.fetchWorker,
    onStatus: (s) => workerStatus.forEach((fn) => fn(s)),
  });
  const responses = createResponseStore({ client });
  const loading = new Map();

  // The app's other tabs hear of each save (one with the survey open and
  // nothing unsaved takes it, session.adopt, so its next edit cannot
  // quietly overwrite this one's), each deleted survey, and signing out.
  const tabs = typeof BroadcastChannel === 'function' ? new BroadcastChannel(`sv-tabs:${backend.mode || ''}`) : null;
  const who = () => (app.user && app.user.username) || '';
  const announce = (message) => {
    try {
      tabs?.postMessage({ who: who(), ...message });
    } catch {
      /* best effort */
    }
  };
  const announceSaved = (sid, survey) => announce({ sid, survey });
  // Saves under way here when another tab signs out.
  let leaving = Promise.resolve();
  if (tabs) {
    tabs.onmessage = (e) => {
      const { who: from, sid, survey, deleted, signingOut, signedOut, meta } = e.data || {};
      if (from !== who()) return;
      if (signingOut) {
        // Signing out in another tab: cache nothing more, and save what is
        // being edited while still signed in.
        responses.stop();
        leaving = app.flushAll();
        return;
      }
      if (signedOut) {
        // Done there: start over, signed out.
        responses.stop();
        leaving.finally(() => location.reload());
        return;
      }
      if (typeof sid !== 'string') return;
      if (deleted) {
        // Deleted in another tab: leave it rather than edit what is gone.
        app.sessions.delete(sid);
        if (parseRoute(location.hash).sid === sid) {
          toast('This survey was deleted in another tab.');
          go('/');
        }
        return;
      }
      if (survey && survey.id === sid) app.sessions.get(sid)?.adopt(survey);
      // Published, closed, or counted in another tab.
      if (meta && typeof meta === 'object') app.sessions.get(sid)?.setMeta(meta, { remote: true });
    };
  }

  const app = {
    backend,
    repo,
    client,
    responses,
    user: null,
    settings: {},
    sessions: new Map(),
    onWorkerStatus(fn) {
      workerStatus.add(fn);
      return () => workerStatus.delete(fn);
    },
    go,
    shareUrl,
    /**
     * The open session for a survey, loading it on first use. With
     * `refresh`, a session with nothing left to save is checked against
     * the saved file, so edits made in another tab or on another device
     * are picked up instead of being overwritten by this tab's older copy.
     */
    session(sid, { refresh = false } = {}) {
      const cached = app.sessions.get(sid);
      if (cached && (!refresh || cached.dirty)) return Promise.resolve(cached);
      // Two quick visits share one load, so a survey never gets two sessions.
      if (!loading.has(sid)) {
        loading.set(sid, (async () => {
          try {
            let survey;
            try {
              survey = await repo.loadSurvey(sid);
            } catch (err) {
              if (app.sessions.has(sid)) return app.sessions.get(sid);
              throw err;
            }
            // Not newer on disk (or edited here meanwhile): keep this
            // session and its undo history. Only a newer saved copy wins,
            // so a stale read can never roll this tab back.
            const current = app.sessions.get(sid);
            if (current && (current.dirty || !((survey.updatedAt || 0) > (current.survey.updatedAt || 0)))) return current;
            // Its status and folder: from a list read again if this tab's
            // copy predates the survey (made in another tab).
            if (!repo.index || !repo.index[sid]) await repo.loadIndex();
            const s = createSession({ repo, survey, meta: (repo.index && repo.index[sid]) || {}, onSaved: (doc) => announceSaved(sid, doc), onMeta: (meta) => announce({ sid, meta }) });
            app.sessions.set(sid, s);
            return s;
          } finally {
            loading.delete(sid);
          }
        })());
      }
      return loading.get(sid);
    },
    /** Tell the app's other tabs a survey is gone. */
    surveyDeleted(sid) {
      announce({ sid, deleted: true });
    },
    async flushAll() {
      for (const s of app.sessions.values()) await s.flush().catch(() => {});
    },
    /** Persist a settings change locally and to the account. */
    async setSetting(patch) {
      app.settings = { ...app.settings, ...patch };
      try {
        await repo.updateSettings(patch);
      } catch {
        /* settings are best effort */
      }
    },
    /** Survey status for lists: draft until shared, then open or closed. */
    statusFromCollectors(collectors) {
      return collectorsStatus(collectors).status;
    },
  };

  /* ---- Layout ---- */

  const appbar = h('header', { class: 'appbar' });
  const main = h('main', { class: 'app-main', id: 'main', tabindex: '-1' });
  // The skip link moves focus itself: following #main would be a route
  // change in this hash-routed app.
  const skipLink = h('a', { class: 'skip-link', href: '#main' }, 'Skip to content');
  skipLink.addEventListener('click', (e) => {
    e.preventDefault();
    main.focus({ preventScroll: true });
  });
  replace(root, skipLink, appbar, main);

  let current = null;
  let currentKey = '';
  // Each route() call's number: a mount that finishes after a newer call
  // started is stale, even for the same survey.
  let routeSeq = 0;

  app.setAppbar = ({ left = null, center = null, right = null } = {}) => {
    replace(
      appbar,
      h('div', { class: 'appbar-left' }, left || homeBrand()),
      h('div', { class: 'appbar-center' }, center),
      h('div', { class: 'appbar-right' }, right,
        backend.mode === 'local' ? h('span', { class: 'chip chip-plain local-pill', title: 'Everything stays in this browser' }, 'Local demo') : null,
        sourceLink(), profileButton()),
    );
  };

  function homeBrand() {
    return h('a', { class: 'brand', href: '#/', 'aria-label': 'Surveys home' }, brandMark(26), h('span', { class: 'brand-name' }, 'Surveys'));
  }
  app.homeBrand = homeBrand;

  function sourceLink() {
    return h(
      'a',
      { class: 'btn btn-ghost btn-icon source-link', href: REPO_URL, target: '_blank', rel: 'noopener', title: 'Source code on GitHub', 'aria-label': 'Source code on GitHub (opens in a new tab)' },
      githubMark(18),
    );
  }

  /* ---- Profile menu ---- */

  let avatarUrl = null;
  function avatar(size = 28) {
    const name = (app.user && app.user.username) || '?';
    if (avatarUrl) return h('img', { class: 'avatar', src: avatarUrl, alt: '', width: size, height: size });
    return h('span', { class: 'avatar avatar-initial', 'aria-hidden': 'true' }, name.slice(0, 1).toUpperCase());
  }

  function profileButton() {
    const btn = h(
      'button',
      { type: 'button', class: 'btn btn-ghost btn-icon avatar-btn', 'aria-label': 'Account and settings', 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
      avatar(),
    );
    btn.addEventListener('click', () => {
      const theme = currentTheme();
      const setTheme = (t) => {
        applyTheme(t);
        app.setSetting({ theme: t });
      };
      showMenu(
        btn,
        [
          { heading: app.user ? `Signed in as ${app.user.username}` : 'Account' },
          { heading: 'Appearance' },
          { label: 'System', icon: 'monitor', checked: theme === 'system', run: () => setTheme('system') },
          { label: 'Light', icon: 'sun', checked: theme === 'light', run: () => setTheme('light') },
          { label: 'Dark', icon: 'moon', checked: theme === 'dark', run: () => setTheme('dark') },
          'sep',
          { label: 'Keyboard shortcuts', icon: 'keyboard', hint: singleKeysOn() ? '?' : undefined, run: () => openShortcuts() },
          { label: 'About Surveys', icon: 'info', run: () => aboutDialog() },
          // Inside the Puter desktop the app lives in the user's session:
          // signing out is the desktop's job, not ours.
          backend.env !== 'app' && backend.mode === 'puter' ? 'sep' : null,
          backend.env !== 'app' && backend.mode === 'puter'
            ? { label: 'Sign out', icon: 'logout', run: () => signOut() }
            : null,
        ],
        { align: 'end', label: 'Account' },
      );
    });
    return btn;
  }

  async function signOut() {
    await app.flushAll();
    // Respondents' answers must not stay on a shared computer, including
    // through another open tab of the app.
    announce({ signingOut: true });
    await responses.clear();
    await backend.auth.signOut();
    // Only now: a tab reloading sooner would start up still signed in.
    announce({ signedOut: true });
    location.reload();
  }

  function aboutDialog() {
    openDialog({
      title: 'About Surveys',
      build: (close) => ({
        body: h(
          'div',
          { class: 'about' },
          h('p', null, 'Build surveys, share them with a link, and analyze the results. Your surveys and responses are stored in your own Puter account.'),
          h('p', { class: 'muted' }, 'Surveys is open source and in early development (alpha).'),
          h('p', null, h('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Powered by Puter')),
        ),
        foot: h('button', { type: 'button', class: 'btn btn-primary', onclick: () => close() }, 'Close'),
      }),
    });
  }

  /* ---- Routing ---- */

  const views = {
    home: () => import('./views/home.js'),
    survey: () => import('./views/survey-frame.js'),
  };

  /*
   * A screen with unsaved changes the app cannot keep for it (a share link's
   * settings) registers { dirty(), title, message }: leaving it then asks
   * first. Saying no goes back to the history entry left, which entries are
   * numbered for (Back, Forward and links all count).
   */
  let leaveGuard = null;
  let shownHash = location.hash;
  let entry = history.state && Number.isInteger(history.state.svEntry) ? history.state.svEntry : 0;
  if (!(history.state && Number.isInteger(history.state.svEntry))) history.replaceState({ ...(history.state || {}), svEntry: entry }, '');
  let restoring = false;
  app.setLeaveGuard = (guard) => {
    leaveGuard = guard;
    return () => {
      if (leaveGuard === guard) leaveGuard = null;
    };
  };

  async function route() {
    if (restoring) {
      // Back on the entry left: nothing to route.
      restoring = false;
      return;
    }
    if (leaveGuard && location.hash !== shownHash && leaveGuard.dirty()) {
      const guard = leaveGuard;
      const ok = await confirmDialog({ title: guard.title || 'Discard changes?', message: guard.message || 'You have unsaved changes.', confirm: 'Discard', danger: true });
      if (!ok) {
        const at = history.state && Number.isInteger(history.state.svEntry) ? history.state.svEntry : null;
        restoring = true;
        if (at == null) history.back();
        else history.go(entry - at);
        return;
      }
      if (leaveGuard === guard) leaveGuard = null;
    }
    // A dialog belongs to the screen it was opened on: Back or Forward
    // (Alt+arrows, a mouse's back button) while it is open closes it.
    if (location.hash !== shownHash) for (const d of document.querySelectorAll('dialog[open]')) d.close();
    // Number the entry: a new one (a link, typed address) has no state yet.
    if (history.state && Number.isInteger(history.state.svEntry)) entry = history.state.svEntry;
    else history.replaceState({ ...(history.state || {}), svEntry: ++entry }, '');
    shownHash = location.hash;
    const r = parseRoute(location.hash);
    const key = r.name === 'survey' ? `survey:${r.sid}` : 'home';
    if (current && currentKey === key && current.update) {
      current.update(r);
      return;
    }
    const seq = ++routeSeq;
    if (current && current.unmount) await current.unmount();
    current = null;
    currentKey = key;
    clear(main);
    main.append(h('div', { class: 'view-loading', role: 'status' }, h('div', { class: 'spinner' }), h('span', { class: 'sr-only' }, 'Loading')));
    try {
      const mod = await views[r.name]();
      if (seq !== routeSeq) return;
      clear(main);
      // Each view mounts into its own host, so one that finishes after the
      // user moved on can be removed without touching the current view.
      const host = h('div', { class: 'view-host' });
      main.append(host);
      const view = await mod.mount(host, r, app);
      if (seq !== routeSeq) {
        if (view && view.unmount) await view.unmount();
        host.remove();
        return;
      }
      current = view;
    } catch (err) {
      console.error(err);
      if (seq !== routeSeq) return;
      replace(
        main,
        h(
          'div',
          { class: 'empty' },
          h('div', { class: 'empty-icon' }, icon('alert', { size: 22 })),
          h('h2', null, r.name === 'survey' ? 'This survey could not be opened' : 'Something went wrong'),
          h('p', null, r.name === 'survey' ? 'It may have been deleted, or your connection dropped.' : 'Please reload the page.'),
          h('a', { class: 'btn', href: '#/' }, 'Back to surveys'),
        ),
      );
    }
  }
  app.refreshRoute = () => {
    currentKey = '';
    route();
  };

  window.addEventListener('hashchange', route);
  installRadioGroups();
  // A file dropped outside a drop zone would make the browser open it in
  // place of the app, losing anything unsaved. Drop zones and file inputs
  // still get their drops; other drags (reordering) carry no files.
  const strayFile = (e) =>
    e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files') && !(e.target instanceof HTMLInputElement && e.target.type === 'file');
  window.addEventListener('dragover', (e) => strayFile(e) && e.preventDefault());
  window.addEventListener('drop', (e) => strayFile(e) && e.preventDefault());
  // The setting is kept with the account, like the theme.
  const openShortcuts = () => shortcutsDialog({ onSingleKeys: (on) => app.setSetting({ singleKeys: on }) });
  window.addEventListener('keydown', (e) => {
    if (e.key === '?' && singleKeysOn() && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      openShortcuts();
    }
  });
  // Save before the tab goes away.
  window.addEventListener('beforeunload', (e) => {
    if (leaveGuard && leaveGuard.dirty()) e.preventDefault();
    for (const s of app.sessions.values()) {
      if (s.dirty) {
        s.flush();
        e.preventDefault();
      }
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') app.flushAll();
  });

  app.start = async () => {
    try {
      app.user = await backend.auth.getUser();
    } catch {
      app.user = null;
    }
    backend.auth.getProfilePicture().then((url) => {
      if (url) {
        avatarUrl = url;
        document.querySelectorAll('.avatar-btn').forEach((b) => b.replaceChildren(avatar()));
      }
    }).catch(() => {});
    try {
      app.settings = (await repo.loadSettings()) || {};
      if (app.settings.theme && app.settings.theme !== currentTheme()) applyTheme(app.settings.theme);
      setSingleKeys(app.settings.singleKeys);
    } catch {
      app.settings = {};
    }
    await route();
    showAlphaNotice(app);
  };

  return app;
}

/* ---- First-run alpha notice ---- */

const ALPHA_KEY = 'sv:alpha-ack';

export function showAlphaNotice(app) {
  let seen = false;
  try {
    seen = !!localStorage.getItem(ALPHA_KEY);
  } catch {
    /* storage blocked: fall back to the account setting */
  }
  if (seen || (app.settings && app.settings.alphaAck)) return null;
  const dismiss = () => {
    card.remove();
    try {
      localStorage.setItem(ALPHA_KEY, '1');
    } catch {
      /* ignore */
    }
    app.setSetting({ alphaAck: true });
  };
  const card = h(
    'section',
    { class: 'notice-card', 'aria-labelledby': 'alpha-title', 'aria-live': 'polite' },
    h('h2', { id: 'alpha-title' }, icon('info', { size: 16 }), 'Early preview'),
    h(
      'p',
      null,
      'Surveys is in alpha. Features may change and things may break, and data you create now might not carry over to later versions. Please don’t rely on it for important surveys or sensitive information yet.',
    ),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: dismiss }, 'Got it')),
  );
  document.body.append(card);
  return card;
}

/* ---- Sign-in screen (website mode, signed out) ---- */

export function renderSignIn(root, { onSignIn }) {
  const btn = h('button', { type: 'button', class: 'btn btn-primary btn-lg' }, 'Sign in');
  const err = h('p', { class: 'signin-error', role: 'alert' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    err.textContent = '';
    try {
      await onSignIn();
    } catch {
      err.textContent = 'Sign in did not complete. Please try again.';
      btn.disabled = false;
    }
  });
  const localUrl = new URL(location.href);
  localUrl.searchParams.set('local', '');
  replace(
    root,
    h(
      'main',
      { class: 'signin', id: 'main' },
      h(
        'div',
        { class: 'signin-card' },
        brandMark(48),
        h('h1', null, 'Surveys'),
        h('p', { class: 'muted' }, 'Create surveys, share them with a link, and see the results as they come in. Everything is stored in your own Puter account.'),
        btn,
        err,
        h('a', { class: 'signin-alt', href: localUrl.href.replace('local=', 'local') }, 'Try it without an account (stays in this browser)'),
      ),
      h('p', { class: 'signin-foot' }, h('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Powered by Puter')),
    ),
  );
}

export { coerce, toast, toastError };
