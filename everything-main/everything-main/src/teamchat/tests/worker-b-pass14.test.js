/**
 * Review pass 14, the message plane: channels, messages, threads, reactions,
 * pins, saved messages, direct messages, huddles, shared channels, transfer.
 * Each test here is a hole that was found in the worker's routes and closed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import { LIMITS, cleanText } from '../src/shared/limits.js';
import { signAttestation } from '../worker/connect.js';

const { alice, bob, carol, dave } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

const post = (u, wsId, conv, text, extra = {}) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text, ...extra });
const sysLines = async (wsId, conv, re) => (await as(alice).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.filter((x) => x.kind === 'sys' && re.test(x.text));

describe('two people pinning the same message in the same instant, as the first pin of the conversation', () => {
  it('leaves one pin and one line on a store that refuses to append to a list that is not there yet, and tells the second it was pinned already', async () => {
    rt = await boot({ strictAdd: true });
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const conv = general.id;
    const m = (await post(alice, wsId, conv, 'pin this')).data.message;
    const [a, b] = await Promise.all([
      as(alice).post(`/api/ws/${wsId}/conv/${conv}/pins`, { seq: m.seq }),
      as(bob).post(`/api/ws/${wsId}/conv/${conv}/pins`, { seq: m.seq }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    // The one whose first write of the list survived pinned it; the other is told so, and writes no line of its own.
    const winners = [a, b].filter((r) => !r.data.already);
    expect(winners).toHaveLength(1);
    const items = (await rt.kv.get(KEYS.pins(wsId, conv))).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ seq: m.seq, by: winners[0].data.pin.by });
    expect(await sysLines(wsId, conv, /pinned a message/)).toHaveLength(1);
    expect((await rt.kv.get(KEYS.activity(wsId))).c[conv].pc).toBe(1);
    const pins = (await as(bob).get(`/api/ws/${wsId}/conv/${conv}/pins`)).data.pins;
    expect(pins.map((p) => p.seq)).toEqual([m.seq]);
    expect(pins[0].message.pinned).toBe(true);
    // Two different messages pinned in the same instant as the first pins are both kept, as before.
    const other = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'other' })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${other.id}/join`);
    const m1 = (await post(alice, wsId, other.id, 'one')).data.message;
    const m2 = (await post(bob, wsId, other.id, 'two')).data.message;
    const [c, d] = await Promise.all([
      as(alice).post(`/api/ws/${wsId}/conv/${other.id}/pins`, { seq: m1.seq }),
      as(bob).post(`/api/ws/${wsId}/conv/${other.id}/pins`, { seq: m2.seq }),
    ]);
    expect([c.data.already, d.data.already]).toEqual([undefined, undefined]);
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${other.id}/pins`)).data.pins.map((p) => p.seq).sort()).toEqual([m1.seq, m2.seq].sort());
    expect((await rt.kv.get(KEYS.activity(wsId))).c[other.id].pc).toBe(2);
  });

  it('a pin whose entry an unpin took off while another pinned the message again is answered as pinned already, with no second line', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const conv = general.id;
    const m = (await post(alice, wsId, conv, 'contested')).data.message;
    // Bob's request has appended its entry and set the flag; before it reads
    // the list back, alice unpins (every copy goes) and pins it again.
    const key = KEYS.pins(wsId, conv);
    const realGet = rt.kv.get.bind(rt.kv);
    let intercepted = false;
    rt.kv.get = async (k) => {
      if (k === key && !intercepted && (await realGet(k))?.items?.some((p) => p.by === bob.uuid)) {
        intercepted = true;
        await rt.kv.set(key, { items: [{ seq: m.seq, by: alice.uuid, ts: Date.now() + 1 }] });
      }
      return realGet(k);
    };
    try {
      const res = await as(bob).post(`/api/ws/${wsId}/conv/${conv}/pins`, { seq: m.seq });
      expect(res.data).toEqual({ ok: true, already: true });
    } finally {
      rt.kv.get = realGet;
    }
    expect(intercepted).toBe(true);
    const items = (await rt.kv.get(key)).items;
    expect(items).toHaveLength(1);
    expect(items[0].by).toBe(alice.uuid);
    expect(await sysLines(wsId, conv, /pinned a message/)).toHaveLength(0);
  });
});

describe('the first two saves of a member, in the same instant, on a store that refuses to append to a list that is not there yet', () => {
  it('keeps both, and the Later view lists both', async () => {
    rt = await boot({ strictAdd: true });
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m1 = (await post(alice, wsId, general.id, 'one')).data.message;
    const m2 = (await post(alice, wsId, general.id, 'two')).data.message;
    const [a, b] = await Promise.all([
      as(bob).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: m1.seq }),
      as(bob).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: m2.seq }),
    ]);
    expect(a.data).toEqual({ ok: true, saved: true });
    expect(b.data).toEqual({ ok: true, saved: true });
    expect((await rt.kv.get(KEYS.saved(wsId, bob.uuid))).items.map((e) => e.s).sort()).toEqual([m1.seq, m2.seq].sort());
    expect((await as(bob).get(`/api/ws/${wsId}/saved`)).data.items.map((e) => e.s).sort()).toEqual([m1.seq, m2.seq].sort());
    // The same message saved twice at once as the first saves stays one entry.
    const m3 = (await post(alice, wsId, general.id, 'three')).data.message;
    await rt.kv.del(KEYS.saved(wsId, bob.uuid));
    await Promise.all([
      as(bob).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: m3.seq }),
      as(bob).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: m3.seq }),
    ]);
    expect((await rt.kv.get(KEYS.saved(wsId, bob.uuid))).items.map((e) => e.s)).toEqual([m3.seq]);
    // A first save with nothing racing it is kept as before.
    const { wsId: ws2, general: g2 } = await workspaceWith(alice, [bob], 'Beta');
    const m4 = (await post(alice, ws2, g2.id, 'four')).data.message;
    expect((await as(bob).post(`/api/ws/${ws2}/saved`, { conv: g2.id, seq: m4.seq })).data).toEqual({ ok: true, saved: true });
    expect((await as(bob).get(`/api/ws/${ws2}/saved`)).data.items.map((e) => e.s)).toEqual([m4.seq]);
  });
});

describe('a message deleted in the same instant it was pinned', () => {
  /** Run the deletion inside the pin route's window: after it has found the message standing, before it appends the pin and flags the message. */
  async function pinAcrossDeletion(wsId, conv, seq) {
    const key = KEYS.pins(wsId, conv);
    const realGet = rt.kv.get.bind(rt.kv);
    let deleted = null;
    rt.kv.get = async (k) => {
      if (k === key && !deleted) {
        deleted = await as(alice).del(`/api/ws/${wsId}/conv/${conv}/messages/${seq}`);
      }
      return realGet(k);
    };
    try {
      return { pin: await as(bob).post(`/api/ws/${wsId}/conv/${conv}/pins`, { seq }), deleted };
    } finally {
      rt.kv.get = realGet;
    }
  }

  it('does not stand on the pinned list for good as a pin with nothing to open, nor in the header\'s count', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const conv = general.id;
    const kept = (await post(alice, wsId, conv, 'stays')).data.message;
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${conv}/pins`, { seq: kept.seq })).ok).toBe(true);
    const m = (await post(alice, wsId, conv, 'gone soon')).data.message;
    const { pin, deleted } = await pinAcrossDeletion(wsId, conv, m.seq);
    expect(deleted.data).toEqual({ ok: true });
    expect(pin.ok).toBe(true);
    // The crossing left a pin of a deleted message on the list and in the count.
    expect((await rt.kv.get(KEYS.pins(wsId, conv))).items.map((p) => p.seq).sort()).toEqual([kept.seq, m.seq].sort());
    expect((await rt.kv.get(KEYS.activity(wsId))).c[conv].pc).toBe(2);
    // Reading the pinned list lets it go, and puts the count right; the other pin stands.
    const before = (await rt.kv.get(KEYS.activity(wsId))).c[conv].x;
    const pins = (await as(bob).get(`/api/ws/${wsId}/conv/${conv}/pins`)).data.pins;
    expect(pins.map((p) => p.seq)).toEqual([kept.seq]);
    expect(pins[0].message.text).toBe('stays');
    expect((await rt.kv.get(KEYS.pins(wsId, conv))).items.map((p) => p.seq)).toEqual([kept.seq]);
    const act = (await rt.kv.get(KEYS.activity(wsId))).c[conv];
    expect(act.pc).toBe(1);
    expect(act.x).toBeGreaterThanOrEqual(before);
    // Nothing left to unpin for it; the list is left alone by a read that finds nothing gone.
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${conv}/pins/${m.seq}`)).status).toBe(404);
    const ops = rt.kv._calls.ops;
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${conv}/pins`)).data.pins.map((p) => p.seq)).toEqual([kept.seq]);
    expect((await rt.kv.get(KEYS.pins(wsId, conv))).items).toHaveLength(1);
    expect(rt.kv._calls.ops - ops).toBeLessThan(8);
  });

  it('keeps a pin whose block lies past the dozen one answer reads, and every pin while the workspace is still being imported', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const conv = general.id;
    const m = (await post(alice, wsId, conv, 'far back')).data.message;
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${conv}/pins`, { seq: m.seq })).ok).toBe(true);
    // Twelve later blocks pinned: the first pin's block is not read, and it is shown without its message, not dropped.
    const items = [];
    for (let n = 1; n <= 12; n++) items.push({ seq: n * 50 + 1, by: alice.uuid, ts: Date.now() + n });
    await rt.kv.set(KEYS.pins(wsId, conv), { items: [{ seq: m.seq, by: alice.uuid, ts: 1 }, ...items] });
    for (let n = 1; n <= 12; n++) await rt.kv.set(KEYS.block(conv, n), { m: [{ s: n * 50 + 1, u: alice.uuid, t: `b${n}`, ts: Date.now() }], x: {} });
    await rt.kv.set(KEYS.seq(conv), 12 * 50 + 1);
    const pins = (await as(bob).get(`/api/ws/${wsId}/conv/${conv}/pins`)).data.pins;
    expect(pins).toHaveLength(13);
    expect(pins.find((p) => p.seq === m.seq).message).toBeNull();
    expect((await rt.kv.get(KEYS.pins(wsId, conv))).items).toHaveLength(13);
    // Importing: a pin for a message not written yet stays.
    await rt.kv.set(KEYS.pins(wsId, conv), { items: [{ seq: 40, by: alice.uuid, ts: 1 }] });
    await rt.kv.update(KEYS.ws(wsId), { importing: true });
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${conv}/pins`)).data.pins.map((p) => p.seq)).toEqual([40]);
    expect((await rt.kv.get(KEYS.pins(wsId, conv))).items).toHaveLength(1);
    await rt.kv.remove(KEYS.ws(wsId), 'importing');
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${conv}/pins`)).data.pins).toEqual([]);
    expect((await rt.kv.get(KEYS.pins(wsId, conv))).items).toEqual([]);
  });

  it('writes nothing to a copy that has moved to another server, or is being moved: the list is shown as it stands until the workspace takes writes again', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const conv = general.id;
    const m = (await post(alice, wsId, conv, 'gone soon')).data.message;
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${conv}/pins`, { seq: m.seq })).ok).toBe(true);
    // The pin is left pointing at a deleted message, as the crossing above leaves it.
    await rt.kv.update(KEYS.block(conv, 0), { [`x.s${m.seq}.d`]: 1 });
    const stale = (await rt.kv.get(KEYS.pins(wsId, conv))).items;
    expect(stale.map((p) => p.seq)).toEqual([m.seq]);
    const wsOps = () => rt.kv._calls.ops;
    // Being moved: the nominee's freeze holds.
    await as(alice).post(`/api/ws/${wsId}/members/${carol.uuid}/role`, { role: 'admin' });
    await as(alice).post(`/api/ws/${wsId}/transfer`, { to: carol.uuid });
    expect((await as(carol).post(`/api/ws/${wsId}/transfer/begin`)).ok).toBe(true);
    let before = wsOps();
    let pins = (await as(bob).get(`/api/ws/${wsId}/conv/${conv}/pins`)).data.pins;
    expect(pins.map((p) => [p.seq, p.message])).toEqual([[m.seq, null]]);
    expect((await rt.kv.get(KEYS.pins(wsId, conv))).items).toEqual(stale);
    expect((await rt.kv.get(KEYS.block(conv, 0))).x[`s${m.seq}`].p).toBe(1);
    expect(wsOps() - before).toBeLessThan(8);
    // Moved for good: read-only from then on.
    expect((await as(carol).post(`/api/ws/${wsId}/transfer/complete`, { to: 'newcopy123@other.puter.work' })).ok).toBe(true);
    before = wsOps();
    pins = (await as(bob).get(`/api/ws/${wsId}/conv/${conv}/pins`)).data.pins;
    expect(pins.map((p) => [p.seq, p.message])).toEqual([[m.seq, null]]);
    expect((await rt.kv.get(KEYS.pins(wsId, conv))).items).toEqual(stale);
    expect(wsOps() - before).toBeLessThan(8);
    // Open to writes again (the move undone by hand here): the stale pin goes.
    await rt.kv.remove(KEYS.ws(wsId), 'movedTo', 'movedAt');
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${conv}/pins`)).data.pins).toEqual([]);
    expect((await rt.kv.get(KEYS.pins(wsId, conv))).items).toEqual([]);
    expect((await rt.kv.get(KEYS.block(conv, 0))).x[`s${m.seq}`].p).toBeUndefined();
  });
});

