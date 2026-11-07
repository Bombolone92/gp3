/**
 * Fifteenth review pass, the shell: the Directory, the list views, the
 * sidebar and the app frame, driven in node through tests/helpers/dom.js
 * (a small DOM: elements, selectors, bubbling events, focus with the focus
 * fixup rule, a hash location that fires hashchange on the next tick,
 * matchMedia by viewport; no CSS). Every test boots a fresh DOM and a fresh
 * module registry, so the listeners the modules hang on window and document
 * never outlive their test. Puter is faked at `puter.workers.exec`, as in
 * tests/store.test.js and tests/ui-shell-pass14.test.js.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom.js';

// The conversation column and the huddle window are stubbed where the whole
// shell is mounted (their own tests cover them), as in the pass-14 file.
vi.mock('../src/ui/conversation.js', () => ({
  createConversationView: (convId) => {
    const node = document.createElement('div');
    node.className = 'main';
    node.dataset.conv = convId;
    return { el: node, destroy() {}, renderHeader() {}, tab: () => 'messages', setTab() {}, jumpTo() {} };
  },
}));
vi.mock('../src/ui/huddle.js', () => ({
  mountHuddleDock() {},
  joinHuddleFlow() {},
  huddleButton() { return document.createElement('span'); },
  createHuddleBar() { return { el: document.createElement('div'), destroy() {} }; },
}));

const REF = 'abc123def0@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dom = null;

/** A fresh DOM and fresh modules; the store opens a small workspace when asked. */
async function boot({ hash = '', width = 1280, routes = {}, ...env } = {}) {
  dom?.uninstall();
  dom = installDom({ hash, width, ...env });
  vi.resetModules();
  const calls = [];
  globalThis.puter = {
    workers: {
      exec: async (url, init = {}) => {
        const u = new URL(url);
        calls.push(`${init.method || 'GET'} ${u.pathname}${u.search}`);
        const hit = Object.entries(routes).find(([k]) => u.pathname.endsWith(k));
        if (!hit) return json({ code: 'not_found', message: 'nope' }, 404);
        return hit[1](u.searchParams, init);
      },
    },
  };
  const { store } = await import('../src/lib/store.js');
  const open = () => {
    store.wsId = REF;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.ws = {
      id: 'abc123def0', name: 'Globex',
      channels: {
        c1: { id: 'c1', name: 'general', def: true },
        c2: { id: 'c2', name: 'ops' },
        c3: { id: 'c3', name: 'random', count: 2 },
      },
      members: {
        'u-me': { role: 'member', name: 'Me', username: 'me' },
        'u-dan': { role: 'member', name: 'Dan Ito', username: 'dan' },
      },
    };
    store.me = {
      role: 'member', channels: ['c1', 'c2'],
      dms: { dm_d: { members: ['u-me', 'u-dan'], createdAt: 3 } },
      reads: {}, mentions: {}, notify: {}, threads: {},
    };
    store.act = { c: {}, p: {}, w: 0, u: 0 };
    store.workspaces = [{ id: REF, name: 'Globex' }];
  };
  store.openWorkspace = async () => { open(); store.emit('workspace'); };
  store.startPolling = () => {};
  store.pokeSync = () => {};
  return { store, open, calls, dom };
}

afterEach(() => {
  dom?.uninstall();
  dom = null;
  delete globalThis.puter;
});

