/**
 * What each hot route costs the caller in waiting: the store round trips it
 * makes before it answers, and the order they go in.
 *
 * Latency here is not the number of calls, it is how many of them are in a
 * row. Three things decide that, and each has a test below:
 *
 *   - Identifying the caller is an HTTP call to Puter, not a store read, so
 *     it runs beside the first read rather than in front of it.
 *   - Keys that do not depend on one another are read together: kv.get takes
 *     a list (see getMany), so the caller's own document, the conversation's
 *     counter, the message's block, the activity document and the caller's
 *     account record come up in one call rather than one after another.
 *   - Work the answer does not depend on — the search index, push
 *     notifications, the change signal, letting go of a deleted message's
 *     files — runs behind the answer through the runtime's waitUntil (see
 *     worker/lib.js's route).
 *
 * The numbers here are ceilings, not targets: a change that reads one thing
 * less is welcome and should lower them. A change that reads one more thing
 * in a row is what these exist to catch.
 */
import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';

const { alice, bob } = USERS;
let rt;

/** One turn of the event loop: what a store call costs here, so a call cannot settle in the same breath it was made. */
const tick = () => new Promise((r) => { setTimeout(r, 0); });

/**
 * Records the store calls a request makes and which of them the answer
 * waited on. A call carrying a list of keys is one round trip, which is the
 * whole point of it; `keys` names each key in it so what was read stays
 * legible.
 *
 * Every call is made to take a turn of the event loop, and calls are counted
 * as they *finish*. The in-memory store answers in the same breath it is
 * asked, which no store over a network ever does, and without the delay work
 * handed to waitUntil would finish before the answer went out — so nothing
 * here could tell what a caller actually waits on from what merely happens.
 */
function probe() {
  const kv = rt.kv;
  const orig = {};
  const issued = [];
  const done = [];
  let answeredAt = null;
  let live = 0;
  let overlap = 1;
  for (const m of ['get', 'set', 'del', 'incr', 'add', 'update', 'remove', 'expire', 'expireAt', 'list']) {
    if (typeof kv[m] !== 'function') continue;
    orig[m] = kv[m];
    kv[m] = async (k, ...rest) => {
      const entry = { op: m, keys: Array.isArray(k) ? k.map(String) : [String(k)] };
      issued.push(entry);
      live += 1;
      overlap = Math.max(overlap, live);
      try {
        await tick();
        const out = await orig[m].call(kv, k, ...rest);
        done.push(entry);
        return out;
      } finally {
        live -= 1;
      }
    };
  }
  rt.setStores({ onAnswered: () => { if (answeredAt === null) answeredAt = done.length; } });
  const cut = () => (answeredAt === null ? done.length : answeredAt);
  return {
    reset: () => { issued.length = 0; done.length = 0; answeredAt = null; overlap = 1; },
    /** The most calls this request had in flight at once: what makes call count and serial depth differ. */
    overlap: () => overlap,
    /** Round trips the answer waited on. */
    waited: () => cut(),
    /** Round trips that finished after it, through waitUntil. */
    deferred: () => done.length - cut(),
    /** Calls in the order they were made, settled or not. */
    issued: () => issued.slice(),
    calls: () => done.slice(),
    before: () => done.slice(0, cut()),
    after: () => done.slice(cut()),
    restore: () => { for (const m of Object.keys(orig)) kv[m] = orig[m]; rt.setStores({ onAnswered: null }); },
  };
}

/** Every key touched by the given calls, flattened. */
const keysOf = (calls) => calls.flatMap((c) => c.keys);

let p;
beforeEach(async () => { rt = await boot(); });
afterEach(() => { if (p) p.restore(); p = null; });

describe('identifying the caller runs beside the first read, not in front of it', () => {
  it('the workspace read is already in flight while Puter is still answering who is asking', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    p = probe();
    p.reset();
    let inFlight = null;
    // Recorded a turn into the wait, which is where a real one would be:
    // identify is called first and the read goes out the moment it suspends.
    await as({ ...alice, onIdentify: async () => { await tick(); inFlight = keysOf(p.issued()); } })
      .post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'hello' });
    expect(inFlight).toContain(KEYS.ws(wsId));
  });

  it('a request carrying no session at all reads nothing', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    p = probe();
    p.reset();
    const res = await as(null).get(`/api/ws/${wsId}`);
    expect(res.status).toBe(401);
    expect(p.calls()).toEqual([]);
  });

  it('a workspace id that could name none is refused without a read', async () => {
    p = probe();
    p.reset();
    expect((await as(alice).get('/api/ws/NOT-AN-ID/sync')).status).toBe(403);
    expect((await as(alice).get('/api/ws/NOT-AN-ID')).status).toBe(404);
    expect(p.issued()).toEqual([]);
  });
});

