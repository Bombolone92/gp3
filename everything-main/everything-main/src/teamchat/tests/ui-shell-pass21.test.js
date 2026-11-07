/**
 * Twenty-first review pass, the shell: the long press helper and the
 * stylesheet, driven in node through tests/helpers/dom.js (a small DOM:
 * elements, selectors, bubbling events with capture, focus, matchMedia by
 * viewport and pointer; no CSS). Every test boots a fresh DOM and a fresh
 * module registry, as tests/ui-shell-pass19.test.js does.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { installDom } from './helpers/dom.js';

// The conversation column, the huddle dock and the thread panel stand in as
// small boxes: the shell modules under test import them, and none of these
// tests is about them (as tests/ui-shell-pass19.test.js has it).
vi.mock('../src/ui/conversation.js', () => ({
  createConversationView: (convId) => {
    const node = document.createElement('div');
    node.className = 'main';
    node.dataset.conv = convId;
    node.append(document.createElement('textarea'));
    return { el: node, destroy() {}, renderHeader() {}, tab: () => 'messages', setTab() {}, jumpTo() {} };
  },
}));
vi.mock('../src/ui/huddle.js', () => ({
  mountHuddleDock() {},
  joinHuddleFlow() {},
  huddleButton() { return document.createElement('span'); },
  createHuddleBar() { return { el: document.createElement('div'), destroy() {} }; },
}));
vi.mock('../src/ui/panel.js', () => ({
  renderThreadPanel: (panelEl, { onClose }) => {
    const close = document.createElement('button');
    close.className = 'icon-btn panel-close';
    close.addEventListener('click', onClose);
    panelEl.append(close);
    return { destroy() {}, jumpTo() {} };
  },
}));

const REF = 'abc123def0@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dom = null;

afterEach(() => {
  dom?.uninstall();
  dom = null;
  delete globalThis.puter;
});

/** A fresh touch-screen DOM and fresh modules. */
async function boot(env = {}) {
  dom?.uninstall();
  dom = installDom({ coarse: true, hover: false, ...env });
  vi.resetModules();
  return dom;
}

