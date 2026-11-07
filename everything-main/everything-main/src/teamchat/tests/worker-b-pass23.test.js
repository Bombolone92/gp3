/**
 * Review pass 23, the message plane: channels, messages, threads, reactions,
 * pins, saved messages, direct messages, huddles, shared channels, transfer.
 * Each test here is a hole that was found in the worker's routes and closed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { countKv } from './helpers/kvcount.js';
import { KEYS, BLOCK_SIZE, BLOCK_BYTES, BLOCK_BYTES_HARD, blockIndexOf, lastSeqOfBlock, jsonBytes } from '../src/shared/blocks.js';
import { VALUE_BYTES_MAX } from '../dev/worker-runtime.js';

const { alice, bob, carol, dave } = USERS;
const own = (obj, key) => (obj && typeof obj === 'object' && Object.hasOwn(obj, key) ? obj[key] : undefined);
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

describe('a direct message that names a guest reads each member document once', () => {
  /** Alice's workspace: bob a member, carol and dave guests of the public #x, bob in it too. */
  const setup = async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const x = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'x' })).data.channel;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${x.id}/invites`, {});
    expect((await as(carol).post('/api/join', { code: inv.data.code })).ok).toBe(true);
    expect((await as(dave).post('/api/join', { code: inv.data.code })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${x.id}/join`)).ok).toBe(true);
    return { wsId, general, x };
  };

  it('a member messaging a guest: the guest\'s document is read once, not three times', async () => {
    const { wsId } = await setup();
    const c = countKv(rt);
    const dm = await as(bob).post(`/api/ws/${wsId}/dms`, { members: [carol.uuid] });
    expect(dm.ok).toBe(true);
    expect(dm.data.members).toEqual([bob.uuid, carol.uuid].sort());
    // The guest's document was read for her channels, again among everyone's
    // for who is in #x with her, and a third time for the conversation she
    // may already hold; bob's own, read at the top of the request, once more.
    expect(c.duplicateGets()).toEqual([]);
    c.restore();
    // Both hold the conversation.
    expect(own((await rt.kv.get(KEYS.member(wsId, carol.uuid))).dms, dm.data.conv)).toBeTruthy();
    expect(own((await rt.kv.get(KEYS.member(wsId, bob.uuid))).dms, dm.data.conv)).toBeTruthy();
  });

  it('a guest messaging a member, and a group of two guests: once each, and the rules still hold', async () => {
    const { wsId, x } = await setup();
    const c = countKv(rt);
    const dm = await as(carol).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] });
    expect(dm.ok).toBe(true);
    expect(c.duplicateGets()).toEqual([]);
    c.reset();
    const group = await as(bob).post(`/api/ws/${wsId}/dms`, { members: [carol.uuid, dave.uuid] });
    expect(group.ok).toBe(true);
    expect(group.data.members).toHaveLength(3);
    expect(c.duplicateGets()).toEqual([]);
    c.reset();
    // Alice, out of #x, shares no channel with the guests: refused, as before.
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${x.id}/leave`)).ok).toBe(true);
    c.reset();
    const refused = await as(alice).post(`/api/ws/${wsId}/dms`, { members: [carol.uuid] });
    expect(refused.status).toBe(403);
    expect(c.duplicateGets()).toEqual([]);
    c.reset();
    // Opened again from the other side: the same conversation, nobody's document read twice.
    const again = await as(carol).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid, dave.uuid] });
    expect(again.ok).toBe(true);
    expect(again.data).toMatchObject({ conv: group.data.conv, already: true });
    expect(c.duplicateGets()).toEqual([]);
    c.restore();
    // And a guest left in #x alone with bob gone from it may still open the
    // conversation the two have (see peersOf): it is theirs to keep.
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${x.id}/leave`)).ok).toBe(true);
    expect((await as(carol).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).data).toMatchObject({ conv: dm.data.conv, already: true });
  });
});

