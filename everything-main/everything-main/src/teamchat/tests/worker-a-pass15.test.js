/**
 * Identity, membership, notification and invite routes: what the fifteenth
 * review pass found.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';

const { alice, bob, carol, dave } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

describe('a mention read the moment it lands', () => {
  const post = (u, wsId, conv, text) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text });
  const read = (u, wsId, conv, seq) => as(u).post(`/api/ws/${wsId}/conv/${conv}/read`, { seq });
  const seqOf = async (conv) => Number(await rt.kv.get(KEYS.seq(conv))) || 0;

  /** Run `then` once, right after the activity document announces a new message in `conv` (a reader looking at it fetches and reads at once). */
  function onAnnounce(wsId, conv, then) {
    const update = rt.kv.update;
    let fired = false;
    rt.kv.update = async (k, patch) => {
      const res = await update(k, patch);
      if (!fired && k === KEYS.activity(wsId) && Object.hasOwn(patch, `c.${conv}.s`)) {
        fired = true;
        await then(patch[`c.${conv}.s`]);
      }
      return res;
    };
    return () => { rt.kv.update = update; };
  }

  it('is not a badge on a channel the reader is looking at, read to its end', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    let aliceRead = null;
    const restore = onAnnounce(wsId, general.id, async (seq) => { aliceRead = await read(alice, wsId, general.id, seq); });
    try {
      expect((await post(bob, wsId, general.id, '@alice look at this')).ok).toBe(true);
    } finally {
      restore();
    }
    expect(aliceRead?.ok).toBe(true);
    const doc = await rt.kv.get(KEYS.member(wsId, alice.uuid));
    const latest = await seqOf(general.id);
    expect(doc.reads[general.id]).toBe(latest);
    expect(doc.mentions?.[general.id] || 0).toBe(0);
    // The mention still reached her Activity.
    const inbox = await as(alice).get(`/api/ws/${wsId}/inbox`);
    expect(inbox.data.items.some((e) => e.k === 'mention' && e.s === latest)).toBe(true);
  });

  it('is counted for a reader whose read of the message before it lands in the same instant, and cleared by their read of it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await post(bob, wsId, general.id, 'first')).ok).toBe(true);
    const prev = await seqOf(general.id);
    // Alice's read of the message before, in flight as bob posts, lands just as her count is being written.
    const incr = rt.kv.incr;
    let fired = false;
    rt.kv.incr = async (k, amount) => {
      if (!fired && k === KEYS.member(wsId, alice.uuid) && amount && typeof amount === 'object' && Object.hasOwn(amount, `mentions.${general.id}`)) {
        fired = true;
        expect((await read(alice, wsId, general.id, prev)).ok).toBe(true);
      }
      return incr(k, amount);
    };
    try {
      expect((await post(bob, wsId, general.id, '@alice second')).ok).toBe(true);
    } finally {
      rt.kv.incr = incr;
    }
    expect(fired).toBe(true);
    let doc = await rt.kv.get(KEYS.member(wsId, alice.uuid));
    expect(doc.reads[general.id]).toBe(prev);
    expect(doc.mentions[general.id]).toBe(1);
    expect((await read(alice, wsId, general.id, prev + 1)).ok).toBe(true);
    doc = await rt.kv.get(KEYS.member(wsId, alice.uuid));
    expect(doc.mentions[general.id]).toBe(0);
  });

  it('nor is a reply a Threads badge for a follower reading the thread as it comes', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const root = (await post(alice, wsId, general.id, 'root')).data.message.seq;
    const thread = `${general.id}_t${root}`;
    expect((await post(bob, wsId, thread, 'one')).ok).toBe(true);
    // Alice, the root's author, follows; she has the thread open and reads bob's next reply at once.
    expect((await read(alice, wsId, thread, await seqOf(thread))).ok).toBe(true);
    let aliceRead = null;
    const restore = onAnnounce(wsId, thread, async (seq) => { aliceRead = await read(alice, wsId, thread, seq); });
    try {
      expect((await post(bob, wsId, thread, 'two')).ok).toBe(true);
    } finally {
      restore();
    }
    expect(aliceRead?.ok).toBe(true);
    const doc = await rt.kv.get(KEYS.member(wsId, alice.uuid));
    expect(doc.reads[thread]).toBe(await seqOf(thread));
    expect(doc.threads?.[thread] || 0).toBe(0);
    // The reply still reached her Activity and her Threads list.
    const inbox = await as(alice).get(`/api/ws/${wsId}/inbox`);
    expect(inbox.data.items.filter((e) => e.k === 'reply' && e.c === thread).length).toBe(2);
    expect((await as(alice).get(`/api/ws/${wsId}/threads`)).data.threads.map((t) => t.id)).toContain(thread);
  });
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