/** The shell at a route, opened and settled. */
async function shell(opts = {}) {
  const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1`, ...opts });
  const { mountShell } = await import('../src/ui/shell.js');
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(app);
  mountShell(app);
  await ctx.dom.tick(5);
  return { ...ctx, app };
}

describe('Back from a conversation to the list, on a phone', () => {
  const MSGS = { '/messages': () => json({ messages: [], seq: 0 }) };

  it('hands the keyboard to the sidebar row of the conversation just left', async () => {
    const { app, dom: d } = await shell({ width: 390, routes: MSGS });
    // The conversation is the screen; the keyboard is on a control in its column (the header's Back).
    const back = document.createElement('button');
    app.querySelector('.main').append(back);
    back.focus();
    expect(document.activeElement).toBe(back);
    location.hash = `#/ws/${encodeURIComponent(REF)}`; // what the header's Back navigates to
    await d.tick(10);
    expect(app.querySelector('.shell').classList.contains('show-sidebar')).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement.getAttribute('href')).toMatch(/\/c\/c1$/);
  });

  it('hands it to the DMs pane row of the conversation just left, and to an Activity pane\'s first control when the pane has no such row', async () => {
    const { app, dom: d } = await shell({ width: 390, hash: `#/ws/${encodeURIComponent(REF)}/dms/c/dm_d`, routes: MSGS });
    let back = document.createElement('button');
    app.querySelector('.main').append(back);
    back.focus();
    location.hash = `#/ws/${encodeURIComponent(REF)}/dms`;
    await d.tick(10);
    expect(document.activeElement.getAttribute('href')).toMatch(/\/dms\/c\/dm_d$/);
    // From a conversation opened from Activity: the pane offers no row by address; its first control (Back to channels) takes the keyboard.
    location.hash = `#/ws/${encodeURIComponent(REF)}/activity/c/c1/m/3`;
    await d.tick(10);
    back = document.createElement('button');
    app.querySelector('.main').append(back);
    back.focus();
    location.hash = `#/ws/${encodeURIComponent(REF)}/activity`;
    await d.tick(10);
    expect(document.activeElement).not.toBe(document.body);
    expect(app.querySelector('.sidebar').contains(document.activeElement)).toBe(true);
  });

  it('leaves the keyboard where it is when it was not in the column taken down, and does not open a phone\'s keyboard for a touch', async () => {
    const { app, dom: d } = await shell({ width: 390, coarse: true, hover: false, routes: MSGS });
    // A touch: nothing has the keyboard (the body does); Back must not put it in the filter box, which would bring the keyboard up.
    expect(document.activeElement).toBe(document.body);
    location.hash = `#/ws/${encodeURIComponent(REF)}`;
    await d.tick(10);
    expect(document.activeElement).toBe(document.body);
  });
});

describe('the top bar\'s Back and Forward', () => {
  it('keep the keyboard when the history runs out under them, saying they are disabled rather than being so', async () => {
    globalThis.navigation = { canGoBack: true, canGoForward: false };
    try {
      const { app, dom: d } = await shell();
      const [back, fwd] = app.querySelectorAll('.top-nav');
      expect(back.getAttribute('aria-label')).toBe('Back');
      expect(fwd.getAttribute('aria-label')).toBe('Forward');
      // Forward has nowhere to go: said, not disabled (a disabled button is skipped by Tab, and drops the keyboard when it is on it).
      expect(fwd.getAttribute('aria-disabled')).toBe('true');
      expect(fwd.hasAttribute('disabled')).toBe(false);
      expect(back.getAttribute('aria-disabled')).toBe('false');
      // Back is pressed from the keyboard and lands on the first page: it has nowhere to go now, and keeps the keyboard.
      back.focus();
      expect(document.activeElement).toBe(back);
      globalThis.navigation.canGoBack = false;
      window.dispatchEvent(new Event('hashchange'));
      await d.tick(5);
      expect(back.getAttribute('aria-disabled')).toBe('true');
      expect(document.activeElement).toBe(back);
      // Pressed again, it asks the browser for nothing.
      const went = [];
      history.back = () => went.push('back');
      back.click();
      expect(went).toEqual([]);
      globalThis.navigation.canGoBack = true;
      window.dispatchEvent(new Event('hashchange'));
      await d.tick(5);
      back.click();
      expect(went).toEqual(['back']);
    } finally {
      delete globalThis.navigation;
    }
  });
});