/** A fresh DOM and fresh modules with a faked Puter and a small workspace the store opens when asked (see tests/ui-shell-pass19.test.js). */
async function bootApp({ hash = '', width = 1280, routes = {}, ...env } = {}) {
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

/** A finger going down on `target`, as Chrome on a phone reports it. */
function touchDown(target, { x = 40, y = 40 } = {}) {
  const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
  Object.defineProperties(ev, { pointerType: { value: 'touch' }, clientX: { value: x }, clientY: { value: y } });
  target.dispatchEvent(ev);
  return ev;
}
function touchUp(target) {
  const ev = new PointerEvent('pointerup', { bubbles: true, cancelable: true });
  Object.defineProperties(ev, { pointerType: { value: 'touch' } });
  target.dispatchEvent(ev);
}

describe('a long press on a row, then a tap on a button or a link inside it', () => {
  /** A row with words, a reaction button and a link in it, its menu opening on a long press as a message row's does. */
  async function row() {
    const d = await boot();
    const { attachLongPress } = await import('../src/ui/longpress.js');
    const node = document.createElement('div');
    node.className = 'msg';
    const words = document.createElement('span');
    words.textContent = 'hello there';
    const react = document.createElement('button');
    react.type = 'button';
    react.textContent = '👍 1';
    const link = document.createElement('a');
    link.href = 'https://example.com/';
    link.textContent = 'example.com';
    node.append(words, react, link);
    document.body.append(node);
    const menu = vi.fn();
    attachLongPress(node, menu, { ignore: 'button, a' });
    const reacted = vi.fn();
    react.addEventListener('click', reacted);
    const followed = vi.fn();
    link.addEventListener('click', followed);
    return { d, node, words, react, link, menu, reacted, followed };
  }

  it('lets the tap through where the browser sent no click after the long press (Chrome on Android)', async () => {
    const { d, words, react, link, menu, reacted, followed } = await row();
    // The long press: the menu opens at its time, and the finger lifts with
    // no click to follow, as Android has it (the release is a long tap).
    touchDown(words);
    await d.tick(520);
    expect(menu).toHaveBeenCalledTimes(1);
    touchUp(words);
    // The next tap, on the reaction: a press of its own, whose click is its own.
    touchDown(react);
    touchUp(react);
    react.click();
    expect(reacted).toHaveBeenCalledTimes(1);
    // And on the link after it.
    touchDown(link);
    touchUp(link);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(ev);
    expect(followed).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(false);
    // The menu opened once, for the long press alone.
    expect(menu).toHaveBeenCalledTimes(1);
  });

  it('still swallows the click the same press sends after the menu opened (iOS), and nothing more', async () => {
    const { d, node, words, react, menu, reacted } = await row();
    const opened = vi.fn();
    node.addEventListener('click', opened);
    touchDown(words);
    await d.tick(520);
    expect(menu).toHaveBeenCalledTimes(1);
    touchUp(words);
    // iOS sends the click of the press that was held: the row must not open on it.
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    words.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(opened).not.toHaveBeenCalled();
    // A second click with no press of its own is not the long press's either: it goes through.
    words.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(opened).toHaveBeenCalledTimes(1);
    // A tap on the reaction after all that opens no menu and is not swallowed.
    touchDown(react);
    touchUp(react);
    react.click();
    expect(reacted).toHaveBeenCalledTimes(1);
    expect(menu).toHaveBeenCalledTimes(1);
  });

  it('opens no menu for a press on a button or a link, and swallows no click of theirs', async () => {
    const { d, react, menu, reacted } = await row();
    touchDown(react);
    await d.tick(520);
    expect(menu).not.toHaveBeenCalled();
    touchUp(react);
    react.click();
    expect(reacted).toHaveBeenCalledTimes(1);
  });
});

describe('a second finger on a row a first is pressing (a pinch, a two-finger scroll)', () => {
  /** A finger going down as the browser reports a second one: not the primary pointer. */
  function secondFingerDown(target, { x = 120, y = 40 } = {}) {
    const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperties(ev, { pointerType: { value: 'touch' }, isPrimary: { value: false }, clientX: { value: x }, clientY: { value: y } });
    target.dispatchEvent(ev);
  }
  function cancelPointer(target) {
    const ev = new PointerEvent('pointercancel', { bubbles: true, cancelable: true });
    Object.defineProperties(ev, { pointerType: { value: 'touch' } });
    target.dispatchEvent(ev);
  }

  it('is a gesture, not a long press: the browser taking it over opens no menu', async () => {
    const d = await boot();
    const { attachLongPress } = await import('../src/ui/longpress.js');
    const node = document.createElement('div');
    node.textContent = 'hello there';
    document.body.append(node);
    const menu = vi.fn();
    attachLongPress(node, menu);
    // The first finger, then the second a moment later; the browser then
    // recognises the pinch and cancels the pointers, as Chrome does.
    touchDown(node, { x: 40, y: 40 });
    await d.tick(60);
    secondFingerDown(node);
    await d.tick(60);
    cancelPointer(node);
    await d.tick(520);
    expect(menu).not.toHaveBeenCalled();
  });

  it('is no long press of its own either, while one finger held still is', async () => {
    const d = await boot();
    const { attachLongPress } = await import('../src/ui/longpress.js');
    const node = document.createElement('div');
    node.textContent = 'hello there';
    document.body.append(node);
    const menu = vi.fn();
    attachLongPress(node, menu);
    // Two fingers down and held: the first's press was ended by the second, and the second arms none.
    touchDown(node, { x: 40, y: 40 });
    secondFingerDown(node);
    await d.tick(620);
    expect(menu).not.toHaveBeenCalled();
    touchUp(node);
    // One finger, held: the menu, as before.
    touchDown(node, { x: 40, y: 40 });
    await d.tick(520);
    expect(menu).toHaveBeenCalledTimes(1);
  });
});

describe('the arrow keys from a control of a row that is not the row itself', () => {
  /** A list the way the sidebar and the Later view lay theirs out: a heading, rows of a link with a kebab beside it, and Load more under them. */
  async function list() {
    const d = await boot({ coarse: false, hover: true });
    const { listKeyNav } = await import('../src/ui/dom.js');
    const container = document.createElement('div');
    const heading = document.createElement('button');
    heading.className = 'side-title';
    heading.textContent = 'Channels';
    container.append(heading);
    const rows = [1, 2, 3].map((n) => {
      const row = document.createElement('div');
      row.className = 'side-row';
      const item = document.createElement('a');
      item.className = 'side-item';
      item.href = `#/c/${n}`;
      item.textContent = `row ${n}`;
      const kebab = document.createElement('button');
      kebab.className = 'side-kebab';
      kebab.setAttribute('aria-label', `Options for row ${n}`);
      row.append(item, kebab);
      container.append(row);
      return { row, item, kebab };
    });
    const more = document.createElement('button');
    more.textContent = 'Load more';
    container.append(more);
    document.body.append(container);
    listKeyNav(container, '.side-item');
    return { d, container, heading, rows, more };
  }

  it('step to the row below or above the control\'s own row, not to the top of the list', async () => {
    const { d, rows } = await list();
    rows[1].kebab.focus();
    let ev = d.key(rows[1].kebab, 'ArrowDown');
    expect(document.activeElement).toBe(rows[2].item);
    expect(ev.defaultPrevented).toBe(true);
    rows[1].kebab.focus();
    ev = d.key(rows[1].kebab, 'ArrowUp');
    expect(document.activeElement).toBe(rows[0].item);
    expect(ev.defaultPrevented).toBe(true);
    // The first row's control, going up, and the last row's, going down: nowhere to go, and the key passes.
    rows[0].kebab.focus();
    ev = d.key(rows[0].kebab, 'ArrowUp');
    expect(document.activeElement).toBe(rows[0].kebab);
    expect(ev.defaultPrevented).toBe(false);
    rows[2].kebab.focus();
    ev = d.key(rows[2].kebab, 'ArrowDown');
    expect(document.activeElement).toBe(rows[2].kebab);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('step from a heading or a button between the rows to the nearest row on that side', async () => {
    const { d, heading, rows, more } = await list();
    heading.focus();
    d.key(heading, 'ArrowDown');
    expect(document.activeElement).toBe(rows[0].item);
    heading.focus();
    const up = d.key(heading, 'ArrowUp');
    expect(document.activeElement).toBe(heading);
    expect(up.defaultPrevented).toBe(false);
    more.focus();
    d.key(more, 'ArrowUp');
    expect(document.activeElement).toBe(rows[2].item);
    more.focus();
    const down = d.key(more, 'ArrowDown');
    expect(document.activeElement).toBe(more);
    expect(down.defaultPrevented).toBe(false);
  });

  it('keep Home and End, and the steps between the rows themselves, as they were', async () => {
    const { d, rows } = await list();
    rows[1].kebab.focus();
    d.key(rows[1].kebab, 'End');
    expect(document.activeElement).toBe(rows[2].item);
    rows[1].kebab.focus();
    d.key(rows[1].kebab, 'Home');
    expect(document.activeElement).toBe(rows[0].item);
    d.key(rows[0].item, 'ArrowDown');
    expect(document.activeElement).toBe(rows[1].item);
    d.key(rows[1].item, 'ArrowUp');
    expect(document.activeElement).toBe(rows[0].item);
    // A row hidden by the layout (a folded section) is skipped, as before.
    rows[1].row.hidden = true;
    d.key(rows[0].item, 'ArrowDown');
    expect(document.activeElement).toBe(rows[2].item);
  });
});

describe('the keyboard shortcuts panel\'s search box', () => {
  it('finds a shortcut whatever accents the words typed carry, as the other boxes do', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    ctx.open();
    const { renderShortcutsPanel } = await import('../src/ui/shortcuts.js');
    const panel = document.createElement('aside');
    document.body.append(panel);
    renderShortcutsPanel(panel, { onClose() {} });
    const search = panel.querySelector('.shortcuts-search');
    const whats = () => [...panel.querySelectorAll('.shortcut-what')].map((n) => n.textContent);
    ctx.dom.type(search, 'rép');
    expect(whats()).toContain('Reply in thread');
    expect(whats()).not.toContain('Bold');
    ctx.dom.type(search, 'Édit');
    expect(whats()).toContain('Edit your message');
    // And a word that names none says so, quoting what was typed.
    ctx.dom.type(search, 'zzz');
    expect(whats()).toEqual([]);
    expect(panel.querySelector('.side-empty').textContent).toBe('No shortcut matches “zzz”');
  });
});

describe('a long link listed in Files with no page title', () => {
  /** The Files view over one message whose text is `url`. */
  async function filesWith(url) {
    const ctx = await bootApp({
      hash: `#/ws/${encodeURIComponent(REF)}/files`,
      routes: {
        '/search': (q) => json(q.get('has') === 'link'
          ? { results: [{ conv: 'c1', seq: 3, ts: 1000, user: 'u-dan', text: url, attachments: [] }], indexed: true }
          : { results: [], indexed: true }),
      },
    });
    ctx.open();
    const { createFilesPage } = await import('../src/ui/filesview.js');
    const page = createFilesPage();
    document.body.append(page.el);
    await ctx.dom.tick(5);
    const strong = page.el.querySelector('.files-row a.files-main .files-text strong');
    expect(strong).not.toBeNull();
    return { page, strong };
  }

  it('is cut in the middle, whole characters, its end kept, with the whole address in the title', async () => {
    const url = `https://example.com/${'a'.repeat(56)}😀/rest-of-the-path.html`;
    // The 77th UTF-16 unit is the high half of the emoji: cut there, the row showed half a character.
    expect(/[\uD800-\uDBFF]/.test(url[76])).toBe(true);
    const { page, strong } = await filesWith(url);
    const shown = strong.textContent;
    expect(shown.isWellFormed()).toBe(true);
    expect(shown).toContain('…');
    expect(shown.startsWith('https://example.com/')).toBe(true);
    expect(shown.endsWith('of-the-path.html')).toBe(true);
    expect([...shown].length).toBeLessThanOrEqual(80);
    expect(strong.getAttribute('title')).toBe(url);
    page.destroy();
  });

  it('is shown whole when it is short, with no title over it', async () => {
    const url = 'https://example.com/docs/plan-😀.html';
    const { page, strong } = await filesWith(url);
    expect(strong.textContent).toBe(url);
    expect(strong.hasAttribute('title')).toBe(false);
    page.destroy();
  });
});

describe('the empty result of a filter box, said aloud', () => {
  it('sidebar: "Nothing called …" once the list empties, nothing while rows match, nothing again on a poll', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    ctx.open();
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const nav = document.createElement('nav');
    document.body.append(nav);
    renderSidebar(nav);
    await ctx.dom.tick(5);
    const status = nav.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('');
    const box = nav.querySelector('.side-filter-input');
    ctx.dom.type(box, 'gen');
    expect(status.textContent).toBe('');
    ctx.dom.type(box, 'gene');
    expect(status.textContent).toBe('');
    ctx.dom.type(box, 'genx');
    expect(status.textContent).toBe('Nothing called “genx”');
    expect(nav.querySelector('.side-empty').textContent).toBe('Nothing called “genx”');
    // A poll redraws the list: the same region, its words unchanged, says nothing over again.
    ctx.store.emit('activity');
    await ctx.dom.tick(5);
    expect(nav.querySelector('[role="status"]')).toBe(status);
    expect(status.textContent).toBe('Nothing called “genx”');
    ctx.dom.type(box, 'gen');
    expect(status.textContent).toBe('');
    ctx.dom.type(box, '');
    expect(status.textContent).toBe('');
  });

  it('Direct messages list: who is not there, and "Nothing unread." with the switch on', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/dms`, routes: { '/messages': () => json({ messages: [], seq: 0 }) } });
    ctx.open();
    const { createDmsPane } = await import('../src/ui/dmspane.js');
    const pane = createDmsPane();
    document.body.append(pane.el);
    await ctx.dom.tick(20);
    const status = pane.el.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status.textContent).toBe('');
    const box = pane.el.querySelector('.side-filter-input');
    ctx.dom.type(box, 'dan');
    expect(status.textContent).toBe('');
    ctx.dom.type(box, 'dna');
    expect(status.textContent).toBe('Nobody called “dna”');
    expect(pane.el.querySelector('.side-empty').textContent).toBe('Nobody called “dna”');
    ctx.dom.type(box, '');
    expect(status.textContent).toBe('');
    // The Unreads switch, with nothing unread: said once, and taken back when the switch is.
    const toggle = pane.el.querySelector('[role="switch"]');
    toggle.click();
    expect(status.textContent).toBe('Nothing unread.');
    toggle.click();
    expect(status.textContent).toBe('');
    pane.destroy();
  });

  it('Directory: "Nobody matches" and "No channels match" once the cards empty', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/directory` });
    ctx.open();
    const { createDirectoryView } = await import('../src/ui/directory.js');
    const view = createDirectoryView();
    document.body.append(view.el);
    await ctx.dom.tick(5);
    const status = view.el.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status.textContent).toBe('');
    const box = view.el.querySelector('.dir-search');
    ctx.dom.type(box, 'da');
    expect(status.textContent).toBe('');
    ctx.dom.type(box, 'dax');
    expect(status.textContent).toBe('Nobody matches');
    // The Channels tab with the same words: no channel is called that either.
    view.el.querySelectorAll('[role="tab"]')[1].click();
    expect(status.textContent).toBe('No channels match');
    ctx.dom.type(box, 'gen');
    expect(status.textContent).toBe('');
    view.destroy();
  });
});