describe('a channel deleted while someone joins or leaves it, is added to it, or is taken out of the workspace', () => {
  /**
   * Run the channel's deletion inside another request's window: the moment
   * that request first counts under the channel, after it read the channel
   * standing. Returns the request's answer and the deletion's.
   */
  async function deletionUnder(wsId, chId, run) {
    const realIncr = rt.kv.incr.bind(rt.kv);
    let fired = false;
    let deleted = null;
    rt.kv.incr = async (k, by) => {
      if (k === KEYS.ws(wsId) && !fired && by && typeof by === 'object' && Object.keys(by).some((p) => p.startsWith(`channels.${chId}.`))) {
        fired = true;
        deleted = await as(alice).del(`/api/ws/${wsId}/channels/${chId}`);
      }
      return realIncr(k, by);
    };
    try {
      return { res: await run(), deleted };
    } finally {
      rt.kv.incr = realIncr;
    }
  }
  const noTrace = async (wsId, chId) => {
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[chId]).toBeUndefined();
    expect(await rt.kv.get(KEYS.block(chId, 0))).toBeFalsy();
    expect(await rt.kv.get(KEYS.seq(chId))).toBeFalsy();
  };

  it('does not come back as a nameless channel: joining is told it is gone, and nothing is written into it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'doomed' })).data.channel;
    const { res, deleted } = await deletionUnder(wsId, ch.id, () => as(bob).post(`/api/ws/${wsId}/channels/${ch.id}/join`));
    expect(deleted.data).toEqual({ ok: true });
    expect(res.status).toBe(404);
    await noTrace(wsId, ch.id);
    expect(Object.keys((await as(bob).get(`/api/ws/${wsId}`)).data.workspace.channels)).toEqual([general.id]);
  });

  it('leaving it writes no line into it and leaves no entry of it', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'doomed' })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${ch.id}/join`);
    const { res, deleted } = await deletionUnder(wsId, ch.id, () => as(bob).post(`/api/ws/${wsId}/channels/${ch.id}/leave`));
    expect(deleted.data).toEqual({ ok: true });
    expect(res.data).toEqual({ ok: true });
    await noTrace(wsId, ch.id);
  });

  it('adding people to it is told it is gone, and its member list does not come back', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'doomed', private: true })).data.channel;
    const { res, deleted } = await deletionUnder(wsId, ch.id, () => as(alice).post(`/api/ws/${wsId}/channels/${ch.id}/members`, { uuids: [bob.uuid, carol.uuid] }));
    expect(deleted.data).toEqual({ ok: true });
    expect(res.status).toBe(404);
    await noTrace(wsId, ch.id);
  });

  it('a count written under it by someone\'s removal from the workspace is swept at the next read, and a real channel is never touched', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'doomed' })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${ch.id}/join`);
    const { res, deleted } = await deletionUnder(wsId, ch.id, () => as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`));
    expect(deleted.data).toEqual({ ok: true });
    expect(res.data).toEqual({ ok: true });
    // The removal's count landed after the deletion: a nameless entry stands on the document.
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[ch.id]).toEqual({ count: -1 });
    // The next read of the workspace shows no such channel and takes the entry off.
    const seen = (await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels;
    expect(Object.keys(seen)).toEqual([general.id]);
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[ch.id]).toBeUndefined();
    // A rename that crossed a deletion leaves a name with no id: no channel either; the channel beside it stands.
    const kept = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'kept', topic: 'stays' })).data.channel;
    await rt.kv.update(KEYS.ws(wsId), { 'channels.ghost00000.name': 'ghost', 'channels.ghost00000.topic': 'boo' });
    const after = (await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels;
    expect(Object.keys(after).sort()).toEqual([general.id, kept.id].sort());
    expect(after[kept.id]).toMatchObject({ name: 'kept', topic: 'stays' });
    const doc = await rt.kv.get(KEYS.ws(wsId));
    expect(doc.channels.ghost00000).toBeUndefined();
    expect(doc.channels[kept.id].id).toBe(kept.id);
  });

  it('is kept out of what a moved or frozen copy shows, and out of its export, without writing to that copy', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    await as(alice).post(`/api/ws/${wsId}/members/${carol.uuid}/role`, { role: 'admin' });
    await as(alice).post(`/api/ws/${wsId}/transfer`, { to: carol.uuid });
    expect((await as(carol).post(`/api/ws/${wsId}/transfer/begin`)).ok).toBe(true);
    // A count that landed after a deletion, while the move runs.
    await rt.kv.update(KEYS.ws(wsId), { 'channels.ghost00000.count': -1 });
    let seen = (await as(bob).get(`/api/ws/${wsId}`)).data.workspace.channels;
    expect(Object.keys(seen)).toEqual([general.id]);
    expect((await rt.kv.get(KEYS.ws(wsId))).channels.ghost00000).toEqual({ count: -1 });
    // The nominee's export leaves it out too.
    const exported = await as(carol).get(`/api/ws/${wsId}/export`);
    expect(exported.ok).toBe(true);
    expect(Object.keys(exported.data.header.channels)).toEqual([general.id]);
    expect((await rt.kv.get(KEYS.ws(wsId))).channels.ghost00000).toEqual({ count: -1 });
    // Moved for good: still shown without it, still not written.
    expect((await as(carol).post(`/api/ws/${wsId}/transfer/complete`, { to: 'newcopy123@other.puter.work' })).ok).toBe(true);
    seen = (await as(bob).get(`/api/ws/${wsId}`)).data.workspace.channels;
    expect(Object.keys(seen)).toEqual([general.id]);
    expect((await rt.kv.get(KEYS.ws(wsId))).channels.ghost00000).toEqual({ count: -1 });
    // Open to writes again: the entry comes off.
    await rt.kv.remove(KEYS.ws(wsId), 'movedTo', 'movedAt');
    expect(Object.keys((await as(bob).get(`/api/ws/${wsId}`)).data.workspace.channels)).toEqual([general.id]);
    expect((await rt.kv.get(KEYS.ws(wsId))).channels.ghost00000).toBeUndefined();
  });
});

describe('someone from a connected workspace whose standing runs out while the host is being moved', () => {
  /** Alice's workspace hosts #design, shared with Globex; dave, of Globex, is in it as an external member. */
  async function hostWithExternal() {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const design = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'design' })).data.channel;
    const code = (await as(alice).post(`/api/ws/${wsId}/channels/${design.id}/connect/invites`, {})).data.code;
    const { conn, secret } = (await as(dave).post('/api/connect/accept', { code, partner: { ref: 'globex0001@globex.puter.work', name: 'Globex' } })).data;
    const join = async (user) => as(user).post('/api/connect/join', { conn, token: await signAttestation(secret, { conn, uuid: user.uuid, kind: 'join' }), profile: { name: user.username } });
    expect((await join(dave)).ok).toBe(true);
    return { wsId, general, design, conn, join };
  }

  it('renews it, so they go on reading the channel, while nobody new enters the host until the move is over', async () => {
    const { wsId, general, design, conn, join } = await hostWithExternal();
    await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    await as(alice).post(`/api/ws/${wsId}/transfer`, { to: bob.uuid });
    expect((await as(bob).post(`/api/ws/${wsId}/transfer/begin`)).ok).toBe(true);
    // Dave's day ran out under the freeze: every route of his asks for a renewal.
    await rt.kv.update(KEYS.ws(wsId), { [`members.${dave.uuid}.exp`]: Date.now() - 1000 });
    expect((await as(dave).get(`/api/ws/${wsId}/conv/${design.id}/messages`)).data.code).toBe('reattest');
    const renewed = await join(dave);
    expect(renewed.ok).toBe(true);
    expect(renewed.data.exp).toBeGreaterThan(Date.now());
    expect((await as(dave).get(`/api/ws/${wsId}/conv/${design.id}/messages`)).ok).toBe(true);
    expect((await as(dave).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    // Renewed, not let in anywhere: the channel counts him once, and he still cannot post while the move runs.
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.channels[design.id].count).toBe(2);
    expect(ws.channels[design.id].connections[conn].count).toBe(1);
    expect((await post(dave, wsId, design.id, 'hello?')).data.code).toBe('transferring');
    // Someone new from Globex is told to wait, and no card is made for them.
    const erin = { uuid: 'u-erin-0000', username: 'erin' };
    const late = await join(erin);
    expect(late.status).toBe(423);
    expect(late.data.code).toBe('transferring');
    expect((await rt.kv.get(KEYS.ws(wsId))).members[erin.uuid]).toBeUndefined();
    // So is a member of the host itself who is not in the channel yet, joining it through Globex's word.
    expect((await join(carol)).status).toBe(423);
    expect((await rt.kv.get(KEYS.member(wsId, carol.uuid))).channels).not.toContain(design.id);
    // A moved copy still turns a renewal away, with the new address.
    await as(bob).post(`/api/ws/${wsId}/transfer/complete`, { to: 'newcopy123@other.puter.work' });
    expect((await join(dave)).data.code).toBe('moved');
    expect((await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).ok).toBe(true);
  });
});

describe('text cut to its limit inside a character written as a surrogate pair', () => {
  it('lets the first half go with the second, in messages, edits and one-line fields alike', async () => {
    expect(cleanText('ab😀', 3)).toBe('ab');
    expect(cleanText('ab 😀', 4)).toBe('ab');
    expect(cleanText('😀', 1)).toBe('');
    expect(cleanText('ab😀', 4)).toBe('ab😀');
    expect(cleanText('ab😀c', 4)).toBe('ab😀');
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(alice, wsId, general.id, 'a'.repeat(LIMITS.messageText - 1) + '😀')).data.message;
    expect(m.text).toHaveLength(LIMITS.messageText - 1);
    expect(m.text.isWellFormed()).toBe(true);
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.find((x) => x.seq === m.seq).text.isWellFormed()).toBe(true);
    const edited = (await as(alice).put(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}`, { text: 'b'.repeat(LIMITS.messageText - 1) + '🎉x' })).data;
    expect(edited.text).toHaveLength(LIMITS.messageText - 1);
    expect(edited.text.isWellFormed()).toBe(true);
    const whole = (await post(alice, wsId, general.id, 'c'.repeat(LIMITS.messageText - 2) + '😀')).data.message;
    expect(whole.text).toHaveLength(LIMITS.messageText);
    expect(whole.text.endsWith('😀')).toBe(true);
    const topic = (await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { topic: 't'.repeat(LIMITS.channelTopic - 1) + '😀' })).data.channel.topic;
    expect(topic).toHaveLength(LIMITS.channelTopic - 1);
    expect(topic.isWellFormed()).toBe(true);
  });
});