describe('a row of a workspace pressed while it is being forgotten', () => {
  it('is told of the lost access once, and forgets the workspace once', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    const { store, dom: d } = ctx;
    const { ApiError } = await import('../src/lib/api.js');
    const forgotten = [];
    let release = null;
    store.forgetWorkspace = (ref) => { forgotten.push(ref); return new Promise((r) => { release = r; }); };
    const { mountShell } = await import('../src/ui/shell.js');
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    mountShell(app);
    await d.tick(5);
    // The poll says the reader is no longer a member: told, and the workspace is being forgotten (a write to their account).
    store.emit('error', new ApiError(403, 'forbidden', 'You are not a member of this workspace'));
    await d.tick(5);
    const said = () => [...document.querySelectorAll('.toast span')].map((n) => n.textContent).filter((t) => /access/.test(t));
    expect(said()).toEqual(['You no longer have access to this workspace']);
    expect(forgotten).toEqual([REF]);
    // Before the write lands, a row of the same workspace's sidebar is pressed: its worker refuses again.
    store.openWorkspace = async () => { throw new ApiError(403, 'forbidden', 'You are not a member of this workspace'); };
    location.hash = `#/ws/${encodeURIComponent(REF)}/c/c2`;
    await d.tick(10);
    expect(said()).toEqual(['You no longer have access to this workspace']); // not a second time, in other words
    expect(forgotten).toEqual([REF]); // and not forgotten twice
    // The write lands: home, as before.
    store.workspaces = [];
    release();
    await d.tick(20);
    expect(location.hash).toBe('#/');
    expect(app.querySelector('.auth-title')?.textContent).toBe('No workspace yet');
  });
});

describe('the app opened without a network, the network back within the first second', () => {
  /** Wait for a condition rather than a fixed pause, up to a generous bound. */
  const until = async (fn, ms = 12_000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await dom.tick(25); } };

  it('asks for the SDK once more on its own, rather than landing on "Could not reach Puter" for a network that is there', async () => {
    dom?.uninstall();
    dom = installDom({ hash: '' });
    vi.resetModules();
    const app = document.createElement('div');
    app.id = 'app';
    app.className = 'app';
    document.body.append(app);
    // The page's own SDK tag, which failed to load offline.
    const tag = document.createElement('script');
    tag.setAttribute('src', 'https://js.puter.com/v2/');
    document.head.append(tag);
    dom.navigator.onLine = false;
    delete globalThis.puter;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    await import('../src/main.js');
    // The short wait for the SDK is under way. The network comes back inside
    // it: the page is online by the time the wait fails, so no `online`
    // event follows the failure to bring the retry.
    dom.navigator.onLine = true;
    await until(() => document.querySelectorAll('script[src*="js.puter.com"]').length === 2, 6000);
    expect(app.querySelector('.auth-title')?.textContent).not.toBe('Could not reach Puter');
    // It loads: the app comes up, no reload asked of anyone.
    globalThis.puter = { auth: { isSignedIn: async () => true, getUser: async () => ({ uuid: 'u-me', username: 'me' }) }, kv: { get: async () => null } };
    await until(() => !!app.querySelector('.app-frame'));
    expect(dom.location.reloads).toBe(0);
    quiet.mockRestore();
    delete globalThis.puter;
  }, 20_000);
});