describe('an admin removing someone in the instant they join a channel', () => {
  const texts = async (wsId, conv) => (await as(alice).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.map((m) => m.text);
  async function setup() {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    return { wsId, general, open };
  }
  /** The workspace as it must stand afterwards: bob out, #open counting alice alone, nothing of bob's left behind. */
  async function settled(wsId, general, open) {
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.members[bob.uuid]).toBeUndefined();
    expect(ws.channels[open].count).toBe(1);
    expect(ws.channels[general.id].count).toBe(1);
    expect(await rt.kv.get(KEYS.member(wsId, bob.uuid))).toBeFalsy();
    expect(await texts(wsId, open)).not.toContain('bob joined');
    expect((await as(bob).get(`/api/ws/${wsId}`)).status).toBe(403);
  }

  it('counts the channel right when the removal reads his document first', async () => {
    const { wsId, general, open } = await setup();
    let join = null;
    const restore = hookOnce('update', KEYS.member(wsId, bob.uuid), 'gone', async () => { join = await as(bob).post(`/api/ws/${wsId}/channels/${open}/join`); });
    try {
      expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    } finally {
      restore();
    }
    expect(join.status).toBe(403);
    await settled(wsId, general, open);
  });

  it('counts the channel right when his join puts the channel on his document first', async () => {
    const { wsId, general, open } = await setup();
    const restore = hookOnce('add', KEYS.member(wsId, bob.uuid), 'channels', async () => {
      expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    });
    let join;
    try {
      join = await as(bob).post(`/api/ws/${wsId}/channels/${open}/join`);
    } finally {
      restore();
    }
    expect(join.status).toBe(403);
    await settled(wsId, general, open);
  });

  it('leaves no document of the channel alone when his join lands after his document was deleted', async () => {
    const { wsId, general, open } = await setup();
    const restore = hookOnce('add', KEYS.member(wsId, bob.uuid), 'channels', async () => {
      expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    }, { before: true });
    let join;
    try {
      join = await as(bob).post(`/api/ws/${wsId}/channels/${open}/join`);
    } finally {
      restore();
    }
    expect(join.status).toBe(403);
    await settled(wsId, general, open);
  });

  it('counts the channel right when an admin adds him to it as another removes him', async () => {
    const { wsId, general, open } = await setup();
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    let added = null;
    const restore = hookOnce('update', KEYS.member(wsId, bob.uuid), 'gone', async () => {
      added = await as(alice).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [bob.uuid] });
    });
    try {
      expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    } finally {
      restore();
    }
    expect(added.ok).toBe(true);
    expect(added.data.added).toEqual([]);
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.channels[secret].count).toBe(1);
    expect(ws.channels[secret].members).toEqual([alice.uuid]);
    await settled(wsId, general, open);
  });
});

