/**
 * Identity, membership, notification and scheduling routes: what the
 * nineteenth review pass found.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import { LIMITS } from '../src/shared/limits.js';

const { alice, bob, carol } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

describe('a one-line field made of letters that draw as nothing', () => {
  // The Hangul fillers and the braille pattern with no dots: letters and a
  // symbol by category, blank on screen.
  const blanks = ['ㅤ', 'ㅤㅤ', 'ᅟ', 'ᅠ', 'ﾠ', '⠀', ' ㅤ ⠀ '];

  it('is refused as a display name, as an empty one is, and the card keeps the name that stood', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    for (const name of blanks) {
      const res = await as(bob).put('/api/me', { name });
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect(res.data.message).toBe('Display name cannot be empty');
    }
    expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid].name).toBe('bob');
    expect((await rt.kv.get(KEYS.user(bob.uuid))).name).toBe('bob');
  });

  it('is refused as a workspace name, and stays where a name has something else to show', async () => {
    const { wsId } = await workspaceWith(alice, []);
    for (const name of blanks) {
      const res = await as(alice).put(`/api/ws/${wsId}`, { name });
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect(res.data.message).toBe('Workspace name cannot be empty');
    }
    expect((await rt.kv.get(KEYS.ws(wsId))).name).toBe('Acme');
    expect((await as(alice).post('/api/workspaces', { name: 'ㅤ' })).status).toBe(400);
    // A filler beside a letter is kept as typed: Korean text may carry one.
    expect((await as(alice).put(`/api/ws/${wsId}`, { name: 'Acmeㅤ' })).data.workspace.name).toBe('Acmeㅤ');
    expect((await as(bob).put('/api/me', { name: 'ㅤ bob' })).data.profile.name).toBe('ㅤ bob');
  });

  it('clears a title or a status rather than setting a blank one', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    expect((await as(bob).put('/api/me', { title: 'Ops', status: { emoji: '⠀', text: 'here' } })).ok).toBe(true);
    const res = await as(bob).put('/api/me', { title: 'ㅤ', status: { emoji: '⠀', text: 'ㅤ' } });
    expect(res.ok).toBe(true);
    expect(res.data.profile.title).toBe('');
    expect(res.data.profile.status).toBe(null);
    const card = (await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid];
    expect(card.title).toBe('');
    expect(card.status).toBe(null);
  });
});

describe('a scheduled entry on a store that answers a write with the part it changed', () => {
  const posted = async (wsId, conv, text) => (await as(alice).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.some((m) => m.text === text && m.user === bob.uuid);

  it('is delivered by the poll that claims it, rather than taken off the queue as one already sent', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const id = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'overdue', dueAt: Date.now() - 30_000 })).data.scheduled.id;
    const key = KEYS.sched(wsId);
    const orig = rt.kv.incr;
    // The store takes the claim but hands back the counter it moved, not the queue.
    rt.kv.incr = async (k, arg) => {
      const res = await orig(k, arg);
      if (k === key && arg && Object.hasOwn(arg, `m.${id}.claims`)) return { m: { [id]: { claims: res.m[id].claims } } };
      return res;
    };
    try {
      expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    } finally {
      rt.kv.incr = orig;
    }
    expect(await posted(wsId, general.id, 'overdue')).toBe(true);
    expect((await rt.kv.get(key)).m[id]).toBeUndefined();
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBeUndefined();
  });

  it('still lets go of the stub a claim leaves where the entry was deleted between the poll\'s read and its claim, posting nothing', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const id = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'overdue', dueAt: Date.now() - 30_000 })).data.scheduled.id;
    const key = KEYS.sched(wsId);
    const origUpdate = rt.kv.update;
    const origRemove = rt.kv.remove;
    let deleted = false;
    // The author deletes the entry in the instant the poll claims it.
    rt.kv.update = async (k, arg) => {
      if (k === key && arg && Object.hasOwn(arg, `m.${id}.claimedAt`) && !deleted) {
        deleted = true;
        await origRemove.call(rt.kv, key, `m.${id}`);
      }
      return origUpdate.call(rt.kv, k, arg);
    };
    try {
      expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    } finally {
      rt.kv.update = origUpdate;
    }
    expect(await posted(wsId, general.id, 'overdue')).toBe(false);
    expect((await rt.kv.get(key)).m[id]).toBeUndefined();
  });

  it('takes an edit of its words, the entry kept whole', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const id = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'first words', dueAt: Date.now() + 5 * 60_000 })).data.scheduled.id;
    const key = KEYS.sched(wsId);
    const orig = rt.kv.update;
    // The store takes the patch but hands back the fields it wrote, not the queue.
    rt.kv.update = async (k, arg) => {
      const res = await orig.call(rt.kv, k, arg);
      if (k === key && arg && Object.hasOwn(arg, `m.${id}.text`)) return { m: { [id]: { text: res.m[id].text } } };
      return res;
    };
    let res;
    try {
      res = await as(bob).put(`/api/ws/${wsId}/scheduled/${id}`, { text: 'second words' });
    } finally {
      rt.kv.update = orig;
    }
    expect(res.ok).toBe(true);
    const e = (await rt.kv.get(key)).m[id];
    expect(e.text).toBe('second words');
    expect(e.u).toBe(bob.uuid);
    expect((await as(bob).get(`/api/ws/${wsId}/scheduled`)).data.scheduled.map((x) => x.text)).toEqual(['second words']);
  });

  it('still refuses an edit that landed after the entry was taken out, and takes the stub the edit made off the queue', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const id = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'first words', dueAt: Date.now() + 5 * 60_000 })).data.scheduled.id;
    const key = KEYS.sched(wsId);
    const origUpdate = rt.kv.update;
    const origRemove = rt.kv.remove;
    let deleted = false;
    // Deleted from another tab in the instant this edit writes.
    rt.kv.update = async (k, arg) => {
      if (k === key && arg && Object.hasOwn(arg, `m.${id}.text`) && !deleted) {
        deleted = true;
        await origRemove.call(rt.kv, key, `m.${id}`);
      }
      return origUpdate.call(rt.kv, k, arg);
    };
    let res;
    try {
      res = await as(bob).put(`/api/ws/${wsId}/scheduled/${id}`, { text: 'second words' });
    } finally {
      rt.kv.update = origUpdate;
    }
    expect(res.status).toBe(404);
    expect((await rt.kv.get(key)).m[id]).toBeUndefined();
  });
});

/**
 * Acme (alice, carol) hosts #design; Globex (alice owns it too, bob is its
 * admin) is the partner, and bob joins the channel on Acme as an external
 * member (see tests/connect.test.js).
 */
