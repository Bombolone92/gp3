/**
 * Message and reading routes: what the twenty-seventh review pass found.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, mergeBlock, threadConvId } from '../src/shared/blocks.js';

const { alice, bob, carol } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

const until = async (ok, ms = 2000) => {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
  expect(ok()).toBe(true);
};

/**
 * The last person taking a reaction back used to remove the reaction's
 * whole entry from the message, not only their own name under it. Read
 * before the write, as every request reads the block, someone else's same
 * reaction landing between the two went with the entry: they were answered
 * that it was on, their tab drew it, and the next re-read of the window
 * took it away. Every reader skips an entry with nobody under it, so a
 * removal takes its own name alone and leaves the rest to whoever is there.
 */
describe('taking a reaction back while someone else puts the same one on', () => {
  it('keeps the other person\'s reaction', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const g = general.id;
    const seq = (await as(carol).post(`/api/ws/${wsId}/conv/${g}/messages`, { text: 'hello' })).data.message.seq;
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${g}/messages/${seq}/reactions`, { reaction: 'thumbs-up', on: true })).ok).toBe(true);
    const blockKey = KEYS.block(g, 0);
    // Both requests read the block before either writes; alice's removal
    // then waits for bob's write to land.
    const get = rt.kv.get;
    const remove = rt.kv.remove;
    const incr = rt.kv.incr;
    let reads = 0;
    let bobLanded = false;
    let releaseReads;
    const bothRead = new Promise((r) => { releaseReads = r; });
    rt.kv.get = async (k) => {
      const v = await get(k);
      if (k === blockKey && ++reads === 2) releaseReads();
      if (k === blockKey) await bothRead;
      return v;
    };
    rt.kv.incr = async (k, by) => {
      const v = await incr(k, by);
      if (k === blockKey) bobLanded = true;
      return v;
    };
    rt.kv.remove = async (k, ...paths) => {
      if (k === blockKey) await until(() => bobLanded);
      return remove(k, ...paths);
    };
    try {
      const [off, on] = await Promise.all([
        as(alice).post(`/api/ws/${wsId}/conv/${g}/messages/${seq}/reactions`, { reaction: 'thumbs-up', on: false }),
        as(bob).post(`/api/ws/${wsId}/conv/${g}/messages/${seq}/reactions`, { reaction: 'thumbs-up', on: true }),
      ]);
      expect(off.data).toEqual({ ok: true, on: false });
      expect(on.data).toEqual({ ok: true, on: true });
    } finally {
      rt.kv.get = get;
      rt.kv.remove = remove;
      rt.kv.incr = incr;
    }
    const m = mergeBlock(await rt.kv.get(blockKey)).find((x) => x.seq === seq);
    expect(Object.keys(m.reactions['thumbs-up'] || {})).toEqual([bob.uuid]);
    // And the page shows it to everyone.
    const page = await as(carol).get(`/api/ws/${wsId}/conv/${g}/messages`);
    expect(page.data.messages.find((x) => x.seq === seq).reactions['thumbs-up']).toEqual({ [bob.uuid]: 1 });
  });

  it('shows a reaction everyone took back to nobody, and the record does not grow by every kind ever put on', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const g = general.id;
    const seq = (await as(alice).post(`/api/ws/${wsId}/conv/${g}/messages`, { text: 'hello' })).data.message.seq;
    const path = `/api/ws/${wsId}/conv/${g}/messages/${seq}/reactions`;
    const shown = async () => (await as(alice).get(`/api/ws/${wsId}/conv/${g}/messages`)).data.messages.find((x) => x.seq === seq).reactions;
    const record = async () => (await rt.kv.get(KEYS.block(g, 0))).x[`s${seq}`].r;
    expect((await as(bob).post(path, { reaction: 'heart', on: true })).data.on).toBe(true);
    expect((await as(bob).post(path, { reaction: 'heart', on: false })).data.on).toBe(false);
    // Off the page, on the record with nobody under it.
    expect(await shown()).toEqual({});
    expect(await record()).toEqual({ heart: {} });
    // Put on again, it is the same entry.
    expect((await as(bob).post(path, { reaction: 'heart', on: true })).data.on).toBe(true);
    expect(await shown()).toEqual({ heart: { [bob.uuid]: 1 } });
    expect((await as(bob).post(path, { reaction: 'heart', on: false })).data.on).toBe(false);
    // Twenty-three more kinds put on and taken back leave twenty-four empty
    // entries, as many kinds as a message may show; the next kind put on
    // takes the empty ones off, but for its own.
    const kinds = ['tada', 'wave', 'eyes', 'fire', 'rocket', 'clap', 'pray', 'joy', 'sob', 'thinking', '100', 'ok_hand', 'raised_hands', 'sparkles', 'star', 'zap', 'bug', 'coffee', 'pizza', 'cake', 'sunny', 'rainbow', 'muscle'];
    for (const k of kinds) {
      expect((await as(bob).post(path, { reaction: k, on: true })).data.on).toBe(true);
      expect((await as(bob).post(path, { reaction: k, on: false })).data.on).toBe(false);
    }
    expect(Object.keys(await record())).toHaveLength(24);
    expect(await shown()).toEqual({});
    expect((await as(alice).post(path, { reaction: 'zap', on: true })).data.on).toBe(true);
    expect(await record()).toEqual({ zap: { [alice.uuid]: 1 } });
    expect((await as(bob).post(path, { reaction: 'thumbs-up', on: true })).data.on).toBe(true);
    expect(await record()).toEqual({ zap: { [alice.uuid]: 1 }, 'thumbs-up': { [bob.uuid]: 1 } });
    expect(await shown()).toEqual({ zap: { [alice.uuid]: 1 }, 'thumbs-up': { [bob.uuid]: 1 } });
    // An emptied kind is a new kind again for the cap on kinds.
    for (const k of kinds.filter((x) => x !== 'zap').slice(0, 22)) expect((await as(alice).post(path, { reaction: k, on: true })).data.on).toBe(true);
    expect((await as(bob).post(path, { reaction: 'heart', on: true })).data.code).toBe('limit');
    expect((await as(bob).post(path, { reaction: 'zap', on: true })).data.on).toBe(true);
  });
});

/**
 * Removing a saved message, or marking one done, rewrites the member's list
 * whole from a read made a moment before; a save of another message landing
 * in between (another tab, another device) went off the list with that
 * write, answered as saved all the same, and the Later view never showed
 * it. The save reads the list back once, as a pin does (see POST /pins),
 * and puts its entry back where a rewrite took it off.
 */
describe('saving a message while another saved message is removed', () => {
  it('keeps the save on the list', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const g = general.id;
    const m1 = (await as(alice).post(`/api/ws/${wsId}/conv/${g}/messages`, { text: 'one' })).data.message.seq;
    const m2 = (await as(alice).post(`/api/ws/${wsId}/conv/${g}/messages`, { text: 'two' })).data.message.seq;
    expect((await as(bob).post(`/api/ws/${wsId}/saved`, { conv: g, seq: m1 })).ok).toBe(true);
    const key = KEYS.saved(wsId, bob.uuid);
    // Both requests read the list before either writes; the removal's
    // rewrite lands after the save's append, and the save's read-back after
    // the rewrite.
    const get = rt.kv.get;
    const set = rt.kv.set;
    const add = rt.kv.add;
    let reads = 0;
    let added = false;
    let rewritten = false;
    let release;
    const bothRead = new Promise((r) => { release = r; });
    rt.kv.get = async (k) => {
      if (k === key && reads >= 2) await until(() => rewritten);
      const v = await get(k);
      if (k === key && ++reads === 2) release();
      if (k === key && reads <= 2) await bothRead;
      return v;
    };
    rt.kv.add = async (k, v) => { const out = await add(k, v); if (k === key) added = true; return out; };
    rt.kv.set = async (k, v) => {
      if (k === key) await until(() => added);
      const out = await set(k, v);
      if (k === key) rewritten = true;
      return out;
    };
    try {
      const [removed, saved] = await Promise.all([
        as(bob).post(`/api/ws/${wsId}/saved`, { conv: g, seq: m1, remove: true }),
        as(bob).post(`/api/ws/${wsId}/saved`, { conv: g, seq: m2 }),
      ]);
      expect(removed.data).toEqual({ ok: true, saved: false });
      expect(saved.data).toEqual({ ok: true, saved: true });
    } finally {
      rt.kv.get = get;
      rt.kv.set = set;
      rt.kv.add = add;
    }
    expect((await rt.kv.get(key)).items.map((e) => e.s)).toEqual([m2]);
    expect((await as(bob).get(`/api/ws/${wsId}/saved`)).data.items.map((e) => e.s)).toEqual([m2]);
  });
});

/**
 * Writes the poll makes later, into a conversation that is gone by then.
 * Deleting a channel takes its huddle roster and its queue entries with it,
 * but a heartbeat, or a scheduling, in flight during the delete lands after
 * it: the poll then found a roster with nobody live in a channel that was
 * no longer there and wrote "Huddle ended" into it, minting a block and an
 * activity entry for a deleted channel; and it delivered the queued message
 * into nothing and kept it for its author as "Not sent" in a conversation
 * with no name. What lands after the deletion goes the way of the deletion.
 */
describe('a poll finding traces of a channel deleted meanwhile', () => {
  it('tidies a huddle roster left behind without writing into the deleted channel', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${ch}/huddle`, { invite: 'abcdefgh', join: true, sid: 'tab1' })).data.started).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${ch}`)).ok).toBe(true);
    expect(await rt.kv.get(KEYS.block(ch, 0))).toBeNull();
    expect((await rt.kv.get(KEYS.activity(wsId))).c?.[ch]).toBeUndefined();
    // Bob's heartbeat, read before the delete, lands after it: a seat with no start, gone quiet since.
    const stale = Date.now() - 120_000;
    await rt.kv.update(KEYS.activity(wsId), { [`h.${ch}.m.${bob.uuid}`]: { at: stale, j: stale, inv: 'abcdefgh', s: 'tab1' } });
    const poll = await as(alice).get(`/api/ws/${wsId}/sync?since=0`);
    expect(poll.ok).toBe(true);
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.h?.[ch]).toBeUndefined();
    expect(act.he?.[ch]).toBeUndefined();
    expect(act.c?.[ch]).toBeUndefined();
    expect(await rt.kv.get(KEYS.block(ch, 0))).toBeNull();
    expect(await rt.kv.get(KEYS.seq(ch))).toBeNull();
  });

  it('drops a queued message for the deleted channel rather than keeping it as not sent', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`);
    // Beside it, a message due for a thread of a channel still here: the same poll delivers that one as ever.
    const root = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' })).data.message.seq;
    const thread = threadConvId(general.id, root);
    expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: thread, text: 'reply later', dueAt: Date.now() - 30_000 })).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${ch}`)).ok).toBe(true);
    // Bob's scheduling into #ops, checked before the delete, lands after it.
    const dueAt = Date.now() - 1000;
    const entry = { id: 'abcdefghij', kind: 'message', u: bob.uuid, conv: ch, text: 'later', attachments: [], dueAt, createdAt: dueAt - 60_000 };
    await rt.kv.update(KEYS.sched(wsId), { [`m.${entry.id}`]: entry });
    await rt.kv.update(KEYS.activity(wsId), { nd: dueAt });
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect(Object.keys((await rt.kv.get(KEYS.sched(wsId)))?.m || {})).toEqual([]);
    expect((await as(bob).get(`/api/ws/${wsId}/scheduled`)).data.scheduled).toEqual([]);
    expect(await rt.kv.get(KEYS.block(ch, 0))).toBeNull();
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${thread}/messages`)).data.messages.map((m) => m.text)).toEqual(['reply later']);
  });
});
/**
 * A reminder line (the worker's own line in a member's space when a
 * reminder comes due) takes no reaction, pin or edit, as a system line
 * takes none: the app draws none on it and offers none, so one put there
 * by its address was a write nobody could see, and each moved the
 * conversation's stamp, which had every open tab re-read its window.
 */