describe('a list view that could not load, while a poll asks for it again', () => {
  it('keeps "Could not load" and Try again on the screen, and the keyboard on Try again, until the answer comes', async () => {
    let answer = () => json({ code: 'error', message: 'The server is down for a moment' }, 500);
    const ctx = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/activity`,
      routes: { '/inbox': () => answer(), '/inbox/read': () => json({ ok: true }) },
    });
    const { store, dom: d } = ctx;
    ctx.open();
    store._schedule = () => {};
    store.me.inbox = 1;
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('activity', { pane: true });
    document.body.append(view.el);
    await d.tick(10);
    const tryAgain = () => [...view.el.querySelectorAll('button')].find((b) => b.textContent === 'Try again');
    expect(view.el.querySelector('.empty h3')?.textContent).toBe('Could not load activity');
    expect(tryAgain()).toBeTruthy();
    tryAgain().focus();
    store.emit('workspace'); // the poll's first word since the view opened: the baseline
    await d.tick(5);
    // A mention lands while the list is failed: the quiet reload it brings must not swap the words for a skeleton.
    let release = null;
    answer = () => new Promise((r) => { release = r; });
    store.me.inbox = 2;
    store.emit('workspace');
    await d.tick(5);
    expect(release).not.toBeNull(); // asked again
    expect(view.el.querySelector('.empty h3')?.textContent).toBe('Could not load activity');
    expect(view.el.querySelector('[aria-busy="true"]')).toBeNull();
    expect(document.activeElement).toBe(tryAgain());
    // The answer comes: the list takes the words' place.
    release(json({ items: [{ k: 'mention', c: 'c1', s: 3, by: 'u-dan', ts: 1003, message: { seq: 3, user: 'u-dan', ts: 1003, text: 'hi @me', kind: 'msg' } }] }));
    await d.tick(10);
    expect(view.el.querySelector('.empty')).toBeNull();
    expect(view.el.querySelectorAll('.view-row').length).toBe(1);
    // Try again itself, pressed, shows the wait as before.
    answer = () => new Promise(() => {});
    store.me.inbox = 0;
    view.destroy();
  });
});

describe('small controls under a finger, in the stylesheet', () => {
  // The fake DOM applies no CSS, so the contract is read from the text, as
  // the pass-14 file reads the safe-area rules.
  const app = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const components = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...app.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2].trim().replace(/\s+/g, ' ') }));
  const bodyOf = (sel) => rules.find((r) => r.sel === sel)?.body || '';
  /** The last coarse-pointer block of app.css, where the file's own touch sizes live. */
  const coarse = () => {
    const at = app.lastIndexOf('@media (pointer: coarse)');
    let depth = 0;
    let end = app.indexOf('{', at);
    for (; end < app.length; end++) {
      if (app[end] === '{') depth++;
      else if (app[end] === '}' && --depth === 0) break;
    }
    return app.slice(at, end).replace(/\s+/g, ' ');
  };

  it('gives the section headings, Clear over recent searches, a thread card\'s name and Show more, the search tips and a pane\'s filter choices 28px under a finger, without resizing them to the eye', () => {
    const block = coarse();
    const small = ['.side-head > button.side-title', '.top-drop-clear', '.thread-card-where', '.thread-card-more', '.search-tip', '.list-pane .seg button'];
    expect(block).toContain(`${small.join(', ')} { position: relative; }`);
    expect(block).toContain(`:is(${small.join(', ')})::before { content: ''; position: absolute; inset: -2px 0; }`);
    // Each keeps its look: the sizes that made it 24 to 27px tall stand as they were.
    expect(bodyOf('.side-head > button.side-title')).toMatch(/padding: 4px 4px;.*font-size: 12px/);
    expect(bodyOf('.top-drop-clear')).toContain('min-height: 24px');
    expect(bodyOf('.thread-card-where')).toContain('min-height: 24px');
    expect(bodyOf('.thread-card-more')).toMatch(/padding: 4px 0; font-size: 13\.5px/);
    expect(bodyOf('.search-tip')).toMatch(/font-size: 13px; padding: 3px 8px/);
    expect(bodyOf('.list-pane .seg button')).toMatch(/padding: 3px 9px; font-size: 12\.5px/);
    // And nothing else in either stylesheet already draws a ::before on them (only the :is() above does), or positions them by their own rule.
    const both = app + components;
    for (const sel of small) {
      const bare = sel.replace(/[.>]/g, (c) => `\\${c}`);
      expect((both.match(new RegExp(`${bare}::before`, 'g')) || []).length).toBe(0);
      expect(bodyOf(sel)).not.toContain('position:');
    }
  });
});

describe('the notch\'s room on the left, in the stylesheet', () => {
  const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  /** The rules of each block of one media query, flattened to (selector, declarations) pairs. */
  const blocksOf = (media) => {
    const out = [];
    for (let at = css.indexOf(media); at >= 0; at = css.indexOf(media, at + 1)) {
      let depth = 0;
      let end = css.indexOf('{', at);
      for (; end < css.length; end++) {
        if (css[end] === '{') depth++;
        else if (css[end] === '}' && --depth === 0) break;
      }
      const inner = css.slice(css.indexOf('{', at) + 1, end);
      out.push([...inner.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2].trim().replace(/\s+/g, ' ') })));
    }
    return out;
  };
  const top = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2].trim().replace(/\s+/g, ' ') }));

  it('is kept clear by the thread panel on a phone, anchored to both edges rather than the whole width anchored right', () => {
    // From tablet widths down the panel floats over the shell, against its right safe edge.
    const tablet = blocksOf('@media (max-width: 1023px)').find((rules) => rules.some((r) => r.sel === '.panel'));
    expect(tablet.find((r) => r.sel === '.panel')?.body).toContain('right: var(--safe-r)');
    // On a phone it takes what lies between the two safe edges: with `width: 100%` of a shell padded on both sides, anchored right, its left edge stood at minus the right inset.
    const phone = blocksOf('@media (max-width: 719px)').find((rules) => rules.some((r) => r.sel === '.rail'));
    const panel = phone.find((r) => r.sel === '.panel')?.body || '';
    expect(panel).toContain('left: var(--safe-l)');
    expect(panel).toContain('width: auto');
    expect(panel).not.toContain('width: 100%');
  });

  it('is kept by the shell on a phone, where the rail that keeps it on wider screens is not shown, and by the top bar on both sides', () => {
    // Wider screens: the rail takes the left inset, the shell the right.
    expect(top.find((r) => r.sel === '.rail')?.body).toMatch(/padding: calc\(10px \+ var\(--safe-t\)\) 6px calc\(10px \+ var\(--safe-b\)\) calc\(6px \+ var\(--safe-l\)\)/);
    expect(top.find((r) => r.sel === '.shell')?.body).toContain('padding-right: var(--safe-r)');
    // A phone: the rail goes, and the shell takes the left inset over.
    const phone = blocksOf('@media (max-width: 719px)').find((rules) => rules.some((r) => r.sel === '.rail'));
    expect(phone).toBeTruthy();
    expect(phone.find((r) => r.sel === '.rail')?.body).toBe('display: none;');
    expect(phone.find((r) => r.sel === '.shell')?.body).toContain('padding-left: var(--safe-l)');
    // The top bar, first row of the frame from tablet widths up: both sides.
    expect(top.find((r) => r.sel === '.topbar')?.body).toContain('padding: 0 calc(12px + var(--safe-r)) 0 calc(8px + var(--safe-l))');
    // And the strips above and inside the frame already keep both sides.
    expect(top.find((r) => r.sel === '.offline-banner, .transfer-strip')?.body).toContain('padding: 5px calc(14px + var(--safe-r)) 5px calc(14px + var(--safe-l))');
  });
});

describe('the Forget button beside a recent search, in the stylesheet', () => {
  // The fake DOM applies no CSS and lets any connected control take focus;
  // a browser refuses focus to a control that is visibility: hidden (or
  // display: none), so the rule that hides the button until its row is
  // hovered or focused must hide it by opacity, which focus does not mind:
  // the top bar hands the keyboard to the next row's Forget right after a
  // press, before that row has the focus that would show it.
  const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2].trim().replace(/\s+/g, ' ') }));
  const bodyOf = (sel) => rules.find((r) => r.sel === sel)?.body || '';

  it('is hidden by opacity, which does not keep the keyboard off it, and never by visibility or display', () => {
    expect(bodyOf('.top-drop-x')).toContain('opacity: 0');
    expect(bodyOf('.top-drop-x')).not.toMatch(/visibility|display: none/);
    expect(bodyOf('.top-drop-row:hover .top-drop-x, .top-drop-row:focus-within .top-drop-x')).toBe('opacity: 1;');
    // No hover to reveal it with: always there.
    const touch = rules.filter((r) => r.sel === '.top-drop-x').map((r) => r.body);
    expect(touch).toContain('opacity: 1;');
    expect(css).not.toMatch(/\.top-drop-x[^{]*\{[^}]*visibility/);
  });
});

describe('the pill of actions on a Later row, in the stylesheet', () => {
  // As with the Forget button: held() in views.js hands the keyboard back to
  // the mark or the remove button of the redrawn row, whose pill has neither
  // the pointer nor the keyboard yet; hidden with display: none it could not
  // be focused in a browser, and the keyboard fell to the page.
  const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2].trim().replace(/\s+/g, ' ') }));
  const bodyOf = (sel) => rules.find((r) => r.sel === sel)?.body || '';

  it('is hidden by opacity and takes no clicks while hidden, shown on hover, keyboard or an open menu, and always there on touch', () => {
    const base = bodyOf('.later-actions');
    expect(base).toContain('display: flex');
    expect(base).toContain('opacity: 0');
    expect(base).toContain('pointer-events: none');
    expect(base).not.toMatch(/display: none|visibility/);
    expect(bodyOf('.later-row:hover .later-actions, .later-row:focus-within .later-actions, .later-row.menu-open .later-actions')).toBe('opacity: 1; pointer-events: auto;');
    const touch = rules.filter((r) => r.sel === '.later-actions').map((r) => r.body).find((b) => b.includes('position: static'));
    expect(touch).toContain('opacity: 1');
    expect(touch).toContain('pointer-events: auto');
    expect(touch).not.toContain('display:');
  });
});

describe('the sidebar\'s pill that points at unread rows out of view', () => {
  it('stays for an unread row a folded section keeps showing, while the section\'s read rows fold away', async () => {
    // A folded section keeps its unread rows and the open one on the page,
    // (it used to fold every row away, and the pill with them).
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c2` });
    const { store, dom: d } = ctx;
    ctx.open();
    store.act.c = { c2: { s: 5, t: 1 } }; // #ops has five messages, none read: an unread row (and the open one)
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const nav = document.createElement('nav');
    document.body.append(nav);
    renderSidebar(nav);
    await d.tick(5);
    const scroll = nav.querySelector('.sidebar-scroll');
    const row = nav.querySelector('.side-item[href$="/c/c2"]');
    const read = nav.querySelector('.side-item[href$="/c/c1"]'); // #general: read, and not the open one
    expect(row.classList.contains('unread')).toBe(true);
    expect(read.classList.contains('unread')).toBe(false);
    // The fake DOM has no layout: the list box and the row are given theirs
    // here, the row below the box's bottom edge while it is shown, and none
    // (as a browser reports for a row in a folded, hidden list) when not.
    const box = { x: 0, y: 0, left: 0, top: 0, right: 240, bottom: 400, width: 240, height: 400 };
    const below = { x: 0, y: 900, left: 0, top: 900, right: 240, bottom: 934, width: 240, height: 34 };
    const none = { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    scroll.getBoundingClientRect = () => box;
    row.getBoundingClientRect = () => (row._rendered() ? below : none); // the helper's own "rendered": connected, no [hidden] ancestor
    const pill = nav.querySelector('.side-unread-pill.down');
    scroll.dispatchEvent(new Event('scroll'));
    expect(pill.hidden).toBe(false);
    expect(pill.textContent).toBe('Unreads');
    // Channels is folded: the read row goes, the unread (and open) one stays, and so does the pill that points at it.
    const toggle = nav.querySelector('.side-title[aria-controls="side-channels"]');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(read.getClientRects().length).toBe(0);
    expect(row.getClientRects().length).toBe(1);
    expect(pill.hidden).toBe(false);
    // Unfolded again: the read row is back.
    toggle.click();
    expect(read.getClientRects().length).toBe(1);
    expect(pill.hidden).toBe(false);
  });
});

