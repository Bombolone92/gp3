/**
 * Tenth review pass, client libraries: what a window has reached when the
 * poll reads past deleted messages, the outbox's handoff across workspaces
 * and across a host's lapsed attestation, and the channel join and leave
 * flows when the refresh after them fails. Puter is faked at
 * `puter.workers.exec`, as in tests/store.test.js.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { store } from '../src/lib/store.js';

const REF = 'abc123def0@teamchat-test';
const HOST = 'host00host@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Route each call by the end of its path; a handler may throw to stand for a network failure. */
function worker(routes) {
  const calls = [];
  globalThis.puter = {
    workers: {
      exec: async (url, init = {}) => {
        const u = new URL(url);
        calls.push(`${init.method || 'GET'} ${u.pathname}`);
        const hit = Object.entries(routes).find(([k]) => u.pathname.endsWith(k));
        if (!hit) return json({ code: 'not_found', message: 'nope' }, 404);
        return hit[1](u.searchParams, init);
      },
    },
  };
  return calls;
}

function openPlain() {
  store.wsId = REF;
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.ws = { id: 'abc123def0', name: 'Globex', channels: { c1: { id: 'c1', name: 'ops' } }, members: { 'u-me': { role: 'member', name: 'Me', username: 'me' } } };
  store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.act = { c: {}, p: {}, w: 0, u: 0 };
}

afterEach(() => {
  store.wsId = null;
  store.ws = null;
  store.me = null;
  store.profile = null;
  store.links = new Map();
  store.convs.clear();
  store._localSeen.clear();
  store._seenAt.clear();
  delete globalThis.puter;
});

describe('fetchNewer and what the window has reached', () => {
  it('reads on from the counter when the window holds no message (its newest all deleted), not from the start of history', async () => {
    const seen = [];
    worker({
      '/messages': (q) => {
        const after = Number(q.get('after'));
        seen.push(after);
        if (after >= 300) return json({ seq: 301, hasMore: false, messages: [{ seq: 301, text: 'new', user: 'u2' }] });
        // Asked from nothing, the worker answers the oldest three blocks, with more to come.
        return json({ seq: 301, hasMore: true, messages: Array.from({ length: 150 }, (_, i) => ({ seq: after + i + 1, user: 'u2' })) });
      },
    });
    store.wsId = REF;
    const c = store.conv('c1');
    // The newest page came back empty (its messages all deleted), so the window's counter says 300 and it holds nothing.
    Object.assign(c, { loaded: true, seq: 300, messages: [] });
    await store.fetchNewer('c1');
    expect(seen).toEqual([300]);
    expect(c.messages.map((m) => m.seq)).toEqual([301]);
    expect(c.seq).toBe(301);
  });

  it('walks past a page of nothing but deleted messages rather than taking the counter for what it reached', async () => {
    const seen = [];
    worker({
      '/messages': (q) => {
        const after = Number(q.get('after'));
        seen.push(after);
        // The worker's page: three blocks from the one after+1 lies in; 101..250 were deleted, 251..260 stand.
        const hi = Math.min(260, (Math.floor(after / 50) + 3) * 50);
        const messages = [];
        for (let s = after + 1; s <= hi; s++) if (s > 250) messages.push({ seq: s, user: 'u2' });
        return json({ seq: 260, hasMore: hi < 260, messages });
      },
    });
    store.wsId = REF;
    const c = store.conv('c2');
    Object.assign(c, { loaded: true, seq: 100, messages: [{ seq: 100, user: 'u2' }] });
    await store.fetchNewer('c2');
    expect(seen).toEqual([100, 250]);
    expect(c.messages.map((m) => m.seq)).toEqual([100, 251, 252, 253, 254, 255, 256, 257, 258, 259, 260]);
    expect(c.seq).toBe(260);
  });
});

