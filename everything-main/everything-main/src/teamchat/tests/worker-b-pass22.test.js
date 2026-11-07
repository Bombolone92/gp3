/**
 * Review pass 22, the message plane: channels, messages, threads, reactions,
 * pins, saved messages, direct messages, huddles, shared channels, transfer.
 * Each test here is a hole that was found in the worker's routes and closed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { countKv } from './helpers/kvcount.js';
import { KEYS } from '../src/shared/blocks.js';

const { alice, bob, carol, dave } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

describe('deleting a channel whose threads have had every reply deleted', () => {
  /**
   * Two threads that no reader can tell are there any more: one under a root
   * that stands with its count back at nothing, one under a root deleted
   * while its reply stood (a tombstone), whose reply then went too. Each
   * still has its block, its counter and (for the second) its pins list.
   */
  const emptiedThreads = async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'busy' })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${ch.id}/join`);
    const rootA = (await as(alice).post(`/api/ws/${wsId}/conv/${ch.id}/messages`, { text: 'root a' })).data.message;
    const tA = `${ch.id}_t${rootA.seq}`;
    const replyA = (await as(bob).post(`/api/ws/${wsId}/conv/${tA}/messages`, { text: 'reply a' })).data.message;
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${tA}/messages/${replyA.seq}`)).ok).toBe(true);
    const rootB = (await as(alice).post(`/api/ws/${wsId}/conv/${ch.id}/messages`, { text: 'root b' })).data.message;
    const tB = `${ch.id}_t${rootB.seq}`;
    const replyB = (await as(bob).post(`/api/ws/${wsId}/conv/${tB}/messages`, { text: 'reply b' })).data.message;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${tB}/pins`, { seq: replyB.seq })).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${ch.id}/messages/${rootB.seq}`)).ok).toBe(true);
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${tB}/messages/${replyB.seq}`)).ok).toBe(true);
    // Both threads still have their storage (the second holds its "pinned a
    // message" line as well), and nothing shows them.
    for (const t of [tA, tB]) {
      expect(Number(await rt.kv.get(KEYS.seq(t)))).toBeGreaterThanOrEqual(1);
      expect(await rt.kv.get(KEYS.block(t, 0))).toBeTruthy();
    }
    expect(await rt.kv.get(KEYS.pins(wsId, tB))).toBeTruthy();
    const shown = (await as(alice).get(`/api/ws/${wsId}/conv/${ch.id}/messages`)).data.messages;
    expect(shown.find((m) => m.seq === rootA.seq).replyCount).toBe(0);
    expect(shown.find((m) => m.seq === rootB.seq)).toBeUndefined();
    return { wsId, ch, tA, tB };
  };

  it('takes the threads\' blocks, counters and pins lists away with the channel, and their activity entries', async () => {
    const { wsId, ch, tA, tB } = await emptiedThreads();
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${ch.id}`)).data).toEqual({ ok: true });
    for (const t of [tA, tB]) {
      expect(await rt.kv.get(KEYS.seq(t))).toBeFalsy();
      expect(await rt.kv.get(KEYS.block(t, 0))).toBeFalsy();
      expect(await rt.kv.get(KEYS.pins(wsId, t))).toBeFalsy();
    }
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.c[ch.id]).toBeUndefined();
    expect(act.c[tA]).toBeUndefined();
    expect(act.c[tB]).toBeUndefined();
  });

  it('deleting the workspace takes them away as well', async () => {
    const { wsId, tA, tB } = await emptiedThreads();
    expect((await as(alice).del(`/api/ws/${wsId}`)).data).toEqual({ deleted: true });
    for (const t of [tA, tB]) {
      expect(await rt.kv.get(KEYS.seq(t))).toBeFalsy();
      expect(await rt.kv.get(KEYS.block(t, 0))).toBeFalsy();
      expect(await rt.kv.get(KEYS.pins(wsId, t))).toBeFalsy();
    }
  });

  it('a root merely followed, never replied to, names no thread to purge', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'quiet' })).data.channel;
    const root = (await as(alice).post(`/api/ws/${wsId}/conv/${ch.id}/messages`, { text: 'root' })).data.message;
    const t = `${ch.id}_t${root.seq}`;
    expect((await as(alice).put(`/api/ws/${wsId}/conv/${t}/notify`, { follow: true })).ok).toBe(true);
    const orig = rt.kv.get;
    const read = [];
    rt.kv.get = async (k, ...rest) => {
      read.push(String(k));
      return orig.call(rt.kv, k, ...rest);
    };
    let res;
    try {
      res = await as(alice).del(`/api/ws/${wsId}/channels/${ch.id}`);
    } finally {
      rt.kv.get = orig;
    }
    expect(res.data).toEqual({ ok: true });
    // The follow flag alone names no thread: no counter of one is read for.
    expect(read).not.toContain(KEYS.seq(t));
    expect(await rt.kv.get(KEYS.seq(t))).toBeFalsy();
  });
});