/**
 * The store's sequential depth under one request: how many times it went
 * from idle to busy. Calls made together (see getMany, and the fan-outs that
 * go a dozen at a time) count once; calls awaited one after another count
 * each. What a member waits on is this, not the number of calls.
 */
function rounds(kv) {
  const METHODS = ['get', 'set', 'del', 'incr', 'decr', 'add', 'update', 'remove', 'expire', 'expireAt', 'list'];
  const orig = {};
  let inflight = 0;
  let n = 0;
  for (const m of METHODS) {
    if (typeof kv[m] !== 'function') continue;
    orig[m] = kv[m];
    kv[m] = async (...args) => {
      if (inflight === 0) n++;
      inflight++;
      try {
        return await orig[m].apply(kv, args);
      } finally {
        inflight--;
      }
    };
  }
  return { count: () => n, restore: () => { for (const m of Object.keys(orig)) kv[m] = orig[m]; } };
}

describe('adding many people to a channel at once', () => {
  const people = Array.from({ length: 24 }, (_, i) => ({ uuid: `u-p${String(i).padStart(2, '0')}-0000`, username: `p${String(i).padStart(2, '0')}` }));

  it('runs its round trips a dozen at a time rather than one person after another, and adds everyone as before', async () => {
    const { wsId, code } = await workspaceWith(alice, [bob]);
    for (const p of people) expect((await as(p).post('/api/join', { code })).ok).toBe(true);
    // Two of them guests; one of them is in the channel already; one is named twice; one has left the workspace.
    for (const p of people.slice(0, 2)) expect((await as(alice).post(`/api/ws/${wsId}/members/${p.uuid}/role`, { role: 'guest' })).ok).toBe(true);
    expect((await as(people[23]).del(`/api/ws/${wsId}/members/${people[23].uuid}`)).ok).toBe(true);
    const p = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'p', private: true })).data.channel;
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${p.id}/members`, { uuids: [people[5].uuid] })).data.added).toEqual([people[5].uuid]);
    // A mention of one of them in the channel before they are in it: caught up on entering.
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${p.id}/messages`, { text: 'ask @p07' })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.member(wsId, people[7].uuid))).mentions?.[p.id]).toBeUndefined(); // a private channel they are not in rings nobody
    const seqBefore = Number(await rt.kv.get(KEYS.seq(p.id)));
    const r = rounds(rt.kv);
    const res = await as(alice).post(`/api/ws/${wsId}/channels/${p.id}/members`, { uuids: [...people.map((x) => x.uuid), people[9].uuid, bob.uuid] });
    const depth = r.count();
    r.restore();
    expect(res.ok).toBe(true);
    // Everyone still here and not yet in, once each: 23 people plus bob, less the one already in.
    const expected = [...people.slice(0, 23).filter((x) => x !== people[5]).map((x) => x.uuid), bob.uuid];
    expect(res.data.added).toEqual(expected);
    // One after another, adding this many cost over a hundred round trips in a row (see the route).
    expect(depth).toBeLessThan(24);
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.channels[p.id].count).toBe(1 + 1 + expected.length);
    expect(ws.channels[p.id].guests).toBe(2);
    expect([...ws.channels[p.id].members].sort()).toEqual([alice.uuid, people[5].uuid, ...expected].sort());
    for (const u of expected) {
      const doc = await rt.kv.get(KEYS.member(wsId, u));
      expect(doc.channels).toContain(p.id);
      // Each starts at the channel's present as it stood before the "added" line, the history behind them read.
      expect(doc.reads[p.id]).toBe(seqBefore);
    }
    const line = (await as(alice).get(`/api/ws/${wsId}/conv/${p.id}/messages`)).data.messages.at(-1);
    expect(line.kind).toBe('sys');
    expect(line.text.startsWith('alice added p00, p01, p02')).toBe(true);
    expect(line.text.endsWith('bob')).toBe(true);
    // Every one of them is poked to read their document again.
    const act = await rt.kv.get(KEYS.activity(wsId));
    for (const u of expected) expect(act.u[u]).toBeGreaterThan(0);
    // Named again, nobody is added twice.
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${p.id}/members`, { uuids: expected })).data.added).toEqual([]);
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[p.id].count).toBe(1 + 1 + expected.length);
  });
});

describe('opening a group message of nine', () => {
  const eight = Array.from({ length: 7 }, (_, i) => ({ uuid: `u-g${i}-0000`, username: `g${i}` }));

  it('writes the nine documents together and pokes the eight with one write, and mends a side that lacks it the same way', async () => {
    const { wsId, code } = await workspaceWith(alice, [bob]);
    for (const p of eight) expect((await as(p).post('/api/join', { code })).ok).toBe(true);
    const named = [bob.uuid, ...eight.map((p) => p.uuid)];
    let r = rounds(rt.kv);
    const dm = await as(alice).post(`/api/ws/${wsId}/dms`, { members: named });
    let depth = r.count();
    r.restore();
    expect(dm.ok).toBe(true);
    expect(dm.data.members).toHaveLength(9);
    // One person after another, the nine entries and eight pokes were seventeen round trips in a row.
    expect(depth).toBeLessThan(10);
    const act = await rt.kv.get(KEYS.activity(wsId));
    for (const u of [alice.uuid, ...named]) {
      expect(own((await rt.kv.get(KEYS.member(wsId, u))).dms, dm.data.conv)).toMatchObject({ members: dm.data.members });
      if (u !== alice.uuid) expect(act.u[u]).toBeGreaterThan(0);
    }
    expect(act.u[alice.uuid]).toBeUndefined();
    // Three of them lose their entry (a document cut short): opened again from bob's side, they get it back together.
    for (const p of eight.slice(0, 3)) await rt.kv.remove(KEYS.member(wsId, p.uuid), `dms.${dm.data.conv}`);
    r = rounds(rt.kv);
    const again = await as(bob).post(`/api/ws/${wsId}/dms`, { members: [alice.uuid, ...eight.map((p) => p.uuid)] });
    depth = r.count();
    r.restore();
    expect(again.data).toMatchObject({ conv: dm.data.conv, already: true });
    expect(depth).toBeLessThan(8);
    for (const p of eight.slice(0, 3)) expect(own((await rt.kv.get(KEYS.member(wsId, p.uuid))).dms, dm.data.conv)).toMatchObject({ members: dm.data.members });
  });
});

describe('ending a connection whose partner has many people in the channel', () => {
  const SERVER = 'teamchat-api.test';
  const people = Array.from({ length: 24 }, (_, i) => ({ uuid: `u-p${String(i).padStart(2, '0')}-0000`, username: `p${String(i).padStart(2, '0')}` }));

  /** Acme (alice, carol) hosts #design and #ops; Globex (alice, bob its admin, 24 people) is connected to both. */
  const share = async (acme, globex, name) => {
    const ch = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${ch}/connect/invites`, {});
    const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' } });
    expect(acc.ok).toBe(true);
    const added = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, { ref: `${acme.wsId}@${SERVER}`, ch, conn: acc.data.conn, secret: acc.data.secret, name: `${name}-acme`, host: 'Acme' });
    expect(added.ok).toBe(true);
    return { ch, conn: acc.data.conn, local: added.data.channel.id };
  };
  const joinHost = async (globex, local, p) => {
    if (p !== bob) expect((await as(p).post(`/api/ws/${globex.wsId}/channels/${local}/join`)).ok).toBe(true);
    const att = await as(p).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
    expect((await as(p).post('/api/connect/join', { conn: att.data.conn, token: att.data.token, profile: { name: p.username } })).ok).toBe(true);
  };

  it('takes them all out together, a dozen at a time, leaving what one at a time left', async () => {
    const acme = await workspaceWith(alice, [carol], 'Acme');
    const globex = await workspaceWith(alice, [bob], 'Globex');
    for (const p of people) expect((await as(p).post('/api/join', { code: globex.code })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const design = await share(acme, globex, 'design');
    const ops = await share(acme, globex, 'ops');
    for (const p of [bob, ...people]) await joinHost(globex, design.local, p);
    // Four of them are in #ops as well, and stay in the workspace for it.
    const stayers = people.slice(0, 4);
    for (const p of stayers) await joinHost(globex, ops.local, p);
    // Traces of theirs the disconnect must take: a heartbeat, a seat in the
    // channel's huddle, a message waiting to go out, and a stayer's seat too.
    expect((await as(people[10]).get(`/api/ws/${acme.wsId}/sync?since=0&hb=1`)).ok).toBe(true);
    expect((await as(people[11]).post(`/api/ws/${acme.wsId}/conv/${design.ch}/huddle`, { invite: 'AB-1234', sid: 't1', join: true })).ok).toBe(true);
    expect((await as(stayers[0]).post(`/api/ws/${acme.wsId}/conv/${design.ch}/huddle`, { invite: 'AB-5678', sid: 't2', join: true })).ok).toBe(true);
    expect((await as(people[12]).post(`/api/ws/${acme.wsId}/scheduled`, { conv: design.ch, text: 'later', dueAt: Date.now() + 3600_000 })).ok).toBe(true);
    let ws = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace;
    expect(ws.channels[design.ch].count).toBe(1 + 25);
    expect(ws.channels[ops.ch].count).toBe(1 + 4);
    expect(Object.keys(ws.members)).toHaveLength(2 + 25);
    const r = rounds(rt.kv);
    const res = await as(alice).del(`/api/ws/${acme.wsId}/channels/${design.ch}/connections/${design.conn}`);
    const depth = r.count();
    r.restore();
    expect(res.data).toEqual({ ok: true });
    // One person at a time, this ran to some two hundred and sixty round trips in a row (see disconnect).
    expect(depth).toBeLessThan(60);
    ws = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace;
    expect(ws.channels[design.ch].connections).toEqual({});
    expect(ws.channels[design.ch].count).toBe(1);
    expect(ws.channels[ops.ch].count).toBe(1 + 4);
    expect(await rt.kv.get(KEYS.connect(design.conn))).toBeFalsy();
    // The stayers are still here, in #ops alone, their documents open.
    expect(Object.keys(ws.members).sort()).toEqual([alice.uuid, carol.uuid, ...stayers.map((p) => p.uuid)].sort());
    for (const p of stayers) {
      const doc = await rt.kv.get(KEYS.member(acme.wsId, p.uuid));
      expect(doc.channels).toEqual([ops.ch]);
      expect(doc.gone).toBeUndefined();
    }
    // The rest are gone with everything of theirs, and remembered by name.
    const left = [bob, ...people.slice(4)];
    for (const p of left) {
      expect(ws.members[p.uuid]).toBeUndefined();
      expect(ws.former[p.uuid]).toMatchObject({ name: p.username, org: { name: 'Globex' } });
      expect(await rt.kv.get(KEYS.member(acme.wsId, p.uuid))).toBeFalsy();
      expect(await rt.kv.get(KEYS.inbox(acme.wsId, p.uuid))).toBeFalsy();
      expect((await rt.kv.get(KEYS.user(p.uuid)))?.workspaces || []).not.toContain(acme.wsId);
    }
    const act = await rt.kv.get(KEYS.activity(acme.wsId));
    expect(act.p[people[10].uuid]).toBeUndefined();
    expect(act.h?.[design.ch]?.m?.[people[11].uuid]).toBeUndefined();
    expect(act.h?.[design.ch]?.m?.[stayers[0].uuid]).toBeUndefined();
    for (const p of stayers) expect(act.u[p.uuid]).toBeGreaterThan(0);
    const queue = await rt.kv.get(KEYS.sched(acme.wsId));
    expect(Object.values(queue?.m || {}).filter((e) => e.u === people[12].uuid)).toEqual([]);
    const line = (await as(alice).get(`/api/ws/${acme.wsId}/conv/${design.ch}/messages`)).data.messages.at(-1);
    expect(line).toMatchObject({ kind: 'sys', user: alice.uuid, text: 'alice disconnected Globex' });
    expect(act.c[design.ch].u).toBe('sys');
    // A stayer still reads #ops; someone gone is told the connection has ended on their next word.
    expect((await as(stayers[1]).get(`/api/ws/${acme.wsId}/conv/${ops.ch}/messages`)).ok).toBe(true);
    const att = await as(people[20]).post(`/api/ws/${globex.wsId}/channels/${design.local}/attest`, {});
    expect((await as(people[20]).post('/api/connect/join', { conn: att.data.conn, token: att.data.token })).data.code).toBe('connection_ended');
  });
});

