/**
 * The short-lived identity cache (worker/lib.js's `identify`).
 *
 * Asking Puter who a caller is costs an HTTP round trip, and it is made on
 * every request the worker serves — a poll every few seconds per open tab,
 * and again for every message, read and reaction. It is also the one call
 * that cannot be batched with a store read or pushed behind the answer,
 * because everything else depends on knowing who is asking. So the answer is
 * reused for IDENTITY_TTL_MS against a hash of the token that earned it.
 *
 * What has to hold: one token's answer is never handed to another, an answer
 * that was never given is never cached, and the reuse really does lapse.
 */
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { IDENTITY_TTL_MS, resetIdentityCache } from '../worker/lib.js';

const { alice, bob } = USERS;
let rt;

/** A caller whose token is their own, counting how often Puter was actually asked. */
function caller(user, token, calls) {
  return { ...user, authToken: token, onIdentify: () => { calls.n += 1; } };
}

beforeEach(async () => { rt = await boot(); });
afterEach(() => { vi.useRealTimers(); resetIdentityCache(); });

describe('identifying a caller', () => {
  it('asks Puter once and reuses the answer for the requests that follow', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const calls = { n: 0 };
    const who = caller(alice, 'tok-alice', calls);
    expect((await as(who).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect(calls.n).toBe(1);
    for (let i = 0; i < 5; i++) expect((await as(who).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect(calls.n).toBe(1);
  });

  it('never hands one token\'s answer to another', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const a = { n: 0 };
    const b = { n: 0 };
    const mine = await as(caller(alice, 'tok-alice', a)).get(`/api/ws/${wsId}`);
    const theirs = await as(caller(bob, 'tok-bob', b)).get(`/api/ws/${wsId}`);
    expect(mine.data.me.role).toBe('owner');
    expect(theirs.data.me.role).toBe('member');
    expect([a.n, b.n]).toEqual([1, 1]);
    // And again, from cache, still each their own.
    expect((await as(caller(alice, 'tok-alice', a)).get(`/api/ws/${wsId}`)).data.me.role).toBe('owner');
    expect((await as(caller(bob, 'tok-bob', b)).get(`/api/ws/${wsId}`)).data.me.role).toBe('member');
    expect([a.n, b.n]).toEqual([1, 1]);
  });

  it('asks again once the answer has lapsed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { wsId } = await workspaceWith(alice, [bob]);
    const calls = { n: 0 };
    const who = caller(alice, 'tok-alice', calls);
    expect((await as(who).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect(calls.n).toBe(1);
    vi.advanceTimersByTime(IDENTITY_TTL_MS + 1);
    expect((await as(who).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect(calls.n).toBe(2);
  });

  it('caches nothing for a token Puter would not answer for', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const calls = { n: 0 };
    // A caller the runtime has a token for but no identity behind it.
    const nobody = { uuid: undefined, username: undefined, authToken: 'tok-ghost', onIdentify: () => { calls.n += 1; } };
    expect((await as(nobody).get(`/api/ws/${wsId}/sync?since=0`)).status).toBe(401);
    expect((await as(nobody).get(`/api/ws/${wsId}/sync?since=0`)).status).toBe(401);
    // Asked every time: a refusal is never remembered as an answer.
    expect(calls.n).toBe(2);
  });

  it('a caller with no token at all is never cached, so two of them do not collide', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const a = { n: 0 };
    const b = { n: 0 };
    // The harness's default: no token forwarded. Each must still be itself.
    expect((await as({ ...alice, onIdentify: () => { a.n += 1; } }).get(`/api/ws/${wsId}`)).data.me.role).toBe('owner');
    expect((await as({ ...bob, onIdentify: () => { b.n += 1; } }).get(`/api/ws/${wsId}`)).data.me.role).toBe('member');
    expect([a.n, b.n]).toEqual([1, 1]);
  });
});

describe('the answer says what it cost', () => {
  it('carries Server-Timing, with auth at nothing once the identity is cached', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const calls = { n: 0 };
    const who = caller(alice, 'tok-alice', calls);
    const first = await rt.dispatch(`https://teamchat-api.test/api/ws/${wsId}/sync?since=0`, {}, who);
    expect(first.headers.get('Server-Timing')).toMatch(/total;dur=\d+/);
    expect(first.headers.get('Server-Timing')).toMatch(/auth;dur=\d+/);
    expect(first.headers.get('Access-Control-Expose-Headers')).toBe('Server-Timing');
    const second = await rt.dispatch(`https://teamchat-api.test/api/ws/${wsId}/sync?since=0`, {}, who);
    expect(second.headers.get('Server-Timing')).toMatch(/auth;dur=0/);
  });
});

describe('the timing header does not trample what a route already said', () => {
  it('adds itself to an answer that exposes a header of its own', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const fd = new FormData();
    fd.append('file', new Blob(['bytes'], { type: 'text/plain' }), 'notes.txt');
    const up = await as(alice).post(`/api/ws/${wsId}/files`, fd);
    expect(up.ok).toBe(true);
    const res = await rt.dispatch(`https://teamchat-api.test/api/ws/${wsId}/files/${up.data.id}`, {}, alice);
    expect(res.status).toBe(200);
    // The download still names its file, and the timing rides beside it.
    expect(res.headers.get('X-File-Name')).toBeTruthy();
    expect(res.headers.get('Server-Timing')).toMatch(/total;dur=\d+/);
  });
});

describe('what the cache does not hold', () => {
  it('a member removed mid-window is refused at once, cached identity or not', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const who = { ...bob, authToken: 'tok-bob' };
    expect((await as(who).get(`/api/ws/${wsId}`)).ok).toBe(true); // identity now cached
    expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    // Identity is who you are; membership is read from the workspace on every
    // request, so it is not the cache's to go stale.
    const after = await as(who).get(`/api/ws/${wsId}`);
    expect(after.status).toBe(403);
    expect((await as(who).get(`/api/ws/${wsId}/sync?since=0`)).status).toBe(403);
  });

  it('a role taken away takes effect at once too', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const who = { ...bob, authToken: 'tok-bob2' };
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    expect((await as(who).post(`/api/ws/${wsId}/channels`, { name: 'one' })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'guest' })).ok).toBe(true);
    // Their identity is still cached; what they may do is not.
    expect((await as(who).post(`/api/ws/${wsId}/channels`, { name: 'two' })).status).toBe(403);
  });
});