describe('the Files view\'s empty states, said aloud', () => {
  const file = { conv: 'c1', seq: 3, ts: 1000, user: 'u-dan', text: '', attachments: [{ id: 'f1', name: 'plan.pdf', type: 'application/pdf', size: 10 }] };

  it('says nothing is shared yet; with a row, nothing, until the words typed match nothing', async () => {
    let files = [];
    const ctx = await bootApp({
      hash: `#/ws/${encodeURIComponent(REF)}/files`,
      routes: { '/search': (q) => json(q.get('has') === 'file' ? { results: files, indexed: true } : { results: [], indexed: true }) },
    });
    ctx.open();
    const { createFilesPage } = await import('../src/ui/filesview.js');
    const page = createFilesPage();
    document.body.append(page.el);
    await ctx.dom.tick(5);
    const status = page.el.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status.textContent).toBe('No files or links here yet');
    page.destroy();
    files = [file];
    const page2 = createFilesPage();
    document.body.append(page2.el);
    await ctx.dom.tick(5);
    const status2 = page2.el.querySelector('[role="status"]');
    expect(status2.textContent).toBe('');
    const box = page2.el.querySelector('.files-search');
    ctx.dom.type(box, 'pla');
    expect(status2.textContent).toBe('');
    ctx.dom.type(box, 'plax');
    expect(status2.textContent).toBe('Nothing matches');
    expect(page2.el.querySelector('.empty h3').textContent).toBe('Nothing matches');
    ctx.dom.type(box, '');
    expect(status2.textContent).toBe('');
    page2.destroy();
  });

  it('says the list could not load, and lets the word of an older page\'s failure stand while the rows do', async () => {
    let fail = true;
    const ctx = await bootApp({
      hash: `#/ws/${encodeURIComponent(REF)}/files`,
      routes: {
        '/search': (q) => (fail ? json({ code: 'bad', message: 'Worker down' }, 400)
          : json(q.get('has') === 'file' ? { results: [file], indexed: true, hasMore: !q.get('cursor'), cursor: q.get('cursor') ? null : 'c2' } : { results: [], indexed: true })),
      },
    });
    ctx.open();
    const { createFilesPage } = await import('../src/ui/filesview.js');
    const page = createFilesPage();
    document.body.append(page.el);
    await ctx.dom.tick(5);
    const status = page.el.querySelector('[role="status"]');
    expect(status.textContent).toBe('Could not load files and links');
    // Try again, with the worker answering: rows, and nothing said of them.
    fail = false;
    page.el.querySelector('.empty button').click();
    await ctx.dom.tick(5);
    expect(page.el.querySelectorAll('.files-row').length).toBe(1);
    expect(status.textContent).toBe('');
    // An older page that cannot be read: said, and left standing over the rows.
    fail = true;
    [...page.el.querySelectorAll('button')].find((b) => b.textContent === 'Load older files and links').click();
    await ctx.dom.tick(5);
    expect(status.textContent).toBe('Could not load older files and links');
    expect(page.el.querySelectorAll('.files-row').length).toBe(1);
    page.destroy();
  });
});

