/**
 * Identity, membership, notification and invite routes: what the seventeenth
 * review pass found.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';

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

describe('the next due time when something is scheduled', () => {
  const nd = async (wsId) => (await rt.kv.get(KEYS.activity(wsId))).nd;

  it('is not raised past an entry that came due a moment ago, which the next poll then delivers', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    // Bob's message came due half a minute ago (the route admits a minute of leeway); no poll has run since.
    const due = Date.now() - 30_000;
    expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'overdue', dueAt: due })).ok).toBe(true);
    expect(await nd(wsId)).toBe(due);
    const later = Date.now() + 86400_000;
    expect((await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'tomorrow', dueAt: later })).ok).toBe(true);
    expect(await nd(wsId)).toBe(due);
    // The next poll finds something due, delivers bob's message, and the next due time is alice's.
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    const msgs = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages;
    expect(msgs.some((m) => m.text === 'overdue' && m.user === bob.uuid)).toBe(true);
    expect(await nd(wsId)).toBe(later);
  });

  it('settles on the earlier of two entries scheduled in the same instant, whichever write lands last', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const soon = Date.now() + 3600_000;
    const later = soon + 3600_000;
    // Alice's later entry has read the next due time (none) and is about to write it when bob's earlier entry lands whole.
    const restore = hookOnce('update', KEYS.activity(wsId), 'nd', async () => {
      expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'soon', dueAt: soon })).ok).toBe(true);
    }, { before: true });
    try {
      expect((await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt: later })).ok).toBe(true);
    } finally {
      restore();
    }
    expect(await nd(wsId)).toBe(soon);
  });

  it('is lowered for a reminder as for a message, and left where an earlier entry already holds it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const seq = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'remind me' })).data.message.seq;
    const t1 = Date.now() + 7200_000;
    const t2 = t1 - 3600_000;
    expect((await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt: t1 })).ok).toBe(true);
    expect(await nd(wsId)).toBe(t1);
    expect((await as(carol).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq, dueAt: t2 })).ok).toBe(true);
    expect(await nd(wsId)).toBe(t2);
    expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'latest', dueAt: t1 + 60_000 })).ok).toBe(true);
    expect(await nd(wsId)).toBe(t2);
  });
});

describe('a guest made a member twice in the same instant', () => {
  const counts = async (wsId, ch) => {
    const c = (await rt.kv.get(KEYS.ws(wsId))).channels[ch];
    return { count: c.count, guests: c.guests || 0 };
  };
  /** Bob, a guest of #secret whom an admin has also put into #general: in every default channel already. */
  async function guestInDefaults() {
    const { wsId, general, code } = await workspaceWith(alice, []);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, {});
    expect((await as(bob).post('/api/join', { code: inv.data.code })).data.guest).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${general.id}/members`, { uuids: [bob.uuid] })).data.added).toEqual([bob.uuid]);
    expect(await counts(wsId, secret)).toEqual({ count: 2, guests: 1 });
    expect(await counts(wsId, general.id)).toEqual({ count: 2, guests: 1 });
    return { wsId, general, code, secret };
  }

  it('is counted out of the guests of each of their channels once, not twice, when the workspace invite is accepted from two tabs', async () => {
    const { wsId, general, code, secret } = await guestInDefaults();
    let second = null;
    // The first tab's promotion has the role on his document and is about to write his card when the second tab's runs whole.
    const restore = hookOnce('update', KEYS.ws(wsId), `members.${bob.uuid}.role`, async () => {
      second = await as(bob).post('/api/join', { code });
    }, { before: true });
    let first;
    try {
      first = await as(bob).post('/api/join', { code });
    } finally {
      restore();
    }
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid].role).toBe('member');
    expect(await counts(wsId, secret)).toEqual({ count: 2, guests: 0 });
    expect(await counts(wsId, general.id)).toEqual({ count: 2, guests: 0 });
    // In every default channel already, they land in none, and no line says they joined one.
    const lines = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages;
    expect(lines.filter((m) => m.kind === 'sys' && /joined$/.test(m.text) && m.user === bob.uuid)).toHaveLength(0);
    // A guest who comes to #general after that is announced as one, as the notice depends on the count.
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, {});
    expect((await as(carol).post('/api/join', { code: inv.data.code })).data.guest).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${general.id}/members`, { uuids: [carol.uuid] })).data.added).toEqual([carol.uuid]);
    expect(await counts(wsId, general.id)).toEqual({ count: 3, guests: 1 });
  });

  it('is counted out again after being made a guest once more and then a member again', async () => {
    const { wsId, general, secret } = await guestInDefaults();
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'member' })).ok).toBe(true);
    expect(await counts(wsId, general.id)).toEqual({ count: 2, guests: 0 });
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'guest' })).ok).toBe(true);
    expect(await counts(wsId, general.id)).toEqual({ count: 2, guests: 1 });
    expect(await counts(wsId, secret)).toEqual({ count: 2, guests: 1 });
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    expect(await counts(wsId, general.id)).toEqual({ count: 2, guests: 0 });
    expect(await counts(wsId, secret)).toEqual({ count: 2, guests: 0 });
  });
});