describe('a member of both workspaces joining the channel shared between them', () => {
  const SERVER = 'teamchat-api.test';
  const last = async (wsId, conv) => (await as(alice).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.at(-1);

  it('has their cursor written once, to their own "joined" line, with no reading of the counter for it', async () => {
    // Acme (alice, dave) hosts #design; Globex (alice, bob its admin, dave) is the partner.
    const acme = await workspaceWith(alice, [dave], 'Acme');
    const globex = await workspaceWith(alice, [bob, dave], 'Globex');
    expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const design = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'design' })).data.channel.id;
    // Dave is named in #design before he is in it: a mention counted for him there (see readersAmong).
    expect((await as(alice).post(`/api/ws/${acme.wsId}/conv/${design}/messages`, { text: 'ask @dave' })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.member(acme.wsId, dave.uuid))).mentions[design]).toBe(1);
    const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`, {});
    const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' } });
    expect(acc.ok).toBe(true);
    const added = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, { ref: `${acme.wsId}@${SERVER}`, ch: design, conn: acc.data.conn, secret: acc.data.secret, name: 'design-with-acme', host: 'Acme' });
    expect(added.ok).toBe(true);
    const local = added.data.channel.id;
    expect((await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/join`)).ok).toBe(true);
    const att = await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
    expect(att.ok).toBe(true);
    const c = countKv(rt);
    const j = await as(dave).post('/api/connect/join', { conn: att.data.conn, token: att.data.token });
    expect(j.ok).toBe(true);
    expect(j.data).toMatchObject({ channel: design, member: true });
    // One write to his record (his cursor, and the mention count caught up),
    // and no read of the channel's counter: the line's own number is the cursor.
    expect(c.keys.update.filter((k) => k === KEYS.member(acme.wsId, dave.uuid))).toHaveLength(1);
    expect(c.keys.get.filter((k) => k === KEYS.seq(design))).toHaveLength(0);
    c.restore();
    const line = await last(acme.wsId, design);
    expect(line).toMatchObject({ kind: 'sys', user: dave.uuid, text: 'dave joined' });
    const doc = await rt.kv.get(KEYS.member(acme.wsId, dave.uuid));
    expect(doc.channels).toContain(design);
    expect(doc.reads[design]).toBe(line.seq);
    expect(doc.mentions[design]).toBe(0);
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.channels[design].count).toBe(2);
    // Someone new here (bob, from Globex) still has his document made whole, his cursor on his own line.
    const att2 = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
    expect((await as(bob).post('/api/connect/join', { conn: att2.data.conn, token: att2.data.token, profile: { name: 'Bob B.' } })).ok).toBe(true);
    const bline = await last(acme.wsId, design);
    expect(bline).toMatchObject({ kind: 'sys', user: bob.uuid, text: 'Bob B. (Globex) joined' });
    const bdoc = await rt.kv.get(KEYS.member(acme.wsId, bob.uuid));
    expect(bdoc).toMatchObject({ channels: [design], dms: {}, mentions: {}, reads: { [design]: bline.seq } });
    expect(bdoc.joinedAt).toBeGreaterThan(0);
  });
});

