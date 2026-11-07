/**
 * Review pass 19, the message plane: channels, messages, threads, reactions,
 * pins, saved messages, direct messages, huddles, shared channels, transfer.
 * Each test here is a hole that was found in the worker's routes and closed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, overlayKey } from '../src/shared/blocks.js';

const { alice, bob, carol } = USERS;
let rt;

/**
 * A store that takes a counter write under `key` but hands back the paths it
 * wrote, with their new values, rather than the whole document (the shape
 * worker-a's tests give a path write; the real store's is unverified).
 */
function partialIncr(key) {
  return partialWrites(key, 'incr');
}

/** The same, for whichever path write (`incr`, `update`) the route makes under `key`. */
function partialWrites(key, method) {
  const orig = rt.kv[method];
  rt.kv[method] = async (k, arg) => {
    const res = await orig.call(rt.kv, k, arg);
    if (k !== key || !arg || typeof arg !== 'object') return res;
    const out = {};
    for (const path of Object.keys(arg)) {
      const parts = path.split('.');
      let src = res;
      let dst = out;
      parts.forEach((seg, i) => {
        if (i === parts.length - 1) dst[seg] = src?.[seg];
        else {
          dst[seg] = dst[seg] || {};
          dst = dst[seg];
          src = src?.[seg];
        }
      });
    }
    return out;
  };
  return () => { rt.kv[method] = orig; };
}

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

describe('unpinning a message in a conversation whose pin list holds another message twice', () => {
  it('counts the messages pinned, as pinning and the pins list do, not the entries on the list', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const post = (text) => as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text });
    const a = (await post('first')).data.message;
    const b = (await post('second')).data.message;
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/pins`, { seq: a.seq })).ok).toBe(true);
    // The pins list sorts by the moment pinned; two pins in one millisecond
    // tie, so the second waits a few, and the list is compared as a set below.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/pins`, { seq: b.seq })).ok).toBe(true);
    const pinsKey = KEYS.pins(wsId, general.id);
    const doc = await rt.kv.get(pinsKey);
    expect(doc.items.map((p) => p.seq)).toEqual([a.seq, b.seq]);
    // The list came to hold the first message twice (two pins of it in the
    // same instant on a store that hands nothing back from an append; see
    // the pins list route, which shows such a list with one row per message).
    const first = doc.items.find((p) => p.seq === a.seq);
    await rt.kv.set(pinsKey, { items: [first, { ...first }, doc.items.find((p) => p.seq === b.seq)] });
    // Two messages are pinned; the list shows two rows.
    const pinned = async () => (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/pins`)).data.pins.map((p) => p.seq).sort((x, y) => x - y);
    expect(await pinned()).toEqual([a.seq, b.seq].sort((x, y) => x - y));
    expect((await rt.kv.get(KEYS.activity(wsId))).c[general.id].pc).toBe(2);
    // Unpinning the second leaves one message pinned, and the header counts one.
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${general.id}/pins/${b.seq}`)).ok).toBe(true);
    expect(await pinned()).toEqual([a.seq]);
    expect((await rt.kv.get(KEYS.activity(wsId))).c[general.id].pc).toBe(1);
    // Deleting a pinned message unpins it the same way: nothing left pinned, nothing counted.
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${a.seq}`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.activity(wsId))).c[general.id].pc).toBe(0);
    expect((await rt.kv.get(pinsKey)).items).toEqual([]);
    expect((await rt.kv.get(KEYS.block(general.id, 0))).x[overlayKey(a.seq)].p).toBeUndefined();
    // A list with no duplicate counts as it always did.
    const c = (await post('third')).data.message;
    const d = (await post('fourth')).data.message;
    await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/pins`, { seq: c.seq });
    await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/pins`, { seq: d.seq });
    expect((await rt.kv.get(KEYS.activity(wsId))).c[general.id].pc).toBe(2);
    await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/pins/${c.seq}`);
    expect((await rt.kv.get(KEYS.activity(wsId))).c[general.id].pc).toBe(1);
  });
});