describe('what a caller waits on', () => {
  /** Round trips each route may make before it answers. Lower is better; these are ceilings. */
  const CEILING = {
    post: 7, mention: 11, sync: 2, bootstrap: 2, edit: 3, react: 4, read: 3, typing: 3, avatar: 1, messages: 3,
    inbox: 2, threads: 2, saved: 2, scheduled: 2, syncDue: 2, rename: 2,
  };

  it('a plain post: the workspace, then the caller and the counter together, the duplicate check, and the write', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    p = probe();
    p.reset();
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'hi', cid: 'cid-aaaaaaaa' })).ok).toBe(true);
    expect(p.waited()).toBeLessThanOrEqual(CEILING.post);
    // The author's own cursor goes beside the conversation's stamp rather
    // than after it: both land, and the two were in flight together, so the
    // chain the sender waits through is a round trip shorter than the count.
    expect(keysOf(p.before())).toContain(KEYS.member(wsId, alice.uuid));
    expect(p.overlap()).toBeGreaterThan(1);
    // The caller's own document and the conversation's counter share a call.
    const second = p.before()[1];
    expect(second.keys).toContain(KEYS.member(wsId, alice.uuid));
    expect(second.keys).toContain(KEYS.seq(general.id));
    // And the index is behind the answer, never in front of it.
    expect(keysOf(p.before()).some((k) => k.includes(':idx:'))).toBe(false);
    expect(keysOf(p.after()).some((k) => k.includes(':idx:'))).toBe(true);
  });

  it('a post naming someone: their counter and inbox do not lengthen the chain much', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    p = probe();
    p.reset();
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'hey @bob', cid: 'cid-bbbbbbbb' })).ok).toBe(true);
    expect(p.waited()).toBeLessThanOrEqual(CEILING.mention);
    expect(keysOf(p.before()).some((k) => k.includes(':idx:'))).toBe(false);
  });

  it('the sync poll: the workspace and the activity document together, then the caller\'s own', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    p = probe();
    p.reset();
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect(p.waited()).toBe(CEILING.sync);
    expect(p.calls()[0].keys.sort()).toEqual([KEYS.activity(wsId), KEYS.ws(wsId)].sort());
    expect(p.calls()[1].keys).toEqual([KEYS.member(wsId, alice.uuid)]);
  });

  it('and in one read once the caller is known, which is every poll after the first', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const who = { ...alice, authToken: 'tok-sync' };
    // The first poll pays for the identity; the ones behind it do not, and
    // then every key the poll wants is known before it reads anything.
    expect((await as(who).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    p = probe();
    p.reset();
    expect((await as(who).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect(p.waited()).toBe(1);
    expect(p.calls()[0].keys.sort()).toEqual([KEYS.activity(wsId), KEYS.member(wsId, alice.uuid), KEYS.ws(wsId)].sort());
  });

  it('a post by a caller already known waits on four rounds, not six', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const who = { ...alice, authToken: 'tok-post' };
    expect((await as(who).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true); // warm the identity
    p = probe();
    p.reset();
    expect((await as(who).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'hi', cid: 'cid-warmaaaa', first: true })).ok).toBe(true);
    // Five calls in four rounds: everything the post needs before it writes
    // in one read, then the number, then the message, then the conversation's
    // stamp and the author's cursor together.
    expect(p.waited()).toBe(5);
    expect(p.overlap()).toBeGreaterThan(1);
    expect(p.calls()[0].keys.sort()).toEqual([KEYS.member(wsId, alice.uuid), KEYS.seq(general.id), KEYS.ws(wsId)].sort());
  });

  it('the bootstrap: the workspace, then the caller\'s document, account record and the activity document together', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    p = probe();
    p.reset();
    expect((await as(alice).get(`/api/ws/${wsId}`)).ok).toBe(true);
    expect(p.waited()).toBe(CEILING.bootstrap);
    expect(p.calls()[1].keys.sort()).toEqual([KEYS.activity(wsId), KEYS.member(wsId, alice.uuid), KEYS.user(alice.uuid)].sort());
  });

  it('an edit: the block comes up with the caller, and the stamp and the index go behind the answer', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const seq = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'first' })).data.message.seq;
    p = probe();
    p.reset();
    expect((await as(alice).put(`/api/ws/${wsId}/conv/${general.id}/messages/${seq}`, { text: 'second' })).ok).toBe(true);
    expect(p.waited()).toBeLessThanOrEqual(CEILING.edit);
    expect(p.calls()[1].keys).toContain(KEYS.block(general.id, 0));
    expect(keysOf(p.before()).some((k) => k.includes(':idx:'))).toBe(false);
  });

  it('a reaction: the block comes up with the caller, and telling the author goes behind the answer', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const seq = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'first' })).data.message.seq;
    p = probe();
    p.reset();
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages/${seq}/reactions`, { reaction: 'thumbsup' })).ok).toBe(true);
    expect(p.waited()).toBeLessThanOrEqual(CEILING.react);
    expect(p.calls()[1].keys).toContain(KEYS.block(general.id, 0));
    // The author's inbox entry is for the author, not for whoever tapped.
    expect(keysOf(p.after())).toContain(KEYS.inbox(wsId, alice.uuid));
  });

  it('a read: the counter comes up with the caller, and the poke for their other tabs goes behind the answer', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const seq = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'hey @bob' })).data.message.seq;
    p = probe();
    p.reset();
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq })).ok).toBe(true);
    expect(p.waited()).toBeLessThanOrEqual(CEILING.read);
    expect(p.calls()[1].keys).toContain(KEYS.seq(general.id));
    expect(p.deferred()).toBeGreaterThan(0);
  });

  it('typing: one write, and its signal behind the answer', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    p = probe();
    p.reset();
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/typing`, { first: true })).ok).toBe(true);
    expect(p.waited()).toBeLessThanOrEqual(CEILING.typing);
  });

  it('a member\'s photo: one read, whatever a workspace of fifty asks for at once', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(64)], { type: 'image/png' }), 'me.png');
    expect((await as(bob).post('/api/me/avatar', fd)).ok).toBe(true);
    p = probe();
    p.reset();
    expect((await as(alice).get(`/api/ws/${wsId}/members/${bob.uuid}/avatar`)).status).toBe(200);
    expect(p.waited()).toBe(CEILING.avatar);
    expect(p.calls()[0].keys.sort()).toEqual([KEYS.user(bob.uuid), KEYS.ws(wsId)].sort());
  });

  it('the panels read their own list with the caller, not after them', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    p = probe();
    for (const [name, path, ceiling] of [
      ['inbox', 'inbox', CEILING.inbox],
      ['threads', 'threads', CEILING.threads],
      ['saved', 'saved', CEILING.saved],
      ['scheduled', 'scheduled', CEILING.scheduled],
    ]) {
      p.reset();
      expect((await as(alice).get(`/api/ws/${wsId}/${path}`)).ok, name).toBe(true);
      expect(p.waited(), name).toBeLessThanOrEqual(ceiling);
    }
  });

  it('a poll that finds something due answers first and delivers behind it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const sid = (await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt: Date.now() + 3600_000 })).data.scheduled.id;
    expect(sid).toBeTruthy();
    await rt.kv.update(KEYS.sched(wsId), { [`m.${sid}.dueAt`]: Date.now() - 1 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    p = probe();
    p.reset();
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    // The poll costs what any poll costs; the delivery — a claim, a whole
    // post, the next due time — lands after the answer has gone.
    expect(p.waited()).toBeLessThanOrEqual(CEILING.syncDue);
    expect(p.deferred()).toBeGreaterThan(5);
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.some((m) => m.text === 'later')).toBe(true);
  });

  it('a rename answers before it carries the new name to every card', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    p = probe();
    p.reset();
    expect((await as(alice).put('/api/me', { name: 'Alice Two' })).ok).toBe(true);
    expect(p.waited()).toBeLessThanOrEqual(CEILING.rename);
    // The cards follow behind, and they do land.
    expect(keysOf(p.after())).toContain(KEYS.ws(wsId));
    expect((await rt.kv.get(KEYS.ws(wsId))).members[alice.uuid].name).toBe('Alice Two');
  });

  it('a window of messages: the workspace, the caller, then the blocks together', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    for (let i = 0; i < 3; i++) await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: `m${i}` });
    p = probe();
    p.reset();
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).ok).toBe(true);
    expect(p.waited()).toBeLessThanOrEqual(CEILING.messages);
  });
});

