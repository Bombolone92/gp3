/**
 * Review pass 24, the message plane: channels, messages, threads, reactions,
 * pins, saved messages, direct messages, huddles, shared channels, transfer.
 * Each test here is a hole that was found in the worker's routes and closed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { countKv } from './helpers/kvcount.js';
import { KEYS, BLOCK_BYTES, BLOCK_BYTES_HARD, blockIndexOf, lastSeqOfBlock, jsonBytes } from '../src/shared/blocks.js';
import { VALUE_BYTES_MAX } from '../dev/worker-runtime.js';

const { alice, bob, carol } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

/** A block of forty-five long messages past the ceiling growth is refused at, yet under what the store holds, put in place of #general's first block. */
async function fullBlock(wsId, general, extra = {}) {
  const big = { m: [], x: {} };
  for (let s = 1; s <= 45; s++) big.m.push({ s, u: alice.uuid, t: 'x'.repeat(9000), ts: Date.now() - 1000 + s });
  Object.assign(big.x, extra);
  expect(jsonBytes(big)).toBeGreaterThan(BLOCK_BYTES_HARD);
  expect(JSON.stringify(big).length).toBeLessThan(VALUE_BYTES_MAX);
  await rt.kv.set(KEYS.block(general.id, 0), big);
  await rt.kv.set(KEYS.seq(general.id), 45);
  await rt.kv.update(KEYS.activity(wsId), { [`c.${general.id}.s`]: 45 });
  return big;
}

