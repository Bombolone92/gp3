/**
 * Review pass 10, message plane and realtime: each test here is a hole that
 * was found in the worker's message, scheduling, sync, or preview routes
 * and closed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { BLOCK_SIZE, KEYS, threadConvId } from '../src/shared/blocks.js';

const { alice, bob } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

const post = (u, wsId, conv, text, extra = {}) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text, ...extra });
const messages = (u, wsId, conv, q = '') => as(u).get(`/api/ws/${wsId}/conv/${conv}/messages${q}`);

/** Post `n` messages and delete the ones whose seq is in [from, to]. */
async function historyWithDeletedRun(wsId, conv, n, from, to) {
  for (let i = 0; i < n; i++) await post(alice, wsId, conv, `m${i}`);
  for (let s = from; s <= to; s++) expect((await as(alice).del(`/api/ws/${wsId}/conv/${conv}/messages/${s}`)).ok, `delete ${s}`).toBe(true);
}

describe('reading past a run of deleted messages longer than a page', () => {
  it('paging back over two whole blocks of deleted messages still reaches what lies above them', async () => {
    const { wsId, general } = await workspaceWith(alice);
    // #general opens with one system line; 160 posts bring the counter to 161.
    await historyWithDeletedRun(wsId, general.id, 160, 51, 150);
    // The newest page holds seqs 151..161; the client asks for what is older than its oldest.
    const page = await messages(alice, wsId, general.id, '?before=151');
    expect(page.ok).toBe(true);
    // Blocks 2 (101..150) and 1 (51..100) are wholly deleted: an empty page
    // with more to come is one the client cannot page on from (it keys the
    // next request on the oldest message it holds, which this brought none
    // of), and the history above the run would be out of reach.
    expect(page.data.messages.length).toBeGreaterThan(0);
    expect(page.data.messages.map((m) => m.seq)).toEqual(Array.from({ length: BLOCK_SIZE }, (_, i) => i + 1));
    expect(page.data.hasMore).toBe(false);
  });

  it('the newest page walks back past a wholly deleted head', async () => {
    const { wsId, general } = await workspaceWith(alice);
    // Counter at 150 exactly: block 2 (101..150) and block 1 (51..100) deleted whole.
    await historyWithDeletedRun(wsId, general.id, 149, 51, 150);
    const page = await messages(alice, wsId, general.id);
    expect(page.ok).toBe(true);
    expect(page.data.seq).toBe(150);
    expect(page.data.messages.length).toBeGreaterThan(0);
    expect(page.data.messages.at(-1).seq).toBe(50);
    expect(page.data.hasMore).toBe(false);
  });

  it('reading newer than a message skips a run of deleted messages longer than a page', async () => {
    const { wsId, general } = await workspaceWith(alice);
    // Seqs 2..200 posted; 51..200 deleted whole (three blocks' worth), then one live message at 201.
    await historyWithDeletedRun(wsId, general.id, 199, 51, 200);
    await post(alice, wsId, general.id, 'after the run');
    const page = await messages(alice, wsId, general.id, '?after=50');
    expect(page.ok).toBe(true);
    // An empty page with more to come ends the client's forward walk (it
    // takes "nothing new" for the end), and the counter it takes for what it
    // has reached marks the live message past the run as read and never fetched.
    expect(page.data.messages.map((m) => m.seq)).toEqual([201]);
    expect(page.data.hasMore).toBe(false);
    expect(page.data.seq).toBe(201);
  });

  it('a `before` past the counter reads the newest page, not blocks that do not exist', async () => {
    const { wsId, general } = await workspaceWith(alice);
    for (let i = 0; i < 3; i++) await post(alice, wsId, general.id, `m${i}`);
    const newest = await messages(alice, wsId, general.id);
    for (const q of ['?before=1e999', '?before=Infinity', '?before=999999']) {
      const before = rt.kv._calls.ops;
      const page = await messages(alice, wsId, general.id, q);
      expect(page.ok, q).toBe(true);
      expect(page.data, q).toEqual(newest.data);
      // Workspace, member document, counter, the head block: nothing read for a block that cannot exist.
      expect(rt.kv._calls.ops - before, q).toBeLessThanOrEqual(4);
    }
  });

  it('still bounds what one answer reads: a run past the budget answers empty with more to come', async () => {
    const { wsId, general } = await workspaceWith(alice);
    // Seqs 2..471 posted; 2..460 deleted: nine whole blocks and a bit, past a page and the blocks read on after it.
    await historyWithDeletedRun(wsId, general.id, 470, 2, 460);
    const before = rt.kv._calls.ops;
    const page = await messages(alice, wsId, general.id, '?after=1');
    expect(page.ok).toBe(true);
    expect(page.data.messages).toEqual([]);
    expect(page.data.hasMore).toBe(true);
    expect(page.data.seq).toBe(471);
    // Workspace, member document, counter, and the blocks read: a bounded handful, whatever the run.
    expect(rt.kv._calls.ops - before).toBeLessThanOrEqual(14);
  });
});

