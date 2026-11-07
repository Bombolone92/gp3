/**
 * Review pass 13, the message plane: channels, messages, threads, reactions,
 * pins, saved messages, direct messages, huddles, shared channels. Each test
 * here is a hole that was found in the worker's routes and closed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, threadConvId, blockIndexOf, overlayKey } from '../src/shared/blocks.js';
import { LIMITS } from '../src/shared/limits.js';
import { signAttestation } from '../worker/connect.js';

const { alice, bob } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

const post = (u, wsId, conv, text, extra = {}) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text, ...extra });

describe('saving the same message twice at once', () => {
  it('keeps one entry, tells the second tab it was saved already, and one removal clears it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(alice, wsId, general.id, 'save me')).data.message;
    const save = () => as(bob).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: m.seq });
    const [a, b] = await Promise.all([save(), save()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.data.already, b.data.already].filter(Boolean)).toHaveLength(1);
    expect((await rt.kv.get(KEYS.saved(wsId, bob.uuid))).items).toHaveLength(1);
    expect((await as(bob).get(`/api/ws/${wsId}/saved`)).data.items.map((e) => e.s)).toEqual([m.seq]);
    expect((await as(bob).post(`/api/ws/${wsId}/saved`, { conv: general.id, seq: m.seq, remove: true })).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${wsId}/saved`)).data.items).toEqual([]);
  });

  it('shows a message that got onto the list twice once, and keeps it once', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(alice, wsId, general.id, 'twice over')).data.message;
    const other = (await post(alice, wsId, general.id, 'once')).data.message;
    const key = KEYS.saved(wsId, bob.uuid);
    // A store that hands nothing back from an append gives the save route no
    // word of a second copy: two saves at once both stay on the list.
    await rt.kv.set(key, { items: [{ c: general.id, s: m.seq, ts: 1, done: false }, { c: general.id, s: other.seq, ts: 2, done: false }, { c: general.id, s: m.seq, ts: 3, done: false }] });
    const shown = (await as(bob).get(`/api/ws/${wsId}/saved`)).data.items;
    expect(shown.map((e) => e.s)).toEqual([other.seq, m.seq]);
    expect((await rt.kv.get(key)).items.map((e) => e.s)).toEqual([m.seq, other.seq]);
  });
});

describe('two people pinning the same message in the same instant', () => {
  const sysLines = async (wsId, conv) => (await as(alice).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.filter((x) => x.kind === 'sys' && /pinned a message/.test(x.text));

  it('leaves one pin, one count and one line, and tells the second it was pinned already', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const conv = general.id;
    const m = (await post(alice, wsId, conv, 'pin this')).data.message;
    const [a, b] = await Promise.all([
      as(alice).post(`/api/ws/${wsId}/conv/${conv}/pins`, { seq: m.seq }),
      as(bob).post(`/api/ws/${wsId}/conv/${conv}/pins`, { seq: m.seq }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const winners = [a, b].filter((r) => !r.data.already);
    expect(winners).toHaveLength(1);
    expect(winners[0].data.pin).toMatchObject({ seq: m.seq });
    expect((await rt.kv.get(KEYS.pins(wsId, conv))).items).toHaveLength(1);
    expect((await rt.kv.get(KEYS.activity(wsId))).c[conv].pc).toBe(1);
    expect(await sysLines(wsId, conv)).toHaveLength(1);
    const pins = (await as(bob).get(`/api/ws/${wsId}/conv/${conv}/pins`)).data.pins;
    expect(pins.map((p) => p.seq)).toEqual([m.seq]);
    expect(pins[0].by).toBe(winners[0].data.pin.by);
    // The one pin comes off with one unpin, by an admin, and the count follows.
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${conv}/pins/${m.seq}`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.pins(wsId, conv))).items).toEqual([]);
    expect((await rt.kv.get(KEYS.activity(wsId))).c[conv].pc).toBe(0);
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${conv}/pins/${m.seq}`)).status).toBe(404);
  });

  it('shows a message that got onto the list twice once, as the pin that landed first', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const conv = general.id;
    const m = (await post(alice, wsId, conv, 'listed twice')).data.message;
    const n = (await post(bob, wsId, conv, 'listed once')).data.message;
    await rt.kv.set(KEYS.pins(wsId, conv), { items: [{ seq: m.seq, by: alice.uuid, ts: 10 }, { seq: n.seq, by: bob.uuid, ts: 20 }, { seq: m.seq, by: bob.uuid, ts: 30 }] });
    const pins = (await as(bob).get(`/api/ws/${wsId}/conv/${conv}/pins`)).data.pins;
    expect(pins.map((p) => [p.seq, p.by])).toEqual([[n.seq, bob.uuid], [m.seq, alice.uuid]]);
  });
});

describe('a channel\'s topic, description and bookmark labels', () => {
  it('lose control and bidi override characters, and one that shows as nothing is nothing', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    // A right-to-left override at the head of a topic turned the rest of its line around.
    const made = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'design', topic: '\u202Ereversed' })).data.channel;
    expect(made.topic).toBe('reversed');
    // A topic of a bell character alone passed as a topic and drew as none.
    const bell = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops', topic: '\u0007' })).data.channel;
    expect(bell.topic).toBe('');
    const put = (body) => as(alice).put(`/api/ws/${wsId}/channels/${made.id}`, body);
    // Isolates and controls go; a zero-width space (a joiner's kin) stays, as in a name.
    expect((await put({ topic: '\u2066isolated\u2069 \u200Bstill here' })).data.channel.topic).toBe('isolated \u200Bstill here');
    expect((await put({ topic: '\u200D\u200D' })).data.channel.topic).toBe('');
    // A description keeps its lines; the override and the controls go.
    expect((await put({ description: 'What we do\n\u202Eand why' })).data.channel.description).toBe('What we do\nand why');
    // A bookmark needs a name that shows; a label with an override in it is kept without it.
    const empty = await put({ bookmarks: [{ label: '\u200D', url: 'https://example.com/' }] });
    expect(empty.status).toBe(400);
    expect(empty.data.message).toMatch(/name/);
    const kept = await put({ bookmarks: [{ label: 'Docs\u202E', url: 'https://example.com/' }] });
    expect(kept.ok).toBe(true);
    expect(kept.data.channel.bookmarks.map((b) => b.label)).toEqual(['Docs']);
    // The plain text of each stands as written.
    expect((await put({ topic: 'Pixels & type', description: 'Design system work.' })).data.channel).toMatchObject({ topic: 'Pixels & type', description: 'Design system work.' });
  });
});

describe('leaving an archived channel', () => {
  it('writes no line into it, so it does not light up as unread for the others, while a live channel still says who left', async () => {
    const { wsId } = await workspaceWith(alice, [bob, USERS.carol]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'old-project' })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${ch.id}/join`);
    await as(USERS.carol).post(`/api/ws/${wsId}/channels/${ch.id}/join`);
    // Carol leaves while the channel is live: the channel says so, as before.
    expect((await as(USERS.carol).post(`/api/ws/${wsId}/channels/${ch.id}/leave`)).ok).toBe(true);
    const texts = async () => (await as(alice).get(`/api/ws/${wsId}/conv/${ch.id}/messages`)).data.messages.map((m) => m.text);
    expect(await texts()).toContain('carol left');
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch.id}`, { archived: true })).ok).toBe(true);
    // Alice has read everything; the newest-message stamp is where the archive left it.
    const before = (await rt.kv.get(KEYS.activity(wsId))).c[ch.id];
    await as(alice).post(`/api/ws/${wsId}/conv/${ch.id}/read`, { seq: before.s });
    const left = await as(bob).post(`/api/ws/${wsId}/channels/${ch.id}/leave`);
    expect(left.ok).toBe(true);
    expect(await texts()).not.toContain('bob left');
    const after = (await rt.kv.get(KEYS.activity(wsId))).c[ch.id];
    expect(after.s).toBe(before.s);
    // Bob is out all the same: off his own list, off the count.
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).channels).not.toContain(ch.id);
    const boot = (await as(alice).get(`/api/ws/${wsId}`)).data;
    expect(boot.workspace.channels[ch.id].count).toBe(1);
    expect(boot.me.reads[ch.id]).toBe(boot.activity.c[ch.id].s);
  });
});

describe('the Threads list', () => {
  const threads = async (u, wsId) => (await as(u).get(`/api/ws/${wsId}/threads`)).data.threads;

  it('lets go of a thread whose root is gone for good, its unread count with it, and keeps one whose root is a tombstone', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const conv = general.id;
    const root = (await post(alice, wsId, conv, 'a question')).data.message;
    const other = (await post(alice, wsId, conv, 'another')).data.message;
    const tid = threadConvId(conv, root.seq);
    const reply = (await post(bob, wsId, tid, 'an answer')).data.message;
    await post(bob, wsId, threadConvId(conv, other.seq), 'kept');
    // Alice, the root's author, follows it and has bob's reply unread.
    expect((await rt.kv.get(KEYS.member(wsId, alice.uuid))).threads[tid]).toBe(1);
    // The root deleted while its reply stands: a tombstone, and the thread stays listed around it.
    await as(alice).del(`/api/ws/${wsId}/conv/${conv}/messages/${root.seq}`);
    let list = await threads(bob, wsId);
    expect(list.map((t) => t.id).sort()).toEqual([tid, threadConvId(conv, other.seq)].sort());
    expect(list.find((t) => t.id === tid).root).toMatchObject({ deleted: true, replyCount: 1 });
    // The last reply goes too: nothing is left of the thread, and the card used to say "Loading message" for good.
    await as(bob).del(`/api/ws/${wsId}/conv/${tid}/messages/${reply.seq}`);
    list = await threads(bob, wsId);
    expect(list.map((t) => t.id)).toEqual([threadConvId(conv, other.seq)]);
    expect((await rt.kv.get(KEYS.threads(wsId, bob.uuid))).t[tid]).toBeUndefined();
    // Alice's unread count for it is cleared, and her other tabs are told.
    const poked = (await rt.kv.get(KEYS.activity(wsId))).u?.[alice.uuid] || 0;
    expect((await threads(alice, wsId)).map((t) => t.id)).toEqual([threadConvId(conv, other.seq)]);
    expect((await rt.kv.get(KEYS.member(wsId, alice.uuid))).threads[tid]).toBeUndefined();
    expect((await rt.kv.get(KEYS.threads(wsId, alice.uuid))).t[tid]).toBeUndefined();
    expect((await rt.kv.get(KEYS.activity(wsId))).u[alice.uuid]).toBeGreaterThan(poked);
  });

  it('takes the counters of threads it lets go of off the document, and sweeps dead ones, rather than leaving a key per thread ever followed', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const conv = general.id;
    // The list is over its cap by three; every thread carries a counter, alternating between nothing and one.
    const n = LIMITS.threadsFollowed + 3;
    const t = {};
    const counters = {};
    for (let i = 1; i <= n; i++) {
      const tid = threadConvId(conv, 1000 + i);
      t[tid] = { c: conv, s: 1000 + i, at: i };
      counters[`threads.${tid}`] = i % 2;
    }
    // And two counters for threads not on the list at all: one at nothing (left by an earlier reading), one counting a reply that got ahead of its entry.
    counters[`threads.${threadConvId(conv, 5000)}`] = 0;
    counters[`threads.${threadConvId(conv, 5001)}`] = 2;
    await rt.kv.set(KEYS.threads(wsId, bob.uuid), { t });
    await rt.kv.update(KEYS.member(wsId, bob.uuid), counters);
    // Roots are "on their way" (an import in progress), so nothing is let go of as gone; only the cap prunes.
    await rt.kv.update(KEYS.ws(wsId), { importing: true });
    const poked = (await rt.kv.get(KEYS.activity(wsId))).u?.[bob.uuid] || 0;
    expect((await as(bob).get(`/api/ws/${wsId}/threads`)).status).toBe(200);
    const kept = Object.keys((await rt.kv.get(KEYS.threads(wsId, bob.uuid))).t);
    expect(kept).toHaveLength(LIMITS.threadsFollowed);
    const doc = await rt.kv.get(KEYS.member(wsId, bob.uuid));
    // The three oldest went off the list, their counters (1, 0, 1) with them; the dead zero went; the reply ahead of its entry stays.
    for (let i = 1; i <= 3; i++) expect(doc.threads[threadConvId(conv, 1000 + i)]).toBeUndefined();
    expect(doc.threads[threadConvId(conv, 5000)]).toBeUndefined();
    expect(doc.threads[threadConvId(conv, 5001)]).toBe(2);
    expect(Object.keys(doc.threads)).toHaveLength(LIMITS.threadsFollowed + 1);
    for (const tid of kept) expect(doc.threads[tid]).toBe(Number(tid.slice(tid.lastIndexOf('_t') + 2)) % 2);
    // A count that stood for something went: the member's other tabs are told.
    expect((await rt.kv.get(KEYS.activity(wsId))).u[bob.uuid]).toBeGreaterThan(poked);
  });

  it('keeps a thread whose root has not arrived yet while the workspace is being imported', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const conv = general.id;
    const tid = threadConvId(conv, 40);
    await rt.kv.set(KEYS.threads(wsId, bob.uuid), { t: { [tid]: { c: conv, s: 40, at: 5 } } });
    await rt.kv.update(KEYS.ws(wsId), { importing: true });
    expect((await threads(bob, wsId)).map((t) => [t.id, t.root])).toEqual([[tid, null]]);
    expect((await rt.kv.get(KEYS.threads(wsId, bob.uuid))).t[tid]).toBeDefined();
    await rt.kv.remove(KEYS.ws(wsId), 'importing');
    expect(await threads(bob, wsId)).toEqual([]);
    expect((await rt.kv.get(KEYS.threads(wsId, bob.uuid))).t[tid]).toBeUndefined();
  });
});

describe('someone named in a thread reply', () => {
  const follower = async (conv, seq, u) => (await rt.kv.get(KEYS.block(conv, blockIndexOf(seq)))).x[overlayKey(seq)].f?.[u];
  const listed = async (u, wsId) => (await as(u).get(`/api/ws/${wsId}/threads`)).data.threads.map((t) => t.id);

  it('follows the thread from there: it stands in their Threads view and later replies count for them', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, USERS.carol, USERS.dave]);
    const conv = general.id;
    const root = (await post(alice, wsId, conv, 'Who owns the rollout?')).data.message;
    const tid = threadConvId(conv, root.seq);
    expect((await post(bob, wsId, tid, 'I think @carol does')).ok).toBe(true);
    // Carol is told of the mention as before (Activity, the parent's badge), and now follows.
    let doc = await rt.kv.get(KEYS.member(wsId, USERS.carol.uuid));
    expect(doc.mentions[conv]).toBe(1);
    expect(doc.threads?.[tid] || 0).toBe(0);
    expect((await as(USERS.carol).get(`/api/ws/${wsId}/inbox`)).data.items.map((e) => e.k)).toEqual(['mention']);
    expect(await follower(conv, root.seq, USERS.carol.uuid)).toBe(1);
    expect(await listed(USERS.carol, wsId)).toEqual([tid]);
    // A reply after that reaches her as a follower.
    expect((await post(USERS.dave, wsId, tid, 'Agreed')).ok).toBe(true);
    doc = await rt.kv.get(KEYS.member(wsId, USERS.carol.uuid));
    expect(doc.threads[tid]).toBe(1);
    expect((await as(USERS.carol).get(`/api/ws/${wsId}/inbox`)).data.items.map((e) => e.k).sort()).toEqual(['mention', 'reply']);
    // She unfollows; named again, she follows again, and the unfollow comes off her document rather than being overwritten.
    expect((await as(USERS.carol).put(`/api/ws/${wsId}/conv/${tid}/notify`, { follow: false })).ok).toBe(true);
    expect(await follower(conv, root.seq, USERS.carol.uuid)).toBe(0);
    expect(await listed(USERS.carol, wsId)).toEqual([]);
    expect((await post(bob, wsId, tid, '@carol, still you?')).ok).toBe(true);
    expect(await follower(conv, root.seq, USERS.carol.uuid)).toBe(1);
    doc = await rt.kv.get(KEYS.member(wsId, USERS.carol.uuid));
    expect(doc.notify[tid]?.follow).toBeUndefined();
    expect(await listed(USERS.carol, wsId)).toEqual([tid]);
    // Naming oneself changes nothing beyond the replier's own follow; a broadcast (an admin's, in #general) pulls nobody in.
    const other = (await post(alice, wsId, conv, 'Another')).data.message;
    const tid2 = threadConvId(conv, other.seq);
    expect((await post(alice, wsId, tid2, '@channel have a look, and @alice too')).ok).toBe(true);
    expect(await follower(conv, other.seq, USERS.carol.uuid)).toBeUndefined();
    expect(await follower(conv, other.seq, USERS.dave.uuid)).toBeUndefined();
    expect(await follower(conv, other.seq, alice.uuid)).toBe(1);
    expect(await listed(USERS.dave, wsId)).toEqual([tid]);
    expect(await listed(USERS.carol, wsId)).toEqual([tid]);
  });
});

describe('archiving a channel and changing its rules in one request', () => {
  it('is refused with the reason, and nothing changes; the name and topic may still travel with the archive', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'wrapup' })).data.channel;
    const texts = async () => (await as(alice).get(`/api/ws/${wsId}/conv/${ch.id}/messages`)).data.messages.map((m) => m.text);
    for (const body of [{ archived: true, postPolicy: 'admins' }, { archived: true, threadPolicy: 'off' }, { archived: true, broadcast: 'admins' }]) {
      const r = await as(alice).put(`/api/ws/${wsId}/channels/${ch.id}`, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.data.code).toBe('invalid');
      expect(r.data.message).toMatch(/on its own/);
    }
    const kept = (await rt.kv.get(KEYS.ws(wsId))).channels[ch.id];
    expect(kept.archived).toBeUndefined();
    expect(kept.postPolicy).toBeUndefined();
    expect(kept.threadPolicy).toBeUndefined();
    expect(await texts()).toEqual(['alice created #wrapup']);
    // A rule on its own, then the archive with a last topic: both as before.
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch.id}`, { postPolicy: 'admins' })).ok).toBe(true);
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch.id}`, { archived: true, topic: 'Wrapped up' })).ok).toBe(true);
    const now = (await rt.kv.get(KEYS.ws(wsId))).channels[ch.id];
    expect(now).toMatchObject({ archived: true, topic: 'Wrapped up', postPolicy: 'admins' });
    expect((await texts()).at(-1)).toBe('alice limited posting to admins');
    // Unarchiving with a rule in the same request is still allowed, the channel being open by then.
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch.id}`, { archived: false, postPolicy: 'members' })).ok).toBe(true);
    expect((await texts()).at(-1)).toBe('alice opened posting to everyone in the channel');
  });
});

describe('archiving a channel with a huddle in progress', () => {
  it('ends the huddle first, its line where the channel still takes one, so nothing lapses into the archived channel later', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'standup' })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${ch.id}/join`);
    const started = await as(bob).post(`/api/ws/${wsId}/conv/${ch.id}/huddle`, { invite: 'NJ-7F3A9C', sid: 'tab1', join: true });
    expect(started.data.started).toBe(true);
    const texts = async () => (await as(alice).get(`/api/ws/${wsId}/conv/${ch.id}/messages`)).data.messages.map((m) => m.text);
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch.id}`, { archived: true })).ok).toBe(true);
    // The roster is gone and the channel says the huddle ended, once, before it was closed.
    let act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.h?.[ch.id]).toBeUndefined();
    const ended = (await texts()).filter((t) => /^Huddle ended/.test(t));
    expect(ended).toHaveLength(1);
    const stamp = act.c[ch.id].s;
    // Bob's tab is refused its seat, and giving it up writes nothing more.
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${ch.id}/huddle`, { invite: 'NJ-7F3A9C', sid: 'tab1' })).status).toBe(403);
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${ch.id}/huddle?sid=tab1`)).data).toMatchObject({ ok: true, ended: false });
    act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.c[ch.id].s).toBe(stamp);
    expect((await texts()).filter((t) => /^Huddle ended/.test(t))).toHaveLength(1);
    // A heartbeat that read the channel open and landed after the archive left a seat behind: neither that tab
    // giving it up nor the poll tidying it once stale writes a line into the closed channel.
    const late = { at: Date.now(), j: Date.now(), inv: 'NJ-7F3A9C', s: 'tab1' };
    await rt.kv.update(KEYS.activity(wsId), { [`h.${ch.id}.by`]: bob.uuid, [`h.${ch.id}.at`]: Date.now(), [`h.${ch.id}.m.${bob.uuid}`]: late });
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${ch.id}/huddle?sid=tab1`)).data).toMatchObject({ ok: true, ended: true });
    act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.h?.[ch.id]).toBeUndefined();
    expect(act.c[ch.id].s).toBe(stamp);
    await rt.kv.update(KEYS.activity(wsId), { [`h.${ch.id}.by`]: bob.uuid, [`h.${ch.id}.at`]: Date.now() - 200_000, [`h.${ch.id}.m.${bob.uuid}`]: { ...late, at: Date.now() - 100_000 } });
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.h?.[ch.id]).toBeUndefined();
    expect(act.c[ch.id].s).toBe(stamp);
    expect((await texts()).filter((t) => /^Huddle ended/.test(t))).toHaveLength(1);
    // Archiving a channel with no huddle in it writes nothing either.
    const quiet = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'quiet' })).data.channel;
    const before = (await rt.kv.get(KEYS.activity(wsId))).c[quiet.id].s;
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${quiet.id}`, { archived: true })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.activity(wsId))).c[quiet.id].s).toBe(before);
  });
});

describe('moving a workspace: the freeze', () => {
  const begin = (u, wsId) => as(u).post(`/api/ws/${wsId}/transfer/begin`);
  const cancel = (u, wsId) => as(u).post(`/api/ws/${wsId}/transfer/cancel`);
  const wsDoc = (wsId) => rt.kv.get(KEYS.ws(wsId));

  it('holds writes while the nominee exports, keeps reads open, renews, and lets go on cancel or complete', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, USERS.carol]);
    expect((await as(alice).post(`/api/ws/${wsId}/members/${USERS.carol.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    // Nobody is nominated yet: nobody may begin; then only the nominee may.
    expect((await begin(USERS.carol, wsId)).status).toBe(403);
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { to: USERS.carol.uuid })).ok).toBe(true);
    expect((await begin(bob, wsId)).status).toBe(403);
    expect((await begin(alice, wsId)).status).toBe(403);
    const t0 = Date.now();
    const b = await begin(USERS.carol, wsId);
    expect(b.ok).toBe(true);
    expect(b.data.transferring).toMatchObject({ by: USERS.carol.uuid });
    expect(b.data.transferring.at).toBeGreaterThanOrEqual(t0);
    expect(b.data.until).toBe(b.data.transferring.at + 30 * 60_000);
    // Writes are refused with the reason; reads and the poll go on.
    const refused = await post(alice, wsId, general.id, 'anyone there?');
    expect(refused.status).toBe(423);
    expect(refused.data.code).toBe('transferring');
    expect(refused.data.message).toMatch(/being moved.*few minutes/);
    expect((await as(bob).post(`/api/ws/${wsId}/channels`, { name: 'late' })).status).toBe(423);
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.workspace.transferring).toMatchObject({ by: USERS.carol.uuid });
    // Renewed while the export still runs: the stamp moves up.
    await rt.kv.update(KEYS.ws(wsId), { 'transferring.at': Date.now() - 20 * 60_000 });
    const t1 = Date.now();
    expect((await begin(USERS.carol, wsId)).data.transferring.at).toBeGreaterThanOrEqual(t1);
    // Cancel: a member may not; the nominee may, and writes resume.
    expect((await cancel(bob, wsId)).status).toBe(403);
    expect((await cancel(USERS.carol, wsId)).ok).toBe(true);
    expect((await wsDoc(wsId)).transferring).toBeUndefined();
    expect((await post(alice, wsId, general.id, 'back')).ok).toBe(true);
    // The owner may cancel the freeze too, and may withdraw the nomination while it stands, which takes the freeze with it.
    expect((await begin(USERS.carol, wsId)).ok).toBe(true);
    expect((await cancel(alice, wsId)).ok).toBe(true);
    expect((await begin(USERS.carol, wsId)).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { to: bob.uuid })).status).toBe(423);
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { cancel: true })).ok).toBe(true);
    let doc = await wsDoc(wsId);
    expect(doc.transferring).toBeUndefined();
    expect(doc.transferTo).toBeUndefined();
    // Nominated again, frozen, completed: the copy is moved, and nothing of the freeze is left.
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { to: USERS.carol.uuid })).ok).toBe(true);
    expect((await begin(USERS.carol, wsId)).ok).toBe(true);
    const done = await as(USERS.carol).post(`/api/ws/${wsId}/transfer/complete`, { to: 'newcopy123@other.puter.work' });
    expect(done.data).toMatchObject({ ok: true, movedTo: 'newcopy123@other.puter.work' });
    doc = await wsDoc(wsId);
    expect(doc.transferring).toBeUndefined();
    expect(doc.transferTo).toBeUndefined();
    expect((await post(alice, wsId, general.id, 'x')).data.code).toBe('moved');
    expect((await begin(USERS.carol, wsId)).data.code).toBe('moved');
  });

  it('holds the shared-channel routes that write into the host from outside: accepting a share and disconnecting', async () => {
    const { wsId } = await workspaceWith(alice, [bob, USERS.carol]);
    await as(alice).post(`/api/ws/${wsId}/members/${USERS.carol.uuid}/role`, { role: 'admin' });
    const design = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'design' })).data.channel;
    const code = (await as(alice).post(`/api/ws/${wsId}/channels/${design.id}/connect/invites`, {})).data.code;
    // Globex's admin (dave) accepts once before the move begins: a live connection with its secret.
    const accepted = await as(USERS.dave).post('/api/connect/accept', { code, partner: { ref: 'globex0001@globex.puter.work', name: 'Globex' } });
    expect(accepted.ok).toBe(true);
    const { conn, secret } = accepted.data;
    await as(alice).post(`/api/ws/${wsId}/transfer`, { to: USERS.carol.uuid });
    expect((await begin(USERS.carol, wsId)).ok).toBe(true);
    // Another partner accepting the share now is told to wait, and nothing is written.
    const late = await as(USERS.dave).post('/api/connect/accept', { code, partner: { ref: 'initech001@initech.puter.work', name: 'Initech' } });
    expect(late.status).toBe(423);
    expect(late.data.code).toBe('transferring');
    expect(Object.keys((await wsDoc(wsId)).channels[design.id].connections)).toEqual([conn]);
    // So is the partner ending its connection; once the move is cancelled, it goes through.
    const token = await signAttestation(secret, { conn, uuid: USERS.dave.uuid, kind: 'disconnect' });
    const held = await as(USERS.dave).post('/api/connect/disconnect', { conn, token });
    expect(held.status).toBe(423);
    expect(held.data.code).toBe('transferring');
    expect((await wsDoc(wsId)).channels[design.id].connections[conn]).toBeDefined();
    expect((await cancel(USERS.carol, wsId)).ok).toBe(true);
    expect((await as(USERS.dave).post('/api/connect/disconnect', { conn, token })).data).toEqual({ ok: true });
    expect((await wsDoc(wsId)).channels[design.id].connections?.[conn]).toBeUndefined();
  });

  it('lets go on its own after half an hour, and goes with the nomination', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, USERS.carol]);
    await as(alice).post(`/api/ws/${wsId}/members/${USERS.carol.uuid}/role`, { role: 'admin' });
    await as(alice).post(`/api/ws/${wsId}/transfer`, { to: USERS.carol.uuid });
    expect((await begin(USERS.carol, wsId)).ok).toBe(true);
    // The nominee's export died: half an hour on, the workspace is open again by itself.
    await rt.kv.update(KEYS.ws(wsId), { 'transferring.at': Date.now() - 31 * 60_000 });
    expect((await post(alice, wsId, general.id, 'the export died')).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.transferring).toBeNull();
    // Demoting the nominee withdraws the nomination and what is left of the freeze with it; a former nominee may not begin.
    expect((await as(alice).post(`/api/ws/${wsId}/members/${USERS.carol.uuid}/role`, { role: 'member' })).ok).toBe(true);
    const doc = await rt.kv.get(KEYS.ws(wsId));
    expect(doc.transferTo).toBeUndefined();
    expect(doc.transferring).toBeUndefined();
    expect((await begin(USERS.carol, wsId)).status).toBe(403);
  });
});

describe('starting direct messages', () => {
  const dm = (u, wsId, members) => as(u).post(`/api/ws/${wsId}/dms`, { members });

  it('is capped per member, while a conversation that exists still opens', async () => {
    const { wsId } = await workspaceWith(alice, [bob, USERS.carol]);
    const first = await dm(alice, wsId, [bob.uuid]);
    expect(first.ok).toBe(true);
    // Alice is in the maximum number already (the rest seeded as a long life here would leave them).
    const filler = Object.fromEntries(Array.from({ length: LIMITS.dmsPerMember - 1 }, (_, i) => [`dm_filler${i}`, { members: [alice.uuid, `u-x-${i}`], createdAt: 1 }]));
    await rt.kv.update(KEYS.member(wsId, alice.uuid), Object.fromEntries(Object.entries(filler).map(([k, v]) => [`dms.${k}`, v])));
    const more = await dm(alice, wsId, [USERS.carol.uuid]);
    expect(more.status).toBe(400);
    expect(more.data.code).toBe('limit');
    expect(more.data.message).toMatch(/500/);
    expect(Object.keys((await rt.kv.get(KEYS.member(wsId, USERS.carol.uuid))).dms || {})).toEqual([]);
    // The one with bob is there already: it opens.
    const again = await dm(alice, wsId, [bob.uuid]);
    expect(again.ok).toBe(true);
    expect(again.data).toMatchObject({ conv: first.data.conv, already: true });
    // The cap is on what one starts; another member may still open one with alice (the room check is what guards what she holds).
    expect((await dm(USERS.carol, wsId, [alice.uuid])).ok).toBe(true);
    // Past the cap by another's hand, the refusal says what she is in, not the cap twice over.
    const over = await dm(alice, wsId, [bob.uuid, USERS.carol.uuid]);
    expect(over.status).toBe(400);
    expect(over.data.message).toMatch(/up to 500 direct message conversations, and you are in 501 already/);
  });

  it('needs room on every participant\'s document, the caller\'s included', async () => {
    const { wsId } = await workspaceWith(alice, [bob, USERS.carol]);
    // Bob's document is near what the store takes: nobody can start a conversation with him.
    await rt.kv.update(KEYS.member(wsId, bob.uuid), { filler: 'x'.repeat(300_001) });
    const toBob = await dm(alice, wsId, [bob.uuid]);
    expect(toBob.status).toBe(400);
    expect(toBob.data.code).toBe('limit');
    expect(toBob.data.message).toMatch(/bob/);
    expect((await rt.kv.get(KEYS.member(wsId, alice.uuid))).dms).toEqual({});
    // A group naming him is refused the same way; one without him goes through.
    expect((await dm(alice, wsId, [bob.uuid, USERS.carol.uuid])).status).toBe(400);
    expect((await dm(alice, wsId, [USERS.carol.uuid])).ok).toBe(true);
    // Bob himself can start none until his document has room.
    const fromBob = await dm(bob, wsId, [USERS.carol.uuid]);
    expect(fromBob.status).toBe(400);
    expect(fromBob.data.message).toMatch(/^You are in/);
  });
});

describe('a private channel nobody is left in', () => {
  it('is listed to admins as an orphan, so the deletion the worker allows can be offered, and to nobody else', async () => {
    const { wsId } = await workspaceWith(alice, [bob, USERS.carol]);
    const secret = (await as(bob).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel;
    const shared = (await as(bob).post(`/api/ws/${wsId}/channels`, { name: 'duo', private: true })).data.channel;
    await as(bob).post(`/api/ws/${wsId}/channels/${shared.id}/members`, { uuids: [USERS.carol.uuid] });
    // A private channel with people in it stays hidden from an admin outside it.
    let boot = (await as(alice).get(`/api/ws/${wsId}`)).data;
    expect(boot.workspace.channels[secret.id]).toBeUndefined();
    expect(boot.workspace.channels[shared.id]).toBeUndefined();
    // Bob is removed from the workspace: #secret has nobody left; #duo still has carol.
    expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    boot = (await as(alice).get(`/api/ws/${wsId}`)).data;
    expect(boot.workspace.channels[secret.id]).toMatchObject({ id: secret.id, name: 'secret', private: true, orphan: true, members: [] });
    expect(boot.me.channels).not.toContain(secret.id);
    expect(boot.workspace.channels[shared.id]).toBeUndefined();
    // Not to a member who is not an admin.
    const carolBoot = (await as(USERS.carol).get(`/api/ws/${wsId}`)).data;
    expect(carolBoot.workspace.channels[secret.id]).toBeUndefined();
    expect(carolBoot.workspace.channels[shared.id].id).toBe(shared.id);
    expect(carolBoot.workspace.channels[shared.id].orphan).toBeUndefined();
    // Every other route still knows nothing of it for the admin; the deletion goes through, and the listing follows.
    expect((await as(alice).get(`/api/ws/${wsId}/conv/${secret.id}/messages`)).status).toBe(404);
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${secret.id}`, { topic: 'x' })).status).toBe(404);
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${secret.id}/members`, { uuids: [USERS.carol.uuid] })).status).toBe(404);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${secret.id}`)).ok).toBe(true);
    boot = (await as(alice).get(`/api/ws/${wsId}`)).data;
    expect(boot.workspace.channels[secret.id]).toBeUndefined();
  });
});
