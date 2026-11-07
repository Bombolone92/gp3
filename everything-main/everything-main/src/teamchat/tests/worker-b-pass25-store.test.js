/**
 * Review pass 25, the message plane's client half of the shared-channel
 * protocol: the words this workspace's app carries to the hosts of its
 * shared channels (a leave, a disconnect, a revocation). Each test here is a
 * hole that was found and closed.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { store } from '../src/lib/store.js';

const WS = 'abc123def0@teamchat-test';
const HOST = 'host00host@teamchat-test';
const OTHER = 'init00init@teamchat-other';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * A fake of every server the app calls, answering by path suffix and
 * keeping, per server, how many requests of `watch` were in flight at once:
 * the host's record of one person is written whole by each such request,
 * so two of them at once on one server is the race.
 */
function servers(routes, watch) {
  const inFlight = new Map();
  const most = new Map();
  const calls = [];
  let mostAnywhere = 0;
  globalThis.puter = {
    workers: {
      exec: async (url, init = {}) => {
        const u = new URL(url);
        calls.push(`${init.method || 'GET'} ${u.host}${u.pathname}`);
        const hit = Object.entries(routes).find(([k]) => u.pathname.endsWith(k));
        if (!hit) return json({ code: 'not_found', message: 'nope' }, 404);
        if (!watch(u.pathname)) return hit[1](init, u);
        inFlight.set(u.host, (inFlight.get(u.host) || 0) + 1);
        most.set(u.host, Math.max(most.get(u.host) || 0, inFlight.get(u.host)));
        mostAnywhere = Math.max(mostAnywhere, [...inFlight.values()].reduce((a, b) => a + b, 0));
        // Answered a moment later, so words sent together are in flight together.
        await new Promise((r) => setTimeout(r, 15));
        try {
          return await hit[1](init, u);
        } finally {
          inFlight.set(u.host, inFlight.get(u.host) - 1);
        }
      },
    },
  };
  return { calls, most, mostAnywhere: () => mostAnywhere };
}

/** Globex, with two entries for channels Acme hosts and one for a channel Initech hosts, the member in all three as an external. */
function partnerOfTwo() {
  store.wsId = WS;
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.ws = {
    id: 'abc123def0', name: 'Globex',
    channels: {
      e1: { id: 'e1', name: 'design-acme', shared: { ref: HOST, ch: 'hch1', conn: 'conn000001', host: 'Acme' } },
      e2: { id: 'e2', name: 'marketing-acme', shared: { ref: HOST, ch: 'hch2', conn: 'conn000002', host: 'Acme' } },
      e3: { id: 'e3', name: 'ops-initech', shared: { ref: OTHER, ch: 'och', conn: 'conn000003', host: 'Initech' } },
      local: { id: 'local', name: 'general' },
    },
    members: { 'u-me': { role: 'admin', name: 'Me', username: 'me' } },
  };
  store.me = { role: 'admin', channels: ['e1', 'e2', 'e3', 'local'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  const link = (ref, channels) => ({ ref, ws: { channels: {}, members: {} }, me: { role: 'external', channels }, convs: new Map(), loaded: true, loading: null, error: null, lost: false, failures: 0, retryAt: 0, lostConvs: new Map(), rejoinAt: {} });
  store.links = new Map([[HOST, link(HOST, ['hch1', 'hch2'])], [OTHER, link(OTHER, ['och'])]]);
}

afterEach(() => {
  store.wsId = null;
  store.ws = null;
  store.me = null;
  store.profile = null;
  store.links = new Map();
  store.convs.clear();
  delete globalThis.puter;
});

describe('the words this workspace carries to the host of two channels shared with it', () => {
  it('leave the host one after another when the member leaves the workspace, while another host is told beside them', async () => {
    partnerOfTwo();
    const s = servers({ '/leave': () => json({ ok: true }) }, (p) => p.endsWith('/leave'));
    await store.leaveHosts();
    expect(s.calls.filter((c) => c.includes('/leave')).sort()).toEqual([
      'POST teamchat-other.puter.work/api/ws/init00init/channels/och/leave',
      'POST teamchat-test.puter.work/api/ws/host00host/channels/hch1/leave',
      'POST teamchat-test.puter.work/api/ws/host00host/channels/hch2/leave',
    ]);
    // Acme took one word at a time; Initech's went beside Acme's.
    expect(s.most.get('teamchat-test.puter.work')).toBe(1);
    expect(s.mostAnywhere()).toBe(2);
  });

  it('disconnect the host one after another when the workspace is deleted, each with its own attestation', async () => {
    partnerOfTwo();
    const s = servers({
      '/channels/e1/attest': () => json({ ref: HOST, ch: 'hch1', conn: 'conn000001', token: 'a.1' }),
      '/channels/e2/attest': () => json({ ref: HOST, ch: 'hch2', conn: 'conn000002', token: 'a.2' }),
      '/channels/e3/attest': () => json({ ref: OTHER, ch: 'och', conn: 'conn000003', token: 'a.3' }),
      '/api/connect/disconnect': () => json({ ok: true }),
    }, (p) => p.endsWith('/api/connect/disconnect'));
    await store.disconnectHosts();
    expect(s.calls.filter((c) => c.includes('/api/connect/disconnect')).sort()).toEqual([
      'POST teamchat-other.puter.work/api/connect/disconnect',
      'POST teamchat-test.puter.work/api/connect/disconnect',
      'POST teamchat-test.puter.work/api/connect/disconnect',
    ]);
    expect(s.most.get('teamchat-test.puter.work')).toBe(1);
    expect(s.mostAnywhere()).toBe(2);
  });

  it('revoke someone\'s seats there one after another when an admin removes them, a malformed word skipped and a host that fails swallowed', async () => {
    partnerOfTwo();
    const s = servers({ '/api/connect/revoke': (init, u) => (u.host === 'teamchat-other.puter.work' ? json({ code: 'internal', message: 'nope' }, 500) : json({ ok: true })) }, (p) => p.endsWith('/api/connect/revoke'));
    await store.carryRevocations([
      { ref: HOST, ch: 'hch1', conn: 'conn000001', host: 'Acme', token: 'r.1' },
      { ref: 'not a ref', conn: 'cn_x', token: 'r.x' },
      { ref: HOST, ch: 'hch2', conn: 'conn000002', host: 'Acme', token: 'r.2' },
      { ref: OTHER, ch: 'och', conn: 'conn000003', host: 'Initech', token: 'r.3' },
      null,
    ]);
    expect(s.calls.sort()).toEqual([
      'POST teamchat-other.puter.work/api/connect/revoke',
      'POST teamchat-test.puter.work/api/connect/revoke',
      'POST teamchat-test.puter.work/api/connect/revoke',
    ]);
    expect(s.most.get('teamchat-test.puter.work')).toBe(1);
    expect(s.mostAnywhere()).toBe(2);
  });

  it('give a host that hangs one word\'s wait, not one per channel', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      partnerOfTwo();
      let asked = 0;
      servers({ '/leave': () => { asked++; return new Promise(() => {}); } }, () => false);
      let done = false;
      const left = store.leaveHosts().then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(4500);
      expect(done).toBe(true);
      await left;
      // The first word to each host hangs; Acme's second is never sent, as it would hang too (the seat lapses on its own).
      expect(asked).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