describe('the Threads, Activity, Later and Drafts lists\' empty states, said aloud', () => {
  it('Later: "Nothing saved", then "No reminders" for the filter chosen, then nothing once rows show', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/later` });
    ctx.open();
    const { store } = ctx;
    store.loadSaved = async () => [];
    store.loadScheduled = async () => ({ reminders: [], scheduled: [] });
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('later');
    document.body.append(view.el);
    await ctx.dom.tick(5);
    const status = view.el.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('Nothing saved');
    expect(view.el.querySelector('.empty h3').textContent).toBe('Nothing saved');
    // Reminders chosen: the radio keeps the keyboard, and the list's new word is said.
    const radios = [...view.el.querySelectorAll('[role="radio"]')];
    radios[1].click();
    await ctx.dom.tick(5);
    expect(status.textContent).toBe('No reminders');
    // Saved again, now with an item: nothing is said of the rows.
    store.loadSaved = async () => [{ c: 'c1', s: 1, ts: 1000, done: false, message: { seq: 1, user: 'u-dan', ts: 1000, text: 'keep this', kind: 'msg', attachments: [], mentions: [], reactions: {} } }];
    radios[0].click();
    await ctx.dom.tick(5);
    expect(view.el.querySelectorAll('.later-row').length).toBe(1);
    expect(status.textContent).toBe('');
    view.destroy();
  });

  it('Threads: says the list could not load', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/threads`, routes: { '/threads': () => json({ code: 'bad', message: 'Worker down' }, 400) } });
    ctx.open();
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('threads');
    document.body.append(view.el);
    await ctx.dom.tick(5);
    const status = view.el.querySelector('[role="status"]');
    expect(status.textContent).toBe('Could not load threads');
    expect(view.el.querySelector('.empty h3').textContent).toBe('Could not load threads');
    view.destroy();
  });
});

