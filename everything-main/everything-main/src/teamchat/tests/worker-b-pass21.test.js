/**
 * Review pass 21, the message plane: channels, messages, threads, reactions,
 * pins, saved messages, direct messages, huddles, shared channels, transfer.
 * Each test here is a hole that was found in the worker's routes and closed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import { store } from '../src/lib/store.js';

const { alice, bob } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

describe('a message sent once more under its client id after the conversation closed to the author', () => {
  const setup = async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'x' })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${ch.id}/join`);
    const texts = async () => (await as(alice).get(`/api/ws/${wsId}/conv/${ch.id}/messages`)).data.messages.filter((m) => m.kind === 'msg').map((m) => m.text);
    return { wsId, ch, texts };
  };

  it('is answered with the message that landed, not refused, once the channel was archived', async () => {
    const { wsId, ch, texts } = await setup();
    const first = await as(bob).post(`/api/ws/${wsId}/conv/${ch.id}/messages`, { text: 'hello', cid: 'cid-archived-01' });
    expect(first.ok).toBe(true);
    await as(alice).put(`/api/ws/${wsId}/channels/${ch.id}`, { archived: true });
    const retry = await as(bob).post(`/api/ws/${wsId}/conv/${ch.id}/messages`, { text: 'hello', cid: 'cid-archived-01' });
    expect(retry.status).toBe(200);
    expect(retry.data.duplicate).toBe(true);
    expect(retry.data.message.seq).toBe(first.data.message.seq);
    expect(await texts()).toEqual(['hello']);
    // A message never sent is still refused as before.
    const fresh = await as(bob).post(`/api/ws/${wsId}/conv/${ch.id}/messages`, { text: 'new', cid: 'cid-archived-02' });
    expect(fresh.status).toBe(403);
    expect(fresh.data.code).toBe('archived');
  });

  it('is answered with the message that landed once the author had left the channel', async () => {
    const { wsId, ch, texts } = await setup();
    const first = await as(bob).post(`/api/ws/${wsId}/conv/${ch.id}/messages`, { text: 'hello', cid: 'cid-left-0001' });
    await as(bob).post(`/api/ws/${wsId}/channels/${ch.id}/leave`);
    const retry = await as(bob).post(`/api/ws/${wsId}/conv/${ch.id}/messages`, { text: 'hello', cid: 'cid-left-0001' });
    expect(retry.status).toBe(200);
    expect(retry.data.duplicate).toBe(true);
    expect(retry.data.message.seq).toBe(first.data.message.seq);
    expect(await texts()).toEqual(['hello']);
    const fresh = await as(bob).post(`/api/ws/${wsId}/conv/${ch.id}/messages`, { text: 'new', cid: 'cid-left-0002' });
    expect(fresh.status).toBe(403);
    expect(fresh.data.code).toBe('not_joined');
  });

  it('is answered with the message that landed once posting was limited to admins', async () => {
    const { wsId, ch, texts } = await setup();
    const first = await as(bob).post(`/api/ws/${wsId}/conv/${ch.id}/messages`, { text: 'hello', cid: 'cid-locked-001' });
    await as(alice).put(`/api/ws/${wsId}/channels/${ch.id}`, { postPolicy: 'admins' });
    const retry = await as(bob).post(`/api/ws/${wsId}/conv/${ch.id}/messages`, { text: 'hello', cid: 'cid-locked-001' });
    expect(retry.status).toBe(200);
    expect(retry.data.duplicate).toBe(true);
    expect(retry.data.message.seq).toBe(first.data.message.seq);
    expect(await texts()).toEqual(['hello']);
    const fresh = await as(bob).post(`/api/ws/${wsId}/conv/${ch.id}/messages`, { text: 'new', cid: 'cid-locked-002' });
    expect(fresh.status).toBe(403);
    expect(fresh.data.code).toBe('read_only');
  });

  it('still refuses a conversation the caller cannot read at all', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const priv = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel;
    await as(alice).post(`/api/ws/${wsId}/conv/${priv.id}/messages`, { text: 'mine', cid: 'cid-private-01' });
    // Bob never posted here; a cid of his cannot match, and the private channel is not his to read.
    const r = await as(bob).post(`/api/ws/${wsId}/conv/${priv.id}/messages`, { text: 'mine', cid: 'cid-private-01' });
    expect(r.status).toBe(404);
  });
});

describe('deleting a channel with many threads and files', () => {
  /**
   * How many keys matching `re` the store was asked about at once, at most:
   * the keys one batched read carries (see getMany), plus any reads in
   * flight beside it.
   */
  const inFlight = (re) => {
    const orig = rt.kv.get;
    const peak = { get: 0 };
    let live = 0;
    rt.kv.get = async (k, ...rest) => {
      const n = (Array.isArray(k) ? k : [k]).filter((x) => re.test(String(x))).length;
      if (!n) return orig.call(rt.kv, k, ...rest);
      live += n;
      peak.get = Math.max(peak.get, live);
      try {
        return await orig.call(rt.kv, k, ...rest);
      } finally {
        live -= n;
      }
    };
    return { peak, restore: () => { rt.kv.get = orig; } };
  };
  const upload = async (u, wsId, name) => {
    const fd = new FormData();
    fd.append('file', new Blob([`bytes of ${name}`], { type: 'text/plain' }), name);
    return (await as(u).post(`/api/ws/${wsId}/files`, fd)).data.id;
  };

  it('purges the threads a dozen at a time rather than one after another, and leaves nothing of the channel behind', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'busy' })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${ch.id}/join`);
    const shared = await upload(alice, wsId, 'shared.txt'); // carried here and in #general
    const own = await upload(alice, wsId, 'own.txt'); // carried by a reply here alone
    await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'kept', attachments: [{ id: shared }] });
    const threads = [];
    for (let i = 0; i < 15; i++) {
      const root = (await as(alice).post(`/api/ws/${wsId}/conv/${ch.id}/messages`, { text: `root ${i}`, attachments: i === 0 ? [{ id: shared }] : [] })).data.message;
      const t = `${ch.id}_t${root.seq}`;
      threads.push(t);
      const reply = (await as(bob).post(`/api/ws/${wsId}/conv/${t}/messages`, { text: `reply ${i}`, attachments: i === 1 ? [{ id: own }] : [] })).data.message;
      if (i === 2) expect((await as(alice).post(`/api/ws/${wsId}/conv/${t}/pins`, { seq: reply.seq })).ok).toBe(true);
    }
    expect((await rt.kv.get(KEYS.file(shared))).refs).toBe(2);
    expect((await rt.kv.get(KEYS.file(own))).refs).toBe(1);
    const counters = inFlight(/^tc:conv:.*_t\d+:seq$/);
    let res;
    try {
      res = await as(alice).del(`/api/ws/${wsId}/channels/${ch.id}`);
    } finally {
      counters.restore();
    }
    expect(res.data).toEqual({ ok: true });
    // A dozen at a time, as every fan-out here goes.
    expect(counters.peak.get).toBeGreaterThan(1);
    // Nothing of the channel or its threads is left: blocks, counters, pins, activity entries.
    expect(await rt.kv.get(KEYS.seq(ch.id))).toBeFalsy();
    expect(await rt.kv.get(KEYS.block(ch.id, 0))).toBeFalsy();
    expect(await rt.kv.get(KEYS.block(ch.id, 1))).toBeFalsy();
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.c[ch.id]).toBeUndefined();
    for (const t of threads) {
      expect(await rt.kv.get(KEYS.seq(t))).toBeFalsy();
      expect(await rt.kv.get(KEYS.block(t, 0))).toBeFalsy();
      expect(await rt.kv.get(KEYS.pins(wsId, t))).toBeFalsy();
      expect(act.c[t]).toBeUndefined();
    }
    // The file carried here alone is gone, bytes and record; the one #general still carries stays, its hold here let go of.
    expect(await rt.kv.get(KEYS.file(own))).toBeFalsy();
    await expect(rt.fs.read(`teamchat-files/${wsId}/${own}`)).rejects.toThrow();
    const kept = await rt.kv.get(KEYS.file(shared));
    expect(kept.refs).toBe(1);
    expect(kept.cs[ch.id]).toBe(0);
    expect(kept.cs[general.id]).toBe(1);
    expect((await rt.fs.read(`teamchat-files/${wsId}/${shared}`)).size).toBeGreaterThan(0);
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels[ch.id]).toBeUndefined();
  });
});

describe('the author\'s read cursor when a scheduled message is delivered', () => {
  const reads = async (wsId, u) => (await rt.kv.get(KEYS.member(wsId, u.uuid))).reads;

  it('stays where it was when messages the author never saw were posted since the message was scheduled', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    // "alice created #general", "bob joined": bob has read both.
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 2 })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt: Date.now() - 30_000 })).ok).toBe(true);
    for (let i = 0; i < 5; i++) expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: `m${i}` })).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    const list = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages;
    expect(list.map((m) => m.text)).toContain('later');
    expect(list[list.length - 1]).toMatchObject({ seq: 8, user: bob.uuid, text: 'later' });
    // Bob's cursor still stands at 2: alice's five are unread for him, and so is his own delivered message.
    expect((await reads(wsId, bob))[general.id]).toBe(2);
    // The entry marks the delivery, so bob's tabs can tell it from a message he sent from another tab.
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.c[general.id]).toMatchObject({ s: 8, u: bob.uuid, q: 8 });
  });

  it('follows the message when nothing was unread for the author, as it would have had they sent it then', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 2 })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt: Date.now() - 30_000 })).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect((await reads(wsId, bob))[general.id]).toBe(3);
    expect((await rt.kv.get(KEYS.activity(wsId))).c[general.id]).toMatchObject({ s: 3, u: bob.uuid, q: 3 });
  });

  it('a live post still moves the cursor to the message, whatever was unread, and marks nothing on the entry', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 2 })).ok).toBe(true);
    for (let i = 0; i < 5; i++) expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: `m${i}` })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'now' })).data.message.seq).toBe(8);
    expect((await reads(wsId, bob))[general.id]).toBe(8);
    const entry = (await rt.kv.get(KEYS.activity(wsId))).c[general.id];
    expect(entry).toMatchObject({ s: 8, u: bob.uuid });
    expect(entry.q).toBeUndefined();
  });

  describe('the client, told by the poll of a message of its own', () => {
    const setUp = (reads) => {
      store.profile = { uuid: 'u-me' };
      store.me = { reads: { ...reads }, mentions: {}, threads: {}, notify: {}, dms: {}, channels: ['c1'] };
      store.ws = { id: 'w1', channels: { c1: { id: 'c1', name: 'general' } }, members: {} };
      store.links = new Map();
      store.act = { c: { c1: { s: 7, t: 100, u: 'u-ann' } }, p: {}, w: 0, u: 0 };
      store._localSeen.clear();
    };
    afterEach(() => {
      store.profile = null;
      store.me = null;
      store.ws = null;
      store.act = { c: {}, p: {}, w: 0, u: 0 };
      store._localSeen.clear();
    });

    it('leaves its cursor and what it has seen alone for a scheduled delivery with unread messages before it', () => {
      setUp({ c1: 2 });
      const folded = store._foldActivity({ c1: { s: 8, t: 101, u: 'u-me', q: 8 } }, null);
      expect(folded.changed).toBe(true);
      expect(folded.newIn).toEqual([]);
      expect(store.me.reads.c1).toBe(2);
      expect(store._localSeen.get('c1')).toBeUndefined();
      expect(store.act.c.c1).toMatchObject({ s: 8, u: 'u-me', q: 8 });
    });

    it('takes a scheduled delivery as read when it had read everything before it', () => {
      setUp({ c1: 7 });
      store._foldActivity({ c1: { s: 8, t: 101, u: 'u-me', q: 8 } }, null);
      expect(store.me.reads.c1).toBe(8);
      expect(store._localSeen.get('c1')).toBe(8);
    });

    it('still takes a message sent from another tab as read, whatever was unread, and is not misled by an older mark', () => {
      setUp({ c1: 2 });
      store._foldActivity({ c1: { s: 8, t: 101, u: 'u-me', q: 5 } }, null);
      expect(store.me.reads.c1).toBe(8);
      expect(store._localSeen.get('c1')).toBe(8);
    });
  });
});

describe('editing a channel another admin deleted in the same instant', () => {
  it('is refused as not found, leaves no nameless entry, and writes no line into the purged conversation', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const y = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'y' })).data.channel;
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${y.id}`, { archived: true })).ok).toBe(true);
    // The deletion lands between bob's read of the workspace and his write:
    // the channel's entry, counter and block go as the delete route takes them.
    const orig = rt.kv.update;
    let raced = false;
    rt.kv.update = async (k, paths) => {
      if (!raced && k === KEYS.ws(wsId) && Object.keys(paths || {}).some((p) => p.startsWith(`channels.${y.id}.`))) {
        raced = true;
        await rt.kv.remove(KEYS.ws(wsId), `channels.${y.id}`);
        await rt.kv.del(KEYS.seq(y.id));
        await rt.kv.del(KEYS.block(y.id, 0));
        await rt.kv.remove(KEYS.activity(wsId), `c.${y.id}`);
      }
      return orig.call(rt.kv, k, paths);
    };
    let res;
    try {
      res = await as(bob).put(`/api/ws/${wsId}/channels/${y.id}`, { archived: false, postPolicy: 'admins', topic: 'back' });
    } finally {
      rt.kv.update = orig;
    }
    expect(raced).toBe(true);
    expect(res.status).toBe(404);
    expect(res.data.code).toBe('not_found');
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[y.id]).toBeUndefined();
    // No "limited posting to admins" line into a conversation that is gone: no counter, no block, no activity entry made anew.
    expect(await rt.kv.get(KEYS.seq(y.id))).toBeFalsy();
    expect(await rt.kv.get(KEYS.block(y.id, 0))).toBeFalsy();
    expect((await rt.kv.get(KEYS.activity(wsId))).c[y.id]).toBeUndefined();
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels[y.id]).toBeUndefined();
  });

  it('an edit of a channel that stands is answered as before', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const y = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'y' })).data.channel;
    const res = await as(alice).put(`/api/ws/${wsId}/channels/${y.id}`, { topic: 'kept', postPolicy: 'admins' });
    expect(res.ok).toBe(true);
    expect(res.data.channel).toMatchObject({ id: y.id, topic: 'kept', postPolicy: 'admins' });
    const texts = (await as(alice).get(`/api/ws/${wsId}/conv/${y.id}/messages`)).data.messages.map((m) => m.text);
    expect(texts).toContain('alice limited posting to admins');
  });
});
