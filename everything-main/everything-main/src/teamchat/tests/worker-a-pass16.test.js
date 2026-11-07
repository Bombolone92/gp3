/**
 * Identity, membership, notification and invite routes: what the sixteenth
 * review pass found.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import { dmConvId } from '../src/shared/ids.js';

const { alice, bob, carol } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

/**
 * Run `then` once around the first store operation `op` on `key` whose
 * argument has an own property `path` — after it lands (default), or before
 * it (`before: true`). Returns a function that restores the store.
 */
function hookOnce(op, key, path, then, { before = false } = {}) {
  const orig = rt.kv[op];
  let fired = false;
  rt.kv[op] = async (k, arg) => {
    const hit = !fired && k === key && arg && typeof arg === 'object' && Object.hasOwn(arg, path);
    if (hit) fired = true;
    if (hit && before) await then();
    const res = await orig(k, arg);
    if (hit && !before) await then();
    return res;
  };
  return () => { rt.kv[op] = orig; };
}

const counts = async (wsId, ch) => {
  const c = (await rt.kv.get(KEYS.ws(wsId))).channels[ch];
  return { count: c.count, guests: c.guests || 0 };
};

describe('a member made a guest, or a guest a member, in the instant they leave a channel', () => {
  it('a member made a guest as they leave is counted out of its guests once they are one, and the channel counts no guest', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${open}/join`)).ok).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 2, guests: 0 });
    let left = null;
    // The role is on his document, not yet on his card, when his leave runs.
    const restore = hookOnce('update', KEYS.member(wsId, bob.uuid), 'role', async () => { left = await as(bob).post(`/api/ws/${wsId}/channels/${open}/leave`); });
    try {
      expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'guest' })).ok).toBe(true);
    } finally {
      restore();
    }
    expect(left.ok).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 1, guests: 0 });
    expect(await counts(wsId, general.id)).toEqual({ count: 2, guests: 1 });
    expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid].role).toBe('guest');
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).channels).toEqual([general.id]);
  });

  it('a guest made a member by the workspace link as they leave a channel is counted as a guest nowhere, and no channel counts fewer than none', async () => {
    const { wsId, general } = await workspaceWith(alice, []);
    const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    const other = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'other' })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${open}/invites`, {});
    expect((await as(bob).post('/api/join', { code: inv.data.code })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${other}/members`, { uuids: [bob.uuid] })).data.added).toEqual([bob.uuid]);
    expect(await counts(wsId, open)).toEqual({ count: 2, guests: 1 });
    expect(await counts(wsId, other)).toEqual({ count: 2, guests: 1 });
    const code = (await as(alice).get(`/api/ws/${wsId}`)).data.workspace.invite;
    let left = null;
    const restore = hookOnce('update', KEYS.member(wsId, bob.uuid), 'role', async () => { left = await as(bob).post(`/api/ws/${wsId}/channels/${open}/leave`); });
    let promoted;
    try {
      promoted = await as(bob).post('/api/join', { code });
    } finally {
      restore();
    }
    expect(promoted.data.promoted).toBe(true);
    expect(left.ok).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 1, guests: 0 });
    expect(await counts(wsId, other)).toEqual({ count: 2, guests: 0 });
    expect(await counts(wsId, general.id)).toEqual({ count: 2, guests: 0 });
    const doc = await rt.kv.get(KEYS.member(wsId, bob.uuid));
    expect([...doc.channels].sort()).toEqual([other, general.id].sort());
  });

  it('a guest made a member by an admin as they leave a channel is counted as a guest nowhere', async () => {
    const { wsId, general } = await workspaceWith(alice, []);
    const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    const other = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'other' })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${open}/invites`, {});
    expect((await as(bob).post('/api/join', { code: inv.data.code })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${other}/members`, { uuids: [bob.uuid] })).data.added).toEqual([bob.uuid]);
    let left = null;
    const restore = hookOnce('update', KEYS.member(wsId, bob.uuid), 'role', async () => { left = await as(bob).post(`/api/ws/${wsId}/channels/${open}/leave`); });
    try {
      expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'member' })).ok).toBe(true);
    } finally {
      restore();
    }
    expect(left.ok).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 1, guests: 0 });
    expect(await counts(wsId, other)).toEqual({ count: 2, guests: 0 });
    expect(await counts(wsId, general.id)).toEqual({ count: 2, guests: 0 });
  });

  it('a plain leave, with no role change in flight, still counts a guest out of the guests and a member out of the members alone', async () => {
    const { wsId } = await workspaceWith(alice, [carol]);
    const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${open}/invites`, {});
    expect((await as(bob).post('/api/join', { code: inv.data.code })).ok).toBe(true);
    expect((await as(carol).post(`/api/ws/${wsId}/channels/${open}/join`)).ok).toBe(true);
    // Bob (a guest of #open alone) is added to a second channel so he may leave the first.
    const other = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'other' })).data.channel.id;
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${other}/members`, { uuids: [bob.uuid] })).data.added).toEqual([bob.uuid]);
    expect(await counts(wsId, open)).toEqual({ count: 3, guests: 1 });
    expect((await as(carol).post(`/api/ws/${wsId}/channels/${open}/leave`)).ok).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 2, guests: 1 });
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${open}/leave`)).ok).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 1, guests: 0 });
  });
});