async function sharedChannel() {
  const SERVER = 'teamchat-api.test';
  const acme = await workspaceWith(alice, [carol], 'Acme');
  const globex = await workspaceWith(alice, [bob], 'Globex');
  expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
  const design = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'design' })).data.channel.id;
  expect((await as(carol).post(`/api/ws/${acme.wsId}/channels/${design}/join`)).ok).toBe(true);
  const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`, {});
  const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' } });
  expect(acc.ok).toBe(true);
  const added = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, { ref: `${acme.wsId}@${SERVER}`, ch: design, conn: acc.data.conn, secret: acc.data.secret, name: 'design-with-acme', host: 'Acme' });
  expect(added.ok).toBe(true);
  const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${added.data.channel.id}/attest`, {});
  expect((await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token })).ok).toBe(true);
  return { acme, design, conn: acc.data.conn };
}

describe('letting go of someone from a connected workspace whose standing ran out a month ago', () => {
  it('takes them out of the channel, its connection and the workspace on a store that answers a count with the part it changed', async () => {
    const { acme, design, conn } = await sharedChannel();
    const key = KEYS.ws(acme.wsId);
    let ws = await rt.kv.get(key);
    expect(ws.members[bob.uuid].role).toBe('external');
    expect(ws.channels[design].count).toBe(3);
    expect(ws.channels[design].connections[conn].count).toBe(1);
    // Vouched for last five weeks ago: past the grace the sweep allows.
    await rt.kv.update(key, { [`members.${bob.uuid}.exp`]: Date.now() - 35 * 86400_000 });
    const orig = rt.kv.incr;
    // The store takes the claim but hands back the counter it moved, not the workspace.
    rt.kv.incr = async (k, arg) => {
      const res = await orig(k, arg);
      if (k === key && arg && Object.hasOwn(arg, `members.${bob.uuid}.lapse`)) return { members: { [bob.uuid]: { lapse: res.members[bob.uuid].lapse } } };
      return res;
    };
    try {
      expect((await as(alice).get(`/api/ws/${acme.wsId}`)).ok).toBe(true);
    } finally {
      rt.kv.incr = orig;
    }
    ws = await rt.kv.get(key);
    expect(ws.members[bob.uuid]).toBeUndefined();
    expect(ws.channels[design].count).toBe(2);
    expect(ws.channels[design].connections[conn].count).toBe(0);
    expect(ws.former[bob.uuid]).toBeTruthy();
    expect(await rt.kv.get(KEYS.member(acme.wsId, bob.uuid))).toBeFalsy();
    // A card the claim alone made where the person had gone meanwhile still comes off.
    await rt.kv.update(key, { [`members.${carol.uuid}.exp`]: Date.now() - 35 * 86400_000, [`members.${carol.uuid}.role`]: 'external', [`members.${carol.uuid}.org`]: { ref: 'x@y', name: 'X' } });
    const origUpdate = rt.kv.update;
    const origRemove = rt.kv.remove;
    let taken = false;
    rt.kv.update = async (k, arg) => {
      if (k === key && arg && Object.hasOwn(arg, `members.${carol.uuid}.lapseAt`) && !taken) {
        taken = true;
        await origRemove.call(rt.kv, key, `members.${carol.uuid}`);
      }
      return origUpdate.call(rt.kv, k, arg);
    };
    try {
      expect((await as(alice).get(`/api/ws/${acme.wsId}`)).ok).toBe(true);
    } finally {
      rt.kv.update = origUpdate;
    }
    expect((await rt.kv.get(key)).members[carol.uuid]).toBeUndefined();
  });
});