describe('a block of messages grown past what the store holds', () => {
  /** A log line as people paste them, quotes and all (each escaped in the JSON the store keeps), cut to the longest text allowed. */
  const LOG = '{"level":"error","msg":"connection reset by peer","path":"/api/v2/orders/8814","trace":"a1b2c3"}\n';
  const longText = (who) => `@${who} ${LOG.repeat(60)}`.slice(0, 4000);
  const readAll = async (wsId, conv) => {
    const out = [];
    let after = 0;
    for (let i = 0; i < 20; i++) {
      const page = (await as(alice).get(`/api/ws/${wsId}/conv/${conv}/messages?after=${after}`)).data;
      out.push(...page.messages);
      if (!page.messages.length || !page.hasMore) break;
      after = page.messages.at(-1).seq;
    }
    return out;
  };

  it('is closed early, its last numbers left unused, and every message stays reachable and editable', async () => {
    rt = await boot({ strictSize: true });
    const { wsId, general } = await workspaceWith(alice, [bob]);
    // Five attachments of the longest name on every message, as a forward carries them.
    const files = Array.from({ length: 5 }, (_, i) => `f${String(i).padStart(23, '0')}`);
    for (const id of files) await rt.kv.set(KEYS.file(id), { ws: wsId, u: alice.uuid, name: 'n'.repeat(120), size: 10 * 1024 * 1024, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', refs: 0 });
    const posted = [];
    let rolledAt = null;
    for (let i = 0; i < 50; i++) {
      const res = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: longText('bob'), attachments: files.map((id) => ({ id })) });
      expect(res.status).toBe(200);
      posted.push(res.data.message.seq);
      if (rolledAt === null && (await rt.kv.get(KEYS.block(general.id, 0)))?.full) rolledAt = res.data.message.seq;
    }
    // The first block filled past its budget well before its fifty numbers
    // were used, and was closed: the message after it opened the next block.
    expect(rolledAt).not.toBeNull();
    expect(blockIndexOf(rolledAt)).toBe(0);
    const next = posted[posted.indexOf(rolledAt) + 1];
    expect(blockIndexOf(next)).toBe(1);
    expect(next).toBe(lastSeqOfBlock(0) + 1);
    const block0 = await rt.kv.get(KEYS.block(general.id, 0));
    expect(jsonBytes(block0)).toBeGreaterThan(BLOCK_BYTES);
    expect(block0.full).toBe(1);
    // Every edit takes (the edit's text sits beside the original): the
    // closed block has room for its own messages' edits.
    for (const seq of posted) {
      const edit = await as(alice).put(`/api/ws/${wsId}/conv/${general.id}/messages/${seq}`, { text: longText('bob').replace('error', 'fixed') });
      expect(edit.status).toBe(200);
    }
    expect(jsonBytes(await rt.kv.get(KEYS.block(general.id, 0)))).toBeLessThanOrEqual(BLOCK_BYTES_HARD);
    // Every message is found by its number, in order, edited, across the closed block.
    const all = await readAll(wsId, general.id);
    expect(all.map((m) => m.seq)).toEqual([1, 2, ...posted]);
    expect(all.filter((m) => m.kind === 'msg').every((m) => m.text.includes('fixed') && m.attachments.length === 5)).toBe(true);
    const newest = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data;
    expect(newest.messages.at(-1).seq).toBe(posted.at(-1));
    expect(newest.messages.length).toBeGreaterThanOrEqual(25);
    // Reactions, pins and deletion still take on the closed block's messages.
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages/${rolledAt}/reactions`, { reaction: 'thumbsup' })).status).toBe(200);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/pins`, { seq: rolledAt })).status).toBe(200);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${posted[0]}`)).status).toBe(200);
    // The conversation's entry names the newest message, not the counter,
    // so nobody is shown unread messages that do not exist.
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.c[general.id].s).toBe(posted.at(-1) + 1); // the "pinned a message" line
  });

  it('reading to the last message before the unused numbers clears the mention badge, as reading to the end does', async () => {
    rt = await boot({ strictSize: true });
    const { wsId, general } = await workspaceWith(alice, [bob]);
    let last = null;
    for (let i = 0; i < 48 && !(await rt.kv.get(KEYS.block(general.id, 0)))?.full; i++) {
      last = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: longText('bob') })).data.message.seq;
    }
    expect((await rt.kv.get(KEYS.block(general.id, 0)))?.full).toBe(1);
    const counter = Number(await rt.kv.get(KEYS.seq(general.id)));
    expect(counter).toBe(lastSeqOfBlock(0));
    expect(last).toBeLessThan(counter);
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).mentions[general.id]).toBeGreaterThan(0);
    // Bob reads to the newest message that stands: judged by the counter
    // alone the badge stood (on every device) until the next message came.
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: last })).ok).toBe(true);
    const doc = await rt.kv.get(KEYS.member(wsId, bob.uuid));
    expect(doc.reads[general.id]).toBe(last);
    expect(doc.mentions[general.id]).toBe(0);
    // A read short of the last message clears nothing, as before.
    await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'one more @bob' });
    const more = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'and another @bob' })).data.message.seq;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: more - 1 })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).mentions[general.id]).toBe(2);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: more })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).mentions[general.id]).toBe(0);
  });

  it('two messages landing over the budget in the same instant close the block once', async () => {
    rt = await boot({ strictSize: true });
    const { wsId, general } = await workspaceWith(alice, [bob]);
    // Up to just under the budget, then two at once.
    while (jsonBytes(await rt.kv.get(KEYS.block(general.id, 0))) < BLOCK_BYTES - 5000) {
      expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: longText('bob') })).ok).toBe(true);
    }
    const [a, b] = await Promise.all([
      as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: longText('bob') }),
      as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: longText('alice') }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const block0 = await rt.kv.get(KEYS.block(general.id, 0));
    expect(block0.full).toBe(2);
    expect(Number(await rt.kv.get(KEYS.seq(general.id)))).toBe(lastSeqOfBlock(0));
    const next = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'next block' })).data.message.seq;
    expect(next).toBe(lastSeqOfBlock(0) + 1);
    expect(blockIndexOf(next)).toBe(1);
    const all = await readAll(wsId, general.id);
    expect(all.map((m) => m.seq)).toContain(a.data.message.seq);
    expect(all.map((m) => m.seq)).toContain(b.data.message.seq);
    expect(all.at(-1).seq).toBe(next);
  });

  it('a block already past what the store holds (from before) takes no message, and the next opens the next block; a block at its ceiling refuses growth with a word', async () => {
    rt = await boot({ strictSize: true });
    const { wsId, general } = await workspaceWith(alice, [bob]);
    // A block of forty-five messages just under the store's ceiling, as a
    // channel from before blocks were closed early may hold; the counter
    // says the block has numbers left.
    const big = { m: [], x: {} };
    for (let s = 1; s <= 45; s++) big.m.push({ s, u: alice.uuid, t: 'x'.repeat(9000), ts: Date.now() - 1000 + s });
    big.x.s3 = { r: { thumbsup: { [bob.uuid]: 1 } } };
    expect(jsonBytes(big)).toBeGreaterThan(BLOCK_BYTES_HARD);
    expect(JSON.stringify(big).length).toBeLessThan(VALUE_BYTES_MAX);
    await rt.kv.set(KEYS.block(general.id, 0), big);
    await rt.kv.set(KEYS.seq(general.id), 45);
    await rt.kv.update(KEYS.activity(wsId), { [`c.${general.id}.s`]: 45 });
    // The next message would not fit: its number is left, the block closed, and it takes the next block's first number.
    const res = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'y'.repeat(4000) });
    expect(res.status).toBe(200);
    expect(res.data.message.seq).toBe(lastSeqOfBlock(0) + 1);
    expect((await rt.kv.get(KEYS.block(general.id, 0))).m).toHaveLength(45);
    expect((await rt.kv.get(KEYS.block(general.id, 0))).full).toBe(1);
    expect((await rt.kv.get(KEYS.block(general.id, 1))).m.map((m) => m.s)).toEqual([BLOCK_SIZE + 1]);
    expect((await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.at(-1).seq).toBe(BLOCK_SIZE + 1);
    // Growth on the full block is refused with a word, where the store refused it with none...
    const edit = await as(alice).put(`/api/ws/${wsId}/conv/${general.id}/messages/3`, { text: 'z'.repeat(100) });
    expect(edit.status).toBe(400);
    expect(edit.data.code).toBe('limit');
    expect(edit.data.message).toMatch(/cannot be edited/);
    const react = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages/3/reactions`, { reaction: 'heart' });
    expect(react.status).toBe(400);
    expect(react.data.message).toMatch(/cannot take more reactions/);
    const follow = await as(alice).put(`/api/ws/${wsId}/conv/${general.id}_t3/notify`, { follow: true });
    expect(follow.status).toBe(400);
    expect(follow.data.message).toMatch(/cannot take more followers/);
    // ...while what takes a few bytes still goes: a reaction taken back, a pin, a reply (counted, its flags left), a deletion.
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages/3/reactions`, { reaction: 'thumbsup', on: false })).status).toBe(200);
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/pins`, { seq: 3 })).status).toBe(200);
    const reply = await as(bob).post(`/api/ws/${wsId}/conv/${general.id}_t3/messages`, { text: 'a reply' });
    expect(reply.status).toBe(200);
    const root = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages?from=3&to=3`)).data.messages[0];
    expect(root.replyCount).toBe(1);
    expect(root.pinned).toBe(true);
    expect(root.followers).toBeNull();
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/4`)).status).toBe(200);
    expect(jsonBytes(await rt.kv.get(KEYS.block(general.id, 0)))).toBeLessThan(VALUE_BYTES_MAX);
  });
});