describe('a member made a guest, or a guest a member, in the instant they enter a channel', () => {
  async function setup() {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${open}/invites`, {});
    return { wsId, general, open, link: inv.data.code };
  }
  const counts = async (wsId, ch) => {
    const c = (await rt.kv.get(KEYS.ws(wsId))).channels[ch];
    return { count: c.count, guests: c.guests || 0 };
  };

  it('is counted among the guests once when the role is written before the link is accepted', async () => {
    const { wsId, general, open, link } = await setup();
    let join = null;
    const restore = hookOnce('update', KEYS.member(wsId, bob.uuid), 'role', async () => { join = await as(bob).post('/api/join', { code: link }); });
    try {
      expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'guest' })).ok).toBe(true);
    } finally {
      restore();
    }
    expect(join.ok).toBe(true);
    expect(join.data.joined).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 2, guests: 1 });
    expect(await counts(wsId, general.id)).toEqual({ count: 2, guests: 1 });
    expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid].role).toBe('guest');
  });

  it('is counted among the guests once when the link is accepted before the role is written', async () => {
    const { wsId, general, open, link } = await setup();
    const restore = hookOnce('add', KEYS.member(wsId, bob.uuid), 'channels', async () => {
      expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'guest' })).ok).toBe(true);
    });
    let join;
    try {
      join = await as(bob).post('/api/join', { code: link });
    } finally {
      restore();
    }
    expect(join.ok).toBe(true);
    expect(await counts(wsId, open)).toEqual({ count: 2, guests: 1 });
    expect(await counts(wsId, general.id)).toEqual({ count: 2, guests: 1 });
  });

  it('a guest made a member as an admin adds them to a channel is a guest of it nowhere', async () => {
    for (const order of ['role-first', 'add-first']) {
      rt = await boot();
      const { wsId, general } = await workspaceWith(alice, []);
      const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
      const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
      const inv = await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, {});
      expect((await as(bob).post('/api/join', { code: inv.data.code })).ok).toBe(true);
      expect(await counts(wsId, secret)).toEqual({ count: 2, guests: 1 });
      const promote = () => as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'member' });
      const add = () => as(alice).post(`/api/ws/${wsId}/channels/${open}/members`, { uuids: [bob.uuid] });
      let other = null;
      const restore = order === 'role-first'
        ? hookOnce('update', KEYS.member(wsId, bob.uuid), 'role', async () => { other = await add(); })
        : hookOnce('add', KEYS.member(wsId, bob.uuid), 'channels', async () => { other = await promote(); });
      try {
        expect((await (order === 'role-first' ? promote() : add())).ok).toBe(true);
      } finally {
        restore();
      }
      expect(other.ok).toBe(true);
      expect(await counts(wsId, open)).toEqual({ count: 2, guests: 0 });
      expect(await counts(wsId, secret)).toEqual({ count: 2, guests: 0 });
      expect(await counts(wsId, general.id)).toEqual({ count: 2, guests: 0 });
      const doc = await rt.kv.get(KEYS.member(wsId, bob.uuid));
      expect([...doc.channels].sort()).toEqual([secret, open, general.id].sort());
      expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid].role).toBe('member');
    }
  });
});

describe('an invite link opened again while the workspace is being moved', () => {
  async function moving() {
    const { wsId, general, code } = await workspaceWith(alice, [bob]);
    const open = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'open' })).data.channel.id;
    const other = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'other' })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/channels/${open}/join`);
    const link = (await as(alice).post(`/api/ws/${wsId}/channels/${open}/invites`, {})).data.code;
    const otherLink = (await as(alice).post(`/api/ws/${wsId}/channels/${other}/invites`, {})).data.code;
    // Alice nominates bob, an admin; bob's app freezes the workspace for the move.
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { to: bob.uuid })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/transfer/begin`, {})).ok).toBe(true);
    return { wsId, general, code, open, other, link, otherLink };
  }

  it('tells a member they are in already, for the workspace and for a channel they are in, and writes nothing', async () => {
    const { wsId, code, open, link } = await moving();
    const before = JSON.stringify(await rt.kv.get(KEYS.ws(wsId)));
    const r = await as(bob).post('/api/join', { code });
    expect(r.ok).toBe(true);
    expect(r.data.already).toBe(true);
    const c = await as(bob).post('/api/join', { code: link });
    expect(c.ok).toBe(true);
    expect(c.data).toMatchObject({ already: true, channel: { id: open } });
    expect(c.data.joined).toBeUndefined();
    expect(JSON.stringify(await rt.kv.get(KEYS.ws(wsId)))).toBe(before);
  });

  it('still holds a newcomer, a guest handed the workspace invite, and a member handed the link of a channel they are not in', async () => {
    const { wsId, code, otherLink } = await moving();
    const n = await as(carol).post('/api/join', { code });
    expect(n.status).toBe(423);
    expect(n.data.code).toBe('transferring');
    const c = await as(bob).post('/api/join', { code: otherLink });
    expect(c.status).toBe(423);
    // A guest of the workspace handed its own invite would be made a member: that waits too.
    await rt.kv.update(KEYS.ws(wsId), { [`members.${bob.uuid}.role`]: 'guest' });
    const g = await as(bob).post('/api/join', { code });
    expect(g.status).toBe(423);
    // Nothing was counted or written for any of them.
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.members[carol.uuid]).toBeUndefined();
    expect(ws.members[bob.uuid].role).toBe('guest');
    expect(await rt.kv.get(KEYS.member(wsId, carol.uuid))).toBeFalsy();
  });
});

describe('what someone from a connected workspace is told', () => {
  const SERVER = 'teamchat-api.test';
  it('names their standing, not guests, when they may not create, change, or add people to a channel here', async () => {
    const acme = await workspaceWith(alice, [carol], 'Acme');
    const globex = await workspaceWith(alice, [bob], 'Globex');
    expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const design = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'design' })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`, {});
    const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' } });
    expect(acc.ok).toBe(true);
    const added = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, { ref: `${acme.wsId}@${SERVER}`, ch: design, conn: acc.data.conn, secret: acc.data.secret, name: 'design-with-acme', host: 'Acme' });
    expect(added.ok).toBe(true);
    const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${added.data.channel.id}/attest`, {});
    expect((await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(acme.wsId))).members[bob.uuid].role).toBe('external');
    const refusals = [
      await as(bob).post(`/api/ws/${acme.wsId}/channels`, { name: 'mine' }),
      await as(bob).put(`/api/ws/${acme.wsId}/channels/${design}`, { topic: 'Ours now' }),
      await as(bob).post(`/api/ws/${acme.wsId}/channels/${design}/members`, { uuids: [carol.uuid] }),
    ];
    for (const r of refusals) {
      expect(r.status).toBe(403);
      expect(r.data.message).toMatch(/^People from a connected workspace cannot/);
      expect(r.data.message).not.toMatch(/Guests/);
    }
    // A guest of the workspace is still told what guests cannot do.
    const gl = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/invites`, {});
    expect((await as(dave).post('/api/join', { code: gl.data.code })).ok).toBe(true);
    const g = await as(dave).post(`/api/ws/${acme.wsId}/channels/${design}/members`, { uuids: [carol.uuid] });
    expect(g.status).toBe(403);
    expect(g.data.message).toBe('Guests cannot add people');
    expect((await as(dave).post(`/api/ws/${acme.wsId}/channels`, { name: 'mine' })).data.message).toBe('Guests cannot create channels');
  });
});