describe('a person picked from the sidebar\'s filter results', () => {
  it('keeps the words and the matches when their conversation cannot be opened, and clears them once it opens', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    const { store, dom: d } = ctx;
    ctx.open();
    store.ws.members['u-eve'] = { role: 'member', name: 'Eve Park', username: 'eve' };
    let outcome = null;
    const asked = [];
    store.openDmWith = (uuid) => { asked.push(uuid); return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome); };
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const nav = document.createElement('nav');
    document.body.append(nav);
    renderSidebar(nav);
    await d.tick(5);
    const input = nav.querySelector('.side-filter-input');
    d.type(input, 'eve');
    const person = () => [...nav.querySelectorAll('button.side-item')].find((b) => b.textContent.includes('Eve Park'));
    expect(person()).toBeTruthy(); // no conversation with Eve yet: she is offered as a person
    // Out of reach (offline, say): the words stay, and so do the matches, with the reason in a toast.
    outcome = new Error('Could not reach the workspace server');
    person().click();
    await d.tick(5);
    expect(asked).toEqual(['u-eve']);
    expect(input.value).toBe('eve');
    expect(person()).toBeTruthy();
    expect(nav.querySelector('.side-results')).not.toBeNull();
    expect([...document.querySelectorAll('.toast span')].map((n) => n.textContent)).toContain('Could not reach the workspace server');
    // Pressed again once the server answers: the conversation opens, and the box and the list are clear of the search.
    outcome = { ws: REF, conv: 'dm_e' };
    person().click();
    await d.tick(10);
    expect(asked).toEqual(['u-eve', 'u-eve']);
    expect(input.value).toBe('');
    expect(nav.querySelector('.side-filter-clear').hidden).toBe(true);
    expect(nav.querySelector('.side-results')).toBeNull();
    expect(nav.querySelector('.side-views')).not.toBeNull();
    expect(location.hash).toBe(`#/ws/${encodeURIComponent(REF)}/c/dm_e`);
  });
});