describe('a fan-out reads its documents in batches, not one call per key', () => {
  it('a guest\'s bootstrap reads every member document in a couple of calls, not one apiece', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    // Thirty more members, so the guest's peer walk has something to read.
    const many = Array.from({ length: 30 }, (_, i) => ({ uuid: `u-many-${String(i).padStart(4, '0')}`, username: `many${i}` }));
    const code = (await as(alice).get(`/api/ws/${wsId}`)).data.workspace.invite;
    for (const u of many) expect((await as(u).post('/api/join', { code })).ok).toBe(true);
    // A guest is invited to a channel of its own: a default channel takes the
    // workspace's invite instead.
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'proj' })).data.channel.id;
    const inv = (await as(alice).post(`/api/ws/${wsId}/channels/${ch}/invites`, {})).data;
    const guest = { uuid: 'u-guest-0000', username: 'guest' };
    expect((await as(guest).post('/api/join', { code: inv.code })).ok).toBe(true);
    p = probe();
    p.reset();
    expect((await as(guest).get(`/api/ws/${wsId}`)).ok).toBe(true);
    const read = p.calls().filter((c) => c.op === 'get');
    const memberKeys = keysOf(read).filter((k) => /:u:u-many-/.test(k));
    // Thirty-two documents, but nothing like thirty-two round trips for them.
    expect(memberKeys.length).toBeGreaterThanOrEqual(30);
    expect(read.length).toBeLessThan(8);
  });
});