describe('an invite link opened in two tabs at once by someone whose list already names the workspace', () => {
  it('counts them into the default channel once, with one "joined" line', async () => {
    const { wsId, general, code } = await workspaceWith(alice, []);
    // A join of bob's cut short after it took the workspace's place in his list and before it wrote his card.
    expect((await as(bob).get('/api/me')).ok).toBe(true);
    await rt.kv.update(KEYS.user(bob.uuid), { workspaces: [wsId] });
    let second = null;
    // Both tabs have read the workspace without his card; the second's join runs whole before the first writes the card.
    const restore = hookOnce('update', KEYS.ws(wsId), `members.${bob.uuid}`, async () => {
      second = await as(bob).post('/api/join', { code });
    }, { before: true });
    let first;
    try {
      first = await as(bob).post('/api/join', { code });
    } finally {
      restore();
    }
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.members[bob.uuid].role).toBe('member');
    expect(ws.channels[general.id].count).toBe(2);
    const doc = await rt.kv.get(KEYS.member(wsId, bob.uuid));
    expect(doc.channels).toEqual([general.id]);
    const msgs = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages;
    expect(msgs.filter((m) => m.kind === 'sys' && /joined/.test(m.text) && m.user === bob.uuid)).toHaveLength(1);
    expect((await rt.kv.get(KEYS.user(bob.uuid))).workspaces).toEqual([wsId]);
  });

  it('counts them once when both tabs read no document and the slower one writes its document after the faster has appended', async () => {
    const { wsId, general, code } = await workspaceWith(alice, []);
    expect((await as(bob).get('/api/me')).ok).toBe(true);
    await rt.kv.update(KEYS.user(bob.uuid), { workspaces: [wsId] });
    // Both tabs have read bob's document (none). The second tab's write of
    // the document is held until the first tab's append of #general has
    // landed, as a store with latency lags one request by a few steps.
    const key = KEYS.member(wsId, bob.uuid);
    const origUpdate = rt.kv.update;
    const origAdd = rt.kv.add;
    let docWrites = 0;
    let release;
    const appended = new Promise((r) => { release = r; });
    rt.kv.update = async (k, arg) => {
      if (k === key && arg && typeof arg === 'object' && Object.hasOwn(arg, 'joinedAt') && ++docWrites === 2) await appended;
      return origUpdate(k, arg);
    };
    rt.kv.add = async (k, arg) => {
      const res = await origAdd(k, arg);
      if (k === key && arg && typeof arg === 'object' && Object.hasOwn(arg, 'channels')) release();
      return res;
    };
    let a;
    let b;
    try {
      [a, b] = await Promise.all([as(bob).post('/api/join', { code }), as(bob).post('/api/join', { code })]);
    } finally {
      rt.kv.update = origUpdate;
      rt.kv.add = origAdd;
    }
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.channels[general.id].count).toBe(2);
    const doc = await rt.kv.get(KEYS.member(wsId, bob.uuid));
    expect(doc.channels).toEqual([general.id]);
    expect(doc.joinedAt).toBeGreaterThan(0);
    const msgs = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages;
    expect(msgs.filter((m) => m.kind === 'sys' && /joined/.test(m.text) && m.user === bob.uuid)).toHaveLength(1);
  });

  it('joining again after a removal that died with the closed document left behind starts from no channels, counted in afresh', async () => {
    const { wsId, general, code } = await workspaceWith(alice, [bob]);
    const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${open}/join`)).ok).toBe(true);
    // Alice's removal of bob dies after taking his card and before deleting his closed document.
    const key = KEYS.member(wsId, bob.uuid);
    const origDel = rt.kv.del;
    rt.kv.del = async (k) => {
      if (k === key) throw new Error('store down');
      return origDel(k);
    };
    let removed;
    try {
      removed = await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`);
    } finally {
      rt.kv.del = origDel;
    }
    expect(removed.status).toBe(500);
    let ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.members[bob.uuid]).toBeUndefined();
    expect(ws.channels[general.id].count).toBe(1);
    expect(ws.channels[open].count).toBe(1);
    const left = await rt.kv.get(key);
    expect(left.channels).toEqual([general.id, open]);
    // Long after: the stamp of the dead removal is no longer a closing.
    await rt.kv.update(key, { gone: Date.now() - 6 * 60_000 });
    const join = await as(bob).post('/api/join', { code });
    expect(join.ok).toBe(true);
    ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.members[bob.uuid].role).toBe('member');
    expect(ws.channels[general.id].count).toBe(2);
    expect(ws.channels[open].count).toBe(1);
    expect((await rt.kv.get(key)).channels).toEqual([general.id]);
  });
});

