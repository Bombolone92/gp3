/**
 * Identity, membership, notification and scheduling routes: what the
 * twenty-second review pass found.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';

const { alice, bob } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

describe('the author\'s read cursor when a scheduled message is sent now from the Later view', () => {
  const reads = async (wsId, u) => (await rt.kv.get(KEYS.member(wsId, u.uuid))).reads;

  it('stays where it was when messages the author never saw were posted since, as it does for a delivery at the message\'s time', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    // "alice created #general", "bob joined": bob has read both.
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 2 })).ok).toBe(true);
    const sid = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt: Date.now() + 3600_000 })).data.scheduled.id;
    for (let i = 0; i < 5; i++) expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: `m${i}` })).ok).toBe(true);
    // Bob, in the Later view (not in #general), presses "Send now".
    expect((await as(bob).put(`/api/ws/${wsId}/scheduled/${sid}`, { sendNow: true })).data).toMatchObject({ ok: true, sent: true });
    const list = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages;
    expect(list[list.length - 1]).toMatchObject({ seq: 8, user: bob.uuid, text: 'later' });
    // Bob's cursor still stands at 2: alice's five are unread for him, and so is his own message.
    expect((await reads(wsId, bob))[general.id]).toBe(2);
    // The entry marks the message as one from the queue, so bob's tabs can tell it from a message he sent from another tab.
    expect((await rt.kv.get(KEYS.activity(wsId))).c[general.id]).toMatchObject({ s: 8, u: bob.uuid, q: 8 });
  });

  it('follows the message when nothing was unread for the author, as it would have had they sent it then', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 2 })).ok).toBe(true);
    const sid = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt: Date.now() + 3600_000 })).data.scheduled.id;
    expect((await as(bob).put(`/api/ws/${wsId}/scheduled/${sid}`, { sendNow: true })).data).toMatchObject({ ok: true, sent: true });
    expect((await reads(wsId, bob))[general.id]).toBe(3);
    expect((await rt.kv.get(KEYS.activity(wsId))).c[general.id]).toMatchObject({ s: 3, u: bob.uuid, q: 3 });
  });
});

describe('a queued message delivered with unread messages before it, whose author\'s cursor therefore stays', () => {
  it('writes nothing to the author\'s document rather than a patch of nothing, and the bookkeeping after it still lands', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 2 })).ok).toBe(true);
    // Scheduled into a thread, naming alice: her Activity entry and the
    // root's reply count are written after the author's own cursor would be.
    const root = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' })).data.message.seq;
    const thread = `${general.id}_t${root}`;
    expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: thread, text: 'later @alice', dueAt: Date.now() - 30_000 })).ok).toBe(true);
    // Alice replies in the thread meanwhile: bob's cursor in it stands at nothing, so the delivery leaves it there.
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${thread}/messages`, { text: 'first' })).ok).toBe(true);
    const update = rt.kv.update;
    const empty = [];
    rt.kv.update = async (k, patch) => {
      if (!patch || !Object.keys(patch).length) empty.push(k);
      return update(k, patch);
    };
    try {
      expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    } finally {
      rt.kv.update = update;
    }
    expect(empty).toEqual([]);
    const replies = (await as(alice).get(`/api/ws/${wsId}/conv/${thread}/messages`)).data.messages;
    expect(replies.map((m) => m.text)).toEqual(['first', 'later @alice']);
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).reads[thread]).toBeUndefined();
    // What follows the cursor in the post landed: the root counts both replies, and alice was told of the mention.
    const page = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages;
    expect(page.find((m) => m.seq === root).replyCount).toBe(2);
    const inbox = (await as(alice).get(`/api/ws/${wsId}/inbox`)).data.items;
    expect(inbox.some((e) => e.k === 'mention' && e.c === thread && e.by === bob.uuid)).toBe(true);
  });
});

/**
 * Removals of several paths at once, on a store that takes its paths as
 * separate arguments (puter.js's kv.remove refuses one array in their place
 * before any request goes out, and refuses an empty path map for update, incr
 * and add; the runtime models both under `strictPaths`). Every fan-out below
 * used to hand the store one array, under a catch that swallowed the refusal.
 */