describe('a member handed the link of a private channel in the instant they are removed', () => {
  it('leaves no name of theirs on the channel\'s list, and the count as it was', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    const link = (await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, {})).data.code;
    let removed = null;
    // The removal runs whole once bob's join has put #secret on his document and before it counts him in: the
    // count's answer then hands back no card of his, and the list must not have taken his name meanwhile.
    const restore = hookOnce('add', KEYS.member(wsId, bob.uuid), 'channels', async () => { removed = await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`); });
    let join;
    try {
      join = await as(bob).post('/api/join', { code: link });
    } finally {
      restore();
    }
    expect(removed.ok).toBe(true);
    expect(join.status).toBe(409);
    expect(join.data.code).toBe('retry');
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.channels[secret].members).toEqual([alice.uuid]);
    expect(ws.channels[secret].count).toBe(1);
    expect(ws.channels[general.id].count).toBe(1);
    expect(ws.members[bob.uuid]).toBeUndefined();
    expect(await rt.kv.get(KEYS.member(wsId, bob.uuid))).toBeFalsy();
    const lines = (await as(alice).get(`/api/ws/${wsId}/conv/${secret}/messages`)).data.messages.map((m) => m.text);
    expect(lines.filter((t) => t === 'bob joined').length).toBe(0);
    // An admin sees no orphan: the channel still has its maker on its list.
    const boot = await as(alice).get(`/api/ws/${wsId}`);
    expect(boot.data.workspace.channels[secret].orphan).toBeUndefined();
  });

  it('puts a member handed the link of a private channel on its list when nothing is in the way', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    const link = (await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, {})).data.code;
    const join = await as(bob).post('/api/join', { code: link });
    expect(join.ok).toBe(true);
    expect(join.data.joined).toBe(true);
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect([...ws.channels[secret].members].sort()).toEqual([alice.uuid, bob.uuid].sort());
    expect(ws.channels[secret].count).toBe(2);
  });
});

describe('a newcomer removed in the instant they join', () => {
  const SERVER = 'teamchat-api.test';
  /** Bob out, nothing of his left, #general counting alice alone, no line of his. */
  async function settled(wsId, general) {
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.members[bob.uuid]).toBeUndefined();
    expect(ws.channels[general.id].count).toBe(1);
    expect(ws.channels[general.id].guests || 0).toBe(0);
    expect(await rt.kv.get(KEYS.member(wsId, bob.uuid))).toBeFalsy();
    const p = await rt.kv.get(KEYS.user(bob.uuid));
    expect(p?.workspaces || []).not.toContain(wsId);
    const lines = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.map((m) => m.text);
    expect(lines.filter((t) => /bob joined/.test(t)).length).toBe(0);
    expect((await as(bob).get(`/api/ws/${wsId}`)).status).toBe(403);
  }

  it('by a removal running whole once the card is written leaves the count as it was, and no document behind', async () => {
    const { wsId, general, code } = await workspaceWith(alice, []);
    let removed = null;
    const restore = hookOnce('update', KEYS.ws(wsId), `members.${bob.uuid}`, async () => { removed = await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`); });
    let join;
    try {
      join = await as(bob).post('/api/join', { code });
    } finally {
      restore();
    }
    expect(removed.ok).toBe(true);
    expect(join.status).toBe(409);
    expect(join.data.code).toBe('retry');
    await settled(wsId, general);
    // The link still holds: opened again, it joins them.
    expect((await as(bob).post('/api/join', { code })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[general.id].count).toBe(2);
  });

  it('by a removal landing between the append and the count is told to try again, the count right on both sides', async () => {
    const { wsId, general, code } = await workspaceWith(alice, []);
    let removed = null;
    const restore = hookOnce('add', KEYS.member(wsId, bob.uuid), 'channels', async () => { removed = await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`); });
    let join;
    try {
      join = await as(bob).post('/api/join', { code });
    } finally {
      restore();
    }
    expect(removed.ok).toBe(true);
    expect(join.status).toBe(409);
    await settled(wsId, general);
  });

  it('a guest newcomer removed as they join leaves no name on the private channel\'s list, and no guest counted', async () => {
    const { wsId, general } = await workspaceWith(alice, []);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    const link = (await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, {})).data.code;
    for (const at of ['card', 'append']) {
      let removed = null;
      const restore = at === 'card'
        ? hookOnce('update', KEYS.ws(wsId), `members.${bob.uuid}`, async () => { removed = await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`); })
        : hookOnce('add', KEYS.member(wsId, bob.uuid), 'channels', async () => { removed = await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`); });
      let join;
      try {
        join = await as(bob).post('/api/join', { code: link });
      } finally {
        restore();
      }
      expect(removed.ok, at).toBe(true);
      expect(join.status, at).toBe(409);
      const ws = await rt.kv.get(KEYS.ws(wsId));
      expect(ws.channels[secret].members, at).toEqual([alice.uuid]);
      expect(ws.channels[secret].count, at).toBe(1);
      expect(ws.channels[secret].guests || 0, at).toBe(0);
      await settled(wsId, general);
    }
  });

  it('someone from a connected workspace accepting the workspace invite as an admin removes them is told to try again, and left no member\'s card', async () => {
    const acme = await workspaceWith(alice, [carol], 'Acme');
    const globex = await workspaceWith(alice, [bob], 'Globex');
    expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const design = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'design' })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`, {});
    const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' } });
    const added = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, { ref: `${acme.wsId}@${SERVER}`, ch: design, conn: acc.data.conn, secret: acc.data.secret, name: 'design-with-acme', host: 'Acme' });
    const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${added.data.channel.id}/attest`, {});
    expect((await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(acme.wsId))).members[bob.uuid].role).toBe('external');
    let removed = null;
    // Alice removes bob from Acme once his acceptance of Acme's own invite has written him a member's card.
    const restore = hookOnce('update', KEYS.ws(acme.wsId), `members.${bob.uuid}`, async () => { removed = await as(alice).del(`/api/ws/${acme.wsId}/members/${bob.uuid}`); });
    let join;
    try {
      join = await as(bob).post('/api/join', { code: acme.code });
    } finally {
      restore();
    }
    expect(removed.ok).toBe(true);
    expect(join.status).toBe(409);
    const ws = await rt.kv.get(KEYS.ws(acme.wsId));
    expect(ws.members[bob.uuid]).toBeUndefined();
    expect(ws.channels[acme.general.id].count).toBe(2);
    expect(ws.channels[design].count).toBe(1);
    expect(await rt.kv.get(KEYS.member(acme.wsId, bob.uuid))).toBeFalsy();
  });
});

describe('a reminder delivered twice', () => {
  const self = (wsId) => dmConvId([alice.uuid], wsId);
  const lines = async (wsId) => (await as(alice).get(`/api/ws/${wsId}/conv/${self(wsId)}/messages`)).data.messages.filter((x) => /Reminder/.test(x.text));
  const entries = async (wsId) => (await as(alice).get(`/api/ws/${wsId}/inbox`)).data.items.filter((e) => e.k === 'reminder');
  async function remind(wsId, general) {
    const m = await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'remember me' });
    const base = Math.floor(Date.now() / 60_000) * 60_000 + 22_000;
    const r = await as(alice).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: m.data.message.seq, dueAt: base + 120_000, note: 'call' });
    expect(r.ok).toBe(true);
    await rt.kv.update(KEYS.sched(wsId), { [`m.${r.data.reminder.id}.dueAt`]: Date.now() - 1000 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1000 });
    return r.data.reminder;
  }

  it('by a delivery that died after writing the line and by the poll that took it over reminds once, in the conversation and in Activity', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const entry = await remind(wsId, general);
    // The poll writes the line and the Activity entry, then dies before taking the entry off the queue.
    const orig = rt.kv.remove;
    rt.kv.remove = async (k, ...paths) => {
      if (k === KEYS.sched(wsId) && paths.flat().includes(`m.${entry.id}`)) throw new Error('worker died');
      return orig(k, ...paths);
    };
    try {
      expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    } finally {
      rt.kv.remove = orig;
    }
    expect((await rt.kv.get(KEYS.sched(wsId))).m[entry.id]).toBeTruthy();
    expect((await lines(wsId)).length).toBe(1);
    // The claim goes stale; the next poll takes the entry over.
    await rt.kv.update(KEYS.sched(wsId), { [`m.${entry.id}.claimedAt`]: Date.now() - 6 * 60_000 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1000 });
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.sched(wsId))).m[entry.id]).toBeFalsy();
    const got = await lines(wsId);
    expect(got.length).toBe(1);
    expect(got[0].cid).toBe(entry.id);
    expect((await entries(wsId)).length).toBe(1);
  });

  it('by the copy of a moved workspace, whose queue still carries an entry the old copy delivered, reminds once more in Activity and not in the conversation', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const entry = await remind(wsId, general);
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect((await lines(wsId)).length).toBe(1);
    expect((await entries(wsId)).length).toBe(1);
    // The entry comes back with the queue, as an import writes it, and is due.
    await rt.kv.update(KEYS.sched(wsId), { [`m.${entry.id}`]: { ...entry, dueAt: Date.now() - 1000 } });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1000 });
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.sched(wsId))).m[entry.id]).toBeFalsy();
    expect((await lines(wsId)).length).toBe(1);
    expect((await entries(wsId)).length).toBe(1);
  });

  it('two reminders about one message, due together, are two lines and two entries', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'remember me' });
    const base = Math.floor(Date.now() / 60_000) * 60_000 + 22_000;
    const r1 = await as(alice).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: m.data.message.seq, dueAt: base + 120_000, note: 'one' });
    const r2 = await as(alice).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: m.data.message.seq, dueAt: base + 180_000, note: 'two' });
    expect(r1.ok && r2.ok).toBe(true);
    await rt.kv.update(KEYS.sched(wsId), { [`m.${r1.data.reminder.id}.dueAt`]: Date.now() - 1000, [`m.${r2.data.reminder.id}.dueAt`]: Date.now() - 1000 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1000 });
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect((await lines(wsId)).map((x) => x.text).sort()).toEqual(['Reminder: one', 'Reminder: two']);
    expect((await entries(wsId)).length).toBe(2);
  });
});

describe('the push key of a fresh worker', () => {
  it('is one pair for two devices asking at once, the pair that signs', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const [a, b] = await Promise.all([as(alice).get(`/api/ws/${wsId}/push/key`), as(bob).get(`/api/ws/${wsId}/push/key`)]);
    expect(a.ok && b.ok).toBe(true);
    const cfg = await rt.kv.get('tc:config');
    expect(cfg.vapid.pub).toBeTruthy();
    expect(a.data.key).toBe(cfg.vapid.pub);
    expect(b.data.key).toBe(cfg.vapid.pub);
    // Asked again, the same pair.
    expect((await as(carol).get(`/api/ws/${wsId}/push/key`)).status).toBe(403);
    expect((await as(alice).get(`/api/ws/${wsId}/push/key`)).data.key).toBe(cfg.vapid.pub);
  });

  it('is made by a later caller when the one that claimed it never wrote it', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    // A claim taken and abandoned (a request cut short between the claim and the write).
    await rt.kv.incr('tc:config', { vapidClaim: 1 });
    const a = await as(alice).get(`/api/ws/${wsId}/push/key`);
    expect(a.ok).toBe(true);
    const cfg = await rt.kv.get('tc:config');
    expect(a.data.key).toBe(cfg.vapid.pub);
  });
});

describe('a member removed in the instant an admin changes their role', () => {
  async function setup() {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    expect((await as(alice).post(`/api/ws/${wsId}/members/${carol.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${open}/join`)).ok).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 2, guests: 0 });
    return { wsId, general, open };
  }
  /** Bob out, nothing of his left behind, and no channel counting a guest. */
  async function settled(wsId, general, open) {
    expect(await counts(wsId, open)).toEqual({ count: 1, guests: 0 });
    expect(await counts(wsId, general.id)).toEqual({ count: 2, guests: 0 });
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.members[bob.uuid]).toBeUndefined();
    expect(await rt.kv.get(KEYS.member(wsId, bob.uuid))).toBeFalsy();
    expect((await as(bob).get(`/api/ws/${wsId}`)).status).toBe(403);
  }
  const demote = (wsId) => as(carol).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'guest' });
  const remove = (wsId) => as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`);

  it('a role written once his document is closed is refused, and counts him a guest nowhere', async () => {
    const { wsId, general, open } = await setup();
    let role = null;
    const restore = hookOnce('update', KEYS.member(wsId, bob.uuid), 'gone', async () => { role = await demote(wsId); });
    try {
      expect((await remove(wsId)).ok).toBe(true);
    } finally {
      restore();
    }
    expect(role.status).toBe(404);
    await settled(wsId, general, open);
  });

  it('a removal that read his card before the role change counts him out as what he is now', async () => {
    const { wsId, general, open } = await setup();
    let role = null;
    const restore = hookOnce('update', KEYS.member(wsId, bob.uuid), 'gone', async () => { role = await demote(wsId); }, { before: true });
    try {
      expect((await remove(wsId)).ok).toBe(true);
    } finally {
      restore();
    }
    expect(role.ok).toBe(true);
    await settled(wsId, general, open);
  });

  it('a removal that runs whole between the role landing on his document and on his card leaves the counts even', async () => {
    const { wsId, general, open } = await setup();
    let removed = null;
    const restore = hookOnce('update', KEYS.member(wsId, bob.uuid), 'role', async () => { removed = await remove(wsId); });
    let role;
    try {
      role = await demote(wsId);
    } finally {
      restore();
    }
    expect(removed.ok).toBe(true);
    expect(role.status).toBe(404);
    await settled(wsId, general, open);
  });

  it('a guest removed as they accept the workspace invite is told to try again, and counted as a guest nowhere, in either order', async () => {
    for (const order of ['closing-first', 'role-first']) {
      rt = await boot();
      const { wsId, general } = await workspaceWith(alice, []);
      const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
      const inv = await as(alice).post(`/api/ws/${wsId}/channels/${open}/invites`, {});
      expect((await as(bob).post('/api/join', { code: inv.data.code })).ok).toBe(true);
      expect(await counts(wsId, open)).toEqual({ count: 2, guests: 1 });
      const code = (await as(alice).get(`/api/ws/${wsId}`)).data.workspace.invite;
      const join = () => as(bob).post('/api/join', { code });
      let other = null;
      const restore = order === 'closing-first'
        ? hookOnce('update', KEYS.member(wsId, bob.uuid), 'gone', async () => { other = await join(); })
        : hookOnce('update', KEYS.member(wsId, bob.uuid), 'role', async () => { other = await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`); });
      let first;
      try {
        first = await (order === 'closing-first' ? as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`) : join());
      } finally {
        restore();
      }
      const joined = order === 'closing-first' ? other : first;
      const removal = order === 'closing-first' ? first : other;
      expect(removal.ok).toBe(true);
      expect(joined.status).toBe(409);
      expect(joined.data.code).toBe('retry');
      expect(await counts(wsId, open)).toEqual({ count: 1, guests: 0 });
      expect(await counts(wsId, general.id)).toEqual({ count: 1, guests: 0 });
      const ws = await rt.kv.get(KEYS.ws(wsId));
      expect(ws.members[bob.uuid]).toBeUndefined();
      expect(await rt.kv.get(KEYS.member(wsId, bob.uuid))).toBeFalsy();
    }
  });

  it('a guest made a member whose removal closes the document once the role is on the card, before the defaults are entered, is a guest nowhere', async () => {
    for (const via of ['role', 'link']) {
      rt = await boot();
      const { wsId, general } = await workspaceWith(alice, [carol]);
      expect((await as(alice).post(`/api/ws/${wsId}/members/${carol.uuid}/role`, { role: 'admin' })).ok).toBe(true);
      const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
      const link = (await as(alice).post(`/api/ws/${wsId}/channels/${open}/invites`, {})).data.code;
      expect((await as(bob).post('/api/join', { code: link })).ok).toBe(true);
      expect(await counts(wsId, open)).toEqual({ count: 2, guests: 1 });
      const code = (await as(alice).get(`/api/ws/${wsId}`)).data.workspace.invite;
      let removed = null;
      // The removal runs whole once the role is on his card and before his promotion enters him into #general.
      const restore = hookOnce('update', KEYS.ws(wsId), `members.${bob.uuid}.role`, async () => { removed = await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`); });
      let promote;
      try {
        promote = via === 'role' ? await as(carol).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'member' }) : await as(bob).post('/api/join', { code });
      } finally {
        restore();
      }
      expect(removed.ok).toBe(true);
      expect(promote.ok).toBe(true);
      expect(await counts(wsId, open), via).toEqual({ count: 1, guests: 0 });
      expect(await counts(wsId, general.id), via).toEqual({ count: 2, guests: 0 });
      const ws = await rt.kv.get(KEYS.ws(wsId));
      expect(ws.members[bob.uuid]).toBeUndefined();
      expect(await rt.kv.get(KEYS.member(wsId, bob.uuid))).toBeFalsy();
      expect((await as(bob).get(`/api/ws/${wsId}`)).status).toBe(403);
    }
  });

  it('a member leaving a channel in the instant they are removed is counted out of it once', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${open}/join`)).ok).toBe(true);
    expect((await as(carol).post(`/api/ws/${wsId}/channels/${open}/join`)).ok).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 3, guests: 0 });
    let left = null;
    // His leave lands once the removal has closed his document, which still carries #open.
    const restore = hookOnce('update', KEYS.member(wsId, bob.uuid), 'gone', async () => { left = await as(bob).post(`/api/ws/${wsId}/channels/${open}/leave`); });
    try {
      expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    } finally {
      restore();
    }
    expect(left.ok).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 2, guests: 0 });
    expect(await counts(wsId, general.id)).toEqual({ count: 2, guests: 0 });
    expect(await rt.kv.get(KEYS.member(wsId, bob.uuid))).toBeFalsy();
    const lines = (await as(alice).get(`/api/ws/${wsId}/conv/${open}/messages`)).data.messages.map((m) => m.text);
    expect(lines.filter((t) => t === 'bob left').length).toBe(0);
  });

  it('a guest leaving a private channel in the instant they are removed is counted out once, and comes off its list once', async () => {
    const { wsId } = await workspaceWith(alice, [carol]);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    const other = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'other', private: true })).data.channel.id;
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [carol.uuid] })).data.added).toEqual([carol.uuid]);
    const link = (await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, {})).data.code;
    expect((await as(bob).post('/api/join', { code: link })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${other}/members`, { uuids: [bob.uuid] })).data.added).toEqual([bob.uuid]);
    expect(await counts(wsId, secret)).toEqual({ count: 3, guests: 1 });
    let left = null;
    const restore = hookOnce('update', KEYS.member(wsId, bob.uuid), 'gone', async () => { left = await as(bob).post(`/api/ws/${wsId}/channels/${secret}/leave`); });
    try {
      expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    } finally {
      restore();
    }
    expect(left.ok).toBe(true);
    expect(await counts(wsId, secret)).toEqual({ count: 2, guests: 0 });
    expect(await counts(wsId, other)).toEqual({ count: 1, guests: 0 });
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[secret].members.sort()).toEqual([alice.uuid, carol.uuid].sort());
    expect(await rt.kv.get(KEYS.member(wsId, bob.uuid))).toBeFalsy();
  });

  it('a leave whose write a store answers with true, the document deleted by the removal before it is read again, counts nothing', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${open}/join`)).ok).toBe(true);
    expect((await as(carol).post(`/api/ws/${wsId}/channels/${open}/join`)).ok).toBe(true);
    const key = KEYS.member(wsId, bob.uuid);
    let left = null;
    const restore = hookOnce('update', key, 'gone', async () => {
      // Inside the removal, after its closing: bob's leave, on a store whose
      // update answers true, the removal's deletion of his document landing
      // before the leave reads it again.
      const orig = rt.kv.update;
      const origDel = rt.kv.del;
      rt.kv.update = async (k, arg) => {
        const res = await orig(k, arg);
        if (k === key && arg && Object.hasOwn(arg, 'channels')) {
          await origDel.call(rt.kv, key);
          return true;
        }
        return res;
      };
      try {
        left = await as(bob).post(`/api/ws/${wsId}/channels/${open}/leave`);
      } finally {
        rt.kv.update = orig;
      }
    });
    try {
      expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    } finally {
      restore();
    }
    expect(left.ok).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 2, guests: 0 });
    expect(await counts(wsId, general.id)).toEqual({ count: 2, guests: 0 });
    expect(await rt.kv.get(key)).toBeFalsy();
  });

  it('a leave whose write lands after the removal has run to its end leaves no document of the channels alone, and counts nothing', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${open}/join`)).ok).toBe(true);
    expect((await as(carol).post(`/api/ws/${wsId}/channels/${open}/join`)).ok).toBe(true);
    const key = KEYS.member(wsId, bob.uuid);
    let removed = null;
    // The removal runs whole between the leave's reading of bob's document and its write of the channel list.
    const restore = hookOnce('update', key, 'channels', async () => { removed = await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`); }, { before: true });
    let left;
    try {
      left = await as(bob).post(`/api/ws/${wsId}/channels/${open}/leave`);
    } finally {
      restore();
    }
    expect(removed.ok).toBe(true);
    expect(left.ok).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 2, guests: 0 });
    expect(await counts(wsId, general.id)).toEqual({ count: 2, guests: 0 });
    expect(await rt.kv.get(key)).toBeFalsy();
    const lines = (await as(alice).get(`/api/ws/${wsId}/conv/${open}/messages`)).data.messages.map((m) => m.text);
    expect(lines.filter((t) => t === 'bob left').length).toBe(0);
  });

  it('a member whose document is from before joining times were kept still leaves as before', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${open}/join`)).ok).toBe(true);
    const key = KEYS.member(wsId, bob.uuid);
    await rt.kv.remove(key, 'joinedAt');
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${open}/leave`)).ok).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 1, guests: 0 });
    const doc = await rt.kv.get(key);
    expect(doc.channels).not.toContain(open);
    expect(doc.dms).toBeTruthy();
    const lines = (await as(alice).get(`/api/ws/${wsId}/conv/${open}/messages`)).data.messages.map((m) => m.text);
    expect(lines.filter((t) => t === 'bob left').length).toBe(1);
  });

  it('a leave whose write a store answers with true, and whose reading again fails, counts by the card as before', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${open}/join`)).ok).toBe(true);
    const key = KEYS.member(wsId, bob.uuid);
    const origUpdate = rt.kv.update;
    const origGet = rt.kv.get;
    let written = false;
    rt.kv.update = async (k, arg) => {
      const res = await origUpdate(k, arg);
      if (k === key && arg && Object.hasOwn(arg, 'channels')) { written = true; return true; }
      return res;
    };
    rt.kv.get = async (k) => {
      if (written && k === key) { written = false; throw new Error('store hiccup'); }
      return origGet(k);
    };
    let left;
    try {
      left = await as(bob).post(`/api/ws/${wsId}/channels/${open}/leave`);
    } finally {
      rt.kv.update = origUpdate;
      rt.kv.get = origGet;
    }
    expect(left.ok).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 1, guests: 0 });
    expect((await rt.kv.get(key)).channels).not.toContain(open);
  });

  it('a leave that lands before the removal closes the document is counted by the leave alone, as before', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${open}/join`)).ok).toBe(true);
    expect((await as(carol).post(`/api/ws/${wsId}/channels/${open}/join`)).ok).toBe(true);
    let left = null;
    const restore = hookOnce('update', KEYS.member(wsId, bob.uuid), 'gone', async () => { left = await as(bob).post(`/api/ws/${wsId}/channels/${open}/leave`); }, { before: true });
    try {
      expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    } finally {
      restore();
    }
    expect(left.ok).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 2, guests: 0 });
    expect(await counts(wsId, general.id)).toEqual({ count: 2, guests: 0 });
    const lines = (await as(alice).get(`/api/ws/${wsId}/conv/${open}/messages`)).data.messages.map((m) => m.text);
    expect(lines.filter((t) => t === 'bob left').length).toBe(1);
  });

  it('a removal with no role change in flight still counts a guest out of the guests, and a member out of the members alone', async () => {
    const { wsId, general, open } = await setup();
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${open}/invites`, {});
    const dave = USERS.dave;
    expect((await as(dave).post('/api/join', { code: inv.data.code })).ok).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 3, guests: 1 });
    expect((await as(alice).del(`/api/ws/${wsId}/members/${dave.uuid}`)).ok).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 2, guests: 0 });
    expect((await remove(wsId)).ok).toBe(true);
    await settled(wsId, general, open);
  });
});