describe('a channel on a store that answers a counter write with the part it changed', () => {
  const texts = async (wsId, conv) => (await as(alice).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.map((m) => m.text);

  it('stands after being made, joined, added to and left, with its counts and lines as on any store', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    const key = KEYS.ws(wsId);
    const restore = partialIncr(key);
    try {
      const made = await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'pub' });
      expect(made.status).toBe(200);
      const ch = made.data.channel.id;
      expect((await rt.kv.get(key)).channels[ch]).toMatchObject({ id: ch, name: 'pub', count: 1 });
      expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).data).toEqual({ ok: true });
      expect((await rt.kv.get(key)).channels[ch]).toMatchObject({ id: ch, name: 'pub', count: 2 });
      expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/members`, { uuids: [carol.uuid] })).data).toEqual({ added: [carol.uuid] });
      expect((await rt.kv.get(key)).channels[ch]).toMatchObject({ id: ch, name: 'pub', count: 3 });
      expect((await as(carol).post(`/api/ws/${wsId}/channels/${ch}/leave`)).data).toEqual({ ok: true });
      expect((await rt.kv.get(key)).channels[ch]).toMatchObject({ id: ch, name: 'pub', count: 2 });
      expect(await texts(wsId, ch)).toEqual(['alice created #pub', 'bob joined', 'bob added carol', 'carol left']);
      // A private channel's list follows the leave as well.
      const priv = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'priv', private: true })).data.channel.id;
      expect((await as(alice).post(`/api/ws/${wsId}/channels/${priv}/members`, { uuids: [bob.uuid] })).data).toEqual({ added: [bob.uuid] });
      expect((await as(bob).post(`/api/ws/${wsId}/channels/${priv}/leave`)).data).toEqual({ ok: true });
      expect((await rt.kv.get(key)).channels[priv]).toMatchObject({ id: priv, count: 1, members: [alice.uuid] });
    } finally {
      restore();
    }
    const boot = await as(bob).get(`/api/ws/${wsId}`);
    expect(Object.values(boot.data.workspace.channels).map((c) => c.name).sort()).toEqual(['general', 'pub']);
  });

  it('still comes off where the write alone made it, the channel deleted meanwhile, on either kind of store', async () => {
    for (const partial of [false, true]) {
      rt = await boot();
      const { wsId } = await workspaceWith(alice, [bob]);
      const key = KEYS.ws(wsId);
      const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'pub' })).data.channel.id;
      const restore = partial ? partialIncr(key) : () => {};
      const origIncr = rt.kv.incr;
      const origRemove = rt.kv.remove;
      let removed = false;
      // Alice deletes the channel in the instant bob's join counts him in.
      rt.kv.incr = async (k, arg) => {
        if (k === key && arg && Object.hasOwn(arg, `channels.${ch}.count`) && !removed) {
          removed = true;
          await origRemove.call(rt.kv, key, `channels.${ch}`);
        }
        return origIncr.call(rt.kv, k, arg);
      };
      let res;
      try {
        res = await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`);
      } finally {
        rt.kv.incr = origIncr;
        restore();
      }
      expect(res.status).toBe(404);
      expect((await rt.kv.get(key)).channels[ch]).toBeUndefined();
    }
  });
});

describe('a huddle heartbeat on a store that answers a path write with the part it changed', () => {
  it('keeps the huddle as it stands: its start, its one line, and a roster naming everyone in it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const key = KEYS.activity(wsId);
    const huddle = (who, body) => as(who).post(`/api/ws/${wsId}/conv/${general.id}/huddle`, body);
    const restore = partialWrites(key, 'update');
    try {
      const start = await huddle(alice, { invite: 'AA-1111', sid: 'tab-a', join: true });
      expect(start.data.started).toBe(true);
      const joined = await huddle(bob, { invite: 'BB-2222', sid: 'tab-b', join: true });
      expect(joined.data.started).toBe(false);
      expect(Object.keys(joined.data.huddle.m).sort()).toEqual([alice.uuid, bob.uuid]);
      const at = (await rt.kv.get(key)).h[general.id].at;
      await new Promise((resolve) => setTimeout(resolve, 5));
      // Heartbeats from both, in turn: nothing begins anew.
      for (const [who, invite, sid] of [[alice, 'AA-1111', 'tab-a'], [bob, 'BB-2222', 'tab-b'], [alice, 'AA-1111', 'tab-a']]) {
        const beat = await huddle(who, { invite, sid });
        expect(beat.status).toBe(200);
        expect(beat.data.started).toBe(false);
        expect(Object.keys(beat.data.huddle.m).sort()).toEqual([alice.uuid, bob.uuid]);
        expect(beat.data.huddle.at).toBe(at);
      }
      const h = (await rt.kv.get(key)).h[general.id];
      expect(h).toMatchObject({ by: alice.uuid, at, n: 1 });
      expect(Object.keys(h.m).sort()).toEqual([alice.uuid, bob.uuid]);
    } finally {
      restore();
    }
    const texts = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.map((m) => m.text);
    expect(texts.filter((t) => /huddle/.test(t))).toEqual(['alice started a huddle']);
  });
});