describe('a member\'s card on a store that answers a path write with the part it changed', () => {
  /** The store takes a write under `members` but hands back the fields it wrote, not the workspace. */
  const partial = (key) => {
    const orig = rt.kv.update;
    rt.kv.update = async (k, arg) => {
      const res = await orig.call(rt.kv, k, arg);
      if (k !== key || !arg) return res;
      const paths = Object.keys(arg).filter((p) => p.startsWith('members.'));
      if (!paths.length) return res;
      const out = { members: {} };
      for (const p of paths) {
        const [, uuid, ...rest] = p.split('.');
        if (!rest.length) out.members[uuid] = res.members[uuid];
        else (out.members[uuid] = out.members[uuid] || {})[rest.join('.')] = res.members[uuid]?.[rest[0]];
      }
      return out;
    };
    return () => { rt.kv.update = orig; };
  };
  const counts = async (wsId, ch) => {
    const c = (await rt.kv.get(KEYS.ws(wsId))).channels[ch];
    return { count: c.count, guests: c.guests || 0 };
  };

  it('stands after a change of role, a synced name, and a newcomer\'s join', async () => {
    const { wsId, general, code } = await workspaceWith(alice, [bob]);
    const key = KEYS.ws(wsId);
    const restore = partial(key);
    try {
      expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
      expect((await rt.kv.get(key)).members[bob.uuid]).toMatchObject({ role: 'admin', username: 'bob', name: 'bob' });
      expect((await as(bob).put('/api/me', { name: 'Robert' })).ok).toBe(true);
      expect((await rt.kv.get(key)).members[bob.uuid]).toMatchObject({ role: 'admin', name: 'Robert' });
      const joined = await as(carol).post('/api/join', { code });
      expect(joined.status).toBe(200);
      expect(joined.data.guest).toBe(false);
      expect((await rt.kv.get(key)).members[carol.uuid]).toMatchObject({ role: 'member', username: 'carol' });
      expect(await counts(wsId, general.id)).toEqual({ count: 3, guests: 0 });
      expect((await rt.kv.get(KEYS.member(wsId, carol.uuid))).channels).toEqual([general.id]);
    } finally {
      restore();
    }
    expect((await as(carol).get(`/api/ws/${wsId}`)).data.me.role).toBe('member');
  });

  it('still comes off where the write alone made it, the member having gone meanwhile', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const key = KEYS.ws(wsId);
    const origUpdate = rt.kv.update;
    const origRemove = rt.kv.remove;
    let removed = false;
    // Bob leaves in the instant alice's role change writes his card.
    rt.kv.update = async (k, arg) => {
      if (k === key && arg && Object.hasOwn(arg, `members.${bob.uuid}.role`) && !removed) {
        removed = true;
        await origRemove.call(rt.kv, key, `members.${bob.uuid}`);
      }
      return origUpdate.call(rt.kv, k, arg);
    };
    let res;
    try {
      res = await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    } finally {
      rt.kv.update = origUpdate;
    }
    expect(res.status).toBe(404);
    expect((await rt.kv.get(key)).members[bob.uuid]).toBeUndefined();
  });
});

