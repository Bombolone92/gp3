/**
 * Identity, membership, scheduling and presence routes: what the eleventh
 * review pass found.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import { dmConvId } from '../src/shared/ids.js';

const { alice, bob } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

const MIN = 60_000;
const sync = (u, wsId) => as(u).get(`/api/ws/${wsId}/sync?since=0`);
const post = (u, wsId, conv, text) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text });
const messages = async (u, wsId, conv) => (await as(u).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages;

describe('a delivery two polls take over from one that died', () => {
  it('posts the reminder once, whichever poll\'s claim lands first', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const key = KEYS.sched(wsId);
    // A claim older than the delivery window: the poll that took it never finished.
    const stale = { id: 'r1', kind: 'reminder', u: alice.uuid, conv: general.id, seq: 1, note: 'call back', dueAt: Date.now() - 10 * MIN, createdAt: Date.now() - 20 * MIN, claims: 1, claimedAt: Date.now() - 6 * MIN };
    await rt.kv.set(key, { m: { r1: stale } });
    await rt.kv.update(KEYS.activity(wsId), { nd: stale.dueAt });
    // The store answers in its own time: the second poll's reset of the old
    // claim reaches it after the first poll's claim has already landed.
    const kv = rt.kv;
    const origIncr = kv.incr.bind(kv);
    const origRemove = kv.remove.bind(kv);
    let claimed;
    const firstClaim = new Promise((r) => { claimed = r; });
    let resets = 0;
    kv.remove = async (k, ...paths) => {
      if (k === key && paths.flat().includes('m.r1.claims') && ++resets === 2) await firstClaim;
      return origRemove(k, ...paths);
    };
    kv.incr = async (k, amount) => {
      const res = await origIncr(k, amount);
      if (k === key && amount && amount['m.r1.claims']) claimed();
      return res;
    };
    const [a, b] = await Promise.all([sync(alice, wsId), sync(bob, wsId)]);
    expect(a.ok && b.ok).toBe(true);
    const self = dmConvId([alice.uuid], wsId);
    const lines = (await messages(alice, wsId, self)).filter((m) => m.kind === 'rem');
    expect(lines).toHaveLength(1);
    const inbox = (await as(alice).get(`/api/ws/${wsId}/inbox`)).data.items.filter((e) => e.k === 'reminder');
    expect(inbox).toHaveLength(1);
    expect((await rt.kv.get(key)).m).toEqual({});
  });
});

describe('two reminders due together, for someone whose own space does not exist yet', () => {
  it('both land there when two polls deliver one each', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await post(alice, wsId, general.id, 'second')).ok).toBe(true);
    const key = KEYS.sched(wsId);
    const base = { kind: 'reminder', u: alice.uuid, conv: general.id, dueAt: Date.now() - MIN, createdAt: Date.now() - 10 * MIN };
    await rt.kv.set(key, { m: { r1: { ...base, id: 'r1', seq: 1, note: 'one' }, r2: { ...base, id: 'r2', seq: 2, note: 'two' } } });
    await rt.kv.update(KEYS.activity(wsId), { nd: base.dueAt });
    // The second poll reaches the store once the first has claimed its
    // entry: it takes the other, and is a few writes behind from then on.
    const kv = rt.kv;
    const origIncr = kv.incr.bind(kv);
    let second = null;
    kv.incr = async (k, amount) => {
      const res = await origIncr(k, amount);
      if (k === key && amount && amount['m.r1.claims'] && !second) second = sync(bob, wsId);
      return res;
    };
    expect((await sync(alice, wsId)).ok).toBe(true);
    expect((await second).ok).toBe(true);
    const self = dmConvId([alice.uuid], wsId);
    const lines = (await messages(alice, wsId, self)).filter((m) => m.kind === 'rem').map((m) => m.text).sort();
    expect(lines).toEqual(['Reminder: one', 'Reminder: two']);
    expect((await rt.kv.get(key)).m).toEqual({});
  });
});

describe('an entry edited as its delivery removed it', () => {
  it('is answered as gone and leaves no stub behind in the queue', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const key = KEYS.sched(wsId);
    const r = await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'first draft', dueAt: Date.now() + 5 * MIN });
    expect(r.ok).toBe(true);
    const id = r.data.scheduled.id;
    // Between the edit's read of the queue and its write, the poll delivering
    // the entry took it out.
    const kv = rt.kv;
    const origUpdate = kv.update.bind(kv);
    const origRemove = kv.remove.bind(kv);
    let raced = false;
    kv.update = async (k, paths) => {
      if (k === key && paths && `m.${id}.text` in paths && !raced) {
        raced = true;
        await origRemove(k, `m.${id}`);
      }
      return origUpdate(k, paths);
    };
    const edit = await as(alice).put(`/api/ws/${wsId}/scheduled/${id}`, { text: 'second draft' });
    expect(raced).toBe(true);
    expect(edit.status).toBe(404);
    expect((await rt.kv.get(key)).m[id]).toBeUndefined();
    expect((await as(alice).get(`/api/ws/${wsId}/scheduled`)).data.scheduled).toEqual([]);
  });

  it('is swept from the queue by the next delivery when it was left by a retry', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const key = KEYS.sched(wsId);
    const due = { id: 'ok1', kind: 'message', u: alice.uuid, conv: general.id, text: 'on time', attachments: [], dueAt: Date.now() - MIN, createdAt: Date.now() - 10 * MIN };
    // What a failed delivery's retry note leaves when the author deleted the entry meanwhile.
    await rt.kv.set(key, { m: { ok1: due, junk: { tries: 1, retryAt: Date.now() - MIN } } });
    await rt.kv.update(KEYS.activity(wsId), { nd: due.dueAt });
    expect((await sync(bob, wsId)).ok).toBe(true);
    expect((await messages(alice, wsId, general.id)).some((m) => m.text === 'on time')).toBe(true);
    expect((await rt.kv.get(key)).m).toEqual({});
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBeUndefined();
  });
});

describe('someone removed in the middle of a huddle', () => {
  const huddle = (u, wsId, conv, sid) => as(u).post(`/api/ws/${wsId}/conv/${conv}/huddle`, { invite: `${sid}-INVITE1`, sid, join: true });

  it('is off its roster at once, and out of who is typing, rather than when the seat lapses', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await huddle(bob, wsId, general.id, 'tabbob')).ok).toBe(true);
    expect((await huddle(alice, wsId, general.id, 'tabali')).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/typing`, {})).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.h[general.id].m[bob.uuid]).toBeUndefined();
    expect(act.h[general.id].m[alice.uuid]).toBeDefined();
    expect(act.t?.[general.id]?.[bob.uuid]).toBeUndefined();
    const boot = await as(alice).get(`/api/ws/${wsId}`);
    expect(Object.keys(boot.data.activity.h[general.id].m)).toEqual([alice.uuid]);
  });

  it('ends a huddle they were alone in with the next poll, not a minute and a half on', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await huddle(bob, wsId, general.id, 'tabbob')).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    const poll = await sync(alice, wsId);
    expect(poll.ok).toBe(true);
    expect(poll.data.h).toBeUndefined();
    expect((await rt.kv.get(KEYS.activity(wsId))).h?.[general.id]).toBeUndefined();
    expect((await messages(alice, wsId, general.id)).some((m) => m.kind === 'sys' && /^Huddle ended/.test(m.text))).toBe(true);
  });
});

describe('the owner\'s card in a sample workspace', () => {
  it('carries their photo and status like a card anywhere else', async () => {
    const status = { emoji: '🎨', text: 'Designing', until: null };
    expect((await as(alice).put('/api/me', { status })).ok).toBe(true);
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array(64)], 'me.png', { type: 'image/png' }));
    const up = await as(alice).post('/api/me/avatar', fd);
    expect(up.ok).toBe(true);
    const wsId = (await as(alice).post('/api/workspaces/sample', { profile: { name: 'Alice A.' } })).data.workspace.id;
    const me = (await as(alice).get(`/api/ws/${wsId}`)).data.workspace.members[alice.uuid];
    expect(me).toMatchObject({ name: 'Alice A.', role: 'owner', avatar: up.data.avatar, status });
  });
});