describe('a bot token reacting on a block at its ceiling', () => {
  it('is refused with a word, as a member is, and may still take a reaction of its back', async () => {
    rt = await boot({ strictSize: true });
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const bot = await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Deploy', channels: [general.id], scopes: ['react'] });
    expect(bot.ok).toBe(true);
    const who = `bot_${bot.data.id}`;
    await fullBlock(wsId, general, { s3: { r: { thumbsup: { [who]: 1 } } } });
    const before = jsonBytes(await rt.kv.get(KEYS.block(general.id, 0)));
    // A member's new reaction is refused with a word (see the pass-23 tests); a token's must be too.
    const byMember = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages/3/reactions`, { reaction: 'heart' });
    expect(byMember.status).toBe(400);
    const byBot = await as(null).post(`/bot/${bot.data.token}/channels/${general.id}/messages/3/reactions`, { reaction: 'heart', on: true });
    expect(byBot.status).toBe(400);
    expect(byBot.data.code).toBe('limit');
    expect(byBot.data.message).toMatch(/cannot take more reactions/);
    // Joining a reaction that stands is a new name on the block too.
    const join = await as(null).post(`/bot/${bot.data.token}/channels/${general.id}/messages/4/reactions`, { reaction: 'thumbsup', on: true });
    expect(join.status).toBe(400);
    expect(jsonBytes(await rt.kv.get(KEYS.block(general.id, 0)))).toBe(before);
    // What takes bytes off still goes: the token's own reaction taken back
    // (its name; the entry stays with nobody under it, see mergeBlock).
    const off = await as(null).post(`/bot/${bot.data.token}/channels/${general.id}/messages/3/reactions`, { reaction: 'thumbsup', on: false });
    expect(off.status).toBe(200);
    expect(off.data.on).toBe(false);
    expect(Object.keys((await rt.kv.get(KEYS.block(general.id, 0))).x.s3.r.thumbsup || {})).toEqual([]);
    // And on a block with room, a token reacts as it always did: the first
    // post still fits the full block and closes it behind itself (see
    // rollBlock), the second opens the next block.
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'closes the block' })).ok).toBe(true);
    const room = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'next block' });
    expect(room.ok).toBe(true);
    expect(blockIndexOf(room.data.message.seq)).toBe(1);
    const fine = await as(null).post(`/bot/${bot.data.token}/channels/${general.id}/messages/${room.data.message.seq}/reactions`, { reaction: 'heart', on: true });
    expect(fine.status).toBe(200);
    expect(fine.data.on).toBe(true);
  });
});

describe('a huddle started in a direct message', () => {
  const dmWith = async (wsId, other) => (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [other.uuid] })).data.conv;
  const lastLine = async (wsId, conv) => (await as(bob).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.at(-1);

  it('tells the others of the line that says so, by the number the write handed back, with no reading of the counter', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const dm = await dmWith(wsId, bob);
    const c = countKv(rt);
    const started = await as(alice).post(`/api/ws/${wsId}/conv/${dm}/huddle`, { invite: 'NJ-7F3A9C', join: true });
    expect(started.data.started).toBe(true);
    expect(c.keys.get.filter((k) => k === KEYS.seq(dm))).toEqual([]);
    c.restore();
    const line = await lastLine(wsId, dm);
    expect(line.text).toMatch(/started a huddle/);
    const entry = (await rt.kv.get(KEYS.inbox(wsId, bob.uuid))).items.find((e) => e.k === 'huddle');
    expect(entry.s).toBe(line.seq);
  });

  it('whose line closes the conversation\'s block still names the line, so the Activity row opens onto it rather than onto nothing', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const dm = await dmWith(wsId, bob);
    // The first block a few bytes short of its budget: the huddle's line
    // takes it past, the block is closed behind the line (see rollBlock) and
    // the counter moves to the block's last number, which nothing stands under.
    const block = { m: [], x: {} };
    for (let s = 1; s <= 10; s++) block.m.push({ s, u: alice.uuid, t: 'x'.repeat(4000), ts: Date.now() - 1000 + s });
    block.m[9].t += 'x'.repeat(BLOCK_BYTES - 40 - jsonBytes(block));
    expect(jsonBytes(block)).toBeLessThan(BLOCK_BYTES);
    await rt.kv.set(KEYS.block(dm, 0), block);
    await rt.kv.set(KEYS.seq(dm), 10);
    await rt.kv.update(KEYS.activity(wsId), { [`c.${dm}.s`]: 10 });
    const started = await as(alice).post(`/api/ws/${wsId}/conv/${dm}/huddle`, { invite: 'NJ-7F3A9C', join: true });
    expect(started.data.started).toBe(true);
    expect(Number(await rt.kv.get(KEYS.seq(dm)))).toBe(lastSeqOfBlock(0));
    const line = await lastLine(wsId, dm);
    expect(line.text).toMatch(/started a huddle/);
    expect(line.seq).toBe(11);
    const entry = (await rt.kv.get(KEYS.inbox(wsId, bob.uuid))).items.find((e) => e.k === 'huddle');
    expect(entry.s).toBe(line.seq);
    // Named by the counter, as it used to be, the entry opened onto a number
    // nothing stands under, and the Activity view pruned it as gone.
    const row = (await as(bob).get(`/api/ws/${wsId}/inbox`)).data.items.find((e) => e.k === 'huddle');
    expect(row).toBeTruthy();
    expect(row.message?.text).toMatch(/started a huddle/);
  });
});

describe('a block from before that already holds what the store takes', () => {
  it('is closed with a run that begins at the number the refused message was given, so nobody counts that number as unread', async () => {
    rt = await boot({ strictSize: true });
    const { wsId, general } = await workspaceWith(alice, [bob]);
    // Forty-five messages just under the store's ceiling (see the pass-23
    // tests): the next message takes number 46, does not fit, and is given
    // the next block's first number instead.
    const big = { m: [], x: {} };
    for (let s = 1; s <= 45; s++) big.m.push({ s, u: alice.uuid, t: 'x'.repeat(9000), ts: Date.now() - 1000 + s });
    expect(JSON.stringify(big).length).toBeLessThan(VALUE_BYTES_MAX);
    await rt.kv.set(KEYS.block(general.id, 0), big);
    await rt.kv.set(KEYS.seq(general.id), 45);
    await rt.kv.update(KEYS.activity(wsId), { [`c.${general.id}.s`]: 45 });
    await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 45 });
    const res = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'y'.repeat(4000) });
    expect(res.status).toBe(200);
    expect(res.data.message.seq).toBe(lastSeqOfBlock(0) + 1);
    expect((await rt.kv.get(KEYS.block(general.id, 0))).m.map((m) => m.s)).not.toContain(46);
    // The run noted for every reader's unread count runs from 46, the number
    // nothing stands under, to the block's last: noted from 47, bob's list
    // counted 46 as a message he had not read, beside the one he had not.
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.c[general.id].k).toEqual([46, lastSeqOfBlock(0)]);
    expect(act.c[general.id].s).toBe(lastSeqOfBlock(0) + 1);
  });
});

describe('a file carried by a posted message and by a message waiting in the queue', () => {
  const upload = async (u, wsId, name) => {
    const fd = new FormData();
    fd.append('file', new Blob([`bytes of ${name}`], { type: 'text/plain' }), name);
    return (await as(u).post(`/api/ws/${wsId}/files`, fd)).data.id;
  };
  const inAnHour = () => Math.floor(Date.now() / 60_000) * 60_000 + 22_000 + 3600_000;
  const bytes = (wsId, id) => rt.fs.read(`teamchat-files/${wsId}/${id}`);

  it('stays when the posted message is deleted, goes out with the waiting one, and goes with the last message carrying it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const id = await upload(alice, wsId, 'plan.txt');
    const posted = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'now', attachments: [{ id }] })).data.message;
    const sched = await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', attachments: [{ id }], dueAt: inAnHour() });
    expect(sched.ok).toBe(true);
    expect(sched.data.scheduled.attachments).toEqual([{ id }]);
    expect((await rt.kv.get(KEYS.file(id))).refs).toBe(1);
    // The posted message goes; nothing posted holds the file, but the
    // waiting message does. Judged by the count alone, the bytes went here,
    // and the message went out at its time without its file.
    const c = countKv(rt);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${posted.seq}`)).ok).toBe(true);
    expect(c.keys.get.filter((k) => k === KEYS.sched(wsId))).toHaveLength(1);
    c.restore();
    const meta = await rt.kv.get(KEYS.file(id));
    expect(meta?.refs).toBe(0);
    expect((await bytes(wsId, id)).size).toBeGreaterThan(0);
    // The file is still the author's to read and to send.
    expect((await as(alice).get(`/api/ws/${wsId}/files/${id}`)).status).toBe(200);
    const sent = await as(alice).put(`/api/ws/${wsId}/scheduled/${sched.data.scheduled.id}`, { sendNow: true });
    expect(sent.ok).toBe(true);
    const newest = (await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.at(-1);
    expect(newest.text).toBe('later');
    expect(newest.attachments.map((a) => a.id)).toEqual([id]);
    expect((await rt.kv.get(KEYS.file(id))).refs).toBe(1);
    // With the last message carrying it deleted, and nothing waiting, the file goes as before.
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${newest.seq}`)).ok).toBe(true);
    expect(await rt.kv.get(KEYS.file(id))).toBeFalsy();
    await expect(bytes(wsId, id)).rejects.toThrow();
  });

  it('stays when the channel carrying it is deleted while a message in another waits with it, and a message that waited for the deleted channel lets go of its own', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'temp' })).data.channel;
    const both = await upload(alice, wsId, 'both.txt'); // posted in #temp, waiting for #general
    const only = await upload(alice, wsId, 'only.txt'); // waiting for #temp alone
    await as(alice).post(`/api/ws/${wsId}/conv/${ch.id}/messages`, { text: 'in temp', attachments: [{ id: both }] });
    expect((await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later in general', attachments: [{ id: both }], dueAt: inAnHour() })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: ch.id, text: 'later in temp', attachments: [{ id: only }], dueAt: inAnHour() })).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${ch.id}`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.file(both)))?.refs).toBe(0);
    expect((await bytes(wsId, both)).size).toBeGreaterThan(0);
    expect(await rt.kv.get(KEYS.file(only))).toBeFalsy();
    await expect(bytes(wsId, only)).rejects.toThrow();
    const queue = await rt.kv.get(KEYS.sched(wsId));
    expect(Object.values(queue.m).map((e) => e.conv)).toEqual([general.id]);
  });
});