describe('marking a conversation unread', () => {
  it('moves the member\'s own stamp, so their other devices fetch the cursor moved back', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    for (const t of ['one', 'two', 'three']) expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: t })).ok).toBe(true);
    const seq = (await rt.kv.get(KEYS.seq(general.id))) || 0;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq })).ok).toBe(true);
    const before = (await rt.kv.get(KEYS.activity(wsId))).u?.[bob.uuid] || 0;
    const back = await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: seq - 2, back: true });
    expect(back.ok).toBe(true);
    expect(back.data.seq).toBe(seq - 2);
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).reads[general.id]).toBe(seq - 2);
    const after = (await rt.kv.get(KEYS.activity(wsId))).u?.[bob.uuid] || 0;
    expect(after).toBeGreaterThan(before);
    // The poll of another tab of his, from before, is told his own state moved.
    const poll = await as(bob).get(`/api/ws/${wsId}/sync?since=0`);
    expect(poll.data.u).toBe(after);
    // A plain read forward still pokes nobody (a poke per message would have every tab refetch).
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.activity(wsId))).u?.[bob.uuid] || 0).toBe(after);
  });
});

describe('a guest made a member landing in the default channels', () => {
  const joinedLines = async (wsId, ch, who) => (await as(alice).get(`/api/ws/${wsId}/conv/${ch}/messages`)).data.messages
    .filter((m) => m.kind === 'sys' && /joined$/.test(m.text) && m.user === who);
  /** Bob, a guest of #secret alone. */
  async function guestOfSecret() {
    const { wsId, general, code } = await workspaceWith(alice, []);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, {});
    expect((await as(bob).post('/api/join', { code: inv.data.code })).data.guest).toBe(true);
    expect(await joinedLines(wsId, general.id, bob.uuid)).toHaveLength(0);
    return { wsId, general, code, secret };
  }

  it('is announced in #general once, read past the line, when an admin promotes them', async () => {
    const { wsId, general } = await guestOfSecret();
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'member' })).ok).toBe(true);
    const lines = await joinedLines(wsId, general.id, bob.uuid);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('bob joined');
    const doc = await rt.kv.get(KEYS.member(wsId, bob.uuid));
    expect(doc.channels).toContain(general.id);
    expect(doc.reads[general.id]).toBe(lines[0].seq);
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[general.id].count).toBe(2);
  });

  it('is announced in #general once when they accept the workspace invite, and twice promoted at once leaves one line', async () => {
    const { wsId, general, code } = await guestOfSecret();
    // Both tabs have read the workspace with bob a guest; the second runs whole before the first writes his card.
    let second = null;
    const restore = hookOnce('update', KEYS.ws(wsId), `members.${bob.uuid}.role`, async () => {
      second = await as(bob).post('/api/join', { code });
    }, { before: true });
    let first;
    try {
      first = await as(bob).post('/api/join', { code });
    } finally {
      restore();
    }
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.data.promoted).toBe(true);
    const lines = await joinedLines(wsId, general.id, bob.uuid);
    expect(lines).toHaveLength(1);
    const doc = await rt.kv.get(KEYS.member(wsId, bob.uuid));
    expect(doc.channels.filter((c) => c === general.id)).toHaveLength(1);
    expect(doc.reads[general.id]).toBe(lines[0].seq);
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[general.id].count).toBe(2);
  });
});