describe('on a store that takes paths as separate arguments', () => {
  const act = async (wsId) => rt.kv.get(KEYS.activity(wsId));

  it('the runtime option refuses what puter.js refuses, and the lenient default is unchanged', async () => {
    rt = await boot({ strictPaths: true });
    await rt.kv.set('k', { a: 1, b: 2, c: 3 });
    await expect(rt.kv.remove('k', ['a'])).rejects.toMatchObject({ code: 'paths_invalid' });
    await expect(rt.kv.remove('k')).rejects.toMatchObject({ code: 'arguments_required' });
    await expect(rt.kv.update('k', {})).rejects.toMatchObject({ code: 'path_map_invalid' });
    await expect(rt.kv.incr('k', {})).rejects.toMatchObject({ code: 'path_map_invalid' });
    await expect(rt.kv.add('k', {})).rejects.toMatchObject({ code: 'path_map_invalid' });
    expect(await rt.kv.remove('k', 'a', 'b')).toEqual({ c: 3 });
    rt = await boot();
    await rt.kv.set('k', { a: 1, b: 2 });
    expect(await rt.kv.remove('k', ['a'])).toEqual({ b: 2 });
  });

  it('a member removed from the workspace takes their heartbeat, status and stamp with them', async () => {
    rt = await boot({ strictPaths: true });
    const { wsId } = await workspaceWith(alice, [bob]);
    expect((await as(bob).get(`/api/ws/${wsId}?hb=1&st=dnd`)).ok).toBe(true);
    expect((await act(wsId)).p[bob.uuid]).toBeGreaterThan(0);
    expect((await act(wsId)).ps[bob.uuid]).toBe('dnd');
    expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    const a = await act(wsId);
    expect(a.p[bob.uuid]).toBeUndefined();
    expect(a.ps?.[bob.uuid]).toBeUndefined();
    expect(a.u?.[bob.uuid]).toBeUndefined();
  });

  it('a huddle everyone has gone quiet in is taken off the activity document as its line is written', async () => {
    rt = await boot({ strictPaths: true });
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/huddle`, { invite: 'NJ-7F3A9C' })).ok).toBe(true);
    expect((await act(wsId)).h[general.id].m[alice.uuid]).toBeTruthy();
    // Alice's tab died ten minutes ago.
    await rt.kv.update(KEYS.activity(wsId), { [`h.${general.id}.m.${alice.uuid}.at`]: Date.now() - 600_000 });
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect((await act(wsId)).h?.[general.id]).toBeUndefined();
    const texts = (await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.map((m) => m.text);
    expect(texts.filter((t) => /^Huddle ended/.test(t))).toHaveLength(1);
    // A later poll finds nothing to end again.
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.filter((m) => /^Huddle ended/.test(m.text))).toHaveLength(1);
  });

  it('a deleted channel takes its activity entry with it', async () => {
    rt = await boot({ strictPaths: true });
    const { wsId } = await workspaceWith(alice, [bob]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${ops}/messages`, { text: 'hi' })).ok).toBe(true);
    // "alice created #ops", then the post.
    expect((await act(wsId)).c[ops].s).toBe(2);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${ops}`)).ok).toBe(true);
    expect((await act(wsId)).c[ops]).toBeUndefined();
  });

  it('a removed member\'s scheduled messages and reminders leave the queue', async () => {
    rt = await boot({ strictPaths: true });
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt: Date.now() + 3600_000 })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: 1, dueAt: Date.now() + 3600_000 })).ok).toBe(true);
    expect(Object.keys((await rt.kv.get(KEYS.sched(wsId))).m)).toHaveLength(2);
    expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    expect(Object.keys((await rt.kv.get(KEYS.sched(wsId))).m)).toHaveLength(0);
    expect((await act(wsId)).nd).toBeUndefined();
  });

  it('a member\'s push devices never exceed the cap when several subscribe at once', async () => {
    rt = await boot({ strictPaths: true });
    const { wsId } = await workspaceWith(alice, [bob]);
    const sub = (n) => as(bob).post(`/api/ws/${wsId}/push`, { subscription: { endpoint: `https://push.example.com/d${n}`, keys: { p256dh: 'a', auth: 'b' } } });
    await Promise.all([1, 2, 3, 4, 5, 6, 7].map(sub));
    expect(Object.keys((await rt.kv.get(KEYS.member(wsId, bob.uuid))).push).length).toBeLessThanOrEqual(5);
  });

  it('the Threads view prunes what a member kept of a channel since deleted', async () => {
    rt = await boot({ strictPaths: true });
    const { wsId } = await workspaceWith(alice, [bob]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ops}/join`)).ok).toBe(true);
    // Joining read him past his own "joined" line; the cursor is kept for the channel.
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).reads[ops]).toBeGreaterThan(0);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${ops}`)).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${wsId}/threads`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).reads[ops]).toBeUndefined();
  });

  it('a nameless channel entry is swept off the workspace by the next bootstrap', async () => {
    rt = await boot({ strictPaths: true });
    const { wsId } = await workspaceWith(alice, [bob]);
    await rt.kv.update(KEYS.ws(wsId), { 'channels.zzzzzzzzzz': { count: 1 } });
    const shown = await as(alice).get(`/api/ws/${wsId}`);
    expect(shown.ok).toBe(true);
    expect(shown.data.workspace.channels.zzzzzzzzzz).toBeUndefined();
    expect((await rt.kv.get(KEYS.ws(wsId))).channels.zzzzzzzzzz).toBeUndefined();
  });
});
