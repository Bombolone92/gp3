/**
 * Twenty-seventh review pass (lead), driven in node through
 * tests/helpers/dom.js (a small DOM: elements, selectors, bubbling events,
 * focus; no CSS). Every test boots a fresh DOM and a fresh module registry.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { installDom } from './helpers/dom.js';

// Every test here imports the app's modules afresh (vi.resetModules), and
// the first import of the graph runs past vitest's 5 s under the load of
// several suites at once: room for it, rather than a flake per gate.
vi.setConfig({ testTimeout: 20_000 });

const REF = 'abc123def0@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dom = null;
let store = null;

afterEach(async () => {
  await dom?.tick(5);
  store?.stopPolling();
  for (const t of store?._readTimers?.values() || []) clearTimeout(t);
  store?._readTimers?.clear();
  store = null;
  dom?.uninstall();
  dom = null;
  delete globalThis.puter;
  vi.restoreAllMocks();
});

/** A fresh DOM and fresh modules with a faked Puter, a small workspace already open, and the reader's own space beside a DM with Ana. */
async function boot({ width = 1280, ...env } = {}) {
  dom?.uninstall();
  dom = installDom({ width, ...env });
  vi.resetModules();
  globalThis.puter = { workers: { exec: async () => json({ code: 'not_found', message: 'nope' }, 404) } };
  ({ store } = await import('../src/lib/store.js'));
  store.wsId = REF;
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.ws = {
    id: 'abc123def0', name: 'Globex', owner: 'u-me',
    channels: { c1: { id: 'c1', name: 'general', def: true, count: 2 } },
    members: {
      'u-me': { role: 'member', name: 'Me', username: 'me', color: 1 },
      u2: { role: 'member', name: 'Ana Rocha', username: 'ana', color: 2 },
    },
  };
  store.me = {
    role: 'member', channels: ['c1'],
    dms: { dm_ana: { members: ['u-me', 'u2'], createdAt: 2 }, dm_me: { members: ['u-me'], createdAt: 1 } },
    reads: {}, mentions: {}, notify: {}, threads: {},
  };
  store.act = { c: {}, p: {}, w: 0, u: 0 };
  store.workspaces = [{ id: REF, name: 'Globex' }];
  vi.spyOn(store, 'noteTyping').mockImplementation(() => {});
  vi.spyOn(store, 'stopTyping').mockImplementation(() => {});
  vi.spyOn(store, 'markRead').mockImplementation(() => {});
  return { store, dom };
}

describe("the reader's own space is named as theirs", () => {
  it('is titled with their name and "(you)", where a DM is titled by the other person', async () => {
    await boot();
    expect(store.convTitle('dm_me')).toBe('Me (you)');
    expect(store.dmTitle({ others: [] })).toBe('Me (you)');
    expect(store.convTitle('dm_ana')).toBe('Ana Rocha');
  });

  it('the sidebar row and the header say so, and the box invites a note rather than a message to oneself', async () => {
    await boot();
    const { renderSidebar } = await import('../src/ui/sidebar.js');
    const nav = document.createElement('nav');
    document.body.append(nav);
    renderSidebar(nav);
    await dom.tick(3);
    const rows = [...nav.querySelectorAll('a.side-item')];
    const mine = rows.find((a) => a.getAttribute('href')?.includes('dm_me'));
    const ana = rows.find((a) => a.getAttribute('href')?.includes('dm_ana'));
    expect(mine?.querySelector('.side-label').textContent).toBe('Me (you)');
    expect(mine?.getAttribute('aria-label')).toMatch(/^Me \(you\)/);
    expect(ana?.querySelector('.side-label').textContent).toBe('Ana Rocha');
    nav.remove();

    const { createConversationView } = await import('../src/ui/conversation.js');
    for (const [conv, title, placeholder] of [['dm_me', 'Me (you)', 'Jot something down'], ['dm_ana', 'Ana Rocha', 'Message Ana Rocha']]) {
      Object.assign(store.conv(conv), { loaded: true, seq: 0, hasMore: false, messages: [] });
      const view = createConversationView(conv, { onOpenThread() {}, onOpenDetails() {} });
      document.body.append(view.el);
      await dom.tick(3);
      expect(view.el.querySelector('.conv-title').textContent).toBe(title);
      expect(view.el.querySelector('textarea').getAttribute('placeholder')).toBe(placeholder);
      view.destroy();
    }
  });
});

