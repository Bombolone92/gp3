/**
 * Boundaries the worker must hold between workspaces, roles, and callers:
 * each test here is a hole that was found and closed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, threadConvId, blockIndexOf } from '../src/shared/blocks.js';
import { EMOJI_CODES } from '../src/shared/emoji-codes.js';
import { REACTIONS_PER_MESSAGE } from '../src/shared/reactions.js';
import { LIMITS } from '../src/shared/limits.js';

const { alice, bob, carol, dave } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

const post = (u, wsId, conv, text, extra = {}) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text, ...extra });

async function exportAll(u, wsId) {
  let res = await as(u).get(`/api/ws/${wsId}/export`);
  expect(res.ok).toBe(true);
  const header = res.data.header;
  const pages = [...res.data.pages];
  let guard = 0;
  while (!res.data.done && guard++ < 100) {
    res = await as(u).get(`/api/ws/${wsId}/export?cursor=${encodeURIComponent(JSON.stringify(res.data.cursor))}`);
    expect(res.ok).toBe(true);
    pages.push(...res.data.pages);
  }
  return { header, pages };
}

describe('export and import stay inside their workspace', () => {
  it('ignores a cursor that names conversations of another workspace', async () => {
    const a = await workspaceWith(alice, [bob], 'A');
    const b = await workspaceWith(alice, [carol], 'B');
    await as(alice).post(`/api/ws/${a.wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    await post(alice, b.wsId, b.general.id, 'secret plans of workspace B');
    expect((await as(bob).get(`/api/ws/${b.wsId}`)).status).toBe(403);

    // A cursor of the old shape, carrying the list itself, is refused.
    const forged = { convs: [b.general.id], i: 0, n: 0 };
    expect((await as(bob).get(`/api/ws/${a.wsId}/export?cursor=${encodeURIComponent(JSON.stringify(forged))}`)).status).toBe(400);
    // A made-up token finds no list.
    const guess = { k: 'abcdefghijkl', i: 0, n: 0 };
    expect((await as(bob).get(`/api/ws/${a.wsId}/export?cursor=${encodeURIComponent(JSON.stringify(guess))}`)).status).toBe(410);

    const archive = await exportAll(bob, a.wsId);
    const texts = archive.pages.flatMap((p) => p.messages.map((m) => m.text));
    expect(texts).not.toContain('secret plans of workspace B');
  });

  it('walks threads found along the way through a list kept in the worker, and cleans it up', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    for (let i = 0; i < 12; i++) await as(alice).post(`/api/ws/${wsId}/channels`, { name: `room-${i}` });
    const root = (await post(bob, wsId, general.id, 'thread root')).data.message;
    await post(alice, wsId, threadConvId(general.id, root.seq), 'a reply');
    let res = await as(alice).get(`/api/ws/${wsId}/export`);
    expect(res.data.done).toBe(false);
    expect(res.data.cursor.convs).toBeUndefined();
    const token = res.data.cursor.k;
    expect((await rt.kv.get(KEYS.exportList(wsId, token))).convs).toContain(threadConvId(general.id, root.seq));
    const pages = [...res.data.pages];
    let guard = 0;
    while (!res.data.done && guard++ < 100) {
      res = await as(alice).get(`/api/ws/${wsId}/export?cursor=${encodeURIComponent(JSON.stringify(res.data.cursor))}`);
      pages.push(...res.data.pages);
    }
    expect(pages.some((p) => p.conv === threadConvId(general.id, root.seq))).toBe(true);
    expect(await rt.kv.get(KEYS.exportList(wsId, token))).toBeNull();
  });

  it('only writes the channels and direct messages the archive declared', async () => {
    const victim = await workspaceWith(alice, [carol], 'Victim');
    await post(alice, victim.wsId, victim.general.id, 'untouched');
    const src = await workspaceWith(alice, [bob], 'Source');
    await as(alice).post(`/api/ws/${src.wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    const dm = (await as(alice).post(`/api/ws/${src.wsId}/dms`, { members: [bob.uuid] })).data.conv;
    await post(alice, src.wsId, dm, 'hello bob');
    const archive = await exportAll(alice, src.wsId);
    const created = await as(alice).post('/api/workspaces/import', { header: archive.header });
    expect(created.ok).toBe(true);
    const target = created.data.workspace.id;
    const attempt = await as(alice).post(`/api/ws/${target}/import`, { conv: victim.general.id, seq: 5, messages: [{ seq: 5, user: alice.uuid, text: 'INJECTED', ts: 1 }] });
    expect(attempt.status).toBe(404);
    expect((await as(alice).post(`/api/ws/${target}/import`, { conv: `${victim.general.id}_t1`, messages: [] })).status).toBe(404);
    expect((await as(alice).post(`/api/ws/${target}/import`, { conv: `${src.general.id}_t01`, messages: [] })).status).toBe(400);
    // Bob, an admin the archive carried, is an admin of the copy already; the import is the owner's alone.
    expect((await as(bob).post(`/api/ws/${target}/import`, { conv: src.general.id, seq: 1, messages: [{ seq: 1, user: alice.uuid, text: 'as alice', ts: 1 }] })).status).toBe(403);
    expect((await as(bob).post(`/api/ws/${target}/import/finish`)).status).toBe(403);
    expect((await rt.kv.get(KEYS.ws(target))).importing).toBeTruthy();
    // The archive's own conversations, direct messages included, are fine.
    for (const page of archive.pages) {
      expect((await as(alice).post(`/api/ws/${target}/import`, { conv: page.conv, seq: page.seq, messages: page.messages })).ok).toBe(true);
    }
    expect((await as(alice).post(`/api/ws/${target}/import/finish`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(target))).importDms).toBeUndefined();
    const victimPage = await as(carol).get(`/api/ws/${victim.wsId}/conv/${victim.general.id}/messages`);
    expect(victimPage.data.messages.map((m) => m.text)).not.toContain('INJECTED');
    expect(victimPage.data.seq).toBeLessThan(5);
  });
});

describe('a workspace being imported', () => {
  it('takes no writes until it is open, so nothing takes a number the archive is about to bring', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const proj = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'proj' })).data.channel.id;
    for (let i = 0; i < 3; i++) await post(alice, wsId, proj, `keep ${i}`);
    const archive = await exportAll(alice, wsId);
    const created = await as(alice).post('/api/workspaces/import', { header: archive.header });
    expect(created.ok).toBe(true);
    const newId = created.data.workspace.id;
    const copy = Object.values((await as(alice).get(`/api/ws/${newId}`)).data.workspace.channels).find((c) => c.name === 'proj').id;
    // Bob, carried across with his card, finds the copy in his list before
    // its history is in. Joining #proj would post his "joined" line as its
    // first message, the number the archive's first message is about to
    // take; every write waits, with the answer a post gets.
    const join = await as(bob).post(`/api/ws/${newId}/channels/${copy}/join`);
    expect(join.status).toBe(409);
    expect(join.data.code).toBe('importing');
    expect((await as(bob).post(`/api/ws/${newId}/dms`, { members: [alice.uuid] })).data.code).toBe('importing');
    expect((await as(alice).put(`/api/ws/${newId}/channels/${copy}`, { postPolicy: 'admins' })).data.code).toBe('importing');
    // Reading is fine, and so is the import itself.
    expect((await as(bob).get(`/api/ws/${newId}`)).ok).toBe(true);
    for (const page of archive.pages) expect((await as(alice).post(`/api/ws/${newId}/import`, { conv: page.conv, seq: page.seq, messages: page.messages })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    // Every message of the archive is in, at its own number.
    const before = archive.pages.find((p) => p.conv === proj).messages.map((m) => `${m.seq}:${m.text}`);
    const after = (await as(alice).get(`/api/ws/${newId}/conv/${copy}/messages`)).data.messages.map((m) => `${m.seq}:${m.text}`);
    expect(after).toEqual(before);
    // Open now: the join goes through and lands after the history.
    expect((await as(bob).post(`/api/ws/${newId}/channels/${copy}/join`)).ok).toBe(true);
    const page = await as(alice).get(`/api/ws/${newId}/conv/${copy}/messages`);
    expect(page.data.messages.at(-1)).toMatchObject({ seq: before.length + 1, text: 'bob joined' });
    expect((await as(alice).get(`/api/ws/${newId}`)).data.workspace.channels[copy].count).toBe(2);
    expect(general).toBeTruthy();
  });

  it('takes no newcomers through its invite either: their "joined" line would take the number the archive brings for its first message', async () => {
    const { wsId, general } = await workspaceWith(alice, []);
    await post(alice, wsId, general.id, 'first things first');
    const archive = await exportAll(alice, wsId);
    const created = await as(alice).post('/api/workspaces/import', { header: archive.header });
    expect(created.ok).toBe(true);
    const newId = created.data.workspace.id;
    const copy = (await as(alice).get(`/api/ws/${newId}`)).data.workspace;
    const generalCopy = Object.values(copy.channels).find((c) => c.name === 'general').id;
    // The copy has an invite from the moment it is made; bob, handed it
    // before the history is in, waits like every other write.
    const join = await as(bob).post('/api/join', { code: copy.invite });
    expect(join.status).toBe(409);
    expect(join.data.code).toBe('importing');
    expect((await as(bob).get(`/api/ws/${newId}`)).status).toBe(403);
    for (const page of archive.pages) expect((await as(alice).post(`/api/ws/${newId}/import`, { conv: page.conv, seq: page.seq, messages: page.messages })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    // Every message of the archive is in, at its own number.
    const before = archive.pages.find((p) => p.conv === general.id).messages.map((m) => `${m.seq}:${m.text}`);
    const after = (await as(alice).get(`/api/ws/${newId}/conv/${generalCopy}/messages`)).data.messages.map((m) => `${m.seq}:${m.text}`);
    expect(after).toEqual(before);
    // Open now: the join goes through and lands after the history.
    expect((await as(bob).post('/api/join', { code: copy.invite })).ok).toBe(true);
    const page = await as(alice).get(`/api/ws/${newId}/conv/${generalCopy}/messages`);
    expect(page.data.messages.at(-1)).toMatchObject({ seq: before.length + 1, text: 'bob joined' });
    expect((await as(alice).get(`/api/ws/${newId}`)).data.workspace.channels[generalCopy].count).toBe(2);
  });
});

describe('import and other workspaces\' files', () => {
  it('never counts on, points at, or releases a file another workspace holds', async () => {
    const victim = await workspaceWith(alice, [carol], 'Victim');
    const fd = new FormData();
    fd.append('file', new File(['secret bytes'], 'plan.txt', { type: 'text/plain' }));
    const file = (await as(alice).post(`/api/ws/${victim.wsId}/files`, fd)).data;
    await post(alice, victim.wsId, victim.general.id, 'the plan', { attachments: [{ id: file.id }] });
    expect((await rt.kv.get(KEYS.file(file.id))).refs).toBe(1);

    await as(alice).put('/api/server', { open: true });
    const header = {
      format: 'teamchat-export', version: 1,
      workspace: { id: 'attacker01', name: 'Attacker' },
      channels: { attackerch: { name: 'general', def: true } },
      members: { [bob.uuid]: { username: 'bob', name: 'Bob', role: 'owner' } },
      memberDocs: { [bob.uuid]: { channels: ['attackerch'] } },
    };
    const w2 = (await as(bob).post('/api/workspaces/import', { header })).data.workspace.id;
    const ch = Object.keys((await as(bob).get(`/api/ws/${w2}`)).data.workspace.channels)[0];
    const msg = { seq: 1, user: bob.uuid, text: 'carrying a foreign file', ts: Date.now(), editedAt: Date.now(), attachments: [{ id: file.id, name: 'x', size: 1, type: 'text/plain' }] };
    // The foreign attachment is dropped from the message and never counted.
    expect((await as(bob).post(`/api/ws/${w2}/import`, { conv: ch, seq: 1, messages: [msg] })).ok).toBe(true);
    let rec = await rt.kv.get(KEYS.file(file.id));
    expect(rec).toMatchObject({ ws: victim.wsId, refs: 1 });
    expect(rec.cs?.[ch]).toBeUndefined();
    expect((await as(bob).get(`/api/ws/${w2}/conv/${ch}/messages`)).data.messages[0].attachments).toEqual([]);
    // Deleting the message (once the workspace is open), importing the same
    // page again, and deleting again leaves the victim's file where it was.
    expect((await as(bob).post(`/api/ws/${w2}/import/finish`)).ok).toBe(true);
    expect((await as(bob).del(`/api/ws/${w2}/conv/${ch}/messages/1`)).ok).toBe(true);
    await rt.kv.update(KEYS.ws(w2), { importing: true });
    expect((await as(bob).post(`/api/ws/${w2}/import`, { conv: ch, seq: 1, messages: [msg] })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${w2}/import/finish`)).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${w2}/conv/${ch}/messages`)).data.messages.find((m) => m.seq === 1)).toBeUndefined(); // still deleted
    expect((await as(bob).del(`/api/ws/${w2}/conv/${ch}/messages/1`)).status).toBe(404);
    expect((await rt.kv.get(KEYS.file(file.id))).refs).toBe(1);
    expect((await as(carol).get(`/api/ws/${victim.wsId}/files/${file.id}`)).status).toBe(200);
  });

  it('keeps a message\'s overlay when its page is sent again', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const header = {
      format: 'teamchat-export', version: 1,
      workspace: { id: 'copy000001', name: 'Copy' },
      channels: { copych0001: { name: 'general', def: true } },
      members: { [alice.uuid]: { username: 'alice', name: 'Alice', role: 'owner' } },
      memberDocs: { [alice.uuid]: { channels: ['copych0001'] } },
    };
    const w2 = (await as(alice).post('/api/workspaces/import', { header })).data.workspace.id;
    const ch = Object.keys((await as(alice).get(`/api/ws/${w2}`)).data.workspace.channels)[0];
    const page = [{ seq: 1, user: alice.uuid, text: 'kept', ts: Date.now(), reactions: { tada: { [alice.uuid]: 1 } } }];
    expect((await as(alice).post(`/api/ws/${w2}/import`, { conv: ch, seq: 1, messages: page })).ok).toBe(true);
    await as(alice).post(`/api/ws/${w2}/import/finish`);
    // A reaction added since survives the page arriving a second time.
    expect((await as(alice).post(`/api/ws/${w2}/conv/${ch}/messages/1/reactions`, { reaction: 'heart' })).ok).toBe(true);
    await rt.kv.update(KEYS.ws(w2), { importing: true });
    expect((await as(alice).post(`/api/ws/${w2}/import`, { conv: ch, seq: 1, messages: page })).ok).toBe(true);
    const m = (await as(alice).get(`/api/ws/${w2}/conv/${ch}/messages`)).data.messages.find((x) => x.seq === 1);
    expect(Object.keys(m.reactions).sort()).toEqual(['heart', 'tada']);
    expect(general).toBeTruthy();
  });
});

describe('the import header', () => {
  it('admits its origin only as a workspace reference, and no more members or channels than a workspace holds', async () => {
    const members = { [alice.uuid]: { username: 'alice', name: 'A', role: 'owner' } };
    for (let i = 0; i < 520; i++) members[`u-extra-${String(i).padStart(4, '0')}`] = { username: `x${i}`, name: `X ${i}`, role: 'member' };
    const channels = { copych0001: { name: 'general', def: true } };
    for (let i = 0; i < 230; i++) channels[`ch${String(i).padStart(8, '0')}`] = { name: `c-${i}` };
    const header = { format: 'teamchat-export', version: 1, workspace: { id: 'attacker02', name: 'X', createdAt: 'yesterday' }, channels, members };
    const from = { junk: 'x'.repeat(100_000), nested: [1, 2, 3] };
    const w = (await as(alice).post('/api/workspaces/import', { header, from })).data.workspace.id;
    const ws = await rt.kv.get(KEYS.ws(w));
    expect(ws.importedFrom).toBeNull();
    expect(typeof ws.createdAt).toBe('number');
    expect(Object.keys(ws.members).length).toBeLessThanOrEqual(500);
    expect(ws.members[alice.uuid].role).toBe('owner');
    expect(Object.keys(ws.channels).length).toBe(200);
    const w2 = (await as(alice).post('/api/workspaces/import', { header: { ...header, workspace: { id: 'attacker03', name: 'Y' } }, from: 'abcdef1234@teamchat-xyz' })).data.workspace.id;
    expect((await rt.kv.get(KEYS.ws(w2))).importedFrom).toBe('abcdef1234@teamchat-xyz');
  });
});

describe('the sync poll and the bootstrap', () => {
  it('name only the conversations the caller can see: theirs, and the public channels', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const dm = (await as(bob).post(`/api/ws/${wsId}/dms`, { members: [carol.uuid] })).data.conv;
    await post(carol, wsId, dm, 'between us');
    const priv = (await as(bob).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    await post(bob, wsId, priv, 'in private');
    const open = (await as(bob).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    await post(bob, wsId, open, 'for anyone');
    await as(carol).post(`/api/ws/${wsId}/conv/${dm}/typing`);
    await as(bob).post(`/api/ws/${wsId}/conv/${priv}/typing`);
    await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/typing`);
    // Alice is in neither the direct message nor the private channel: an entry
    // there says who last wrote and who is typing to whom, which she is not
    // to know. The public channel she has not joined is browsable, so its
    // activity is fine.
    const sync = (await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).data;
    expect(sync.c[dm]).toBeUndefined();
    expect(sync.c[priv]).toBeUndefined();
    expect(sync.c[open]).toBeTruthy();
    expect(sync.c[general.id]).toBeTruthy();
    expect(sync.t[dm]).toBeUndefined();
    expect(sync.t[priv]).toBeUndefined();
    expect(sync.t[general.id][bob.uuid]).toBeTruthy();
    const boot = (await as(alice).get(`/api/ws/${wsId}`)).data.activity;
    expect(boot.c[dm]).toBeUndefined();
    expect(boot.c[priv]).toBeUndefined();
    expect(boot.c[open]).toBeTruthy();
    expect(boot.t[dm]).toBeUndefined();
    expect(boot.t[general.id][bob.uuid]).toBeTruthy();
    // Members of both see both.
    const bobSync = (await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).data;
    expect(bobSync.c[dm]).toBeTruthy();
    expect(bobSync.c[priv]).toBeTruthy();
    expect(bobSync.t[dm][carol.uuid]).toBeTruthy();
  });
});

describe('thread ids have one spelling', () => {
  it('refuses padded, nested, and not-yet-posted thread ids', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const root = (await post(alice, wsId, general.id, 'root')).data.message;
    const canonical = threadConvId(general.id, root.seq);
    expect((await post(bob, wsId, canonical, 'fine')).ok).toBe(true);
    for (const bad of [`${general.id}_t00${root.seq}`, `${canonical}_t1`, `${general.id}_t0`, `${general.id}_t99999999999999999999`]) {
      expect((await post(bob, wsId, bad, 'nope')).status, bad).toBe(404);
      expect((await as(bob).get(`/api/ws/${wsId}/conv/${bad}/messages`)).status, bad).toBe(404);
      expect(await rt.kv.get(KEYS.seq(bad))).toBeNull();
    }
    // A well-formed id for a message nobody has posted yet reads empty and takes no reply.
    const future = threadConvId(general.id, root.seq + 50);
    expect((await post(bob, wsId, future, 'nope')).status).toBe(404);
    expect(await rt.kv.get(KEYS.seq(future))).toBeNull();
    const page = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(page.data.messages.find((m) => m.seq === root.seq).replyCount).toBe(1);
    // A deleted root is closed to new replies.
    const other = (await post(alice, wsId, general.id, 'gone soon')).data.message;
    await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${other.seq}`);
    expect((await post(bob, wsId, threadConvId(general.id, other.seq), 'too late')).status).toBe(404);
  });
});

describe('following', () => {
  it('needs a root that exists, so no block is minted for a number nobody posted', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/channels/${ops}/join`);
    const bogus = 987654321;
    const junk = KEYS.block(ops, blockIndexOf(bogus));
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${threadConvId(ops, bogus)}/notify`, { follow: true })).status).toBe(404);
    expect(await rt.kv.get(junk)).toBeNull();
    // Nor for a message that was deleted; a live one takes the flag.
    const m = (await post(alice, wsId, ops, 'root')).data.message;
    const gone = (await post(alice, wsId, ops, 'gone')).data.message;
    await as(alice).del(`/api/ws/${wsId}/conv/${ops}/messages/${gone.seq}`);
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${threadConvId(ops, gone.seq)}/notify`, { follow: true })).status).toBe(404);
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${threadConvId(ops, m.seq)}/notify`, { follow: true })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.block(ops, 0))).x[`s${m.seq}`].f[bob.uuid]).toBe(1);
  });
});

describe('scheduled delivery keeps its next due time', () => {
  it('does not lose a message scheduled while a poll is delivering another', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const first = (await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'first', dueAt: Date.now() + 60_000 })).data.scheduled.id;
    await rt.kv.update(KEYS.sched(wsId), { [`m.${first}.dueAt`]: Date.now() - 1 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    const later = Date.now() + 3600_000;
    const [, second] = await Promise.all([
      as(bob).get(`/api/ws/${wsId}/sync?since=0`),
      as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'second', dueAt: later }),
    ]);
    expect(second.ok).toBe(true);
    const page = await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(page.data.messages.filter((m) => m.text === 'first')).toHaveLength(1);
    expect((await as(alice).get(`/api/ws/${wsId}/scheduled`)).data.scheduled.map((e) => e.text)).toEqual(['second']);
    // The queue still has a next due time, so a later poll will find it.
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBe(later);
    await rt.kv.update(KEYS.sched(wsId), { [`m.${second.data.scheduled.id}.dueAt`]: Date.now() - 1 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    await as(bob).get(`/api/ws/${wsId}/sync?since=0`);
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.some((m) => m.text === 'second')).toBe(true);
  });
});

describe('guests', () => {
  async function withGuest() {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const project = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'project' })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/channels/${project}/join`);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    await as(alice).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [carol.uuid] });
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${project}/invites`, { inviteTtl: '7d' });
    expect((await as(dave).post('/api/join', { code: inv.data.code })).ok).toBe(true);
    return { wsId, general, project, secret };
  }

  it('are not reached by @everyone in a channel they are not in', async () => {
    const { wsId, general, project } = await withGuest();
    const r = await post(alice, wsId, general.id, 'all hands @everyone');
    expect(r.ok).toBe(true);
    expect(r.data.message.broadcast).toBe('everyone');
    expect((await as(dave).get(`/api/ws/${wsId}`)).data.me.mentions[general.id]).toBeUndefined();
    expect((await as(dave).get(`/api/ws/${wsId}/inbox`)).data.items.some((e) => e.c === general.id)).toBe(false);
    // Members of the channel are, and so is a guest where they belong.
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.me.mentions[general.id]).toBe(1);
    await post(bob, wsId, project, 'team @channel');
    expect((await as(dave).get(`/api/ws/${wsId}`)).data.me.mentions[project]).toBe(1);
  });

  it('download only files shared where they can read', async () => {
    const { wsId, project, secret } = await withGuest();
    const upload = async (u, name) => {
      const fd = new FormData();
      fd.append('file', new File(['bytes'], name, { type: 'text/plain' }));
      return (await as(u).post(`/api/ws/${wsId}/files`, fd)).data;
    };
    const hidden = await upload(carol, 'secret.txt');
    await post(carol, wsId, secret, 'for members only', { attachments: [{ id: hidden.id }] });
    const shown = await upload(bob, 'plan.txt');
    await post(bob, wsId, project, 'for the project', { attachments: [{ id: shown.id }] });
    const loose = await upload(alice, 'never-attached.txt'); // uploaded, attached nowhere yet
    expect((await as(dave).get(`/api/ws/${wsId}/files/${hidden.id}`)).status).toBe(404);
    expect((await as(dave).get(`/api/ws/${wsId}/files/${shown.id}`)).status).toBe(200);
    expect((await as(dave).get(`/api/ws/${wsId}/files/${loose.id}`)).status).toBe(404); // shared nowhere yet: its uploader's alone (see worker-c-pass19)
    expect((await as(bob).get(`/api/ws/${wsId}/files/${hidden.id}`)).status).toBe(200); // members: any file of the workspace
    // A file bookmarked in the guest's channel is reachable through that too.
    expect((await as(bob).put(`/api/ws/${wsId}/channels/${project}`, { bookmarks: [{ label: 'Plans', file: hidden.id }] })).ok).toBe(true);
    expect((await as(dave).get(`/api/ws/${wsId}/files/${hidden.id}`)).status).toBe(200);
  });

  it('attach only files they could download, so a file id from elsewhere does not come back through a new message', async () => {
    const { wsId, project, secret } = await withGuest();
    const upload = async (u, name) => {
      const fd = new FormData();
      fd.append('file', new File(['bytes'], name, { type: 'text/plain' }));
      return (await as(u).post(`/api/ws/${wsId}/files`, fd)).data;
    };
    const hidden = await upload(carol, 'secret.txt');
    await post(carol, wsId, secret, 'for members only', { attachments: [{ id: hidden.id }] });
    const shown = await upload(bob, 'plan.txt');
    await post(bob, wsId, project, 'for the project', { attachments: [{ id: shown.id }] });
    const own = await upload(dave, 'mine.txt');
    // The secret channel's file is not the guest's to attach: alone it is nothing to post, beside text it is dropped.
    expect((await post(dave, wsId, project, '', { attachments: [{ id: hidden.id }] })).status).toBe(400);
    const r = await post(dave, wsId, project, 'look', { attachments: [{ id: hidden.id }, { id: shown.id }, { id: own.id }] });
    expect(r.ok).toBe(true);
    expect(r.data.message.attachments.map((a) => a.id).sort()).toEqual([own.id, shown.id].sort());
    expect((await as(dave).get(`/api/ws/${wsId}/files/${hidden.id}`)).status).toBe(404); // and still not downloadable
    // A member attaches any file of the workspace, as before.
    expect((await post(bob, wsId, project, 'fine', { attachments: [{ id: hidden.id }] })).data.message.attachments).toHaveLength(1);
  });

  it('see the photos of the people they share a channel with, and learn nothing of anyone else', async () => {
    const { wsId } = await withGuest();
    const photo = async (u) => {
      const fd = new FormData();
      fd.append('file', new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'me.png', { type: 'image/png' }));
      expect((await as(u).post('/api/me/avatar', fd)).ok).toBe(true);
    };
    await photo(bob); // in #project with the guest
    await photo(carol); // in #general and #secret only
    await photo(dave);
    await as(dave).get(`/api/ws/${wsId}`); // the bootstrap that records whom the guest may see
    expect((await as(dave).get(`/api/ws/${wsId}/members/${bob.uuid}/avatar`)).status).toBe(200);
    expect((await as(dave).get(`/api/ws/${wsId}/members/${dave.uuid}/avatar`)).status).toBe(200);
    // Carol's photo, and whether carol is here at all, are not the guest's to learn: the same answer as for a stranger.
    expect((await as(dave).get(`/api/ws/${wsId}/members/${carol.uuid}/avatar`)).status).toBe(404);
    expect((await as(dave).get(`/api/ws/${wsId}/members/nobody-here/avatar`)).status).toBe(404);
    // Members see everyone's.
    expect((await as(bob).get(`/api/ws/${wsId}/members/${carol.uuid}/avatar`)).status).toBe(200);
  });

  it('cannot learn who is a member by asking to message them: a stranger and a member they share no channel with get one answer', async () => {
    const { wsId } = await withGuest();
    expect((await as(dave).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).ok).toBe(true);
    const member = await as(dave).post(`/api/ws/${wsId}/dms`, { members: [carol.uuid] });
    const stranger = await as(dave).post(`/api/ws/${wsId}/dms`, { members: ['nobody-here'] });
    expect(member.status).toBe(403);
    expect(stranger.status).toBe(403);
    expect(stranger.data).toEqual(member.data);
    // Nor by naming both: the one they may message does not tell the others apart.
    const mixed = await as(dave).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid, 'nobody-here'] });
    expect(mixed.status).toBe(403);
    expect(mixed.data).toEqual(member.data);
    // A member's request naming a stale id is refused with what is wrong (a member may know who is here), not made of the rest.
    const stale = await as(bob).post(`/api/ws/${wsId}/dms`, { members: [carol.uuid, 'nobody-here'] });
    expect(stale.status).toBe(400);
    expect(stale.data.message).toBe('Someone you picked is no longer in this workspace');
    expect((await as(bob).post(`/api/ws/${wsId}/dms`, { members: ['nobody-here'] })).status).toBe(400);
  });

  it('become full members by accepting the workspace\'s own invite', async () => {
    const { wsId, general, project } = await withGuest();
    const code = (await as(alice).get(`/api/ws/${wsId}`)).data.workspace.invite;
    expect((await as(dave).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).status).toBe(404);
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels[project].guests).toBe(1);
    const r = await as(dave).post('/api/join', { code });
    expect(r.data).toMatchObject({ promoted: true, workspace: { id: wsId } });
    const boot = (await as(dave).get(`/api/ws/${wsId}`)).data;
    expect(boot.me.role).toBe('member');
    expect(boot.me.channels).toEqual(expect.arrayContaining([project, general.id]));
    expect((await as(dave).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels[project].guests || 0).toBe(0);
    // A member now: the same code answers as for any member.
    expect((await as(dave).post('/api/join', { code })).data).toMatchObject({ already: true });
  });

  it('cannot rename, re-topic, or re-bookmark the channel they were invited to', async () => {
    const { wsId, project } = await withGuest();
    expect((await as(dave).put(`/api/ws/${wsId}/channels/${project}`, { name: 'renamed-by-guest' })).status).toBe(403);
    expect((await as(dave).put(`/api/ws/${wsId}/channels/${project}`, { topic: 'guest topic' })).status).toBe(403);
    expect((await as(dave).put(`/api/ws/${wsId}/channels/${project}`, { bookmarks: [{ label: 'x', url: 'https://evil.example/' }] })).status).toBe(403);
    const ch = (await as(bob).get(`/api/ws/${wsId}`)).data.workspace.channels[project];
    expect(ch.name).toBe('project');
    expect(ch.topic || '').toBe('');
    // A member of the channel still may.
    expect((await as(bob).put(`/api/ws/${wsId}/channels/${project}`, { topic: 'member topic' })).ok).toBe(true);
  });
});

describe('reactions', () => {
  it('need membership of the channel, as posting does', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    const m = (await post(alice, wsId, ops, 'hello')).data.message;
    // Bob can preview the public channel, but not react in it until he joins.
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${ops}/messages`)).ok).toBe(true);
    const denied = await as(bob).post(`/api/ws/${wsId}/conv/${ops}/messages/${m.seq}/reactions`, { reaction: 'tada' });
    expect(denied.status).toBe(403);
    expect(denied.data.code).toBe('not_joined');
    await as(bob).post(`/api/ws/${wsId}/channels/${ops}/join`);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${ops}/messages/${m.seq}/reactions`, { reaction: 'tada' })).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${wsId}/inbox`)).data.items.filter((e) => e.k === 'reaction')).toHaveLength(1);
  });
});

describe('reaction notices', () => {
  it('stop after a few from the same person on the same message, so toggling cannot flood an inbox', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await post(bob, wsId, general.id, 'hey @alice');
    const m = (await post(alice, wsId, general.id, 'react to me')).data.message;
    for (let i = 0; i < 12; i++) {
      await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/reactions`, { reaction: 'tada', on: true });
      await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/reactions`, { reaction: 'tada', on: false });
    }
    await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/reactions`, { reaction: 'heart', on: true });
    // Three notices on the ring, however many times it was toggled; none of
    // them shown in Activity, since the reaction they name has been taken back.
    const ring = (await rt.kv.get(KEYS.inbox(wsId, alice.uuid))).items;
    expect(ring.filter((e) => e.k === 'reaction')).toHaveLength(3);
    const items = (await as(alice).get(`/api/ws/${wsId}/inbox`)).data.items;
    expect(items.filter((e) => e.k === 'reaction')).toHaveLength(0);
    expect(items.some((e) => e.k === 'mention')).toBe(true);
    // The reaction itself still lands; only the notice is spared.
    const page = await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(Object.keys(page.data.messages.find((x) => x.seq === m.seq).reactions).sort()).toEqual(['heart']);
  });
});

describe('bot tokens', () => {
  it('meet the same cap on distinct reactions as members do', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const bot = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Helper', channels: [general.id], scopes: ['post', 'read', 'react'] })).data.token;
    const m = (await post(alice, wsId, general.id, 'pile on')).data.message;
    const keys = [...EMOJI_CODES].slice(0, REACTIONS_PER_MESSAGE + 5);
    const results = [];
    for (const k of keys) results.push((await as(null).post(`/bot/${bot}/channels/${general.id}/messages/${m.seq}/reactions`, { reaction: k, on: true })).status);
    expect(results.filter((s) => s === 200)).toHaveLength(REACTIONS_PER_MESSAGE);
    expect(results.filter((s) => s === 400)).toHaveLength(5);
    // Joining an existing reaction is still fine past the cap.
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/reactions`, { reaction: keys[0], on: true })).ok).toBe(true);
  });
});

describe('bot tokens and archived channels', () => {
  it('refuse a reaction in an archived channel as they refuse a post', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    const m = (await post(alice, wsId, ops, 'hello')).data.message;
    const bot = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Helper', channels: [ops], scopes: ['react', 'post', 'read'] })).data.token;
    expect((await as(null).post(`/bot/${bot}/channels/${ops}/messages/${m.seq}/reactions`, { reaction: 'tada' })).ok).toBe(true);
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ops}`, { archived: true })).ok).toBe(true);
    expect((await as(null).post(`/bot/${bot}/channels/${ops}/messages`, { text: 'x' })).status).toBe(403);
    const viaBot = await as(null).post(`/bot/${bot}/channels/${ops}/messages/${m.seq}/reactions`, { reaction: 'heart' });
    expect(viaBot.status).toBe(403);
    expect(viaBot.data.code).toBe('archived');
    // Reading stays open, as for a member.
    expect((await as(null).get(`/bot/${bot}/channels/${ops}/messages`)).ok).toBe(true);
  });
});

describe('integration "last used"', () => {
  it('is written to the workspace document at most once a minute', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const bot = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Helper', channels: [general.id], scopes: ['post'] })).data;
    expect((await as(null).post(`/webhook/${hook.token}`, { text: 'one' })).ok).toBe(true);
    expect((await as(null).post(`/bot/${bot.token}/channels/${general.id}/messages`, { text: 'one' })).ok).toBe(true);
    let ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.webhooks[hook.id].lastUsed).toBeGreaterThan(0);
    expect(ws.bots[bot.id].lastUsed).toBeGreaterThan(0);
    // A stamp ten seconds old stands through a burst; one two minutes old is refreshed.
    const recent = Date.now() - 10_000;
    const stale = Date.now() - 120_000;
    await rt.kv.update(KEYS.ws(wsId), { [`webhooks.${hook.id}.lastUsed`]: recent, [`bots.${bot.id}.lastUsed`]: recent });
    for (let i = 0; i < 3; i++) {
      expect((await as(null).post(`/webhook/${hook.token}`, { text: `burst ${i}` })).ok).toBe(true);
      expect((await as(null).post(`/bot/${bot.token}/channels/${general.id}/messages`, { text: `burst ${i}` })).ok).toBe(true);
    }
    ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.webhooks[hook.id].lastUsed).toBe(recent);
    expect(ws.bots[bot.id].lastUsed).toBe(recent);
    await rt.kv.update(KEYS.ws(wsId), { [`webhooks.${hook.id}.lastUsed`]: stale, [`bots.${bot.id}.lastUsed`]: stale });
    expect((await as(null).post(`/webhook/${hook.token}`, { text: 'later' })).ok).toBe(true);
    expect((await as(null).post(`/bot/${bot.token}/channels/${general.id}/messages`, { text: 'later' })).ok).toBe(true);
    ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.webhooks[hook.id].lastUsed).toBeGreaterThan(stale);
    expect(ws.bots[bot.id].lastUsed).toBeGreaterThan(stale);
  });
});

describe('integrations during an import', () => {
  it('wait like members do until the workspace is open', async () => {
    const src = await workspaceWith(alice, [bob], 'Source');
    const archive = await exportAll(alice, src.wsId);
    const target = (await as(alice).post('/api/workspaces/import', { header: archive.header })).data.workspace.id;
    // The copy is on the worker holding the source, so its channels got ids of their own.
    const ch = Object.keys((await as(alice).get(`/api/ws/${target}`)).data.workspace.channels)[0];
    // Integrations are set up once the workspace is open (nothing is written
    // to one being imported); here the import is reopened under them.
    expect((await as(alice).post(`/api/ws/${target}/import/finish`)).ok).toBe(true);
    const hook = (await as(alice).post(`/api/ws/${target}/webhooks`, { channel: ch, name: 'CI' })).data.token;
    const bot = (await as(alice).post(`/api/ws/${target}/bots`, { name: 'Helper', channels: [ch], scopes: ['post', 'read', 'react'] })).data.token;
    await rt.kv.update(KEYS.ws(target), { importing: true });
    expect((await post(alice, target, ch, 'too early')).status).toBe(409);
    expect((await as(null).post(`/webhook/${hook}`, { text: 'too early' })).status).toBe(409);
    expect((await as(null).post(`/bot/${bot}/channels/${ch}/messages`, { text: 'too early' })).status).toBe(409);
    expect((await as(null).get(`/bot/${bot}/channels/${ch}/messages`)).ok).toBe(true); // reading is fine
    await as(alice).post(`/api/ws/${target}/import/finish`);
    expect((await as(null).post(`/webhook/${hook}`, { text: 'now' })).ok).toBe(true);
    expect((await as(null).post(`/bot/${bot}/channels/${ch}/messages`, { text: 'now' })).ok).toBe(true);
  });
});

describe('posting', () => {
  it('does not store an empty message when every attachment is unknown', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const before = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.seq;
    const r = await post(alice, wsId, general.id, '', { attachments: [{ id: 'forged0000' }] });
    expect(r.status).toBe(400);
    expect((await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.seq).toBe(before);
  });
});

describe('the scheduled queue', () => {
  it('stops taking entries before the workspace document outgrows the store', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const long = 'x'.repeat(4000);
    const future = Date.now() + 3600_000;
    let refused = null;
    for (const u of [alice, bob, carol]) {
      for (let i = 0; i < 50 && !refused; i++) {
        const r = await as(u).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: long, dueAt: future });
        if (!r.ok) refused = r;
      }
    }
    expect(refused).not.toBeNull();
    expect(refused.data.code).toBe('limit');
    expect(JSON.stringify(await rt.kv.get(KEYS.sched(wsId))).length).toBeLessThan(260_000);
  });
});

describe('the activity document, invites and reminders hold their bounds', () => {
  it('shows a reminder\'s message only while the caller may still read where it was posted', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const priv = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel;
    await as(alice).post(`/api/ws/${wsId}/channels/${priv.id}/members`, { uuids: [bob.uuid] });
    const m = (await post(alice, wsId, priv.id, 'plans')).data.message;
    const set = await as(bob).post(`/api/ws/${wsId}/reminders`, { conv: priv.id, seq: m.seq, dueAt: Date.now() + 3600_000 });
    expect(set.ok).toBe(true);
    let list = await as(bob).get(`/api/ws/${wsId}/scheduled`);
    expect(list.data.reminders.map((r) => r.message?.text)).toEqual(['plans']);
    await as(bob).post(`/api/ws/${wsId}/channels/${priv.id}/leave`, {});
    list = await as(bob).get(`/api/ws/${wsId}/scheduled`);
    expect(list.data.reminders).toEqual([]);
  });

  it('does not take an inherited property name as an invite duration', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const priv = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel;
    for (const bad of ['constructor', 'toString', '__proto__', '99d']) {
      expect((await as(alice).post(`/api/ws/${wsId}/channels/${priv.id}/invites`, { inviteTtl: bad })).status, bad).toBe(400);
      expect((await as(alice).post(`/api/ws/${wsId}/channels/${general.id}/connect/invites`, { inviteTtl: bad })).status, bad).toBe(400);
    }
    const ok = await as(alice).post(`/api/ws/${wsId}/channels/${priv.id}/invites`, { inviteTtl: '1d' });
    expect(ok.ok).toBe(true);
    expect(ok.data.exp).toBeGreaterThan(Date.now());
  });

  it('refuses typing in a thread whose root does not exist, so nobody can grow the activity document by made-up threads', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const root = (await post(alice, wsId, general.id, 'root')).data.message;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${threadConvId(general.id, root.seq)}/typing`, {})).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${threadConvId(general.id, 999)}/typing`, {})).status).toBe(404);
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(Object.keys(act.t || {})).toEqual([threadConvId(general.id, root.seq)]);
  });

});

describe('bounds on what one member can cost a workspace', () => {
  it('sends a guest the presence of the people they share a channel with, and nobody else', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const project = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'project' })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/channels/${project}/join`);
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${project}/invites`, {});
    await as(dave).post('/api/join', { code: inv.data.code });
    // Everyone is here; carol shares no channel with the guest.
    for (const u of [alice, bob, carol]) await as(u).get(`/api/ws/${wsId}/sync?since=0&hb=1`);
    const boot = await as(dave).get(`/api/ws/${wsId}?hb=1`);
    expect(Object.keys(boot.data.workspace.members).sort()).toEqual([alice.uuid, bob.uuid, dave.uuid].sort());
    expect(boot.data.me.peers).toBeUndefined();
    const s = await as(dave).get(`/api/ws/${wsId}/sync?since=0`);
    expect(Object.keys(s.data.p).sort()).toEqual([alice.uuid, bob.uuid, dave.uuid].sort());
    expect(Object.keys(s.data.ps || {})).not.toContain(carol.uuid);
    // A member still sees everyone.
    expect(Object.keys((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).data.p)).toContain(carol.uuid);
    void general;
  });

  it('gives each member an upload budget: so many files per window, so many bytes a day', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const upload = async (u, size = 4) => {
      const fd = new FormData();
      fd.append('file', new File([new Uint8Array(size)], 'a.bin', { type: 'application/octet-stream' }));
      return as(u).post(`/api/ws/${wsId}/files`, fd);
    };
    for (let i = 0; i < LIMITS.uploadsPerMember; i++) expect((await upload(bob)).ok, `upload ${i}`).toBe(true);
    const over = await upload(bob);
    expect(over.status).toBe(429);
    expect(over.data.code).toBe('too_many_uploads');
    // Another member's budget is their own.
    expect((await upload(alice)).ok).toBe(true);
    // The day's bytes: one more file past the line is refused, and nothing is written for it.
    await rt.kv.set(`tc:upbytes:${wsId}:${alice.uuid}`, LIMITS.uploadBytesPerDay - 1);
    const files = rt.fs._count ? rt.fs._count() : null;
    expect((await upload(alice, 8)).status).toBe(429);
    if (files != null) expect(rt.fs._count()).toBe(files);
  });

  it('refuses to grow a workspace document that is already near the store limit', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await rt.kv.update(KEYS.ws(wsId), { 'channels.padpadpad1': { id: 'padpadpad1', name: 'pad', description: 'x'.repeat(310_000), count: 1 } });
    expect((await as(bob).post(`/api/ws/${wsId}/channels`, { name: 'one-more' })).status).toBe(400);
    expect((await as(bob).put(`/api/ws/${wsId}/channels/${general.id}`, { description: 'more words' })).status).toBe(400);
    expect((await as(bob).put(`/api/ws/${wsId}/channels/${general.id}`, { bookmarks: [{ label: 'Docs', url: 'https://x.io/' }] })).status).toBe(400);
    // Renaming and the topic still work: they replace what is there, and an archive can free room.
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { topic: 'short' })).ok).toBe(true);
  });

  it('keeps every joiner on the member list of a private channel when two accept its invite at once', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    const priv = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${priv.id}/invites`, {});
    const [b, c] = await Promise.all([as(bob).post('/api/join', { code: inv.data.code }), as(carol).post('/api/join', { code: inv.data.code })]);
    expect(b.data.joined).toBe(true);
    expect(c.data.joined).toBe(true);
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect([...ws.channels[priv.id].members].sort()).toEqual([alice.uuid, bob.uuid, carol.uuid].sort());
    // Added by an admin while another accepts: both land on the list.
    const priv2 = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret-2', private: true })).data.channel;
    const inv2 = await as(alice).post(`/api/ws/${wsId}/channels/${priv2.id}/invites`, {});
    await Promise.all([as(alice).post(`/api/ws/${wsId}/channels/${priv2.id}/members`, { uuids: [bob.uuid] }), as(carol).post('/api/join', { code: inv2.data.code })]);
    const again = await rt.kv.get(KEYS.ws(wsId));
    expect([...again.channels[priv2.id].members].sort()).toEqual([alice.uuid, bob.uuid, carol.uuid].sort());
    const listed = await as(bob).get(`/api/ws/${wsId}/channels/${priv2.id}/members`);
    expect([...listed.data.members].sort()).toEqual([alice.uuid, bob.uuid, carol.uuid].sort());
  });

  it('counts a person into a channel once when two requests put them in at the same moment', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    // The same person joining from two tabs at once: one join, one "joined" line, counted once.
    const proj = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'proj' })).data.channel.id;
    const joins = await Promise.all([as(carol).post(`/api/ws/${wsId}/channels/${proj}/join`), as(carol).post(`/api/ws/${wsId}/channels/${proj}/join`)]);
    expect(joins.every((r) => r.ok)).toBe(true);
    expect(joins.filter((r) => r.data.already)).toHaveLength(1);
    expect((await rt.kv.get(KEYS.member(wsId, carol.uuid))).channels.filter((c) => c === proj)).toEqual([proj]);
    let ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.channels[proj].count).toBe(2);
    const lines = (await as(alice).get(`/api/ws/${wsId}/conv/${proj}/messages`)).data.messages.filter((m) => m.text === 'carol joined');
    expect(lines).toHaveLength(1);
    // Two admins adding the same person to a private channel at once: added once, on the list once.
    const priv = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret-3', private: true })).data.channel.id;
    await as(alice).post(`/api/ws/${wsId}/channels/${priv}/members`, { uuids: [bob.uuid] });
    const adds = await Promise.all([
      as(alice).post(`/api/ws/${wsId}/channels/${priv}/members`, { uuids: [carol.uuid] }),
      as(bob).post(`/api/ws/${wsId}/channels/${priv}/members`, { uuids: [carol.uuid] }),
    ]);
    expect(adds.flatMap((r) => r.data.added)).toEqual([carol.uuid]);
    ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.channels[priv].count).toBe(3);
    expect(ws.channels[priv].members).toEqual([alice.uuid, bob.uuid, carol.uuid]);
    expect((await rt.kv.get(KEYS.member(wsId, carol.uuid))).channels.filter((c) => c === priv)).toEqual([priv]);
    // And the two together, a channel invite accepted while an admin adds them.
    const priv2 = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret-4', private: true })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${priv2}/invites`, {});
    await Promise.all([as(alice).post(`/api/ws/${wsId}/channels/${priv2}/members`, { uuids: [carol.uuid] }), as(carol).post('/api/join', { code: inv.data.code })]);
    ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.channels[priv2].count).toBe(2);
    expect((await rt.kv.get(KEYS.member(wsId, carol.uuid))).channels.filter((c) => c === priv2)).toEqual([priv2]);
    // Leaving takes them off, and the count with them.
    expect((await as(carol).post(`/api/ws/${wsId}/channels/${proj}/leave`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[proj].count).toBe(1);
  });

});

describe('the same newcomer joining twice at once', () => {
  it('is made a member once: one card, one "joined" line, counted once, listed once', async () => {
    const { wsId, code, general } = await workspaceWith(alice, []);
    // The invite link opened in two tabs: both requests find no card for bob.
    const both = await Promise.all([as(bob).post('/api/join', { code }), as(bob).post('/api/join', { code })]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    for (const r of both) expect(r.data.workspace.id).toBe(wsId);
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.channels[general.id].count).toBe(2);
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).channels).toEqual([general.id]);
    const lines = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.filter((m) => m.text === 'bob joined');
    expect(lines).toHaveLength(1);
    expect((await rt.kv.get(KEYS.user(bob.uuid))).workspaces).toEqual([wsId]);
    expect((await as(bob).get('/api/me')).data.workspaces.map((w) => w.id)).toEqual([wsId]);
    // And bob is in: the bootstrap answers him.
    expect((await as(bob).get(`/api/ws/${wsId}`)).ok).toBe(true);
    // Leaving takes the one count off.
    expect((await as(bob).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[general.id].count).toBe(1);
  });
});

describe('a guest made a member twice at once', () => {
  it('lands in the default channels once, counted there once, and comes off the guest count once', async () => {
    const { wsId, code, general } = await workspaceWith(alice, [bob]);
    await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${ops}/invites`, {});
    expect((await as(carol).post('/api/join', { code: inv.data.code })).data.guest).toBe(true);
    expect((await as(dave).post('/api/join', { code: inv.data.code })).data.guest).toBe(true);
    let ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.channels[ops].guests).toBe(2);
    const before = ws.channels[general.id].count;
    // Two admins making carol a member in the same moment.
    const both = await Promise.all([
      as(alice).post(`/api/ws/${wsId}/members/${carol.uuid}/role`, { role: 'member' }),
      as(bob).post(`/api/ws/${wsId}/members/${carol.uuid}/role`, { role: 'member' }),
    ]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.members[carol.uuid].role).toBe('member');
    expect(ws.channels[general.id].count).toBe(before + 1);
    expect(ws.channels[ops].guests).toBe(1);
    expect((await rt.kv.get(KEYS.member(wsId, carol.uuid))).channels).toEqual([ops, general.id]);
    // And dave, a guest handed the workspace's own invite, accepting it from two tabs.
    const twice = await Promise.all([as(dave).post('/api/join', { code }), as(dave).post('/api/join', { code })]);
    expect(twice.map((r) => r.status)).toEqual([200, 200]);
    ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.members[dave.uuid].role).toBe('member');
    expect(ws.channels[general.id].count).toBe(before + 2);
    expect(ws.channels[ops].guests).toBe(0);
    expect((await rt.kv.get(KEYS.member(wsId, dave.uuid))).channels).toEqual([ops, general.id]);
  });
});