describe('the browser\'s theme-color metas and the theme stamped before the first paint', () => {
  /** The page as index.html has it: two metas bound to the system's scheme, and the theme stamped from this device's choice. */
  async function page({ stamped, dark = false }) {
    dom?.uninstall();
    dom = installDom({ dark });
    vi.resetModules();
    const metas = [['light', '#f7f7f5'], ['dark', '#0f0f10']].map(([scheme, color]) => {
      const m = document.createElement('meta');
      m.setAttribute('name', 'theme-color');
      m.setAttribute('content', color);
      m.setAttribute('media', `(prefers-color-scheme: ${scheme})`);
      document.head.append(m);
      return m;
    });
    if (stamped) document.documentElement.dataset.theme = stamped;
    const theme = await import('../src/ui/theme.js');
    return { metas, theme, colors: () => metas.map((m) => m.getAttribute('content')) };
  }

  it('follow a dark theme chosen on this device on a light system from the moment the app loads', async () => {
    const { colors } = await page({ stamped: 'dark' });
    expect(colors()).toEqual(['#0f0f10', '#0f0f10']);
  });

  it('follow a light theme chosen on a dark system the same way', async () => {
    const { colors } = await page({ stamped: 'light', dark: true });
    expect(colors()).toEqual(['#f7f7f5', '#f7f7f5']);
  });

  it('follow the system with no theme stamped, and the choice made later in the app', async () => {
    const { colors, theme } = await page({});
    expect(colors()).toEqual(['#f7f7f5', '#f7f7f5']);
    theme.applyTheme('dark');
    expect(colors()).toEqual(['#0f0f10', '#0f0f10']);
    theme.applyTheme('system');
    expect(colors()).toEqual(['#f7f7f5', '#f7f7f5']);
  });
});