describe('changing how a conversation notifies', () => {
  it('moves the member\'s own stamp for a mute, a level or a follow, so their other devices fetch the setting; a plain read does not', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const stamp = async () => (await rt.kv.get(KEYS.activity(wsId))).u?.[bob.uuid] || 0;
    for (const t of ['one', 'two']) expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: t })).ok).toBe(true);
    let before = await stamp();
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${general.id}/notify`, { mute: true })).ok).toBe(true);
    let after = await stamp();
    expect(after).toBeGreaterThan(before);
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).data.u).toBe(after);
    before = after;
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${general.id}/notify`, { level: 'mentions' })).ok).toBe(true);
    after = await stamp();
    expect(after).toBeGreaterThan(before);
    // The document the other device fetches carries the change.
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.me.notify[general.id]).toEqual({ mute: true, level: 'mentions' });
    // Following a thread reaches the other device's Threads list the same way.
    const root = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' })).data.message.seq;
    before = after;
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${general.id}_t${root}/notify`, { follow: true })).ok).toBe(true);
    after = await stamp();
    expect(after).toBeGreaterThan(before);
    // A plain read forward still pokes nobody.
    const seq = (await rt.kv.get(KEYS.seq(general.id))) || 0;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq })).ok).toBe(true);
    expect(await stamp()).toBe(after);
  });
});

describe('joining a workspace whose document holds as much as it can', () => {
  it('is refused with words for the joiner, not for an admin', async () => {
    const { wsId, code } = await workspaceWith(alice, []);
    await rt.kv.update(KEYS.ws(wsId), { pad: 'x'.repeat(300_001) });
    const join = await as(bob).post('/api/join', { code });
    expect(join.status).toBe(400);
    expect(join.data.code).toBe('limit');
    expect(join.data.message).toMatch(/no room for another member/);
    expect(join.data.message).toMatch(/ask one of its admins/);
    expect(join.data.message).not.toMatch(/holds as much as it can/);
    expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid]).toBeUndefined();
    // The admin adding to it is still told what to remove.
    const made = await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'more' });
    expect(made.status).toBe(400);
    expect(made.data.message).toMatch(/holds as much as it can; remove some/);
  });
});

describe('someone from a connected workspace accepting the workspace invite from two tabs', () => {
  const SERVER = 'teamchat-api.test';
  /** Acme (alice, carol) hosts #design with a second default channel; Globex (bob admin) is the partner, bob in #design as an external. */
  async function sharedWithTwoDefaults() {
    const acme = await workspaceWith(alice, [carol], 'Acme');
    const globex = await workspaceWith(alice, [bob], 'Globex');
    expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const design = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'design' })).data.channel.id;
    // A second default channel, as an imported workspace may carry.
    const second = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'announce' })).data.channel.id;
    await rt.kv.update(KEYS.ws(acme.wsId), { [`channels.${second}.def`]: true });
    const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`, {});
    const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' }, profile: { name: 'Bob B.' } });
    expect(acc.ok).toBe(true);
    const added = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, {
      ref: `${acme.wsId}@${SERVER}`, ch: design, conn: acc.data.conn, secret: acc.data.secret, name: 'design-with-acme', host: acc.data.workspace.name,
    });
    expect(added.ok).toBe(true);
    const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${added.data.channel.id}/attest`, {});
    expect((await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token, profile: { name: 'Bob B.' } })).ok).toBe(true);
    return { acme, design, second, conn: acc.data.conn };
  }

  it('takes them off the connection\'s count once when each tab enters one of the two default channels', async () => {
    const { acme, design, second, conn } = await sharedWithTwoDefaults();
    const before = (await rt.kv.get(KEYS.ws(acme.wsId))).channels[design];
    expect(before.connections[conn].count).toBe(1);
    expect(before.count).toBe(2);
    // Both tabs read the workspace with bob's card from Globex. Their appends
    // onto his document land in turn: the first tab's #general, the second's
    // #general (a copy, so the second leaves that one to the first), and then
    // the first tab's second default is held until the second tab's has
    // landed, so each tab enters one of the two and both go on counting.
    const key = KEYS.member(acme.wsId, bob.uuid);
    const orig = rt.kv.add;
    let n = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    rt.kv.add = async (k, arg) => {
      if (k !== key || !arg || typeof arg !== 'object' || !Object.hasOwn(arg, 'channels')) return orig(k, arg);
      const i = ++n;
      if (i === 3) await gate;
      const res = await orig(k, arg);
      if (i === 4) release();
      return res;
    };
    let first;
    let other;
    try {
      [first, other] = await Promise.all([as(bob).post('/api/join', { code: acme.code }), as(bob).post('/api/join', { code: acme.code })]);
    } finally {
      rt.kv.add = orig;
    }
    expect(first.ok).toBe(true);
    expect(other.ok).toBe(true);
    expect(n).toBe(4);
    const ws = await rt.kv.get(KEYS.ws(acme.wsId));
    expect(ws.members[bob.uuid].role).toBe('member');
    expect(ws.channels[acme.general.id].count).toBe(3);
    expect(ws.channels[second].count).toBe(2);
    expect(ws.channels[design].count).toBe(2);
    expect(ws.channels[design].connections[conn].count).toBe(0);
    const doc = await rt.kv.get(KEYS.member(acme.wsId, bob.uuid));
    expect([...doc.channels].sort()).toEqual([design, acme.general.id, second].sort());
  });
});