describe('a message scheduled in the moment a poll works out the next due time', () => {
  const MIN = 60_000;
  const sched = (u, wsId, body) => as(u).post(`/api/ws/${wsId}/scheduled`, body);
  const texts = async (wsId, conv) => (await as(alice).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.map((m) => m.text);

  it('is still delivered at its time', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const first = (await sched(alice, wsId, { conv: general.id, text: 'first', dueAt: Date.now() + 5 * MIN })).data.scheduled.id;
    await rt.kv.update(KEYS.sched(wsId), { [`m.${first}.dueAt`]: Date.now() - 1 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    // Bob schedules his (due already, as a "send in a moment" from a device a little behind the worker's clock is) the moment the delivering poll has read what is left of the queue.
    const get = rt.kv.get;
    let reads = 0;
    let second = null;
    rt.kv.get = async (k) => {
      const res = await get(k);
      if (k === KEYS.sched(wsId) && ++reads === 2 && !second) {
        second = 'pending';
        const r = await sched(bob, wsId, { conv: general.id, text: 'second', dueAt: Date.now() - 30_000 });
        expect(r.ok).toBe(true);
        second = r.data.scheduled.id;
      }
      return res;
    };
    try {
      expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    } finally {
      rt.kv.get = get;
    }
    expect(second).not.toBeNull();
    expect(await texts(wsId, general.id)).toContain('first');
    // The next due time still names bob's message, and the next poll sends it.
    const act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.nd).toBeLessThanOrEqual(Date.now());
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect(await texts(wsId, general.id)).toContain('second');
    expect((await rt.kv.get(KEYS.sched(wsId)))?.m?.[second]).toBeUndefined();
  });
});

describe('someone from a connected workspace let go of by the host in the instant they enter a second shared channel', () => {
  const SERVER = 'teamchat-api.test';
  /** Acme (alice, carol) shares #design and #eng with Globex (alice owns it; bob its admin). Bob is in #design on Acme; his attestation for #eng is signed and ready. */
  async function two() {
    const acme = await workspaceWith(alice, [carol], 'Acme');
    const globex = await workspaceWith(alice, [bob], 'Globex');
    expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const share = async (name) => {
      const ch = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name })).data.channel.id;
      const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${ch}/connect/invites`, {});
      const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' } });
      expect(acc.ok).toBe(true);
      const added = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, { ref: `${acme.wsId}@${SERVER}`, ch, conn: acc.data.conn, secret: acc.data.secret, name: `${name}-with-acme`, host: 'Acme' });
      expect(added.ok).toBe(true);
      return { ch, conn: acc.data.conn, local: added.data.channel.id };
    };
    const design = await share('design');
    const eng = await share('eng');
    const attest = async (local) => (await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {})).data;
    const hostJoin = (att) => as(bob).post('/api/connect/join', { conn: att.conn, token: att.token, profile: { name: 'Bob B.' } });
    expect((await hostJoin(await attest(design.local))).ok).toBe(true);
    const engAtt = await attest(eng.local);
    return { acme, globex, design, eng, hostJoin: () => hostJoin(engAtt) };
  }
  const chan = async (wsId, ch) => (await rt.kv.get(KEYS.ws(wsId))).channels[ch];

  /** The host as it must stand: bob out of it altogether, #eng counting alice alone, nothing of bob's left behind. */
  async function bobGone(acme, design, eng) {
    const ws = await rt.kv.get(KEYS.ws(acme.wsId));
    expect(ws.members[bob.uuid]).toBeUndefined();
    expect(ws.channels[design.ch].count).toBe(1);
    expect(ws.channels[eng.ch].count).toBe(1);
    expect(ws.channels[eng.ch].connections[eng.conn].count).toBe(0);
    expect(await rt.kv.get(KEYS.member(acme.wsId, bob.uuid))).toBeFalsy();
  }
  /** The host as it must stand: bob out of #design and in #eng, counted there once. */
  async function bobInEng(acme, design, eng) {
    const ws = await rt.kv.get(KEYS.ws(acme.wsId));
    expect(ws.members[bob.uuid]).toMatchObject({ role: 'external' });
    expect(ws.channels[design.ch].count).toBe(1);
    // A revocation leaves the connection standing at nobody; a disconnect takes it off the channel.
    expect(ws.channels[design.ch].connections?.[design.conn]?.count ?? 0).toBe(0);
    expect(ws.channels[eng.ch].count).toBe(2);
    expect(ws.channels[eng.ch].connections[eng.conn].count).toBe(1);
    const doc = await rt.kv.get(KEYS.member(acme.wsId, bob.uuid));
    expect(doc.channels).toEqual([eng.ch]);
    expect(doc.gone).toBeUndefined();
  }

  for (const [how, label] of [['revoke', 'his own workspace takes its word back'], ['disconnect', 'the host disconnects his workspace']]) {
    const endSeat = async ({ acme, globex, design }) => {
      if (how === 'disconnect') {
        expect((await as(alice).del(`/api/ws/${acme.wsId}/channels/${design.ch}/connections/${design.conn}`)).ok).toBe(true);
        return;
      }
      const removed = await as(alice).del(`/api/ws/${globex.wsId}/members/${bob.uuid}`);
      expect(removed.ok).toBe(true);
      const word = removed.data.revocations.find((r) => r.conn === design.conn);
      expect(word).toBeTruthy();
      expect((await as(carol).post('/api/connect/revoke', { conn: word.conn, token: word.token })).ok).toBe(true);
    };

    it(`is out altogether, nothing counted, when ${label} before his entry lands`, async () => {
      const t = await two();
      let join = null;
      const restore = hookOnce('update', KEYS.member(t.acme.wsId, bob.uuid), 'gone', async () => { join = await t.hostJoin(); });
      try {
        await endSeat(t);
      } finally {
        restore();
      }
      expect(join.status).toBe(409);
      expect(join.data.code).toBe('retry');
      await bobGone(t.acme, t.design, t.eng);
    });

    it(`is either out altogether or in the channel he entered, counted right either way, when his entry lands as ${label}`, async () => {
      const t = await two();
      // The entry lands right after the seat-ender has read his document: in the old shape, too late for the read and too early for the deletion.
      const get = rt.kv.get;
      let join = null;
      rt.kv.get = async (k) => {
        const res = await get(k);
        if (k === KEYS.member(t.acme.wsId, bob.uuid) && !join) {
          join = 'pending';
          join = await t.hostJoin();
        }
        return res;
      };
      try {
        await endSeat(t);
      } finally {
        rt.kv.get = get;
      }
      expect(join).not.toBeNull();
      const ws = await rt.kv.get(KEYS.ws(t.acme.wsId));
      if (ws.members[bob.uuid]) {
        expect(join.ok).toBe(true);
        await bobInEng(t.acme, t.design, t.eng);
      } else {
        expect(join.status).toBe(409);
        await bobGone(t.acme, t.design, t.eng);
      }
    });

    it(`stays in the channel he entered, counted once, when his entry lands before ${label}`, async () => {
      const t = await two();
      const restore = hookOnce('add', KEYS.member(t.acme.wsId, bob.uuid), 'channels', async () => { await endSeat(t); });
      let join;
      try {
        join = await t.hostJoin();
      } finally {
        restore();
      }
      expect(join.ok).toBe(true);
      await bobInEng(t.acme, t.design, t.eng);
    });
  }
});

describe('an invite accepted in the moment the owner deletes the workspace', () => {
  /** Run `during` once, when the join is about to write the newcomer's card into the workspace document. */
  async function joinWhile(wsId, code, during) {
    const update = rt.kv.update;
    let fired = false;
    rt.kv.update = async (k, patch) => {
      if (!fired && k === KEYS.ws(wsId) && Object.hasOwn(patch, `members.${bob.uuid}`)) {
        fired = true;
        await during();
      }
      return update(k, patch);
    };
    try {
      return await as(bob).post('/api/join', { code });
    } finally {
      rt.kv.update = update;
    }
  }

  it('is refused as a dead link, and leaves the newcomer no nameless workspace nobody can delete', async () => {
    const { wsId, code, general } = await workspaceWith(alice, []);
    const j = await joinWhile(wsId, code, async () => {
      expect((await as(alice).del(`/api/ws/${wsId}`)).ok).toBe(true);
    });
    expect(j.status).toBe(404);
    expect(j.data.code).toBe('invite_not_found');
    // Nothing of the join stands under the deleted workspace: no card, no
    // member document, no "joined" line, no activity.
    expect((await rt.kv.get(KEYS.ws(wsId)))?.members?.[bob.uuid]).toBeUndefined();
    expect(await rt.kv.get(KEYS.member(wsId, bob.uuid))).toBeFalsy();
    expect(await rt.kv.get(KEYS.block(general.id, 0))).toBeFalsy();
    expect(await rt.kv.get(KEYS.activity(wsId))).toBeFalsy();
    // Bob's own list does not name it, and his workspaces are none.
    expect((await rt.kv.get(KEYS.user(bob.uuid))).workspaces).not.toContain(wsId);
    const me = await as(bob).get('/api/me');
    expect(me.data.workspaces).toEqual([]);
    expect((await as(bob).get(`/api/ws/${wsId}`)).status).toBe(403);
    // The link is dead for good.
    expect((await as(bob).post('/api/join', { code })).status).toBe(404);
  });

  it('is joined as before when the workspace stands', async () => {
    const { wsId, code, general } = await workspaceWith(alice, []);
    const j = await joinWhile(wsId, code, async () => {});
    expect(j.ok).toBe(true);
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.members[bob.uuid]).toMatchObject({ role: 'member' });
    expect(ws.channels[general.id].count).toBe(2);
    expect((await as(bob).get('/api/me')).data.workspaces.map((w) => w.id)).toEqual([wsId]);
  });

  it('leaves a document of a card alone, left by a join from before, out of the member\'s list', async () => {
    const { wsId } = await workspaceWith(alice, []);
    // What such a join used to leave: the card, and nothing of the workspace around it.
    await rt.kv.set(KEYS.ws(wsId), { members: { [bob.uuid]: { username: 'bob', name: 'bob', role: 'member', joinedAt: Date.now() } } });
    await rt.kv.set(KEYS.user(bob.uuid), { uuid: bob.uuid, username: 'bob', name: 'bob', title: '', color: 1, workspaces: [wsId], createdAt: Date.now() });
    const me = await as(bob).get('/api/me');
    expect(me.ok).toBe(true);
    expect(me.data.workspaces).toEqual([]);
    expect((await rt.kv.get(KEYS.user(bob.uuid))).workspaces).toEqual([]);
  });
});
