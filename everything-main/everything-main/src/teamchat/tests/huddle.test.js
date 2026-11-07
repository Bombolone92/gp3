/**
 * Huddles: the worker's roster (start, join, heartbeat, leave, pruning by
 * time, who may see and join one) and the shared helpers the client dials by.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import {
  HUDDLE_TTL_MS, HUDDLE_MAX, liveHuddle, liveHuddles, stalePaths, shouldDial, huddleLine, durationText, INVITE_RE,
} from '../src/shared/huddle.js';

const { alice, bob, carol, dave } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

const huddle = (u, wsId, conv, invite = 'NJ-7F3A9C') => as(u).post(`/api/ws/${wsId}/conv/${conv}/huddle`, { invite });
const leave = (u, wsId, conv) => as(u).del(`/api/ws/${wsId}/conv/${conv}/huddle`);
const sync = (u, wsId) => as(u).get(`/api/ws/${wsId}/sync?since=0`);
const lastMessage = async (u, wsId, conv) => {
  const r = await as(u).get(`/api/ws/${wsId}/conv/${conv}/messages`);
  return r.data.messages[r.data.messages.length - 1];
};

describe('huddle roster (worker)', () => {
  it('starts a huddle with the caller in it, says so in the conversation, and lists it to everyone', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const before = await sync(bob, wsId);
    expect(before.data.h).toBeUndefined(); // nothing in progress, nothing sent

    const r = await huddle(alice, wsId, general.id, 'NJ-AAA111');
    expect(r.ok).toBe(true);
    expect(r.data.started).toBe(true);
    expect(r.data.huddle.by).toBe(alice.uuid);
    expect(r.data.huddle.m[alice.uuid]).toMatchObject({ inv: 'NJ-AAA111' });
    expect(r.data.huddle.m[alice.uuid].j).toBe(r.data.huddle.m[alice.uuid].at);

    const line = await lastMessage(bob, wsId, general.id);
    expect(line).toMatchObject({ kind: 'sys', user: alice.uuid, text: 'alice started a huddle' });

    const seen = await sync(bob, wsId);
    expect(seen.data.h[general.id].by).toBe(alice.uuid);
    expect(Object.keys(seen.data.h[general.id].m)).toEqual([alice.uuid]);
    // The bootstrap carries it too, pruned the same way.
    const bootstrap = await as(bob).get(`/api/ws/${wsId}`);
    expect(Object.keys(bootstrap.data.activity.h[general.id].m)).toEqual([alice.uuid]);
  });

  it('joins the one in progress without starting another, and a heartbeat keeps the join time', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await huddle(alice, wsId, general.id, 'NJ-AAA111');
    const j = await huddle(bob, wsId, general.id, 'NJ-BBB222');
    expect(j.data.started).toBe(false);
    expect(j.data.huddle.by).toBe(alice.uuid);
    // The roster a joiner gets back is what they dial: everyone else's invite.
    expect(j.data.huddle.m[alice.uuid].inv).toBe('NJ-AAA111');
    expect(j.data.huddle.m[bob.uuid].inv).toBe('NJ-BBB222');
    const joined = j.data.huddle.m[bob.uuid].j;

    const again = await huddle(bob, wsId, general.id, 'NJ-BBB333'); // a reconnect: fresh code, same seat
    expect(again.data.started).toBe(false);
    expect(again.data.huddle.m[bob.uuid].j).toBe(joined);
    expect(again.data.huddle.m[bob.uuid].inv).toBe('NJ-BBB333');
    expect(again.data.huddle.m[bob.uuid].at).toBeGreaterThanOrEqual(joined);

    // One "started" line for the whole huddle, not one per person.
    const r = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(r.data.messages.filter((m) => m.kind === 'sys' && /huddle/.test(m.text)).length).toBe(1);
  });

  it('is left one at a time; the last one out ends it with a line saying how long it ran', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await huddle(alice, wsId, general.id);
    await huddle(bob, wsId, general.id, 'NJ-BBB222');
    // Started a while ago, so the line has a duration to name.
    await rt.kv.update(KEYS.activity(wsId), { [`h.${general.id}.at`]: Date.now() - 12 * 60_000 });

    const a = await leave(alice, wsId, general.id);
    expect(a.data).toEqual({ ok: true, ended: false });
    expect(Object.keys((await sync(alice, wsId)).data.h[general.id].m)).toEqual([bob.uuid]);

    const b = await leave(bob, wsId, general.id);
    expect(b.data).toEqual({ ok: true, ended: true });
    expect((await sync(alice, wsId)).data.h).toBeUndefined();
    const line = await lastMessage(alice, wsId, general.id);
    expect(line).toMatchObject({ kind: 'sys', text: 'Huddle ended after 12 min' });
    // Leaving a huddle one is not in is nothing, not an error.
    expect((await leave(bob, wsId, general.id)).data).toEqual({ ok: true, ended: false });
    // Nothing of the entry is left behind.
    expect((await rt.kv.get(KEYS.activity(wsId))).h[general.id]).toBeUndefined();
  });

  it('drops participants not heard from and ends a huddle everyone has gone from, on the poll that notices', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await huddle(alice, wsId, general.id);
    await huddle(bob, wsId, general.id, 'NJ-BBB222');
    // Bob's tab died: his heartbeat is old.
    await rt.kv.update(KEYS.activity(wsId), { [`h.${general.id}.m.${bob.uuid}.at`]: Date.now() - HUDDLE_TTL_MS - 1000 });
    const r = await sync(alice, wsId);
    expect(Object.keys(r.data.h[general.id].m)).toEqual([alice.uuid]);
    // The stale seat is taken out of the document too.
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.h[general.id].m[bob.uuid]).toBeUndefined();
    expect(act.h[general.id].m[alice.uuid]).toBeDefined();

    // Then alice's goes quiet as well: the huddle is over, and the room says so once.
    await rt.kv.update(KEYS.activity(wsId), { [`h.${general.id}.m.${alice.uuid}.at`]: Date.now() - HUDDLE_TTL_MS - 1000 });
    const gone = await sync(bob, wsId);
    expect(gone.data.h).toBeUndefined();
    await sync(alice, wsId); // a second poll finds nothing to end
    const msgs = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages;
    expect(msgs.filter((m) => m.kind === 'sys' && /Huddle ended/.test(m.text)).length).toBe(1);
    expect((await rt.kv.get(KEYS.activity(wsId))).h[general.id]).toBeUndefined();
  });

  it('ends a huddle everyone has gone quiet from before a new one starts in its place, with its own ended line', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await huddle(alice, wsId, general.id);
    // Alice's tab died, and nobody polled in the meantime to notice; the huddle began a while ago.
    await rt.kv.update(KEYS.activity(wsId), {
      [`h.${general.id}.at`]: Date.now() - 12 * 60_000,
      [`h.${general.id}.m.${alice.uuid}.at`]: Date.now() - HUDDLE_TTL_MS - 1000,
    });
    const r = await huddle(bob, wsId, general.id, 'NJ-BBB222');
    expect(r.data.started).toBe(true);
    expect(r.data.huddle.by).toBe(bob.uuid);
    expect(Object.keys(r.data.huddle.m)).toEqual([bob.uuid]);
    const msgs = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages;
    const lines = msgs.filter((m) => m.kind === 'sys' && /huddle/i.test(m.text)).map((m) => m.text);
    expect(lines).toEqual(['alice started a huddle', 'Huddle ended after 12 min', 'bob started a huddle']);
    // The old huddle's ending is settled: a poll finds nothing more to end.
    await sync(alice, wsId);
    const after = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages;
    expect(after.filter((m) => m.kind === 'sys' && /Huddle ended/.test(m.text)).length).toBe(1);
  });

  it('keeps the seat with the tab that joined last: another tab of the account is refused a heartbeat and ignored on leave', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const post = (invite, sid, join) => as(alice).post(`/api/ws/${wsId}/conv/${general.id}/huddle`, { invite, sid, join });
    const seat = async () => (await sync(bob, wsId)).data.h?.[general.id]?.m?.[alice.uuid];
    expect((await post('NJ-TAB0A0', 'tab-a', true)).ok).toBe(true);
    expect((await post('NJ-TAB0A1', 'tab-a', false)).ok).toBe(true); // its own heartbeat, a fresh code: fine
    // The tab is named on the worker alone; the roster others get says nothing of it.
    expect(await seat()).toEqual({ at: expect.any(Number), j: expect.any(Number), inv: 'NJ-TAB0A1' });
    const joinedAt = (await seat()).j;

    // A second tab joins: the seat is its now, the join time the account's still.
    const b = await post('NJ-TAB0B0', 'tab-b', true);
    expect(b.ok).toBe(true);
    expect(b.data.started).toBe(false);
    expect(b.data.huddle.m[alice.uuid]).toMatchObject({ inv: 'NJ-TAB0B0', j: joinedAt });
    // The first tab's heartbeat is refused and moves nothing.
    const beat = await post('NJ-TAB0A1', 'tab-a', false);
    expect(beat.status).toBe(409);
    expect(beat.data.code).toBe('replaced');
    expect((await seat()).inv).toBe('NJ-TAB0B0');
    // Nor does the first tab's leave give up the second's seat.
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/huddle?sid=tab-a`)).data).toEqual({ ok: true, ended: false });
    expect((await seat()).inv).toBe('NJ-TAB0B0');
    // The second tab's own heartbeat and leave stand.
    expect((await post('NJ-TAB0B1', 'tab-b', false)).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/huddle?sid=tab-b`)).data).toEqual({ ok: true, ended: true });
    expect((await sync(bob, wsId)).data.h).toBeUndefined();

    // A client that names no tab (an older one) is taken at its word both ways.
    expect((await post('NJ-OLD000')).ok).toBe(true);
    expect((await post('NJ-NEW000', 'tab-c', false)).ok).toBe(true); // a seat that named no tab refuses nobody
    expect((await post('NJ-OLD001')).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/huddle`)).data).toEqual({ ok: true, ended: true });
    // A session id is a short token, or it is ignored.
    expect((await post('NJ-BAD000', 'has space', true)).ok).toBe(true);
    expect((await post('NJ-BAD001', 'tab-d', false)).ok).toBe(true);
  });

  it('writes one ended line when two polls notice the same ending, the second claiming after the first tidied', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await huddle(alice, wsId, general.id);
    await rt.kv.update(KEYS.activity(wsId), { [`h.${general.id}.m.${alice.uuid}.at`]: Date.now() - HUDDLE_TTL_MS - 1000 });
    // Both polls read the roster with alice gone quiet; the second one's
    // claim lands only after the first has claimed, removed the entry, and
    // posted. A claim kept on the entry would be recreated then and won again.
    const kv = rt.kv;
    const incr = kv.incr.bind(kv);
    let claims = 0;
    kv.incr = async (k, amount) => {
      if (amount && typeof amount === 'object' && Object.keys(amount).some((path) => /^he?\./.test(path)) && ++claims === 2) await new Promise((r) => setTimeout(r, 20));
      return incr(k, amount);
    };
    try {
      await Promise.all([sync(alice, wsId), sync(bob, wsId)]);
    } finally {
      kv.incr = incr;
    }
    const msgs = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages;
    expect(msgs.filter((m) => m.kind === 'sys' && /Huddle ended/.test(m.text)).length).toBe(1);
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.h[general.id]).toBeUndefined();
    // The claim stays behind, so a later poll cannot start it over; the next huddle's ending tidies it.
    expect(Object.keys(act.he[general.id]).length).toBe(1);
    await huddle(bob, wsId, general.id, 'NJ-BBB222');
    await rt.kv.update(KEYS.activity(wsId), { [`h.${general.id}.m.${bob.uuid}.at`]: Date.now() - HUDDLE_TTL_MS - 1000 });
    await sync(alice, wsId);
    const after = await rt.kv.get(KEYS.activity(wsId));
    expect(Object.keys(after.he[general.id]).length).toBe(1);
    expect(Object.keys(after.he[general.id])[0]).not.toBe(Object.keys(act.he[general.id])[0]);
  });

  it('starts fresh over a stale entry instead of resurrecting its ghosts', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await huddle(bob, wsId, general.id, 'NJ-BBB222');
    await rt.kv.update(KEYS.activity(wsId), {
      [`h.${general.id}.m.${bob.uuid}.at`]: Date.now() - HUDDLE_TTL_MS - 1000,
      [`h.${general.id}.at`]: Date.now() - 3600_000,
    });
    const r = await huddle(alice, wsId, general.id);
    expect(r.data.started).toBe(true);
    expect(r.data.huddle.by).toBe(alice.uuid);
    expect(Object.keys(r.data.huddle.m)).toEqual([alice.uuid]);
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.h[general.id].m[bob.uuid]).toBeUndefined();
    expect(act.h[general.id].at).toBe(r.data.huddle.at);
  });

  it('refuses what cannot carry a huddle: threads, archived channels, channels merely previewed, and bad invites', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const sent = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' });
    const thread = `${general.id}_t${sent.data.message.seq}`;
    expect((await huddle(alice, wsId, thread)).status).toBe(400);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    const previewing = await huddle(bob, wsId, ops);
    expect(previewing.status).toBe(403);
    expect(previewing.data.code).toBe('not_joined');
    expect((await huddle(carol, wsId, general.id)).status).toBe(403); // not a member at all
    await as(alice).put(`/api/ws/${wsId}/channels/${ops}`, { archived: true });
    expect((await huddle(alice, wsId, ops)).data.code).toBe('archived');
    for (const bad of ['', 'x', 'has space', 'a'.repeat(70), 42]) {
      const r = await huddle(alice, wsId, general.id, bad);
      expect(r.status).toBe(400);
    }
    expect((await huddle(alice, wsId, general.id, 'friday-standup')).ok).toBe(true); // a room name is fine too
  });

  it('holds a bounded number of people', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = {};
    for (let i = 0; i < HUDDLE_MAX; i++) m[`u-full-${i}`] = { at: Date.now(), j: Date.now(), inv: 'NJ-FULL00' };
    await rt.kv.update(KEYS.activity(wsId), { [`h.${general.id}`]: { by: 'u-full-0', at: Date.now(), m } });
    const r = await huddle(bob, wsId, general.id);
    expect(r.status).toBe(409);
    expect(r.data.code).toBe('full');
    // Someone already in it keeps their seat through a heartbeat.
    await rt.kv.update(KEYS.activity(wsId), { [`h.${general.id}.m.${bob.uuid}`]: { at: Date.now(), j: Date.now(), inv: 'NJ-BBB222' } });
    expect((await huddle(bob, wsId, general.id)).ok).toBe(true);
  });

  it('shows a guest only the huddles of their own channels', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    const invite = await as(alice).post(`/api/ws/${wsId}/channels/${ops}/invites`, {});
    await as(carol).post('/api/join', { code: invite.data.code });
    await huddle(alice, wsId, general.id);
    await huddle(alice, wsId, ops, 'NJ-OPS000');
    const guest = await sync(carol, wsId);
    expect(Object.keys(guest.data.h)).toEqual([ops]);
    const bootstrap = await as(carol).get(`/api/ws/${wsId}`);
    expect(Object.keys(bootstrap.data.activity.h)).toEqual([ops]);
    // And may join the one they can see.
    expect((await huddle(carol, wsId, ops, 'NJ-CAR000')).ok).toBe(true);
    expect((await huddle(carol, wsId, general.id, 'NJ-CAR000')).status).toBe(404);
  });

  it('sends a huddle, invite codes and all, only to the people of its conversation, whatever their role', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, dave]);
    const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [dave.uuid] })).data.conv;
    const priv = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    const pub = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    await huddle(alice, wsId, general.id, 'NJ-GEN000');
    await huddle(alice, wsId, dm, 'NJ-DM0000');
    await huddle(alice, wsId, priv, 'NJ-PRIV00');
    await huddle(alice, wsId, pub, 'NJ-PUB000');
    // Bob is a full member, in #general only: the direct message he is not
    // in, the private channel he is not in, and the public channel he has
    // not joined are none of his business, and their invite codes would let
    // him dial in.
    expect(Object.keys((await sync(bob, wsId)).data.h)).toEqual([general.id]);
    expect(Object.keys((await as(bob).get(`/api/ws/${wsId}`)).data.activity.h)).toEqual([general.id]);
    // Dave, in the direct message, sees that one too.
    expect(Object.keys((await sync(dave, wsId)).data.h).sort()).toEqual([general.id, dm].sort());
    // The people of a conversation see every seat in it.
    await huddle(dave, wsId, dm, 'NJ-DAV000');
    expect(Object.keys((await sync(alice, wsId)).data.h[dm].m).sort()).toEqual([alice.uuid, dave.uuid].sort());
    // The filter costs nothing beyond the poll's own reads: the member document every poll reads for what bob may see is the one it uses.
    const { wsId: quiet } = await workspaceWith(alice, [bob]);
    const before = rt.kv._calls.ops;
    await sync(bob, quiet);
    const opsQuiet = rt.kv._calls.ops - before;
    const mid = rt.kv._calls.ops;
    await sync(bob, wsId); // a huddle in progress: no read more
    expect(rt.kv._calls.ops - mid).toBe(opsQuiet);
  });

  it('tells the other people in a direct message, the way a message would', async () => {
    const { wsId } = await workspaceWith(alice, [bob, dave]);
    const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid, dave.uuid] })).data.conv;
    const r = await huddle(alice, wsId, dm);
    expect(r.data.started).toBe(true);
    const inbox = await as(bob).get(`/api/ws/${wsId}/inbox`);
    expect(inbox.data.unread).toBe(1);
    expect(inbox.data.items[0]).toMatchObject({ k: 'huddle', c: dm, by: alice.uuid });
    expect(inbox.data.items[0].message).toMatchObject({ kind: 'sys', text: 'alice started a huddle' });
    // The starter is not told about their own huddle; joining does not tell anyone again.
    expect((await as(alice).get(`/api/ws/${wsId}/inbox`)).data.unread).toBe(0);
    await huddle(dave, wsId, dm, 'NJ-DAV000');
    expect((await as(bob).get(`/api/ws/${wsId}/inbox`)).data.unread).toBe(1);
  });
});

describe('huddle helpers (shared)', () => {
  it('reads a roster with only its live participants', () => {
    const now = 1_000_000;
    const entry = { by: 'a', at: now - 60_000, m: { a: { at: now - 1000, j: now - 60_000, inv: 'A' }, b: { at: now - HUDDLE_TTL_MS, j: 1, inv: 'B' }, c: { at: 'nope' } } };
    const live = liveHuddle(entry, now);
    expect(Object.keys(live.m)).toEqual(['a']);
    expect(live.m.a).toEqual({ at: now - 1000, j: now - 60_000, inv: 'A' });
    expect(liveHuddle({ by: 'a', at: now, m: { b: { at: now - HUDDLE_TTL_MS } } }, now)).toBeNull();
    expect(liveHuddle(null, now)).toBeNull();
    expect(liveHuddle({ m: 'junk' }, now)).toBeNull();
    // A participant from an older shape (no join time) joined when they were last heard from.
    expect(liveHuddle({ m: { a: { at: now } } }, now).m.a.j).toBe(now);
    expect(Object.keys(liveHuddles({ x: entry, y: { m: {} } }, now))).toEqual(['x']);
  });

  it('names what a poll should tidy', () => {
    const now = 1_000_000;
    const h = {
      going: { by: 'a', at: now, m: { a: { at: now }, b: { at: now - HUDDLE_TTL_MS - 1 } } },
      over: { by: 'c', at: now, m: { c: { at: now - HUDDLE_TTL_MS - 1 } } },
      junk: null,
    };
    expect(stalePaths(h, now)).toEqual({ drop: ['h.going.m.b'], ended: ['over', 'junk'] });
    expect(stalePaths(undefined, now)).toEqual({ drop: [], ended: [] });
  });

  it('settles who dials whom by id', () => {
    expect(shouldDial('b', 'a')).toBe(true);
    expect(shouldDial('a', 'b')).toBe(false);
    expect(shouldDial('a', 'a')).toBe(false);
  });

  it('words the banner and the ended line', () => {
    expect(huddleLine([])).toBe('Huddle in progress');
    expect(huddleLine(['Ana'])).toBe('Ana is in a huddle');
    expect(huddleLine(['Ana', 'Ben'])).toBe('Ana and Ben are in a huddle');
    expect(huddleLine(['Ana', 'Ben', 'Cy'])).toBe('Ana, Ben, and Cy are in a huddle');
    expect(huddleLine(['Ana', 'Ben', 'Cy', 'Di'])).toBe('Ana, Ben, and 2 others are in a huddle');
    expect(durationText(20_000)).toBe('less than a minute');
    expect(durationText(12 * 60_000)).toBe('12 min');
    expect(durationText(65 * 60_000)).toBe('1 hr 5 min');
    expect(durationText(120 * 60_000)).toBe('2 hr');
  });

  it('accepts generated invite codes and room names, nothing else', () => {
    for (const ok of ['NJ-7F3A9C', 'friday-standup', 'abc', 'A1_b2']) expect(INVITE_RE.test(ok)).toBe(true);
    for (const bad of ['', 'ab', '-abc', 'has space', 'x'.repeat(65), 'a.b']) expect(INVITE_RE.test(bad)).toBe(false);
  });
});