describe('deleting a workspace of many members', () => {
  /**
   * How many keys matching `re` the store was asked about at once, at most:
   * the keys one batched call carries, plus any calls in flight beside it.
   */
  const inFlight = (re) => {
    const orig = { get: rt.kv.get, update: rt.kv.update };
    const peak = { get: 0, update: 0 };
    const live = { get: 0, update: 0 };
    for (const name of ['get', 'update']) {
      rt.kv[name] = async (k, ...rest) => {
        const n = (Array.isArray(k) ? k : [k]).filter((x) => re.test(String(x))).length;
        if (!n) return orig[name].call(rt.kv, k, ...rest);
        live[name] += n;
        peak[name] = Math.max(peak[name], live[name]);
        try {
          return await orig[name].call(rt.kv, k, ...rest);
        } finally {
          live[name] -= n;
        }
      };
    }
    return { peak, restore: () => { rt.kv.get = orig.get; rt.kv.update = orig.update; } };
  };

  it('reads the conversations\' counters and the members\' account records together rather than one after another, and leaves nothing behind', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    // Thirty more members, each with a direct message to alice.
    const many = Array.from({ length: 30 }, (_, i) => ({ uuid: `u-many-${String(i).padStart(4, '0')}`, username: `many${i}` }));
    const code = (await as(alice).get(`/api/ws/${wsId}`)).data.workspace.invite;
    for (const u of many) {
      expect((await as(u).post('/api/join', { code })).ok).toBe(true);
      expect((await as(u).post(`/api/ws/${wsId}/dms`, { members: [alice.uuid] })).ok).toBe(true);
    }
    const root = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' })).data.message.seq;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}_t${root}/messages`, { text: 'reply' })).ok).toBe(true);
    const records = inFlight(/^tc:user:/);
    const counters = inFlight(/^tc:conv:.*:seq$/);
    let res;
    try {
      res = await as(alice).del(`/api/ws/${wsId}`);
    } finally {
      records.restore();
      counters.restore();
    }
    expect(res.data).toEqual({ deleted: true });
    // A dozen at a time, as every fan-out here goes.
    expect(records.peak.get).toBeGreaterThan(1);
    expect(records.peak.update).toBeGreaterThan(1);
    expect(counters.peak.get).toBeGreaterThan(1);
    expect(await rt.kv.get(KEYS.ws(wsId))).toBeFalsy();
    expect(await rt.kv.get(KEYS.seq(general.id))).toBeFalsy();
    expect(await rt.kv.get(KEYS.seq(`${general.id}_t${root}`))).toBeFalsy();
    for (const u of [alice, bob, carol, ...many]) {
      expect((await rt.kv.get(KEYS.user(u.uuid))).workspaces).not.toContain(wsId);
      expect(await rt.kv.get(KEYS.member(wsId, u.uuid))).toBeFalsy();
    }
    expect((await as(bob).get('/api/me')).data.workspaces).toEqual([]);
  });
});