describe('a scheduled message delivered over messages its author has not read', () => {
  it('writes nothing to the author\'s document, the cursor staying where it stood', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 2 })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt: Date.now() - 30_000 })).ok).toBe(true);
    for (let i = 0; i < 3; i++) expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: `m${i}` })).ok).toBe(true);
    const orig = rt.kv.update;
    const written = [];
    rt.kv.update = async (k, paths) => {
      if (k === KEYS.member(wsId, bob.uuid)) written.push(paths);
      return orig.call(rt.kv, k, paths);
    };
    try {
      expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    } finally {
      rt.kv.update = orig;
    }
    const list = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages;
    expect(list[list.length - 1]).toMatchObject({ seq: 6, user: bob.uuid, text: 'later' });
    // The cursor stays at 2 (see pass 21), and no write of nothing went to the document for it.
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).reads[general.id]).toBe(2);
    expect(written.filter((p) => !p || !Object.keys(p).length)).toEqual([]);
  });
});

describe('the lines a huddle writes, and who the activity entry names as their writer', () => {
  const setup = async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const x = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'x' })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${x.id}/join`);
    return { wsId, x };
  };
  const entry = async (wsId, conv) => (await rt.kv.get(KEYS.activity(wsId))).c[conv];
  const last = async (wsId, conv) => (await as(alice).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.at(-1);

  it('"Huddle ended" is drawn as the starter\'s but written as the system\'s, so the starter\'s tabs do not take it for their own', async () => {
    const { wsId, x } = await setup();
    const h = await as(bob).post(`/api/ws/${wsId}/conv/${x.id}/huddle`, { invite: 'AB-1234', sid: 'tab1', join: true });
    expect(h.data.started).toBe(true);
    // Starting it by hand is bob's own act, in the conversation he is looking at: his line, as before.
    expect(await last(wsId, x.id)).toMatchObject({ kind: 'sys', user: bob.uuid, text: 'bob started a huddle' });
    expect((await entry(wsId, x.id)).u).toBe(bob.uuid);
    // Bob wanders off with the dock; alice posts; the call ends.
    await as(alice).post(`/api/ws/${wsId}/conv/${x.id}/messages`, { text: 'while you were away' });
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${x.id}/huddle?sid=tab1`)).data.ended).toBe(true);
    const line = await last(wsId, x.id);
    expect(line).toMatchObject({ kind: 'sys', user: bob.uuid });
    expect(line.text).toMatch(/^Huddle ended/);
    // The entry names the system, not bob (as a reminder line's does): his tabs leave the conversation unread.
    expect(await entry(wsId, x.id)).toMatchObject({ s: line.seq, u: 'sys' });
  });

  it('a huddle begun anew by a heartbeat, after a poll tidied the roster away, is written as the system\'s too', async () => {
    const { wsId, x } = await setup();
    await as(bob).post(`/api/ws/${wsId}/conv/${x.id}/huddle`, { invite: 'AB-1234', sid: 'tab1', join: true });
    // Bob's seat goes quiet past the roster's patience (a tab beating once a
    // minute in the background); alice's poll ends the huddle with its line.
    await rt.kv.update(KEYS.activity(wsId), { [`h.${x.id}.m.${bob.uuid}.at`]: Date.now() - 200_000 });
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect((await last(wsId, x.id)).text).toMatch(/^Huddle ended/);
    expect((await entry(wsId, x.id)).u).toBe('sys');
    // Bob's tab beats on and begins the huddle again: not a click of his, and he is not looking.
    const beat = await as(bob).post(`/api/ws/${wsId}/conv/${x.id}/huddle`, { invite: 'AB-1234', sid: 'tab1' });
    expect(beat.data.started).toBe(true);
    const line = await last(wsId, x.id);
    expect(line).toMatchObject({ kind: 'sys', user: bob.uuid, text: 'bob started a huddle' });
    expect(await entry(wsId, x.id)).toMatchObject({ s: line.seq, u: 'sys' });
  });
});