describe('scheduling refuses now what the post would refuse at its time', () => {
  const schedule = (u, wsId, conv, text, extra = {}) => as(u).post(`/api/ws/${wsId}/scheduled`, { conv, text, dueAt: Date.now() + 60_000, ...extra });

  it('a broadcast the member may not send in #general is refused to their face, not dropped at its time', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    // #general is the default channel: broadcasts there are for admins.
    expect((await post(bob, wsId, general.id, '@channel now')).data.code).toBe('broadcast_forbidden');
    const refused = await schedule(bob, wsId, general.id, '@channel later');
    expect(refused.status).toBe(403);
    expect(refused.data.code).toBe('broadcast_forbidden');
    // An admin's goes through, as their post would.
    expect((await schedule(alice, wsId, general.id, '@channel later')).status).toBe(200);
    // @everyone belongs to the default channel, scheduled or not.
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'side' })).data.channel;
    const scope = await schedule(alice, wsId, ch.id, '@everyone later');
    expect(scope.status).toBe(400);
    expect(scope.data.code).toBe('broadcast_scope');
    expect((await schedule(bob, wsId, general.id, 'plain later')).status).toBe(200);
    // Nothing refused is in the queue; the delivery would have dropped them quietly.
    const mine = await as(bob).get(`/api/ws/${wsId}/scheduled`);
    expect(mine.data.scheduled.map((e) => e.text)).toEqual(['plain later']);
  });

  it('an edit that writes a broadcast into a scheduled message is checked the same way', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const e = (await schedule(bob, wsId, general.id, 'plain later')).data.scheduled;
    const edited = await as(bob).put(`/api/ws/${wsId}/scheduled/${e.id}`, { text: '@here later' });
    expect(edited.status).toBe(403);
    expect(edited.data.code).toBe('broadcast_forbidden');
    expect((await as(bob).put(`/api/ws/${wsId}/scheduled/${e.id}`, { text: 'still plain' })).status).toBe(200);
  });

  it('a reply scheduled into a thread needs a root that stands', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await schedule(bob, wsId, threadConvId(general.id, 999), 'to nobody')).status).toBe(404);
    const root = (await post(alice, wsId, general.id, 'root')).data.message;
    expect((await schedule(bob, wsId, threadConvId(general.id, root.seq), 'a reply')).status).toBe(200);
    await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${root.seq}`);
    expect((await schedule(bob, wsId, threadConvId(general.id, root.seq), 'to a closed thread')).status).toBe(404);
  });
});

describe('the queue of a transferred workspace is read-only like the rest of it', () => {
  it('editing or deleting a scheduled message on the moved copy answers 423 with the new reference', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const e = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt: Date.now() + 60_000 })).data.scheduled;
    const m = (await post(alice, wsId, general.id, 'remind me')).data.message;
    const r = (await as(bob).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: m.seq, dueAt: Date.now() + 60_000 })).data.reminder;
    await rt.kv.update(KEYS.ws(wsId), { movedTo: 'abcdef1234@teamchat-new' });
    // The queue went with the workspace: an edit or a deletion here would be
    // answered as done and never reach the copy that will deliver it.
    for (const call of [
      () => as(bob).put(`/api/ws/${wsId}/scheduled/${e.id}`, { text: 'changed' }),
      () => as(bob).put(`/api/ws/${wsId}/scheduled/${e.id}`, { dueAt: Date.now() + 120_000 }),
      () => as(bob).put(`/api/ws/${wsId}/scheduled/${e.id}`, { sendNow: true }),
      () => as(bob).del(`/api/ws/${wsId}/scheduled/${e.id}`),
      () => as(bob).put(`/api/ws/${wsId}/scheduled/${r.id}`, { dueAt: Date.now() + 120_000 }),
      () => as(bob).del(`/api/ws/${wsId}/scheduled/${r.id}`),
    ]) {
      const res = await call();
      expect(res.status).toBe(423);
      expect(res.data.code).toBe('moved');
    }
    // Reading what is queued still works, as every read does.
    const mine = await as(bob).get(`/api/ws/${wsId}/scheduled`);
    expect(mine.status).toBe(200);
    expect(mine.data.scheduled.map((x) => x.text)).toEqual(['later']);
    expect(mine.data.reminders.map((x) => x.id)).toEqual([r.id]);
  });
});

describe('a reaction that changes nothing moves no stamp', () => {
  it('repeating a reaction, or taking back one never given, leaves the conversation stamp alone', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(alice, wsId, general.id, 'hi')).data.message;
    const path = `/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/reactions`;
    const stamp = async () => (await rt.kv.get(KEYS.activity(wsId))).c[general.id].x;
    expect((await as(bob).post(path, { reaction: 'tada', on: true })).data.on).toBe(true);
    const after = await stamp();
    expect(after).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 3));
    // Said again from a tab that did not know: the answer is the state, and no tab is sent to re-read.
    expect((await as(bob).post(path, { reaction: 'tada', on: true })).data.on).toBe(true);
    expect(await stamp()).toBe(after);
    expect((await as(bob).post(path, { reaction: 'heart', on: false })).data.on).toBe(false);
    expect(await stamp()).toBe(after);
    // A real change still moves it.
    expect((await as(bob).post(path, { reaction: 'tada', on: false })).data.on).toBe(false);
    expect(await stamp()).toBeGreaterThan(after);
  });
});

describe('first-time saves and pins on a store that refuses add on a missing key', () => {
  it('saves a message for later on a fresh list', async () => {
    rt = await boot({ strictAdd: true });
    const { wsId, general } = await workspaceWith(alice);
    const m = (await post(alice, wsId, general.id, 'keep this')).data.message;
    const saved = await as(alice).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: m.seq });
    expect(saved.status).toBe(200);
    expect(saved.data.saved).toBe(true);
    const list = await as(alice).get(`/api/ws/${wsId}/saved`);
    expect(list.data.items.map((i) => i.s)).toEqual([m.seq]);
    // The second save appends to the list that now exists.
    const m2 = (await post(alice, wsId, general.id, 'and this')).data.message;
    expect((await as(alice).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: m2.seq })).status).toBe(200);
    expect((await as(alice).get(`/api/ws/${wsId}/saved`)).data.items.map((i) => i.s)).toEqual([m2.seq, m.seq]);
  });

  it('pins the first message of a conversation', async () => {
    rt = await boot({ strictAdd: true });
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(bob, wsId, general.id, 'pin me')).data.message;
    const pinned = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/pins`, { seq: m.seq });
    expect(pinned.status).toBe(200);
    const list = await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/pins`);
    expect(list.data.pins.map((p) => p.seq)).toEqual([m.seq]);
    expect(list.data.pins[0].message.text).toBe('pin me');
  });
});
