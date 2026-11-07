/**
 * Review pass 12, the message plane: channels, messages, threads, reactions,
 * pins, direct messages, huddles, shared channels. Each test here is a hole
 * that was found in the worker's routes and closed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, threadConvId, blockIndexOf, overlayKey } from '../src/shared/blocks.js';

const { alice, bob, carol, dave } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

const post = (u, wsId, conv, text, extra = {}) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text, ...extra });
const upload = async (u, wsId, name, content) => {
  const fd = new FormData();
  fd.append('file', new File([content], name, { type: 'text/plain' }));
  return (await as(u).post(`/api/ws/${wsId}/files`, fd)).data;
};

describe('deleting the same message twice at once', () => {
  it('lets go of its attachments once and takes one off its root\'s reply count', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const file = await upload(alice, wsId, 'a.txt', 'kept elsewhere too');
    // The file is held by two messages: the reply about to be deleted, and one in #general.
    await post(alice, wsId, general.id, 'forwarded', { attachments: [{ id: file.id }] });
    const root = (await post(alice, wsId, general.id, 'root')).data.message;
    const tid = threadConvId(general.id, root.seq);
    await post(bob, wsId, tid, 'stays');
    const reply = (await post(alice, wsId, tid, 'goes', { attachments: [{ id: file.id }] })).data.message;
    expect((await rt.kv.get(KEYS.file(file.id))).refs).toBe(2);
    // The author from one tab and an admin from another, in the same instant.
    const [a, b] = await Promise.all([
      as(alice).del(`/api/ws/${wsId}/conv/${tid}/messages/${reply.seq}`),
      as(alice).del(`/api/ws/${wsId}/conv/${tid}/messages/${reply.seq}`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    expect((await rt.kv.get(KEYS.file(file.id))).refs).toBe(1);
    expect(rt.fs._files.has(`teamchat-files/${wsId}/${file.id}`)).toBe(true);
    const rootNow = (await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.find((m) => m.seq === root.seq);
    expect(rootNow.replyCount).toBe(1);
  });
});

describe('deleting a message on a store that hands nothing back from a path increment', () => {
  it('still deletes it, whether the store answers null or undefined, and a second deletion is still refused', async () => {
    for (const answer of [null, undefined]) {
      rt = await boot();
      const base = rt.kv;
      // Plain counters (message numbers) still answer their number; the
      // document form of the increment (a flag, a claim) answers nothing.
      rt.setStores({ kv: { ...base, incr: async (k, by) => { const r = await base.incr(k, by); return by && typeof by === 'object' ? answer : r; } } });
      const { wsId, general } = await workspaceWith(alice, [bob]);
      const m = (await post(alice, wsId, general.id, 'to go')).data.message;
      const del = await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}`);
      expect(del.status, String(answer)).toBe(200);
      const left = (await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.map((x) => x.seq);
      expect(left).not.toContain(m.seq);
      expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}`)).status).toBe(404);
      rt.setStores({ kv: base });
    }
  });
});

describe('the first two replies to a message, sent in the same instant', () => {
  it('are both kept on a store that refuses to append to a block that is not there yet', async () => {
    rt = await boot({ strictAdd: true });
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const root = (await post(alice, wsId, general.id, 'Who can take this?')).data.message;
    const tid = threadConvId(general.id, root.seq);
    const [a, b] = await Promise.all([post(bob, wsId, tid, 'I can'), post(carol, wsId, tid, 'Me too')]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const replies = (await as(alice).get(`/api/ws/${wsId}/conv/${tid}/messages`)).data.messages.map((m) => m.text).sort();
    expect(replies).toEqual(['I can', 'Me too']);
    const rootNow = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.find((m) => m.seq === root.seq);
    expect(rootNow.replyCount).toBe(2);
    // A thread whose block is there is left alone: a later reply reads it once, as before.
    expect((await post(alice, wsId, tid, 'Thanks both')).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${wsId}/conv/${tid}/messages`)).data.messages).toHaveLength(3);
  });
});

describe('an archived channel', () => {
  it('keeps its name, topic, bookmarks and rules until it is unarchived, as it keeps its messages', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops', topic: 'On call' })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${ch.id}/join`);
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch.id}`, { archived: true })).ok).toBe(true);
    const lines = async () => (await as(alice).get(`/api/ws/${wsId}/conv/${ch.id}/messages`)).data.messages.length;
    const before = await lines();
    for (const body of [{ topic: 'Changed' }, { name: 'renamed' }, { description: 'Long form' }, { bookmarks: [{ label: 'Docs', url: 'https://example.com' }] }]) {
      const r = await as(bob).put(`/api/ws/${wsId}/channels/${ch.id}`, body);
      expect(r.status, JSON.stringify(body)).toBe(403);
      expect(r.data.code).toBe('archived');
    }
    for (const body of [{ postPolicy: 'admins' }, { threadPolicy: 'off' }, { broadcast: 'admins' }, { archived: true, topic: 'Still not' }]) {
      const r = await as(alice).put(`/api/ws/${wsId}/channels/${ch.id}`, body);
      expect(r.status, JSON.stringify(body)).toBe(403);
      expect(r.data.code).toBe('archived');
    }
    const kept = (await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels[ch.id];
    expect(kept).toMatchObject({ name: 'ops', topic: 'On call', archived: true });
    expect(kept.postPolicy).toBeUndefined();
    // Nothing was announced into a conversation that takes no lines.
    expect(await lines()).toBe(before);
    // Archiving it again is nothing to refuse, and unarchiving may bring the changes that follow it.
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch.id}`, { archived: true })).ok).toBe(true);
    const back = await as(alice).put(`/api/ws/${wsId}/channels/${ch.id}`, { archived: false, name: 'ops-2', postPolicy: 'admins' });
    expect(back.ok).toBe(true);
    expect(back.data.channel).toMatchObject({ archived: false, name: 'ops-2', postPolicy: 'admins' });
    expect(await lines()).toBe(before + 1);
    expect((await as(bob).put(`/api/ws/${wsId}/channels/${ch.id}`, { topic: 'Open again' })).ok).toBe(true);
  });
});

describe('a pin whose flag and list entry have parted', () => {
  const flag = async (conv, seq) => (await rt.kv.get(KEYS.block(conv, blockIndexOf(seq))))?.x?.[overlayKey(seq)]?.p;
  const listed = async (wsId, conv) => ((await rt.kv.get(KEYS.pins(wsId, conv)))?.items || []).map((p) => p.seq);
  const shown = async (u, wsId, conv, seq) => (await as(u).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.find((m) => m.seq === seq);

  it('can be unpinned (the stray flag goes) and pinned (it goes back on the list) rather than being stuck as "Pinned"', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const conv = general.id;
    const a = (await post(alice, wsId, conv, 'keep this')).data.message;
    const b = (await post(bob, wsId, conv, 'and this')).data.message;
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${conv}/pins`, { seq: a.seq })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${conv}/pins`, { seq: b.seq })).ok).toBe(true);
    // A pin taken off rewrote the list from a read that predates b's pin: b is flagged but off the list.
    const pinsKey = KEYS.pins(wsId, conv);
    await rt.kv.set(pinsKey, { items: (await rt.kv.get(pinsKey)).items.filter((p) => p.seq !== b.seq) });
    expect(await flag(conv, b.seq)).toBe(1);
    expect(await listed(wsId, conv)).toEqual([a.seq]);
    expect((await shown(carol, wsId, conv, b.seq)).pinned).toBe(true);
    // Someone merely previewing the channel may not clear it; someone who could pin here may.
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    const c = (await post(alice, wsId, ops, 'in ops')).data.message;
    await rt.kv.update(KEYS.block(ops, blockIndexOf(c.seq)), { [`x.${overlayKey(c.seq)}.p`]: 1 });
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${ops}/pins/${c.seq}`)).status).toBe(403);
    expect(await flag(ops, c.seq)).toBe(1);
    // "Unpin" on the row that says Pinned: the flag goes, every tab redraws, nothing else changes.
    const stampBefore = (await rt.kv.get(KEYS.activity(wsId))).c[conv].x || 0;
    const un = await as(carol).del(`/api/ws/${wsId}/conv/${conv}/pins/${b.seq}`);
    expect(un.status).toBe(200);
    expect(await flag(conv, b.seq)).toBeUndefined();
    expect((await shown(carol, wsId, conv, b.seq)).pinned).toBe(false);
    expect(await listed(wsId, conv)).toEqual([a.seq]);
    expect((await rt.kv.get(KEYS.activity(wsId))).c[conv].x).toBeGreaterThanOrEqual(stampBefore);
    // A message that is not pinned in any sense is still "not pinned".
    expect((await as(carol).del(`/api/ws/${wsId}/conv/${conv}/pins/${b.seq}`)).status).toBe(404);
    // Flagged but off the list again, and this time someone pins it: it goes on the list as a pin of theirs.
    await rt.kv.update(KEYS.block(conv, blockIndexOf(b.seq)), { [`x.${overlayKey(b.seq)}.p`]: 1 });
    const re = await as(carol).post(`/api/ws/${wsId}/conv/${conv}/pins`, { seq: b.seq });
    expect(re.ok).toBe(true);
    expect(re.data.already).toBeUndefined();
    expect(re.data.pin).toMatchObject({ seq: b.seq, by: carol.uuid });
    expect(await listed(wsId, conv)).toEqual([a.seq, b.seq]);
    expect((await rt.kv.get(KEYS.activity(wsId))).c[conv].pc).toBe(2);
    const pins = (await as(alice).get(`/api/ws/${wsId}/conv/${conv}/pins`)).data.pins;
    expect(pins.map((p) => p.seq).sort()).toEqual([a.seq, b.seq].sort());
    // The other way round (on the list, flag lost): pinning again puts the flag right and adds no second entry.
    await rt.kv.remove(KEYS.block(conv, blockIndexOf(a.seq)), `x.${overlayKey(a.seq)}.p`);
    expect((await shown(carol, wsId, conv, a.seq)).pinned).toBe(false);
    const again = await as(bob).post(`/api/ws/${wsId}/conv/${conv}/pins`, { seq: a.seq });
    expect(again.data.already).toBe(true);
    expect(await flag(conv, a.seq)).toBe(1);
    expect(await listed(wsId, conv)).toEqual([a.seq, b.seq]);
    // And a real unpin still needs the pinner or an admin.
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${conv}/pins/${b.seq}`)).status).toBe(403);
    expect((await as(carol).del(`/api/ws/${wsId}/conv/${conv}/pins/${b.seq}`)).ok).toBe(true);
    expect(await listed(wsId, conv)).toEqual([a.seq]);
    expect(await flag(conv, b.seq)).toBeUndefined();
  });
});

describe('the saved list', () => {
  it('lets go of a saved message that was deleted since, or that never was, and keeps the rest', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const conv = general.id;
    const doomed = (await post(alice, wsId, conv, 'going away')).data.message;
    const root = (await post(alice, wsId, conv, 'a root going away')).data.message;
    const keep = (await post(alice, wsId, conv, 'staying')).data.message;
    await post(bob, wsId, threadConvId(conv, root.seq), 'a reply keeps a tombstone');
    for (const seq of [doomed.seq, root.seq, keep.seq]) expect((await as(bob).post(`/api/ws/${wsId}/saved`, { conv, seq })).ok).toBe(true);
    // An entry for a number nothing was posted under (an import, a bug of old): on the list, nothing behind it.
    await rt.kv.add(KEYS.saved(wsId, bob.uuid), { items: [{ c: conv, s: 900, ts: 1, done: false }] });
    const before = (await as(bob).get(`/api/ws/${wsId}/saved`)).data.items;
    expect(before.map((e) => e.s).sort()).toEqual([doomed.seq, root.seq, keep.seq].sort()); // the phantom already shows nothing
    await as(alice).del(`/api/ws/${wsId}/conv/${conv}/messages/${doomed.seq}`);
    await as(alice).del(`/api/ws/${wsId}/conv/${conv}/messages/${root.seq}`);
    const after = (await as(bob).get(`/api/ws/${wsId}/saved`)).data.items;
    expect(after.map((e) => e.s)).toEqual([keep.seq]);
    expect(after[0].message.text).toBe('staying');
    // Off the list itself, not merely hidden: the cap counts what is there.
    expect((await rt.kv.get(KEYS.saved(wsId, bob.uuid))).items.map((e) => e.s)).toEqual([keep.seq]);
    // What is merely out of reach right now stays (a private channel left), as before.
    const priv = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    await as(alice).post(`/api/ws/${wsId}/channels/${priv}/members`, { uuids: [bob.uuid] });
    const s = (await post(alice, wsId, priv, 'psst')).data.message;
    expect((await as(bob).post(`/api/ws/${wsId}/saved`, { conv: priv, seq: s.seq })).ok).toBe(true);
    await as(bob).post(`/api/ws/${wsId}/channels/${priv}/leave`);
    expect((await as(bob).get(`/api/ws/${wsId}/saved`)).data.items.map((e) => e.s)).toEqual([keep.seq]);
    expect((await rt.kv.get(KEYS.saved(wsId, bob.uuid))).items.map((e) => e.s).sort()).toEqual([keep.seq, s.seq].sort());
  });
});

describe('the same person reacting twice in the same instant', () => {
  it('is one reaction, and the author hears of it once', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const conv = general.id;
    const m = (await post(alice, wsId, conv, 'nice')).data.message;
    const react = (u, reaction, on) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages/${m.seq}/reactions`, { reaction, on });
    // Two tabs of bob's, each showing the reaction off, each tapping it on.
    const both = await Promise.all([react(bob, 'heart', true), react(bob, 'heart', true)]);
    expect(both.map((r) => [r.status, r.data.on])).toEqual([[200, true], [200, true]]);
    const shown = (await as(alice).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.find((x) => x.seq === m.seq);
    expect(shown.reactions).toEqual({ heart: { [bob.uuid]: 1 } });
    const inbox = await as(alice).get(`/api/ws/${wsId}/inbox`);
    expect(inbox.data.unread).toBe(1);
    expect(inbox.data.items.filter((e) => e.k === 'reaction')).toHaveLength(1);
    // The duplicate gave its notice back: bob may still be heard of twice more on this message.
    const overlay = (await rt.kv.get(KEYS.block(conv, blockIndexOf(m.seq)))).x[overlayKey(m.seq)];
    expect(overlay.rn[bob.uuid]).toBe(1);
    // Taken back once, it is gone; two different people at once are two.
    expect((await react(bob, 'heart', false)).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.find((x) => x.seq === m.seq).reactions).toEqual({});
    await Promise.all([react(alice, 'rocket', true), react(bob, 'rocket', true)]);
    const two = (await as(alice).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.find((x) => x.seq === m.seq);
    expect(two.reactions.rocket).toEqual({ [alice.uuid]: 1, [bob.uuid]: 1 });
    expect((await as(alice).get(`/api/ws/${wsId}/inbox`)).data.unread).toBe(2);
  });
});

describe('a roster entry nobody was ever on', () => {
  it('is tidied by the poll without a "Huddle ended" line, and a huddle that ran still gets its line', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const conv = general.id;
    const texts = async () => (await as(alice).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.map((m) => m.text);
    // The start claim's count, left standing alone: a poll swept the roster
    // away between a starter's seat write and their claim.
    await rt.kv.update(KEYS.activity(wsId), { [`h.${conv}.n`]: 1 });
    const before = await texts();
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.activity(wsId))).h?.[conv]).toBeUndefined();
    expect(await texts()).toEqual(before);
    // Someone starting in its place is announced once, as a fresh start is.
    const r = await as(alice).post(`/api/ws/${wsId}/conv/${conv}/huddle`, { invite: 'NJ-ALICE1', sid: 'a', join: true });
    expect(r.data.started).toBe(true);
    expect((await texts()).filter((t) => /started a huddle/.test(t))).toHaveLength(1);
    // And a huddle everyone has gone quiet from still gets its ended line from the poll that notices.
    await rt.kv.update(KEYS.activity(wsId), { [`h.${conv}.m.${alice.uuid}.at`]: Date.now() - 10 * 60_000, [`h.${conv}.at`]: Date.now() - 12 * 60_000 });
    await as(bob).get(`/api/ws/${wsId}/sync?since=0`);
    expect((await texts()).filter((t) => /Huddle ended after/.test(t))).toHaveLength(1);
    expect((await rt.kv.get(KEYS.activity(wsId))).h?.[conv]).toBeUndefined();
  });
});

describe('two people starting a huddle in the same instant', () => {
  const huddle = (u, wsId, conv, invite, sid) => as(u).post(`/api/ws/${wsId}/conv/${conv}/huddle`, { invite, sid, join: true });
  const texts = async (u, wsId, conv) => (await as(u).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.map((m) => m.text);

  it('start one huddle: one line, one call for the others, and each is handed the other\'s seat', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid, carol.uuid] })).data.conv;
    const [a, b] = await Promise.all([huddle(alice, wsId, dm, 'NJ-ALICE1', 'tab-a'), huddle(bob, wsId, dm, 'NJ-BOB001', 'tab-b')]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.data.started, b.data.started].filter(Boolean)).toHaveLength(1);
    const lines = (await texts(carol, wsId, dm)).filter((t) => /started a huddle/.test(t));
    expect(lines).toHaveLength(1);
    // Carol's phone rang once, not twice.
    const inbox = await as(carol).get(`/api/ws/${wsId}/inbox`);
    expect(inbox.data.items.filter((e) => e.k === 'huddle')).toHaveLength(1);
    expect(inbox.data.unread).toBe(1);
    // Both are in it, and the one whose start was second was told of the other's seat.
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(Object.keys(act.h[dm].m).sort()).toEqual([alice.uuid, bob.uuid].sort());
    const second = a.data.started ? b : a;
    expect(Object.keys(second.data.huddle.m).sort()).toEqual([alice.uuid, bob.uuid].sort());
    expect(second.data.huddle.m[alice.uuid].inv).toBe('NJ-ALICE1');
    expect(second.data.huddle.m[bob.uuid].inv).toBe('NJ-BOB001');
    // Joining later says nothing; the huddle ends once, and a fresh start afterwards is announced again.
    expect((await huddle(carol, wsId, dm, 'NJ-CAROL1', 'tab-c')).data.started).toBe(false);
    for (const u of [alice, bob, carol]) await as(u).del(`/api/ws/${wsId}/conv/${dm}/huddle`);
    expect((await texts(carol, wsId, dm)).filter((t) => /Huddle ended/.test(t))).toHaveLength(1);
    expect((await rt.kv.get(KEYS.activity(wsId))).h?.[dm]).toBeUndefined();
    expect((await huddle(bob, wsId, dm, 'NJ-BOB002', 'tab-b')).data.started).toBe(true);
    expect((await texts(carol, wsId, dm)).filter((t) => /started a huddle/.test(t))).toHaveLength(2);
  });
});