describe('a huddle going on when its workspace begins moving to another server', () => {
  it('keeps its seats and takes newcomers while the move runs; starting one, and any seat on a moved copy, still waits', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const other = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'other' })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${other.id}/join`);
    const seat = (u, conv, extra = {}) => as(u).post(`/api/ws/${wsId}/conv/${conv}/huddle`, { invite: `INV-${u.username.toUpperCase()}1`, sid: `s-${u.username}`, join: true, ...extra });
    expect((await seat(alice, general.id)).data.started).toBe(true);
    expect((await seat(bob, general.id)).ok).toBe(true);
    await as(alice).post(`/api/ws/${wsId}/members/${carol.uuid}/role`, { role: 'admin' });
    await as(alice).post(`/api/ws/${wsId}/transfer`, { to: carol.uuid });
    expect((await as(carol).post(`/api/ws/${wsId}/transfer/begin`)).ok).toBe(true);
    // A heartbeat keeps the seat, and the roster comes back whole.
    const beat = await seat(alice, general.id, { join: false });
    expect(beat.ok).toBe(true);
    expect(Object.keys(beat.data.huddle.m).sort()).toEqual([alice.uuid, bob.uuid].sort());
    // A newcomer takes a seat in the call that is going on; no line is written for it.
    const before = (await rt.kv.get(KEYS.activity(wsId))).c[general.id].s;
    const joined = await seat(carol, general.id);
    expect(joined.ok).toBe(true);
    expect(joined.data.started).toBe(false);
    expect(Object.keys(joined.data.huddle.m)).toHaveLength(3);
    expect((await rt.kv.get(KEYS.activity(wsId))).c[general.id].s).toBe(before);
    // Starting a huddle elsewhere waits for the move, and writes nothing.
    const started = await seat(bob, other.id);
    expect(started.status).toBe(423);
    expect(started.data.code).toBe('transferring');
    expect((await rt.kv.get(KEYS.activity(wsId))).h?.[other.id]).toBeUndefined();
    // Leaving is unchanged: the last one out ends it, with its line.
    expect((await as(carol).del(`/api/ws/${wsId}/conv/${general.id}/huddle?sid=s-carol`)).data.ended).toBe(false);
    // A copy that has moved takes no seat, heartbeat or not.
    expect((await as(carol).post(`/api/ws/${wsId}/transfer/complete`, { to: 'newcopy123@other.puter.work' })).ok).toBe(true);
    const gone = await seat(alice, general.id, { join: false });
    expect(gone.status).toBe(423);
    expect(gone.data.code).toBe('moved');
  });
});

describe('completing a move with an address that names this very copy', () => {
  it('is refused before anything is written, while the same id on another server, as a move keeps it, completes', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    await as(alice).post(`/api/ws/${wsId}/members/${carol.uuid}/role`, { role: 'admin' });
    await as(alice).post(`/api/ws/${wsId}/transfer`, { to: carol.uuid });
    // This worker answers at teamchat-api.test; its puter.work spelling names it too.
    for (const to of [`${wsId}@teamchat-api.test`, `${wsId}@teamchat-api.test.puter.work`]) {
      const res = await as(carol).post(`/api/ws/${wsId}/transfer/complete`, { to });
      expect(res.status).toBe(400);
      expect(res.data.code).toBe('invalid');
      expect(res.data.message).toMatch(/itself/);
    }
    expect((await as(alice).post(`/api/ws/${wsId}/transfer/complete`, { to: `${wsId}@teamchat-api.test` })).status).toBe(400);
    const doc = await rt.kv.get(KEYS.ws(wsId));
    expect(doc.movedTo).toBeUndefined();
    expect(doc.transferTo).toBe(carol.uuid);
    expect((await post(alice, wsId, general.id, 'still here')).ok).toBe(true);
    // The import keeps the id where it is free on the new server: the same id there is where the workspace went.
    const done = await as(carol).post(`/api/ws/${wsId}/transfer/complete`, { to: `${wsId}@teamchat-new` });
    expect(done.data).toMatchObject({ ok: true, movedTo: `${wsId}@teamchat-new` });
    expect((await rt.kv.get(KEYS.ws(wsId))).movedTo).toBe(`${wsId}@teamchat-new`);
    // Another workspace, another id on this very server: a move too.
    const { wsId: ws2 } = await workspaceWith(alice, [bob, carol], 'Beta');
    await as(alice).post(`/api/ws/${ws2}/members/${carol.uuid}/role`, { role: 'admin' });
    await as(alice).post(`/api/ws/${ws2}/transfer`, { to: carol.uuid });
    expect((await as(carol).post(`/api/ws/${ws2}/transfer/complete`, { to: 'newcopy123@teamchat-api.test' })).data).toMatchObject({ ok: true, movedTo: 'newcopy123@teamchat-api.test' });
  });
});