/** The whole shell mounted over bootApp's workspace, the way tests/lead-pass19-shell.test.js boots it. */
async function bootShell(opts) {
  const ctx = await bootApp(opts);
  ctx.store.workspaces = [{ id: REF, name: 'Globex' }];
  ctx.store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  const { mountShell } = await import('../src/ui/shell.js');
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(app);
  mountShell(app);
  await ctx.dom.tick(20);
  return ctx;
}

describe('the top bar\'s search box and its list of recent searches', () => {
  it('closes the list on Escape pressed on one of its rows, the keyboard back in the box; the up arrow from the first row keeps it open', async () => {
    const ctx = await bootShell({ hash: `#/ws/${encodeURIComponent(REF)}/c/c1` });
    const { noteSearch } = await import('../src/lib/recent.js');
    noteSearch(REF, 'build');
    noteSearch(REF, 'deploy');
    const input = document.querySelector('.top-search-input');
    const drop = document.querySelector('.top-search-drop');
    input.focus();
    await ctx.dom.tick(2);
    expect(drop.hidden).toBe(false);
    // Down into the list (the open conversation's scope first, then the searches), and Escape from a row.
    ctx.dom.key(input, 'ArrowDown');
    expect(document.activeElement.matches('.top-drop-scope')).toBe(true);
    ctx.dom.key(document.activeElement, 'ArrowDown');
    expect(document.activeElement.matches('.top-drop-main')).toBe(true);
    expect(document.activeElement.textContent.trim()).toBe('deploy');
    const esc = ctx.dom.key(document.activeElement, 'Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(drop.hidden).toBe(true);
    expect(input.value).toBe('');
    // Shown again by the box taking the keyboard: up from the first row is a step back to the box with the list left open.
    input.blur();
    input.focus();
    await ctx.dom.tick(2);
    expect(drop.hidden).toBe(false);
    ctx.dom.key(input, 'ArrowDown');
    ctx.dom.key(document.activeElement, 'ArrowUp');
    expect(document.activeElement).toBe(input);
    expect(drop.hidden).toBe(false);
    // Escape in the box with the list open closes the list and nothing more; Enter on a row runs the search.
    ctx.dom.key(input, 'Escape');
    expect(drop.hidden).toBe(true);
    input.blur();
    input.focus();
    await ctx.dom.tick(2);
    ctx.dom.key(input, 'ArrowDown');
    ctx.dom.key(document.activeElement, 'ArrowDown');
    document.activeElement.click();
    await ctx.dom.tick(5);
    expect(location.hash).toBe(`#/ws/${encodeURIComponent(REF)}/search/deploy`);
    expect(input.value).toBe('deploy');
    expect(drop.hidden).toBe(true);
  });
});

describe('a reminder\'s Snooze menu standing open while the Later list is drawn again', () => {
  it('keeps the row lit on its replacement under the menu, and lets both rows go when the menu closes', async () => {
    const ctx = await bootApp({ hash: `#/ws/${encodeURIComponent(REF)}/later` });
    ctx.open();
    const { store } = ctx;
    const message = { seq: 1, user: 'u-dan', ts: 1000, text: 'water the plants', kind: 'msg', attachments: [], mentions: [], reactions: {} };
    store.loadSaved = async () => [];
    store.loadScheduled = async () => ({ reminders: [{ id: 'r1', kind: 'reminder', conv: 'c1', seq: 1, dueAt: Date.now() + 3_600_000, note: '', message }], scheduled: [] });
    const { createListView } = await import('../src/ui/views.js');
    const view = createListView('later', { pane: true });
    document.body.append(view.el);
    await ctx.dom.tick(5);
    [...view.el.querySelectorAll('[role="radio"]')][1].click(); // Reminders
    await ctx.dom.tick(5);
    const row = view.el.querySelector('.later-row');
    expect(row).not.toBeNull();
    const snooze = row.querySelector('[aria-label="Snooze"]');
    snooze.focus();
    snooze.click();
    await ctx.dom.tick(2);
    expect(document.querySelector('.menu[role="menu"]')).not.toBeNull();
    expect(row.classList.contains('menu-open')).toBe(true);
    // The list is drawn again under the open menu (the pane redraws with the route).
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await ctx.dom.tick(2);
    const again = view.el.querySelector('.later-row');
    expect(again).not.toBe(row);
    expect(again.classList.contains('menu-open')).toBe(true);
    expect(document.querySelector('.menu[role="menu"]')).not.toBeNull();
    // The menu closes: neither the row it opened on nor the one now showing the reminder keeps the class.
    ctx.dom.key(document.activeElement, 'Escape');
    await ctx.dom.tick(2);
    expect(document.querySelector('.menu[role="menu"]')).toBeNull();
    expect(again.classList.contains('menu-open')).toBe(false);
    expect(row.classList.contains('menu-open')).toBe(false);
    view.destroy();
  });
});

describe('the sharer\'s line under a file\'s name on a tablet or a phone, in the stylesheet', () => {
  // The fake DOM applies no CSS, so the contract is read from the text, as
  // the pass-19 file reads the done mark's touch rule.
  const read = (name) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('lets the name and the where give way, the where first, while the face and the time keep their size', () => {
    const app = read('app.css');
    // The line is a nowrap flex row (its items shrink no further than their words unless told they may).
    expect(app).toMatch(/\.files-meta \{ display: flex;[^}]*white-space: nowrap; \}/);
    // The block that puts the line under the name below 1024px.
    const start = app.indexOf('.files-main { grid-template-columns: 36px minmax(0, 1fr);');
    expect(start).toBeGreaterThan(0);
    expect(app.slice(app.lastIndexOf('@media', start), start)).toMatch(/^@media \(max-width: 1023px\) \{\s*$/);
    const block = app.slice(start, app.indexOf('\n}', start));
    expect(block).toMatch(/\.files-main \.files-meta \{ grid-column: 2; min-width: 0; \}/);
    // Both words may be cut with an ellipsis: the sharer's name and the where.
    expect(block).toMatch(/\.files-meta > span \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/);
    // The where gives way first, by a wide margin.
    expect(block).toMatch(/\.files-meta > \.files-where \{ flex-shrink: 1000; \}/);
    // The time keeps its size (a cut date reads as another date); the face already does (.avatar is flex: none).
    expect(block).toMatch(/\.files-meta > time \{ flex: none; \}/);
    expect(read('components.css')).toMatch(/\.avatar \{[^}]*flex: none;/);
    // And nothing in the block pins the name to its full width.
    expect(block).not.toMatch(/:not\(\.files-where\)/);
    expect(block).not.toMatch(/\.files-meta > span \{[^}]*flex: none/);
  });
});