describe('a join or a conversation begun in one workspace, answered after the reader has switched to another', () => {
  const OTHER = 'bbbb222200@teamchat-test';
  const switchTo = (store) => {
    store.wsId = OTHER;
    store.ws = { id: 'bbbb222200', name: 'Initech', channels: { x1: { id: 'x1', name: 'general', def: true } }, members: { 'u-me': { role: 'member', name: 'Me', username: 'me' } } };
    store.me = { role: 'member', channels: ['x1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    location.hash = `#/ws/${encodeURIComponent(OTHER)}/c/x1`;
  };

  it('does not open the Directory\'s joined channel, by its old id, under the new workspace', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/directory` });
    const { store, dom: d } = ctx;
    ctx.open();
    let resolve = null;
    store.joinChannel = () => new Promise((r) => { resolve = r; });
    const { createDirectoryView } = await import('../src/ui/directory.js');
    const view = createDirectoryView();
    document.body.append(view.el);
    await d.tick(5);
    view.el.querySelectorAll('.dir-tabs [role="tab"]')[1].click();
    view.el.querySelector('button[aria-label="Join #random"]').click();
    // Before the worker answers, the reader switches workspaces (the shell tears the Directory down with the switch).
    view.destroy();
    view.el.remove();
    switchTo(store);
    await d.tick(5);
    resolve({});
    await d.tick(10);
    expect(location.hash).toBe(`#/ws/${encodeURIComponent(OTHER)}/c/x1`); // not #/ws/OTHER/c/c3, a channel Initech does not have
    expect([...document.querySelectorAll('.toast span')].map((n) => n.textContent)).toContain('Joined #random'); // the join went through all the same
  });

  it('does not pull the reader back to the workspace a person\'s conversation was opened in from the sidebar', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    const { store, dom: d } = ctx;
    ctx.open();
    store.ws.members['u-eve'] = { role: 'member', name: 'Eve Park', username: 'eve' };
    let resolve = null;
    store.openDmWith = () => new Promise((r) => { resolve = r; });
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const nav = document.createElement('nav');
    document.body.append(nav);
    const bar = renderSidebar(nav);
    await d.tick(5);
    d.type(nav.querySelector('.side-filter-input'), 'eve');
    [...nav.querySelectorAll('button.side-item')].find((b) => b.textContent.includes('Eve Park')).click();
    switchTo(store);
    await d.tick(5);
    resolve({ ws: REF, conv: 'dm_e' });
    await d.tick(10);
    expect(location.hash).toBe(`#/ws/${encodeURIComponent(OTHER)}/c/x1`); // where the reader went, not Globex's new conversation
    bar.destroy();
  });
});