describe('the lines a shared channel writes in the owner\'s name', () => {
  const SERVER = 'teamchat-api.test';
  const entry = async (wsId, conv) => (await rt.kv.get(KEYS.activity(wsId))).c[conv];
  const last = async (wsId, conv) => (await as(alice).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.at(-1);

  it('"now shared with" and "disconnected" are drawn as the owner\'s but written as the system\'s', async () => {
    // Acme (alice owns it, carol is an admin) hosts #design; Globex (alice
    // owns it too, bob is its admin) is the partner. Alice is looking at
    // none of this: bob accepts the link, carol and bob end connections.
    const acme = await workspaceWith(alice, [carol], 'Acme');
    const globex = await workspaceWith(alice, [bob], 'Globex');
    expect((await as(alice).post(`/api/ws/${acme.wsId}/members/${carol.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const design = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'design' })).data.channel.id;
    expect((await as(carol).post(`/api/ws/${acme.wsId}/channels/${design}/join`)).ok).toBe(true);
    const connect = async () => {
      const inv = await as(carol).post(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`, {});
      const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' } });
      expect(acc.ok).toBe(true);
      const added = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, { ref: `${acme.wsId}@${SERVER}`, ch: design, conn: acc.data.conn, secret: acc.data.secret, name: 'design-with-acme', host: 'Acme' });
      expect(added.ok).toBe(true);
      return { conn: acc.data.conn, entry: added.data.channel.id };
    };
    const first = await connect();
    let line = await last(acme.wsId, design);
    expect(line).toMatchObject({ kind: 'sys', user: alice.uuid, text: 'This channel is now shared with Globex' });
    expect(await entry(acme.wsId, design)).toMatchObject({ s: line.seq, u: 'sys' });
    // The host's admin ends it from the channel.
    expect((await as(carol).del(`/api/ws/${acme.wsId}/channels/${design}/connections/${first.conn}`)).ok).toBe(true);
    line = await last(acme.wsId, design);
    expect(line).toMatchObject({ kind: 'sys', user: alice.uuid, text: 'carol disconnected Globex' });
    expect(await entry(acme.wsId, design)).toMatchObject({ s: line.seq, u: 'sys' });
    // Shared again, and this time the partner's admin ends it with a disconnect attestation.
    const second = await connect();
    const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${second.entry}/attest`, { kind: 'disconnect' });
    expect(att.ok).toBe(true);
    expect((await as(bob).post('/api/connect/disconnect', { conn: att.data.conn, token: att.data.token })).ok).toBe(true);
    line = await last(acme.wsId, design);
    expect(line).toMatchObject({ kind: 'sys', user: alice.uuid, text: 'Globex disconnected from this channel' });
    expect(await entry(acme.wsId, design)).toMatchObject({ s: line.seq, u: 'sys' });
  });
});

describe('the round trips of a request that reads every member\'s document', () => {
  /** Alice, bob and carol in #general; a public #x with alice and bob; dave a guest of #x alone. */
  const setup = async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const x = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'x' })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${x.id}/join`);
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${x.id}/invites`, {});
    expect((await as(dave).post('/api/join', { code: inv.data.code })).ok).toBe(true);
    return { wsId, general, x };
  };
  const readsOf = (c, wsId, u) => c.keys.get.filter((k) => k === KEYS.member(wsId, u.uuid)).length;

  it('reads the caller\'s own document once, not again among everyone\'s', async () => {
    const { wsId, general, x } = await setup();
    const c = countKv(rt);
    try {
      // A broadcast in a public channel: who is in the channel is read off every document.
      const bc = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'all @channel' });
      expect(bc.ok).toBe(true);
      expect(bc.data.notified).toBe(2);
      expect(readsOf(c, wsId, alice)).toBe(1);
      expect(readsOf(c, wsId, bob)).toBe(1);
      // The member list of a public channel, in the workspace's own order.
      c.reset();
      const list = await as(bob).get(`/api/ws/${wsId}/channels/${x.id}/members`);
      expect(list.data.members).toEqual([alice.uuid, bob.uuid, dave.uuid]);
      expect(readsOf(c, wsId, bob)).toBe(1);
      // A guest's bootstrap, whose people are read off every document.
      c.reset();
      const b = await as(dave).get(`/api/ws/${wsId}`);
      expect(Object.keys(b.data.workspace.members).sort()).toEqual([alice.uuid, bob.uuid, dave.uuid].sort());
      expect(readsOf(c, wsId, dave)).toBe(1);
      // A guest opening a direct message with someone from their channel.
      c.reset();
      const dm = await as(dave).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] });
      expect(dm.ok).toBe(true);
      expect(readsOf(c, wsId, dave)).toBe(1);
      const refused = await as(dave).post(`/api/ws/${wsId}/dms`, { members: [carol.uuid] });
      expect(refused.status).toBe(403);
    } finally {
      c.restore();
    }
  });
});

describe('the writes a thread reply makes to its root\'s record', () => {
  it('leaves the reply time and the follow flags in one write beside the count', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const root = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' })).data.message;
    const t = `${general.id}_t${root.seq}`;
    const rootKey = KEYS.block(general.id, 0);
    const c = countKv(rt);
    let reply;
    try {
      // Bob's first reply, naming carol, who follows the thread from here (see `pulled`).
      reply = (await as(bob).post(`/api/ws/${wsId}/conv/${t}/messages`, { text: 'hey @carol' })).data.message;
      expect(c.keys.incr.filter((k) => k === rootKey)).toHaveLength(1);
      expect(c.keys.update.filter((k) => k === rootKey)).toHaveLength(1);
    } finally {
      c.restore();
    }
    const shown = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages?from=${root.seq}&to=${root.seq}`)).data.messages[0];
    expect(shown).toMatchObject({ seq: root.seq, replyCount: 1, lastReplyAt: reply.ts });
    expect(shown.followers).toEqual({ [bob.uuid]: 1, [carol.uuid]: 1 });
    // Carol, brought in, now hears of replies as a follower; alice, the author, always did.
    const second = await as(alice).post(`/api/ws/${wsId}/conv/${t}/messages`, { text: 'welcome' });
    expect(second.ok).toBe(true);
    expect((await rt.kv.get(KEYS.member(wsId, carol.uuid))).threads[t]).toBe(1);
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).threads[t]).toBe(1);
  });
});