describe('the outbox handoff', () => {
  it('counts a message queued for another workspace as waiting, so the poll that gets through sends it', async () => {
    store.wsId = REF;
    const e = await store.outbox.enqueue({ ws: 'other00000@teamchat-test', conv: 'c', text: 'later', ts: 1 });
    try {
      await store._syncQueued();
      expect(store._hasQueued).toBe(true);
    } finally {
      await store.outbox.remove(e.id);
    }
  });

  it('sends a queued message again once the host has renewed the standing it said had lapsed', async () => {
    store.wsId = REF;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.ws = { id: 'abc123def0', name: 'Globex', channels: { e1: { id: 'e1', name: 'design-acme', shared: { ref: HOST, ch: 'hch', conn: 'conn000001', host: 'Acme' } } }, members: { 'u-me': { role: 'admin', name: 'Me', username: 'me' } } };
    store.me = { role: 'admin', channels: ['e1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.act = { c: {}, p: {}, w: 0, u: 0 };
    const hostBoot = () => ({
      now: Date.now(),
      workspace: { id: 'host00host', name: 'Acme', channels: { hch: { id: 'hch', name: 'design', count: 3 } }, members: { 'u-me': { role: 'external', name: 'Me', username: 'me', exp: Date.now() + 86_400_000 } } },
      me: { role: 'external', channels: ['hch'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} },
      activity: { c: {}, p: {} },
    });
    // The link loaded yesterday; the day the host gives has run out since.
    store.links.set(HOST, {
      ref: HOST, ws: hostBoot().workspace, me: hostBoot().me, act: null, since: 0, w: 0, u: 0, convs: new Map([['hch', 'e1']]),
      loaded: true, loading: null, syncing: null, error: null, lost: false, failures: 0, retryAt: 0, lostConvs: new Map(), rejoinAt: {},
    });
    let renewed = false;
    const lapsed = () => json({ code: 'reattest', message: 'Your access to this shared channel needs renewing' }, 403);
    const calls = worker({
      '/api/ws/host00host': () => (renewed ? json(hostBoot()) : lapsed()),
      '/channels/e1/attest': () => json({ ref: HOST, ch: 'hch', conn: 'conn000001', token: 'x.y' }),
      '/api/connect/join': () => { renewed = true; return json({ ok: true, exp: Date.now() + 86_400_000 }); },
      '/conv/hch/messages': (q, init) => {
        if (!renewed) return lapsed();
        const body = JSON.parse(init.body);
        return json({ message: { seq: 7, user: 'u-me', text: body.text, ts: 5, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0, cid: body.cid } });
      },
    });
    const data = await store._deliverQueued({ id: 'c_q1', ws: REF, conv: 'e1', host: HOST, hconv: 'hch', text: 'queued yesterday', attachments: [] });
    expect(data.message.seq).toBe(7);
    expect(calls.filter((c) => c.endsWith('/conv/hch/messages'))).toHaveLength(2);
    expect(calls.some((c) => c.endsWith('/api/connect/join'))).toBe(true);
    expect(store.links.get(HOST).loaded).toBe(true);
  });
});

describe('joining and leaving a channel when the refresh after it cannot reach the server', () => {
  it('joinChannel resolves, and the channel counts as joined here as it does on the worker', async () => {
    openPlain();
    store.me.channels = [];
    worker({
      '/channels/c1/join': () => json({ ok: true }),
      '/api/ws/abc123def0': () => { throw new TypeError('fetch failed'); },
    });
    await expect(store.joinChannel('c1')).resolves.toMatchObject({ ok: true });
    expect(store.isJoined('c1')).toBe(true);
  });

  it('leaveChannel resolves, and the channel is out of the member\'s list here as it is on the worker', async () => {
    openPlain();
    worker({
      '/channels/c1/leave': () => json({ ok: true }),
      '/api/ws/abc123def0': () => { throw new TypeError('fetch failed'); },
    });
    await expect(store.leaveChannel('c1')).resolves.toMatchObject({ ok: true });
    expect(store.isJoined('c1')).toBe(false);
  });
});
