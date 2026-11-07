/**
 * The member document's refresh against a read in flight: what the store
 * keeps of its own reading when the worker's answer predates it. Puter is
 * faked at `puter.workers.exec`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { store } from '../src/lib/store.js';

const REF = 'abc123def0@teamchat-test';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

let meFromServer;
let gate = null; // when set, the bootstrap answer waits on it

beforeEach(() => {
  gate = null;
  globalThis.puter = {
    workers: {
      exec: async (url) => {
        const path = new URL(url).pathname;
        if (path === '/api/ws/abc123def0') {
          if (gate) await gate;
          return json({
            workspace: { id: 'abc123def0', name: 'Test', channels: { general: { id: 'general', name: 'general' } }, members: { alice: { username: 'alice', name: 'Alice', color: 1, role: 'owner' } } },
            me: meFromServer,
            activity: { c: { general: { s: 5, t: 1 } }, w: 1, u: {} },
            now: Date.now(),
          });
        }
        if (path.endsWith('/read')) return json({ ok: true });
        return json({ code: 'not_found' }, 404);
      },
    },
  };
  store.wsId = REF;
  store.profile = { uuid: 'alice', username: 'alice', name: 'Alice', color: 1 };
  store.ws = { id: 'abc123def0', name: 'Test', channels: { general: { id: 'general', name: 'general' } }, members: { alice: { username: 'alice', name: 'Alice', color: 1, role: 'owner' } } };
  store.me = { dms: {}, channels: ['general'], notify: {}, reads: { general: 5 }, mentions: {}, threads: {} };
  store.act = { c: { general: { s: 5, t: 1 } }, w: 0, u: 0 };
  store.huddles = {};
  store._localSeen.clear();
  store._seenAt.clear();
});

afterEach(() => {
  for (const t of store._readTimers.values()) clearTimeout(t);
  store._readTimers.clear();
});

describe('refreshWorkspace against a read in flight', () => {
  it('keeps a mention badge on a channel the reader finished before the request went out (a mention in one of its threads)', async () => {
    store._localSeen.set('general', 5);
    store.markRead('general', 5); // read to the end, a while ago
    await new Promise((r) => setTimeout(r, 5));
    meFromServer = { dms: {}, channels: ['general'], notify: {}, reads: { general: 5 }, mentions: { general: 1 }, threads: {} };
    await store.refreshWorkspace();
    expect(store.mentionCount('general')).toBe(1);
  });

  it('drops a count the answer\'s document did not yet know was read', async () => {
    // The cursor stands at 4 here as on the worker; the list reaches 5.
    store.me.reads = { general: 4 };
    meFromServer = { dms: {}, channels: ['general'], notify: {}, reads: { general: 4 }, mentions: { general: 1 }, threads: {} };
    let release;
    gate = new Promise((r) => { release = r; });
    const refresh = store.refreshWorkspace();
    await new Promise((r) => setTimeout(r, 5));
    // The list reaches its end while the answer is on its way.
    store.markRead('general', 5);
    release();
    await refresh;
    expect(store.mentionCount('general')).toBe(0);
  });

  it('keeps a count when messages newer than what was seen have arrived meanwhile', async () => {
    meFromServer = { dms: {}, channels: ['general'], notify: {}, reads: { general: 4 }, mentions: { general: 1 }, threads: {} };
    let release;
    gate = new Promise((r) => { release = r; });
    const refresh = store.refreshWorkspace();
    await new Promise((r) => setTimeout(r, 5));
    store.markRead('general', 4); // seen to 4; the channel is at 5
    release();
    await refresh;
    expect(store.mentionCount('general')).toBe(1);
  });
});

describe('two refreshes in flight', () => {
  it('keeps the answer to the later request when the earlier one lands last', async () => {
    const releases = [];
    const docs = [
      { channels: ['general'], u: 5 }, // asked first: the poll's refetch, slow
      { channels: ['general', 'ops'], u: 6 }, // asked second: after joining #ops
    ];
    globalThis.puter.workers.exec = async (url) => {
      const path = new URL(url).pathname;
      if (path !== '/api/ws/abc123def0') return json({ code: 'not_found' }, 404);
      const d = docs[releases.length];
      await new Promise((r) => { releases.push(r); });
      return json({
        workspace: { id: 'abc123def0', name: 'Test', channels: { general: { id: 'general', name: 'general' }, ops: { id: 'ops', name: 'ops' } }, members: store.ws.members },
        me: { dms: {}, channels: d.channels, notify: {}, reads: {}, mentions: {}, threads: {} },
        activity: { c: {}, w: 1, u: { alice: d.u } },
        now: Date.now(),
      });
    };
    const first = store.refreshWorkspace();
    await new Promise((r) => setTimeout(r, 2));
    const second = store.refreshWorkspace();
    await new Promise((r) => setTimeout(r, 2));
    expect(releases).toHaveLength(2);
    releases[1]();
    await second;
    expect(store.me.channels).toEqual(['general', 'ops']);
    releases[0]();
    await first;
    expect(store.me.channels).toEqual(['general', 'ops']); // the older answer is not applied over the newer
    expect(store.act.u).toBe(6);
  });
});

describe('a read still in its debounce when a refresh starts', () => {
  it('keeps the badge cleared, and trusts the document only once built after the read landed', async () => {
    store.me = { dms: {}, channels: ['general'], notify: {}, reads: { general: 4 }, mentions: { general: 1 }, threads: {} };
    const reads = [];
    let serverMentions = 1;
    const base = globalThis.puter.workers.exec;
    globalThis.puter.workers.exec = async (url, init) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/read')) {
        reads.push(JSON.parse(init.body));
        serverMentions = 0;
        return json({ ok: true });
      }
      meFromServer = { dms: {}, channels: ['general'], notify: {}, reads: { general: serverMentions ? 4 : 5 }, mentions: serverMentions ? { general: 1 } : {}, threads: {} };
      return base(url, init);
    };
    // The reader reaches the end: cleared locally, the read debounced.
    store.markRead('general', 5);
    expect(store.mentionCount('general')).toBe(0);
    await new Promise((r) => setTimeout(r, 30));
    // A stamp moved meanwhile (a reaction to one of their messages): the
    // document is fetched before the read has gone out.
    let release;
    gate = new Promise((r) => { release = r; });
    const refresh = store.refreshWorkspace();
    await new Promise((r) => setTimeout(r, 20));
    release();
    await refresh;
    expect(reads).toEqual([]);
    expect(store.mentionCount('general')).toBe(0);
    // The read lands; a refresh started after that trusts the document (0 by then).
    await new Promise((r) => setTimeout(r, 700));
    expect(reads.length).toBe(1);
    gate = null;
    await store.refreshWorkspace();
    expect(store.mentionCount('general')).toBe(0);
    expect(store._seenAt.has('general')).toBe(false);
    // And a mention arriving later (in a thread of the channel, say) shows.
    // The document carries the reply's own thread entry beside the count, as
    // the worker's does (the entry is written before the count is): without
    // it, a count on a conversation read to its end and unchanged since is a
    // count for what was read (see _healStuckMentions).
    serverMentions = 1;
    const withoutReply = globalThis.puter.workers.exec;
    globalThis.puter.workers.exec = async (url, init) => {
      const res = await withoutReply(url, init);
      if (!new URL(url).pathname.endsWith('/api/ws/abc123def0')) return res;
      const d = await res.json();
      d.activity.c.general_t2 = { s: 1, t: Date.now(), u: 'bob' };
      return json(d);
    };
    await store.refreshWorkspace();
    expect(store.mentionCount('general')).toBe(1);
  });
});

describe('one\'s own message from another tab', () => {
  it('is not unread here: the worker moved this member\'s cursor as it wrote it', () => {
    store.me.reads = { general: 5 };
    store._localSeen.clear();
    const folded = store._foldActivity({ general: { s: 6, t: 2, u: 'alice' } }, null);
    expect(folded.changed).toBe(true);
    expect(folded.newIn).toEqual([]);
    expect(store.unreadCount('general')).toBe(0);
    expect(store.me.reads.general).toBe(6);
    // Someone else's message still counts.
    const again = store._foldActivity({ general: { s: 7, t: 3, u: 'bob' } }, null);
    expect(again.newIn).toEqual([{ conv: 'general', from: 'bob', seq: 7 }]);
    expect(store.unreadCount('general')).toBe(1);
  });
});

describe('a refresh of a workspace that moved, landing after its copy at the new address opened', () => {
  it('is not applied to the copy: the two share an id, but not a server', async () => {
    let release;
    const slow = new Promise((r) => { release = r; });
    globalThis.puter.workers.exec = async (url) => {
      const u = new URL(url);
      if (u.pathname !== '/api/ws/abc123def0') return json({ code: 'not_found' }, 404);
      // The old owner's worker: the read-only copy a transfer left behind, slow to answer.
      if (u.host === 'teamchat-test.puter.work') {
        await slow;
        return json({
          workspace: { id: 'abc123def0', name: 'Test', movedTo: 'abc123def0@other-test', channels: {}, members: store.ws?.members || {} },
          me: { dms: {}, channels: [], notify: {}, reads: {}, mentions: {}, threads: {} },
          activity: { c: {}, w: 9, u: { alice: 9 } },
          now: Date.now(),
        });
      }
      // The new owner's worker: the import kept the workspace's id.
      return json({
        workspace: { id: 'abc123def0', name: 'Test (new home)', channels: { general: { id: 'general', name: 'general' } }, members: { alice: { username: 'alice', name: 'Alice', color: 1, role: 'admin' } } },
        me: { dms: {}, channels: ['general'], notify: {}, reads: {}, mentions: {}, threads: {} },
        activity: { c: {}, w: 1, u: { alice: 1 } },
        now: Date.now(),
      });
    };
    const late = store.refreshWorkspace();
    await new Promise((r) => setTimeout(r, 2));
    // The reader follows the move: what openWorkspace does on a switch, then the new copy's bootstrap.
    store.wsId = 'abc123def0@other-test';
    store.ws = null;
    store.me = null;
    store.act = { c: {}, p: {}, w: 0, u: 0 };
    store._applyBootstrap(await (await globalThis.puter.workers.exec('https://other-test.puter.work/api/ws/abc123def0')).json());
    expect(store.ws.name).toBe('Test (new home)');
    release();
    await late;
    expect(store.ws.name).toBe('Test (new home)');
    expect(store.ws.movedTo).toBeUndefined();
    expect(store.me.channels).toEqual(['general']);
    expect(store.act.w).toBe(1);
  });
});