describe('names of sixty letters and no space', () => {
  const css = async () => (await import('node:fs')).readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (text, selector) => text.match(new RegExp(`${selector.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`))?.[1];

  it('a long channel name in the intro heading wraps at phone width (the paragraph under it already did)', async () => {
    expect(rule(await css(), '.conv-intro h2')).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("a member's long name wraps inside their Directory card rather than running out of it", async () => {
    const r = rule(await css(), '.dir-card-name');
    expect(r).toMatch(/overflow-wrap:\s*anywhere/);
    expect(r).toMatch(/flex-wrap:\s*wrap/);
    expect(r).toMatch(/min-width:\s*0/);
  });

  it("a member's long name and title wrap inside their card popover", async () => {
    await boot();
    store.ws.members.u2.name = 'Alexandrina'.repeat(6).slice(0, 60);
    store.ws.members.u2.title = 'Principal'.repeat(9).slice(0, 80);
    const { showMemberCard } = await import('../src/ui/dialogs.js');
    const anchor = document.createElement('button');
    document.body.append(anchor);
    showMemberCard('u2', anchor);
    await dom.tick(2);
    const card = document.querySelector('.menu');
    expect(card).toBeTruthy();
    const name = [...card.querySelectorAll('div')].find((d) => d.textContent === store.ws.members.u2.name);
    expect(name).toBeTruthy();
    const column = name.parentElement;
    expect(column.style.overflowWrap).toBe('anywhere');
    expect(String(column.style.minWidth)).toMatch(/^0(px)?$/);
    expect(column.contains([...card.querySelectorAll('div')].find((d) => d.textContent === store.ws.members.u2.title))).toBe(true);
  });
});

describe('what a screen reader lands on (an axe-core run over the live app)', () => {
  const css = async (file) => (await import('node:fs')).readFileSync(new URL(`../src/styles/${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('a pane beside an empty main column leaves the page a first-level heading: the column\'s own words', async () => {
    await boot();
    const { mountShell } = await import('../src/ui/shell.js');
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    store.openWorkspace = async () => { store.emit('workspace'); };
    store.startPolling = () => {};
    store.pokeSync = () => {};
    mountShell(app);
    location.hash = `#/ws/${encodeURIComponent(REF)}/activity`;
    window.dispatchEvent(new Event('hashchange'));
    await dom.tick(20);
    const main = document.querySelector('[role="main"]');
    expect(main).toBeTruthy();
    const h1 = main.querySelector('h1');
    expect(h1?.textContent).toBe('Pick something from Activity');
    expect(main.querySelector('h3')).toBeNull();
    // Styled as the empty state's heading, whichever level it is.
    expect((await css('components.css')).match(/\.empty h1, \.empty h3 \{([^}]*)\}/)?.[1]).toMatch(/font-size:\s*17px/);
  });

  it('the search results page carries a heading naming the words searched, said and not shown', async () => {
    await boot();
    const { createSearchView } = await import('../src/ui/search.js');
    const view = createSearchView('deploy', { onQuery() {} });
    document.body.append(view.el);
    await dom.tick(3);
    const h1 = view.el.querySelector('h1');
    expect(h1?.className).toContain('visually-hidden');
    expect(h1?.textContent).toBe('Search results for “deploy”');
    view.setQuery('');
    expect(h1.textContent).toBe('Search');
    view.destroy();
  });

  it('the Files view\'s "Photos" strip is headed one level under the view\'s title', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/ui/filesview.js', import.meta.url), 'utf8');
    expect(src).toMatch(/el\('h2\.files-head'/);
    expect(src).not.toMatch(/el\('h3\.files-head'/);
  });

  it('a link among a message\'s words is underlined, not told apart by colour alone', async () => {
    const app = await css('app.css');
    const rule = app.match(/\.msg-text a \{([^}]*)\}/)?.[1];
    expect(rule).toMatch(/text-decoration:\s*underline/);
    expect(rule).toMatch(/text-underline-offset/);
    // Mentions are spans and keep their look: no underline rule names them.
    expect(app).not.toMatch(/\.mention[^{]*\{[^}]*text-decoration:\s*underline/);
  });
});