describe('the duplicate check a retry needs, and a first send does not', () => {
  it('a send that says it is the first reads no blocks looking for itself; one that says nothing does', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'warm' });
    p = probe();

    p.reset();
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'one', cid: 'cid-firstaaa', first: true })).ok).toBe(true);
    const withFlag = p.waited();
    expect(keysOf(p.before()).filter((k) => k === KEYS.block(general.id, 0))).toHaveLength(1); // the append alone

    p.reset();
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'two', cid: 'cid-checkaaa' })).ok).toBe(true);
    // An older client, or any caller but ours, is checked exactly as before.
    expect(p.waited()).toBe(withFlag + 1);
    expect(keysOf(p.before()).filter((k) => k === KEYS.block(general.id, 0))).toHaveLength(2); // read, then appended
  });

  it('a retry under a client id that has been out is still answered with the message, not a second copy', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const sent = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'once', cid: 'cid-retryaaa', first: true })).data.message;
    // The retry says nothing about being first, so the worker looks and finds it.
    const again = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'once', cid: 'cid-retryaaa' });
    expect(again.data.duplicate).toBe(true);
    expect(again.data.message.seq).toBe(sent.seq);
    const shown = (await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages;
    expect(shown.filter((m) => m.text === 'once')).toHaveLength(1);
  });
});

describe('the poll is told when something is due, since nothing signals a moment arriving', () => {
  it('a workspace with nothing scheduled says nothing; one with something says how long', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).data.ndIn).toBeUndefined();
    const due = Date.now() + 5 * 60_000;
    expect((await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt: due })).ok).toBe(true);
    const { ndIn } = (await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).data;
    // A span, not a moment: the two clocks need not agree.
    expect(ndIn).toBeGreaterThan(4 * 60_000);
    expect(ndIn).toBeLessThanOrEqual(5 * 60_000);
  });

  it('and says nothing once the time has passed, since the poll delivers it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const sid = (await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'now', dueAt: Date.now() + 3600_000 })).data.scheduled.id;
    await rt.kv.update(KEYS.sched(wsId), { [`m.${sid}.dueAt`]: Date.now() - 1 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    const res = await as(bob).get(`/api/ws/${wsId}/sync?since=0`);
    expect(res.data.ndIn).toBeUndefined();
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.some((m) => m.text === 'now')).toBe(true);
  });
});