describe('unpinning a message', () => {
  it('reads the pins list once, and leaves the list, the flag and the count as an unpin leaves them', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'pin me' })).data.message;
    const m2 = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'and me' })).data.message;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/pins`, { seq: m.seq })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/pins`, { seq: m2.seq })).ok).toBe(true);
    const c = countKv(rt);
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${general.id}/pins/${m.seq}`)).data).toEqual({ ok: true });
    // The list was read to find the pin and who made it, and read again to take it off.
    expect(c.keys.get.filter((k) => k === KEYS.pins(wsId, general.id))).toHaveLength(1);
    expect(c.duplicateGets()).toEqual([]);
    c.restore();
    expect((await rt.kv.get(KEYS.pins(wsId, general.id))).items.map((p) => p.seq)).toEqual([m2.seq]);
    const block = await rt.kv.get(KEYS.block(general.id, 0));
    expect(block.x[`s${m.seq}`]?.p).toBeUndefined();
    expect(block.x[`s${m2.seq}`].p).toBe(1);
    expect((await rt.kv.get(KEYS.activity(wsId))).c[general.id].pc).toBe(1);
    // Unpinned already: refused as before, the list read once for the answer.
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${general.id}/pins/${m.seq}`)).status).toBe(404);
    // A pinned message deleted is unpinned by the deletion, which has no list in hand and reads it.
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${m2.seq}`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.pins(wsId, general.id))).items).toEqual([]);
    expect((await rt.kv.get(KEYS.activity(wsId))).c[general.id].pc).toBe(0);
  });
});
