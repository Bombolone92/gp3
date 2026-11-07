/**
 * The shell (review pass 20, lead), driven in node through tests/helpers/dom.js
 * as the pass-19 file is: a fresh DOM and a fresh module registry for every
 * test, Puter faked at `puter.workers.exec`, the conversation column and the
 * huddle window stubbed.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { installDom } from './helpers/dom.js';

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
const banners = [];
vi.mock('../src/lib/notify.js', async (importOriginal) => ({ ...(await importOriginal()), showNotification: (opts) => { banners.push(opts); } }));

const REF = 'abc123def0@teamchat-test';
const OTHER = 'other00000@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dom = null;

/** A fresh DOM and fresh modules; the store opens a small workspace when asked. */
async function boot({ hash = '', width = 1280, routes = {}, ...env } = {}) {
  dom?.uninstall();
  dom = installDom({ hash, width, ...env });
  vi.resetModules();
  globalThis.puter = {
    workers: {
      exec: async (url, init = {}) => {
        const u = new URL(url);
        const hit = Object.entries(routes).find(([k]) => u.pathname.endsWith(k));
        if (!hit) return json({ code: 'not_found', message: 'nope' }, 404);
        return hit[1](u.searchParams, init);
      },
    },
  };
  const { store } = await import('../src/lib/store.js');
  const open = (ref = REF, name = 'Globex') => {
    store.wsId = ref;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.ws = {
      id: ref.split('@')[0], name,
      channels: { c1: { id: 'c1', name: 'general', def: true } },
      members: {
        'u-me': { role: 'member', name: 'Me', username: 'me' },
        'u-dan': { role: 'member', name: 'Dan Ito', username: 'dan' },
      },
    };
    store.me = {
      role: 'member', channels: ['c1'],
      dms: { dm_d: { members: ['u-me', 'u-dan'], createdAt: 3 } },
      reads: {}, mentions: {}, notify: {}, threads: {},
    };
    store.act = { c: {}, p: {}, w: 0, u: 0 };
    store.workspaces = [{ id: REF, name: 'Globex' }, { id: OTHER, name: 'Initech' }];
  };
  store.openWorkspace = async () => { open(); store.emit('workspace'); };
  store.startPolling = () => {};
  store.pokeSync = () => {};
  return { store, open, dom };
}

afterEach(() => {
  dom?.uninstall();
  dom = null;
  delete globalThis.puter;
});

describe('the Files view row', () => {
  it('shows a long file name cut in the middle, its end in view, with the whole name in the title and the accessible name', async () => {
    const name = 'quarterly-report-final-final-really-final-version-2026-09-07.pdf';
    const file = { id: 'f1', name, type: 'application/pdf', size: 1200 };
    const { open, dom: d } = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/files`,
      routes: {
        '/search': (q) => json(q.get('has') === 'file'
          ? { results: [{ conv: 'c1', seq: 3, ts: 1000, user: 'u-dan', text: '', attachments: [file] }], indexed: true }
          : { results: [], indexed: true }),
      },
    });
    open();
    const { createFilesPage } = await import('../src/ui/filesview.js');
    const page = createFilesPage();
    document.body.append(page.el);
    await d.tick(5);
    const strong = page.el.querySelector('.files-text strong');
    expect(strong.textContent).not.toBe(name);
    expect(strong.textContent).toContain('…');
    expect(strong.textContent.endsWith('26-09-07.pdf')).toBe(true);
    expect(strong.getAttribute('title')).toBe(name);
    expect(page.el.querySelector('.files-main').getAttribute('aria-label')).toBe(`Download ${name}`);
    page.destroy();
  });

  it('shows a short name whole, with no title over it', async () => {
    const file = { id: 'f1', name: 'Résumé.pdf', type: 'application/pdf', size: 1200 };
    const { open, dom: d } = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/files`,
      routes: {
        '/search': (q) => json(q.get('has') === 'file'
          ? { results: [{ conv: 'c1', seq: 3, ts: 1000, user: 'u-dan', text: '', attachments: [file] }], indexed: true }
          : { results: [], indexed: true }),
      },
    });
    open();
    const { createFilesPage } = await import('../src/ui/filesview.js');
    const page = createFilesPage();
    document.body.append(page.el);
    await d.tick(5);
    const strong = page.el.querySelector('.files-text strong');
    expect(strong.textContent).toBe('Résumé.pdf');
    expect(strong.hasAttribute('title')).toBe(false);
    page.destroy();
  });

  it('stacks who shared it under the name on tablets and phones, and hides nothing of it', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
    const block = css.match(/@media \(max-width: 1023px\) \{[^}]*\.files-main \{[^}]*\}[\s\S]*?\n\}/);
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/\.files-main \{[^}]*grid-template-columns: 36px minmax\(0, 1fr\)/);
    expect(block[0]).toMatch(/\.files-main \.files-meta \{[^}]*grid-column: 2/);
    expect(block[0]).toMatch(/\.files-main \.att-icon \{[^}]*grid-row: 1 \/ 3/);
    // The sharer's name and where it was shared were hidden below 720px; with
    // the line under the name there is room for them.
    expect(css).not.toMatch(/\.files-meta span \{ display: none; \}/);
  });
});