describe('a member\'s own state written into a copy that has moved', () => {
  it('is refused with the new address, where during the move it is still written', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    expect((await as(alice).post(`/api/ws/${wsId}/members/${carol.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const root = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root @bob' })).data.message;
    const thread = `${general.id}_t${root.seq}`;
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { to: carol.uuid })).ok).toBe(true);
    expect((await as(carol).post(`/api/ws/${wsId}/transfer/begin`, { sid: 'sess_0001' })).ok).toBe(true);
    // Frozen for the export: the member goes on reading, and what is theirs
    // alone (a cursor, a follow, a save, a badge) is still written; a post is not.
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: root.seq })).ok).toBe(true);
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${thread}/notify`, { follow: true })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: root.seq })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/inbox/read`)).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'x' })).status).toBe(423);
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).notify[thread].follow).toBe(true);
    // Moved: the copy left behind takes none of it, and says where the workspace went.
    const done = await as(carol).post(`/api/ws/${wsId}/transfer/complete`, { to: 'newcopy123@other.puter.work' });
    expect(done.data.movedTo).toBe('newcopy123@other.puter.work');
    const before = await rt.kv.get(KEYS.member(wsId, bob.uuid));
    const savedBefore = await rt.kv.get(KEYS.saved(wsId, bob.uuid));
    const blockBefore = await rt.kv.get(KEYS.block(general.id, 0));
    const calls = [
      () => as(bob).put(`/api/ws/${wsId}/conv/${thread}/notify`, { follow: false }),
      () => as(bob).put(`/api/ws/${wsId}/conv/${general.id}/notify`, { mute: true }),
      () => as(bob).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: root.seq, remove: true }),
      () => as(bob).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: root.seq, done: true }),
      () => as(bob).post(`/api/ws/${wsId}/inbox/read`),
      () => as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: root.seq, back: true }),
      () => as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: root.seq + 5 }),
      () => as(bob).post(`/api/ws/${wsId}/conv/${general.id}/pins`, { seq: root.seq }),
    ];
    for (const call of calls) {
      const res = await call();
      expect(res.status).toBe(423);
      expect(res.data.code).toBe('moved');
      expect(res.data.message).toMatch(/moved to newcopy123@other\.puter\.work/);
    }
    expect(await rt.kv.get(KEYS.member(wsId, bob.uuid))).toEqual(before);
    expect(await rt.kv.get(KEYS.saved(wsId, bob.uuid))).toEqual(savedBefore);
    expect(await rt.kv.get(KEYS.block(general.id, 0))).toEqual(blockBefore);
    // Reading the copy left behind stays open.
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${wsId}/saved`)).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${wsId}/threads`)).ok).toBe(true);
  });
});

describe('the tidying the saved, threads and reminder lists do when read', () => {
  const inAnHour = () => Math.floor(Date.now() / 60_000) * 60_000 + 22_000 + 3600_000;

  it('is skipped on a copy being moved and on one that has moved, and done again once the copy takes writes', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    expect((await as(alice).post(`/api/ws/${wsId}/members/${carol.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    // Bob saves a message and sets a reminder on it; follows a thread in a channel.
    const m = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'save me' })).data.message;
    expect((await as(bob).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: m.seq })).ok).toBe(true);
    const rem = await as(bob).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: m.seq, dueAt: inAnHour() });
    expect(rem.ok).toBe(true);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'proj' })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${ch.id}/join`);
    const root = (await as(bob).post(`/api/ws/${wsId}/conv/${ch.id}/messages`, { text: 'root' })).data.message;
    const t = `${ch.id}_t${root.seq}`;
    await as(alice).post(`/api/ws/${wsId}/conv/${t}/messages`, { text: 'reply' });
    // The message goes, and the channel with the thread: every list has something to tidy.
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}`)).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${ch.id}`)).ok).toBe(true);
    const savedKey = KEYS.saved(wsId, bob.uuid);
    const threadsKey = KEYS.threads(wsId, bob.uuid);
    const memberKey = KEYS.member(wsId, bob.uuid);
    const schedKey = KEYS.sched(wsId);
    const snapshot = async () => JSON.stringify(await Promise.all([savedKey, threadsKey, memberKey, schedKey].map((k) => rt.kv.get(k))));
    const readAll = async () => {
      const saved = (await as(bob).get(`/api/ws/${wsId}/saved`)).data.items;
      const threads = (await as(bob).get(`/api/ws/${wsId}/threads`)).data.threads;
      const sched = (await as(bob).get(`/api/ws/${wsId}/scheduled`)).data;
      return { saved, threads, reminders: sched.reminders };
    };
    // Frozen for the export: the lists are shown tidy and nothing is written.
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { to: carol.uuid })).ok).toBe(true);
    expect((await as(carol).post(`/api/ws/${wsId}/transfer/begin`, { sid: 'sess_0001' })).ok).toBe(true);
    const frozenBefore = await snapshot();
    expect((await rt.kv.get(memberKey)).threads[t]).toBe(1);
    // (The reminder list, like the pins list, is shown as it stands there: its
    // row about the gone message is listed without the message.)
    let shown = await readAll();
    expect(shown.saved).toEqual([]);
    expect(shown.threads).toEqual([]);
    expect(shown.reminders).toHaveLength(1);
    expect(shown.reminders[0].message).toBeNull();
    expect(await snapshot()).toBe(frozenBefore);
    // Moved: the same, for good.
    expect((await as(carol).post(`/api/ws/${wsId}/transfer/complete`, { to: 'newcopy123@other.puter.work' })).ok).toBe(true);
    shown = await readAll();
    expect(shown.saved).toEqual([]);
    expect(shown.threads).toEqual([]);
    expect(shown.reminders).toHaveLength(1);
    expect(await snapshot()).toBe(frozenBefore);
    // The move undone by hand (the copy opened again as the workspace): the lists are tidied on the next read.
    await rt.kv.remove(KEYS.ws(wsId), 'movedTo', 'movedAt');
    const u = (await rt.kv.get(KEYS.activity(wsId))).u?.[bob.uuid] || 0;
    shown = await readAll();
    expect(shown.saved).toEqual([]);
    expect((await rt.kv.get(savedKey)).items).toEqual([]);
    // The thread's counter comes off the member's document (its list entry
    // stays, hidden, as the route keeps one out of reach; see GET /threads).
    expect((await rt.kv.get(memberKey)).threads[t]).toBeUndefined();
    expect((await rt.kv.get(KEYS.activity(wsId))).u[bob.uuid]).toBeGreaterThan(u);
    expect((await rt.kv.get(schedKey))?.m?.[rem.data.reminder.id]).toBeUndefined();
  });
});
