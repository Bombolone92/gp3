import { describe, it, expect, vi, afterEach } from 'vitest';
import { installDom } from './helpers/dom.js';
import { readFileSync } from 'node:fs';

const REF = 'abc123def0@globex.puter.work';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dom = null;
let store = null;

/** A fresh DOM and fresh modules, with a small workspace open in the store; `routes` answer the worker's paths by suffix. */
async function boot({ hash = '', routes = {} } = {}) {
  dom?.uninstall();
  dom = installDom({ width: 1280, hash });
  vi.resetModules();
  globalThis.puter = {
    workers: {
      exec: async (url) => {
        const u = new URL(url);
        const hit = Object.entries(routes).find(([k]) => u.pathname.endsWith(k));
        return hit ? hit[1](u.searchParams) : json({ code: 'not_found', message: 'nope' }, 404);
      },
    },
  };
  ({ store } = await import('../src/lib/store.js'));
  store.wsId = REF;
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.ws = {
    id: 'abc123def0', name: 'Globex', owner: 'u-me',
    channels: { c1: { id: 'c1', name: 'general', def: true, count: 3 }, c2: { id: 'c2', name: 'comp-review', private: true, members: ['u-me', 'u-dan'] } },
    members: {
      'u-me': { role: 'owner', name: 'Me', username: 'me', color: 1 },
      'u-dan': { role: 'member', name: 'Dan Ito', username: 'dan', color: 2 },
    },
  };
  store.me = { role: 'owner', channels: ['c1', 'c2'], dms: { dm_d: { members: ['u-me', 'u-dan'], createdAt: 3 } }, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.act = { c: {}, p: {}, w: 0, u: 0 };
  store.workspaces = [{ id: REF, name: 'Globex' }];
  return { store, dom };
}

afterEach(() => {
  store?.stopPolling();
  dom?.uninstall();
  dom = null;
  vi.restoreAllMocks();
});

describe('the headings over search results', () => {
  it('name a channel without its hash beside the hash (or lock) icon, and a direct message by the person', async () => {
    const hit = (conv, seq) => ({ conv, seq, ts: 1000 + seq, user: 'u-dan', text: `ops ${seq}`, kind: 'msg' });
    const { dom: d } = await boot({
      hash: `#/ws/${encodeURIComponent(REF)}/search/ops`,
      routes: { '/search': () => json({ results: [hit('c1', 1), hit('c2', 2), hit('dm_d', 3)], indexed: true }) },
    });
    const { createSearchView } = await import('../src/ui/search.js');
    const view = createSearchView('ops', { onQuery() {} });
    document.body.append(view.el);
    await d.tick(5);
    const heads = [...view.el.querySelectorAll('.search-group')].map((g) => g.textContent.trim());
    expect(heads).toEqual(['general', 'comp-review', 'Dan Ito']);
    view.destroy();
  });
});

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/theme.js', () => ({ applyTheme: vi.fn(), currentTheme: () => 'system', isDark: () => false }));
vi.mock('../src/ui/modal.js', () => ({ confirmDialog: vi.fn(async () => true), closeAllModals: vi.fn(), openModal: vi.fn() }));
vi.mock('../src/lib/router.js', async (importOriginal) => ({ ...(await importOriginal()), navigate: vi.fn() }));

const message = (seq, user = 'u-dan') => ({ seq, user, text: `m${seq}`, ts: 1_700_000_000_000 + seq, kind: 'msg', attachments: [], mentions: [], reactions: {} });

describe('the keyboard on a button of a message\'s hover bar when the list is redrawn', () => {
  it('is handed to the row first and then to the button, since the bar is drawn only for a row that holds the keyboard', async () => {
    const { dom: d } = await boot();
    const { createMessageList } = await import('../src/ui/messagelist.js');
    Object.assign(store.conv('c1'), { loaded: true, seq: 3, hasMore: false, messages: [message(1), message(2), message(3)] });
    store.me.reads.c1 = 3;
    store.act.c.c1 = { s: 3 };
    vi.spyOn(store, 'markRead').mockImplementation(() => {});
    const list = createMessageList({ convId: 'c1', onOpenThread() {}, onShowMember() {} });
    document.body.append(list.el);
    await d.tick(5);
    const row = list.el.querySelector('.msg[data-seq="2"]');
    const button = row.querySelector('.msg-actions button');
    expect(button).toBeTruthy();
    button.focus();
    expect(document.activeElement).toBe(button);
    const label = button.getAttribute('aria-label');
    const order = [];
    list.el.addEventListener('focusin', (e) => order.push(e.target === e.target.closest('.msg') ? 'row' : e.target.getAttribute('aria-label')));
    // A teammate's reaction redraws every row.
    store.emit('messages', { conv: 'c1', reason: 'range' });
    const again = list.el.querySelector('.msg[data-seq="2"]');
    expect(again).not.toBe(row);
    expect(order).toEqual(['row', label]);
    expect(document.activeElement).toBe(again.querySelector('.msg-actions button'));
    expect(document.activeElement.getAttribute('aria-label')).toBe(label);
    await d.tick(2);
    list.destroy();
  });
});

describe('appending a message to a block on a store whose add answers with something other than the document', () => {
  /** A KV whose add appends in place but answers `true`, recording every whole-document write. */
  function fakeKv({ addAppends = true, addThrows = false } = {}) {
    const docs = new Map();
    const sets = [];
    const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
    return {
      docs, sets,
      async get(k) { return clone(docs.get(k)); },
      async set(k, v) { sets.push([k, clone(v)]); docs.set(k, clone(v)); },
      async add(k, v) {
        if (addThrows) throw new Error('add refused');
        if (addAppends) {
          const doc = docs.get(k) || { m: [], x: {} };
          doc.m = [...(doc.m || []), ...v.m];
          docs.set(k, doc);
        }
        return true;
      },
    };
  }
  const withKv = async (kv, fn) => {
    const before = globalThis.me;
    globalThis.me = { puter: { kv, fs: {} } };
    try {
      return await fn();
    } finally {
      globalThis.me = before;
    }
  };

  it('reads the block back and leaves it alone when the message is in it, rather than rewriting it whole', async () => {
    const { appendToBlock } = await import('../worker/lib.js');
    const { KEYS } = await import('../src/shared/blocks.js');
    const kv = fakeKv();
    const key = KEYS.block('c1', 0);
    kv.docs.set(key, { m: [{ s: 1, u: 'u1', t: 'first', ts: 1 }], x: { s1: { r: { '👍': ['u2'] } } } });
    await withKv(kv, () => appendToBlock('c1', 0, { s: 2, u: 'u2', t: 'second', ts: 2 }));
    expect(kv.sets).toEqual([]);
    expect(kv.docs.get(key).m.map((x) => x.s)).toEqual([1, 2]);
    expect(kv.docs.get(key).x.s1.r['👍']).toEqual(['u2']);
  });

  it('still writes the block whole when the store took nothing (a refused or ignored append)', async () => {
    const { appendToBlock } = await import('../worker/lib.js');
    const { KEYS } = await import('../src/shared/blocks.js');
    const key = KEYS.block('c2', 0);
    for (const kv of [fakeKv({ addThrows: true }), fakeKv({ addAppends: false })]) {
      kv.docs.set(key, { m: [{ s: 1, u: 'u1', t: 'first', ts: 1 }], x: {} });
      await withKv(kv, () => appendToBlock('c2', 0, { s: 2, u: 'u2', t: 'second', ts: 2 }));
      expect(kv.sets).toHaveLength(1);
      expect(kv.docs.get(key).m.map((x) => x.s)).toEqual([1, 2]);
    }
  });
});

describe('carrying a workspace\'s revocations to the hosts of its shared channels', () => {
  it('posts each signed word to its host, skips a malformed one, and swallows a host that fails', async () => {
    const { dom: d } = await boot();
    const calls = [];
    globalThis.puter = {
      workers: {
        exec: async (url, init = {}) => {
          calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
          if (url.startsWith('https://down.puter.work')) return new Response('nope', { status: 500 });
          return json({ ok: true });
        },
      },
    };
    const { store: s } = await import('../src/lib/store.js');
    await s.carryRevocations([
      { ref: 'host000001@teamchat-host.puter.work', ch: 'c9', conn: 'cn_1', host: 'Host', token: 'tok-1' },
      { ref: 'not a ref', conn: 'cn_2', token: 'tok-2' },
      { ref: 'gone000002@down', conn: 'cn_3', token: 'tok-3' },
      null,
    ]);
    expect(calls.map((c) => c.url)).toEqual([
      'https://teamchat-host.puter.work/api/connect/revoke',
      'https://down.puter.work/api/connect/revoke',
    ]);
    expect(calls[0].body).toEqual({ conn: 'cn_1', token: 'tok-1' });
    await d.tick(1);
  });

  it('is asked with what the worker answered when an admin removes a member or makes one a guest', async () => {
    const src = readFileSync('src/ui/dialogs.js', 'utf8');
    // Every removal or change of role an admin makes from the app hands the answer's revocations on.
    const removes = [...src.matchAll(/const res = await api\.removeMember\(store\.wsId, [a-z]\.uuid\);\s*\n[^\n]*\n?\s*store\.carryRevocations\(res\?\.revocations\)/g)];
    const roles = [...src.matchAll(/const res = await api\.setRole\(store\.wsId, m\.uuid, role\);\s*\n[^\n]*\n\s*store\.carryRevocations\(res\?\.revocations\)/g)];
    expect(removes).toHaveLength(2);
    expect(roles).toHaveLength(1);
    expect(src.match(/(?<!const res = )await api\.removeMember\(store\.wsId, [a-z]\.uuid\);/g)).toBeNull();
  });
});