describe('a reminder line', () => {
  it('takes no reaction, pin or edit, and may still be deleted by its subject', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'remember' })).data.message.seq;
    expect((await as(alice).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: m, dueAt: Date.now() - 1000 })).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    const self = Object.keys((await rt.kv.get(KEYS.member(wsId, alice.uuid))).dms).find((d) => d !== undefined);
    const page = await as(alice).get(`/api/ws/${wsId}/conv/${self}/messages`);
    const rem = page.data.messages.find((x) => x.kind === 'rem');
    expect(rem).toBeTruthy();
    const stamp = (await rt.kv.get(KEYS.activity(wsId))).c[self];
    const react = await as(alice).post(`/api/ws/${wsId}/conv/${self}/messages/${rem.seq}/reactions`, { reaction: 'thumbs-up', on: true });
    expect([react.status, react.data.code]).toEqual([400, 'invalid']);
    const pin = await as(alice).post(`/api/ws/${wsId}/conv/${self}/pins`, { seq: rem.seq });
    expect([pin.status, pin.data.code]).toEqual([400, 'invalid']);
    const edit = await as(alice).put(`/api/ws/${wsId}/conv/${self}/messages/${rem.seq}`, { text: 'changed' });
    expect([edit.status, edit.data.code]).toEqual([403, 'forbidden']);
    // Nothing was written, and no tab is told the conversation changed.
    const block = await rt.kv.get(KEYS.block(self, 0));
    expect(block.x?.[`s${rem.seq}`]).toBeUndefined();
    expect((await rt.kv.get(KEYS.activity(wsId))).c[self]).toEqual(stamp);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${self}/messages/${rem.seq}`)).ok).toBe(true);
  });
});

/**
 * A thread followed or unfollowed by hand leaves a `notify.<thread>.follow`
 * flag on the member's document, and nothing took one off again: the
 * document grew by one key for every thread ever followed by the button,
 * toward the ceiling past which nothing of the member's could be written.
 * Where the Threads list is drawn, the flags of threads not on the list go
 * (the root's own record says the same, and is what the app falls back to);
 * a listed thread's flag, and any thread's level or mute, stay.
 */
describe('follow flags of threads no longer on the Threads list', () => {
  it('are pruned where the list is drawn, and nothing the list or the badge needs goes with them', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const g = general.id;
    const r1 = (await as(alice).post(`/api/ws/${wsId}/conv/${g}/messages`, { text: 'one' })).data.message.seq;
    const r2 = (await as(alice).post(`/api/ws/${wsId}/conv/${g}/messages`, { text: 'two' })).data.message.seq;
    const r3 = (await as(alice).post(`/api/ws/${wsId}/conv/${g}/messages`, { text: 'three' })).data.message.seq;
    const [t1, t2, t3] = [r1, r2, r3].map((s) => threadConvId(g, s));
    // t1: followed by the button, nobody replied (not on bob's list).
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${t1}/notify`, { follow: true })).ok).toBe(true);
    // t2: bob replied (on his list), then unfollowed.
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${t2}/messages`, { text: 'reply' })).ok).toBe(true);
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${t2}/notify`, { follow: false })).ok).toBe(true);
    // t3: a level set on the thread itself, nobody replied.
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${t3}/notify`, { level: 'nothing', follow: true })).ok).toBe(true);
    const before = (await rt.kv.get(KEYS.member(wsId, bob.uuid))).notify;
    expect(Object.keys(before).sort()).toEqual([t1, t2, t3].sort());
    const threads = await as(bob).get(`/api/ws/${wsId}/threads`);
    expect(threads.ok).toBe(true);
    const after = (await rt.kv.get(KEYS.member(wsId, bob.uuid))).notify;
    expect(Object.keys(after).sort()).toEqual([t2, t3].sort());
    expect(after[t2]).toEqual({ follow: false });
    expect(after[t3]).toEqual({ level: 'nothing', follow: true });
    // The root's record still says bob follows t1: a reply counts for him.
    expect((await as(carol).post(`/api/ws/${wsId}/conv/${t1}/messages`, { text: 'to bob' })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).threads[t1]).toBe(1);
    // And t1 is on his list now, flag or no flag.
    expect((await as(bob).get(`/api/ws/${wsId}/threads`)).data.threads.map((t) => t.id)).toContain(t1);
  });
});
/**
 * A thread's root fetched on its own (the panel asks for the one number
 * when its window does not hold it): the answer is the message wherever
 * its block stands, closed early or not, and whatever run of unused
 * numbers the conversation's entry notes; a root deleted with replies
 * standing comes as its tombstone, and one deleted with none comes as
 * nothing, which the panel reads as "Message not found".
 */
describe('a thread root fetched alone', () => {
  it('is answered from a block closed early, and a deleted one as a tombstone or nothing', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const g = general.id;
    const root = (await as(alice).post(`/api/ws/${wsId}/conv/${g}/messages`, { text: 'root' })).data.message.seq;
    const lone = (await as(alice).post(`/api/ws/${wsId}/conv/${g}/messages`, { text: 'lone' })).data.message.seq;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${threadConvId(g, root)}/messages`, { text: 'reply' })).ok).toBe(true);
    // The block closed early behind them (see rollBlock): the counter at the
    // block's end, the run noted, and the next message in the next block.
    await rt.kv.update(KEYS.block(g, 0), { full: 1 });
    await rt.kv.set(KEYS.seq(g), 50);
    await rt.kv.update(KEYS.activity(wsId), { [`c.${g}.k`]: [lone + 1, 50] });
    const next = await as(alice).post(`/api/ws/${wsId}/conv/${g}/messages`, { text: 'next block' });
    expect(next.data.message.seq).toBe(51);
    const one = async (seq) => (await as(bob).get(`/api/ws/${wsId}/conv/${g}/messages?from=${seq}&to=${seq}`)).data;
    expect((await one(root)).messages.map((m) => [m.seq, m.text, m.replyCount])).toEqual([[root, 'root', 1]]);
    expect((await one(lone)).messages.map((m) => m.text)).toEqual(['lone']);
    expect((await one(51)).messages.map((m) => m.text)).toEqual(['next block']);
    // A number the run covers stands for nothing.
    expect((await one(lone + 1))).toEqual({ seq: 51, messages: [], hasMore: false });
    // Deleted: the root with a reply keeps a tombstone; the lone one is gone.
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${g}/messages/${root}`)).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${g}/messages/${lone}`)).ok).toBe(true);
    const tomb = (await one(root)).messages;
    expect(tomb.map((m) => [m.seq, m.deleted, m.text, m.replyCount])).toEqual([[root, true, '', 1]]);
    expect((await one(lone)).messages).toEqual([]);
  });
});