describe('the Directory redrawn under a Join that is out', () => {
  it('draws the fresh button busy, takes no second press on it, and frees it when the answer comes', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/directory` });
    const { store, dom: d } = ctx;
    ctx.open();
    const joins = [];
    let reject = null;
    store.joinChannel = (id) => { joins.push(id); return new Promise((_, r) => { reject = r; }); };
    const { createDirectoryView } = await import('../src/ui/directory.js');
    const view = createDirectoryView();
    document.body.append(view.el);
    await d.tick(5);
    view.el.querySelectorAll('.dir-tabs [role="tab"]')[1].click();
    const join = () => view.el.querySelector('button[aria-label="Join #random"]');
    const first = join();
    first.focus();
    first.click();
    expect(joins).toEqual(['c3']);
    // A poll lands: the list is redrawn, and the button under the keyboard is a fresh one.
    store.emit('workspace');
    await d.tick(5);
    expect(join()).not.toBe(first);
    expect(document.activeElement).toBe(join()); // the keyboard came back to it
    expect(join().getAttribute('aria-busy')).toBe('true'); // and it shows the join still out
    join().click();
    expect(joins).toEqual(['c3']); // one join, not two
    // Refused: the button standing now is live again, and takes a press.
    reject(new Error('This channel is archived'));
    await d.tick(5);
    expect(join().getAttribute('aria-busy')).toBeNull();
    expect(document.activeElement).toBe(join());
    join().click();
    expect(joins).toEqual(['c3', 'c3']);
    view.destroy();
  });
});

describe('the Join button on a channel row of the Directory', () => {
  it('keeps the keyboard while the worker answers and after it refuses, and takes one press at a time', async () => {
    const ctx = await boot({ hash: `#/ws/${encodeURIComponent(REF)}/directory` });
    const { store, dom: d } = ctx;
    ctx.open();
    const joins = [];
    let reject = null;
    store.joinChannel = (id) => { joins.push(id); return new Promise((_, r) => { reject = r; }); };
    const { createDirectoryView } = await import('../src/ui/directory.js');
    const view = createDirectoryView();
    document.body.append(view.el);
    await d.tick(5);
    view.el.querySelectorAll('.dir-tabs [role="tab"]')[1].click();
    const join = view.el.querySelector('button[aria-label="Join #random"]');
    expect(join).not.toBeNull();
    join.focus();
    expect(document.activeElement).toBe(join);
    join.click();
    expect(joins).toEqual(['c3']);
    // Out to the worker: the button says it is busy, and the keyboard stays on it.
    expect(join.getAttribute('aria-busy')).toBe('true');
    expect(join.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(join);
    // A second press meanwhile asks nothing more.
    join.click();
    expect(joins).toEqual(['c3']);
    // Refused (the channel archived meanwhile, the network gone): the button is live again, with the keyboard still on it.
    reject(new Error('This channel is archived'));
    await d.tick(5);
    expect(join.getAttribute('aria-busy')).toBeNull();
    expect(document.activeElement).toBe(join);
    expect([...document.querySelectorAll('.toast span')].map((n) => n.textContent)).toContain('This channel is archived');
    // Pressed again, it asks again.
    join.click();
    expect(joins).toEqual(['c3', 'c3']);
    view.destroy();
  });
});