describe('counting a member of many channels out of them, or among their guests', () => {
  /** Writes to the workspace document during `fn`, by kind. */
  const writes = async (wsId, fn) => {
    const key = KEYS.ws(wsId);
    const orig = { incr: rt.kv.incr, update: rt.kv.update };
    const n = { incr: 0, update: 0 };
    for (const name of ['incr', 'update']) {
      rt.kv[name] = async (k, ...rest) => {
        if (k === key) n[name]++;
        return orig[name].call(rt.kv, k, ...rest);
      };
    }
    try {
      return [await fn(), n];
    } finally {
      rt.kv.incr = orig.incr;
      rt.kv.update = orig.update;
    }
  };
  const inMany = async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const publics = [];
    const privates = [];
    for (let i = 0; i < 20; i++) {
      publics.push((await as(alice).post(`/api/ws/${wsId}/channels`, { name: `pub-${i}` })).data.channel.id);
      privates.push((await as(alice).post(`/api/ws/${wsId}/channels`, { name: `priv-${i}`, private: true })).data.channel.id);
    }
    for (const ch of publics) expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).ok).toBe(true);
    for (const ch of privates) expect((await as(alice).post(`/api/ws/${wsId}/channels/${ch}/members`, { uuids: [bob.uuid] })).ok).toBe(true);
    return { wsId, general, publics, privates, all: [general.id, ...publics, ...privates] };
  };
  const counts = async (wsId) => Object.fromEntries(Object.entries((await rt.kv.get(KEYS.ws(wsId))).channels).map(([id, c]) => [id, { count: c.count, guests: c.guests || 0, members: c.members }]));

  it('takes a few writes to the workspace document when they are removed, not one or two per channel, and every count and list comes out right', async () => {
    const { wsId, all, privates } = await inMany();
    const [res, n] = await writes(wsId, () => as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`));
    expect(res.ok).toBe(true);
    expect(n.incr).toBeLessThan(5);
    expect(n.update).toBeLessThan(6);
    const after = await counts(wsId);
    for (const ch of all) expect(after[ch].count, ch).toBe(1);
    for (const ch of privates) expect(after[ch].members, ch).toEqual([alice.uuid]);
  });

  it('takes a few writes when they are made a guest and a member again, the guest counts moving on every channel', async () => {
    const { wsId, all } = await inMany();
    const [demoted, n1] = await writes(wsId, () => as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'guest' }));
    expect(demoted.ok).toBe(true);
    expect(n1.incr).toBeLessThan(5);
    let after = await counts(wsId);
    for (const ch of all) expect([after[ch].count, after[ch].guests], ch).toEqual([2, 1]);
    const [promoted, n2] = await writes(wsId, () => as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'member' }));
    expect(promoted.ok).toBe(true);
    expect(n2.incr).toBeLessThan(5);
    after = await counts(wsId);
    for (const ch of all) expect([after[ch].count, after[ch].guests], ch).toEqual([2, 0]);
  });
});

describe('the Activity ring on a store that answers an append with the part it changed', () => {
  it('is still held near its cap, read once in fifty pushes, while a store answering with the whole ring trims it at the cap as before', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const key = KEYS.inbox(wsId, bob.uuid);
    const orig = rt.kv.add;
    // The store takes the append but hands back the entry it appended, not the ring.
    rt.kv.add = async (k, arg) => {
      const res = await orig.call(rt.kv, k, arg);
      if (k === key && arg && Array.isArray(arg.items)) return { items: arg.items };
      return res;
    };
    const reads = { n: 0 };
    const origGet = rt.kv.get;
    rt.kv.get = async (k) => {
      if (k === key) reads.n++;
      return origGet.call(rt.kv, k);
    };
    try {
      for (let i = 0; i < LIMITS.inboxItems + 60; i++) {
        expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: `hey @bob ${i}` })).ok).toBe(true);
      }
    } finally {
      rt.kv.add = orig;
      rt.kv.get = origGet;
    }
    const ring = await rt.kv.get(key);
    expect(ring.items.length).toBeLessThanOrEqual(LIMITS.inboxItems + 49);
    expect(ring.items.length).toBeGreaterThanOrEqual(LIMITS.inboxItems);
    // The newest entries are the ones kept.
    expect(ring.items[ring.items.length - 1].s).toBe((await rt.kv.get(KEYS.seq(general.id))));
    // One read of the ring per fifty pushes, not one a push.
    expect(reads.n).toBeLessThanOrEqual(Math.ceil((LIMITS.inboxItems + 60) / 50));
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).inbox).toBe(LIMITS.inboxItems + 60);
    // Trimmed at the cap by the answer alone where the store hands the ring back.
    for (let i = 0; i < 40; i++) expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: `again @bob ${i}` })).ok).toBe(true);
    expect((await rt.kv.get(key)).items.length).toBe(LIMITS.inboxItems);
    const inbox = await as(bob).get(`/api/ws/${wsId}/inbox`);
    expect(inbox.data.items).toHaveLength(60);
    expect(inbox.data.unread).toBe(LIMITS.inboxItems + 100);
  });
});

describe('a new name for a member of many workspaces on this server', () => {
  it('reaches their cards a dozen workspaces at a time rather than one after another, every card renamed', async () => {
    const ids = [];
    for (let i = 0; i < 15; i++) ids.push((await workspaceWith(alice, [bob], `Acme ${i}`)).wsId);
    const orig = rt.kv.update;
    let live = 0;
    let peak = 0;
    rt.kv.update = async (k, ...rest) => {
      if (!/^tc:ws:[a-z0-9]+$/.test(String(k))) return orig.call(rt.kv, k, ...rest);
      live++;
      peak = Math.max(peak, live);
      try {
        return await orig.call(rt.kv, k, ...rest);
      } finally {
        live--;
      }
    };
    let res;
    try {
      res = await as(bob).put('/api/me', { name: 'Robert' });
    } finally {
      rt.kv.update = orig;
    }
    expect(res.ok).toBe(true);
    expect(peak).toBeGreaterThan(1);
    for (const wsId of ids) expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid].name).toBe('Robert');
  });
});

describe('a profile change reaching a workspace document that holds as much as it may', () => {
  it('leaves the card there as it was when the change would lengthen it, lands one that shortens it, and reaches the other workspaces', async () => {
    const full = await workspaceWith(alice, [bob], 'Full');
    const roomy = await workspaceWith(alice, [bob], 'Roomy');
    // Padded past the ceiling a join is refused at (see assertWorkspaceRoom).
    await rt.kv.update(KEYS.ws(full.wsId), { pad: 'x'.repeat(310_000) });
    expect((await as(bob).put('/api/me', { name: 'Robert the Longer Named', title: 'Head of very long titles' })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(full.wsId))).members[bob.uuid]).toMatchObject({ name: 'bob', title: '' });
    expect((await rt.kv.get(KEYS.ws(roomy.wsId))).members[bob.uuid]).toMatchObject({ name: 'Robert the Longer Named', title: 'Head of very long titles' });
    // The profile itself, in bob's account here, took the change.
    expect((await as(bob).get('/api/me')).data.profile.name).toBe('Robert the Longer Named');
    // A change that makes the card no longer still lands in the full workspace.
    expect((await as(bob).put('/api/me', { name: 'Bo' })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(full.wsId))).members[bob.uuid].name).toBe('Bo');
    expect((await rt.kv.get(KEYS.ws(roomy.wsId))).members[bob.uuid].name).toBe('Bo');
    // Below the ceiling again, the card takes a longer name as ever.
    await rt.kv.remove(KEYS.ws(full.wsId), 'pad');
    expect((await as(bob).put('/api/me', { name: 'Robert' })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(full.wsId))).members[bob.uuid].name).toBe('Robert');
  });
});

describe('an Activity entry for a reaction', () => {
  it('is shown while the reaction stands on the message and not once it has been taken back, the others untouched', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const seq = (await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'bob says' })).data.message.seq;
    const react = (u, reaction, on) => as(u).post(`/api/ws/${wsId}/conv/${general.id}/messages/${seq}/reactions`, { reaction, on });
    expect((await react(alice, 'thumbsup', true)).ok).toBe(true);
    expect((await react(carol, 'thumbsup', true)).ok).toBe(true);
    expect((await react(alice, 'heart', true)).ok).toBe(true);
    const notices = async () => (await as(bob).get(`/api/ws/${wsId}/inbox?kind=reaction`)).data.items.map((e) => `${e.by}:${e.r}`).sort();
    expect(await notices()).toEqual([`${alice.uuid}:heart`, `${alice.uuid}:thumbsup`, `${carol.uuid}:thumbsup`].sort());
    // Alice takes her thumbs-up back: her heart and carol's thumbs-up stay listed.
    expect((await react(alice, 'thumbsup', false)).ok).toBe(true);
    expect(await notices()).toEqual([`${alice.uuid}:heart`, `${carol.uuid}:thumbsup`].sort());
    // Put back, alice's thumbs-up is listed once more: the ring holds the
    // earlier entry and the one the new reaction leaves (it is never
    // rewritten in place), folded into one row for the same person's same
    // reaction on the same message.
    expect((await react(alice, 'thumbsup', true)).ok).toBe(true);
    expect(await notices()).toEqual([`${alice.uuid}:heart`, `${alice.uuid}:thumbsup`, `${carol.uuid}:thumbsup`].sort());
    expect((await rt.kv.get(KEYS.inbox(wsId, bob.uuid))).items).toHaveLength(4);
    // The unread count is the ring's, as for an entry whose message was deleted.
    expect((await as(bob).get(`/api/ws/${wsId}/inbox`)).data.unread).toBe(4);
  });
});
