/**
 * Identity, membership, notification and scheduling routes: what the
 * eighteenth review pass found.
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

describe('the next due time when two people schedule in the same instant', () => {
  const nd = async (wsId) => (await rt.kv.get(KEYS.activity(wsId))).nd;

  it('settles on the earlier entry when both had noted their entry before either read the due time, and the later write lands last', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const soon = Date.now() + 3600_000;
    const later = soon + 3600_000;
    const actKey = KEYS.activity(wsId);
    const origIncr = rt.kv.incr;
    const origUpdate = rt.kv.update;
    let release;
    const gate = new Promise((r) => { release = r; });
    let reached;
    const bobAtWrite = new Promise((r) => { reached = r; });
    let bobReq = null;
    let paused = false;
    // Bob's later entry is in the queue and counted before alice reads the due
    // time, and his write of it lands after hers.
    rt.kv.update = async (k, arg) => {
      if (k === actKey && arg && Object.hasOwn(arg, 'nd') && bobReq && !paused) {
        paused = true;
        reached();
        await gate;
      }
      return origUpdate(k, arg);
    };
    rt.kv.incr = async (k, arg) => {
      const res = await origIncr(k, arg);
      if (k === actKey && arg && Object.hasOwn(arg, 'qv') && !bobReq) {
        bobReq = as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt: later });
        await bobAtWrite;
      }
      return res;
    };
    try {
      expect((await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'soon', dueAt: soon })).ok).toBe(true);
      release();
      expect((await bobReq).ok).toBe(true);
    } finally {
      rt.kv.incr = origIncr;
      rt.kv.update = origUpdate;
    }
    expect(await nd(wsId)).toBe(soon);
  });
});

describe('a guest made a member on a store that answers a count with the part that changed', () => {
  const counts = async (wsId, ch) => {
    const c = (await rt.kv.get(KEYS.ws(wsId))).channels[ch];
    return { count: c.count, guests: c.guests || 0 };
  };

  it('keeps their document, and takes them off the guest count once', async () => {
    const { wsId, general } = await workspaceWith(alice, []);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, {});
    expect((await as(bob).post('/api/join', { code: inv.data.code })).data.guest).toBe(true);
    // Something of bob's own on his document: a setting, and a direct message.
    expect((await as(bob).put(`/api/ws/${wsId}/conv/${secret}/notify`, { mute: true })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/dms`, { members: [alice.uuid] })).ok).toBe(true);
    expect(await counts(wsId, secret)).toEqual({ count: 2, guests: 1 });
    const key = KEYS.member(wsId, bob.uuid);
    const orig = rt.kv.incr;
    // The store takes the count but hands back the field it moved, not the document.
    rt.kv.incr = async (k, arg) => {
      const res = await orig(k, arg);
      if (k === key && arg && typeof arg === 'object' && Object.hasOwn(arg, 'promo')) return { promo: res.promo };
      return res;
    };
    try {
      expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'member' })).ok).toBe(true);
    } finally {
      rt.kv.incr = orig;
    }
    const doc = await rt.kv.get(key);
    expect(doc).toBeTruthy();
    expect(doc.channels).toEqual(expect.arrayContaining([secret, general.id]));
    expect(doc.notify?.[secret]?.mute).toBe(true);
    expect(Object.keys(doc.dms || {})).toHaveLength(1);
    expect(await counts(wsId, secret)).toEqual({ count: 2, guests: 0 });
    expect(await counts(wsId, general.id)).toEqual({ count: 2, guests: 0 });
    // Bob still has his channels and his direct message.
    const me = (await as(bob).get(`/api/ws/${wsId}`)).data.me;
    expect(me.channels).toEqual(expect.arrayContaining([secret, general.id]));
  });

  it('still lets a document the count alone made go, where a removal had deleted theirs, the counts even on both sides', async () => {
    const { wsId, general } = await workspaceWith(alice, []);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, {});
    expect((await as(bob).post('/api/join', { code: inv.data.code })).data.guest).toBe(true);
    expect(await counts(wsId, secret)).toEqual({ count: 2, guests: 1 });
    const key = KEYS.member(wsId, bob.uuid);
    // A removal runs whole once the promotion has appended #general to his
    // document and is about to count him into it: the document is deleted by
    // the time the promotion claims coming off the guest count.
    const origIncr = rt.kv.incr;
    let removed = false;
    rt.kv.incr = async (k, arg) => {
      if (k === KEYS.ws(wsId) && arg && Object.hasOwn(arg, `channels.${general.id}.count`) && !removed) {
        removed = true;
        expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
      }
      return origIncr(k, arg);
    };
    let res;
    try {
      res = await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'member' });
    } finally {
      rt.kv.incr = origIncr;
    }
    expect(res.ok).toBe(true);
    expect(await rt.kv.get(key)).toBeFalsy();
    expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid]).toBeUndefined();
    expect(await counts(wsId, secret)).toEqual({ count: 1, guests: 0 });
    expect(await counts(wsId, general.id)).toEqual({ count: 1, guests: 0 });
  });
});

describe('scheduling a message where the author cannot post', () => {
  it('is refused with the code and the words the post itself would answer', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const mk = async (body) => (await as(alice).post(`/api/ws/${wsId}/channels`, body)).data.channel;
    const dueAt = Date.now() + 3600_000;
    const sched = (u, conv, extra = {}) => as(u).post(`/api/ws/${wsId}/scheduled`, { conv, text: 'later', dueAt, ...extra });
    const live = (u, conv) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text: 'now' });
    const same = async (u, conv) => {
      const [s, l] = [await sched(u, conv), await live(u, conv)];
      expect(s.status).toBe(l.status);
      expect(s.data.code).toBe(l.data.code);
      expect(s.data.message).toBe(l.data.message);
      return s.data.code;
    };
    // Not joined.
    const random = await mk({ name: 'random' });
    expect(await same(bob, random.id)).toBe('not_joined');
    // Admins only.
    const notices = await mk({ name: 'notices' });
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${notices.id}/join`)).ok).toBe(true);
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${notices.id}`, { postPolicy: 'admins' })).ok).toBe(true);
    expect(await same(bob, notices.id)).toBe('read_only');
    // Replies off, and replies for admins.
    const seq = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' })).data.message.seq;
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { threadPolicy: 'off' })).ok).toBe(true);
    expect(await same(bob, `${general.id}_t${seq}`)).toBe('threads_off');
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { threadPolicy: 'admins' })).ok).toBe(true);
    expect(await same(bob, `${general.id}_t${seq}`)).toBe('threads_admins');
    // Archived.
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${notices.id}`, { archived: true })).ok).toBe(true);
    expect(await same(bob, notices.id)).toBe('archived');
    // Where they may post, the message is scheduled.
    expect((await sched(bob, general.id)).ok).toBe(true);
  });
});

describe('a push subscription', () => {
  const sub = (endpoint, keys = { p256dh: 'BPd'.padEnd(87, 'A'), auth: 'x'.padEnd(22, 'B') }) => ({ subscription: { endpoint, keys } });

  it('is refused for an endpoint the worker may not fetch: not https, or a private, loopback or link-local host', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    for (const endpoint of [
      'http://push.example.com/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://10.0.0.5/a', 'https://192.168.1.2/a',
      'https://169.254.169.254/latest/meta-data', 'https://[::1]/a', 'https://[fd00::1]/a', 'https://[::ffff:10.0.0.1]/a',
      'https://metadata.internal/a', 'https://router.local/a', 'https://user:pw@push.example.com/a', 'ftp://push.example.com/a', 'https://',
    ]) {
      const r = await as(bob).post(`/api/ws/${wsId}/push`, sub(endpoint));
      expect(r.status, endpoint).toBe(400);
    }
    expect((await as(bob).post(`/api/ws/${wsId}/push`, { subscription: { endpoint: 'https://push.example.com/a', keys: { p256dh: 'x' } } })).status).toBe(400);
    expect((await as(bob).post(`/api/ws/${wsId}/push`, { subscription: { endpoint: 'https://push.example.com/a', keys: { auth: 'x' } } })).status).toBe(400);
    expect((await as(bob).post(`/api/ws/${wsId}/push`, {})).status).toBe(400);
    expect(Object.keys((await rt.kv.get(KEYS.member(wsId, bob.uuid))).push || {})).toHaveLength(0);
  });

  it('holds five devices per member per workspace, and registering an endpoint again replaces its entry', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const r = await as(bob).post(`/api/ws/${wsId}/push`, sub(`https://push.example.com/d${i}`));
      expect(r.ok).toBe(true);
      ids.push(r.data.id);
    }
    expect((await as(bob).post(`/api/ws/${wsId}/push`, sub('https://push.example.com/d9'))).status).toBe(400);
    // The same endpoint again, with new prefs: the same slot.
    const again = await as(bob).post(`/api/ws/${wsId}/push`, { ...sub('https://push.example.com/d2'), preview: false });
    expect(again.ok).toBe(true);
    expect(again.data.id).toBe(ids[2]);
    const doc = await rt.kv.get(KEYS.member(wsId, bob.uuid));
    expect(Object.keys(doc.push)).toHaveLength(5);
    expect(doc.push[ids[2]].preview).toBe(false);
    // Another workspace of theirs counts its own five; alice's devices are hers.
    expect(Object.keys((await rt.kv.get(KEYS.member(wsId, alice.uuid))).push || {})).toHaveLength(0);
    const other = await workspaceWith(alice, [bob], 'Beta');
    expect((await as(bob).post(`/api/ws/${other.wsId}/push`, sub('https://push.example.com/d9'))).ok).toBe(true);
    // Unsubscribing frees the slot.
    expect((await as(bob).del(`/api/ws/${wsId}/push`, { endpoint: 'https://push.example.com/d0' })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/push`, sub('https://push.example.com/d9'))).ok).toBe(true);
  });
});

describe('roles at their edges', () => {
  it('refuses the owner demoting themselves, an admin removing the owner, and a role for someone from a connected workspace', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const self = await as(alice).post(`/api/ws/${wsId}/members/${alice.uuid}/role`, { role: 'member' });
    expect(self.status).toBe(400);
    expect(self.data.message).toMatch(/owner role cannot be changed/);
    const rm = await as(bob).del(`/api/ws/${wsId}/members/${alice.uuid}`);
    expect(rm.status).toBe(400);
    expect(rm.data.message).toMatch(/owner cannot be removed/);
    const leave = await as(alice).del(`/api/ws/${wsId}/members/${alice.uuid}`);
    expect(leave.status).toBe(400);
    expect(leave.data.message).toMatch(/owner cannot leave/);
    // The only other admin may leave; the owner remains an admin.
    expect((await as(bob).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).members[alice.uuid].role).toBe('owner');
    // A lapsed external: no role here, whatever their standing.
    await rt.kv.update(KEYS.ws(wsId), { [`members.${carol.uuid}`]: { username: 'carol', name: 'Carol', role: 'external', exp: Date.now() - 86400_000, org: { ref: 'x', name: 'Other' }, joinedAt: Date.now() } });
    const ext = await as(alice).post(`/api/ws/${wsId}/members/${carol.uuid}/role`, { role: 'member' });
    expect(ext.status).toBe(400);
    expect(ext.data.message).toMatch(/connected workspace/);
    expect((await as(alice).post(`/api/ws/${wsId}/members/${carol.uuid}/role`, { role: 'owner' })).status).toBe(400);
  });

  it('makes a guest an admin in one step, landing them in the defaults and off the guest counts', async () => {
    const { wsId, general } = await workspaceWith(alice, []);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, {});
    expect((await as(bob).post('/api/join', { code: inv.data.code })).data.guest).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.members[bob.uuid].role).toBe('admin');
    expect(ws.channels[secret].guests || 0).toBe(0);
    expect(ws.channels[general.id].count).toBe(2);
    const doc = await rt.kv.get(KEYS.member(wsId, bob.uuid));
    expect(doc.channels).toEqual(expect.arrayContaining([secret, general.id]));
    expect(doc.role).toBe('admin');
    // Bob, an admin now, may change roles and see the workspace's invite.
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.workspace.invite).toBeTruthy();
  });

  it('promotes a guest whose document is missing without failing, entering the defaults', async () => {
    const { wsId, general } = await workspaceWith(alice, []);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, {});
    expect((await as(bob).post('/api/join', { code: inv.data.code })).data.guest).toBe(true);
    await rt.kv.del(KEYS.member(wsId, bob.uuid));
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'member' })).ok).toBe(true);
    const doc = await rt.kv.get(KEYS.member(wsId, bob.uuid));
    expect(doc.channels).toEqual([general.id]);
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.me.role).toBe('member');
  });
});

describe('read cursors at their edges', () => {
  it('refuses a cursor in a direct message the caller is not in, takes one in a thread whose root is gone, and stores a cursor past the head as given', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).data.conv;
    expect((await as(carol).post(`/api/ws/${wsId}/conv/${dm}/read`, { seq: 1, back: true })).status).toBe(404);
    const root = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' })).data.message.seq;
    const thread = `${general.id}_t${root}`;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${thread}/messages`, { text: 'reply' })).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${root}`)).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${thread}/read`, { seq: 1 })).ok).toBe(true);
    const far = await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 5000 });
    expect(far.ok).toBe(true);
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).reads[general.id]).toBe(5000);
  });

  it('a mention inside a thread is counted on the parent, and a read of the parent at its end clears it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const root = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' })).data.message.seq;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: root })).ok).toBe(true);
    const thread = `${general.id}_t${root}`;
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${thread}/messages`, { text: '@bob look' })).ok).toBe(true);
    let doc = await rt.kv.get(KEYS.member(wsId, bob.uuid));
    expect(doc.mentions[general.id]).toBe(1);
    // Reading the thread to its end leaves the parent's count; reading the parent where it stands clears it.
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${thread}/read`, { seq: 1 })).ok).toBe(true);
    doc = await rt.kv.get(KEYS.member(wsId, bob.uuid));
    expect(doc.mentions[general.id]).toBe(1);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: root })).ok).toBe(true);
    doc = await rt.kv.get(KEYS.member(wsId, bob.uuid));
    expect(doc.mentions[general.id] || 0).toBe(0);
  });
});

describe('a profile at its edges', () => {
  it('takes a one-character name, clamps a long one, refuses one of spaces or of a direction override alone, and ignores a colour out of range', async () => {
    await workspaceWith(alice, [bob]);
    expect((await as(bob).put('/api/me', { name: 'B' })).data.profile.name).toBe('B');
    expect((await as(bob).put('/api/me', { name: 'x'.repeat(200) })).data.profile.name).toHaveLength(60);
    expect((await as(bob).put('/api/me', { name: '   ' })).status).toBe(400);
    expect((await as(bob).put('/api/me', { name: '‮' })).status).toBe(400);
    expect((await as(bob).put('/api/me', { name: '‮Bob' })).data.profile.name).toBe('Bob');
    const r = await as(bob).put('/api/me', { color: 9 });
    expect(r.ok).toBe(true);
    expect(r.data.profile.color).not.toBe(9);
    expect((await as(bob).put('/api/me', { color: 3 })).data.profile.color).toBe(3);
    // A status that has already run out is stored as sent; the app shows none past its time. A title keeps to one line's characters.
    const past = Date.now() - 60_000;
    expect((await as(bob).put('/api/me', { status: { text: 'out', emoji: '', until: past } })).data.profile.status.until).toBe(past);
    const t = (await as(bob).put('/api/me', { title: 'Head\nof things' })).data.profile.title;
    expect(t).not.toMatch(/ |/);
  });
});

describe('workspace settings at their edges', () => {
  const png = (n) => new File([new Uint8Array(n)], 'icon.png', { type: 'image/png' });
  const form = (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return fd;
  };

  it('refuses an empty or blank name, takes an emoji name, and lets only admins change settings', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    expect((await as(alice).put(`/api/ws/${wsId}`, { name: '' })).status).toBe(400);
    expect((await as(alice).put(`/api/ws/${wsId}`, { name: ' \t ' })).status).toBe(400);
    expect((await as(alice).put(`/api/ws/${wsId}`, { name: '🚀' })).data.workspace.name).toBe('🚀');
    const r = await as(bob).put(`/api/ws/${wsId}`, { unfurl: false });
    expect(r.status).toBe(403);
    expect((await rt.kv.get(KEYS.ws(wsId))).unfurl).not.toBe(false);
    expect((await as(alice).put(`/api/ws/${wsId}`, { unfurl: false })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).unfurl).toBe(false);
  });

  it('refuses an icon one byte over the cap, and takes one at it; only admins set it', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    expect((await as(alice).post(`/api/ws/${wsId}/icon`, form(png(300 * 1024 + 1)))).status).toBe(413);
    expect((await as(alice).post(`/api/ws/${wsId}/icon`, form(png(300 * 1024)))).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${wsId}/icon`)).status).toBe(200);
    expect((await as(bob).post(`/api/ws/${wsId}/icon`, form(png(10)))).status).toBe(403);
  });

  it('refuses an icon, or a profile photo, with no bytes at all, and keeps the one that stood', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    expect((await as(alice).post(`/api/ws/${wsId}/icon`, form(png(64)))).ok).toBe(true);
    const before = (await rt.kv.get(KEYS.ws(wsId))).icon;
    const empty = await as(alice).post(`/api/ws/${wsId}/icon`, form(png(0)));
    expect(empty.status).toBe(400);
    expect(empty.data.message).toMatch(/No image/);
    expect((await rt.kv.get(KEYS.ws(wsId))).icon).toBe(before);
    const icon = await as(bob).get(`/api/ws/${wsId}/icon`);
    expect(icon.status).toBe(200);
    expect((await icon.data.arrayBuffer()).byteLength).toBe(64);
    expect((await as(bob).post('/api/me/avatar', form(png(64)))).ok).toBe(true);
    const photo = await as(bob).post('/api/me/avatar', form(png(0)));
    expect(photo.status).toBe(400);
    expect(photo.data.message).toMatch(/No image/);
    const shown = await as(alice).get(`/api/ws/${wsId}/members/${bob.uuid}/avatar`);
    expect(shown.status).toBe(200);
    expect((await shown.data.arrayBuffer()).byteLength).toBe(64);
  });
});

describe('an invite code at its edges', () => {
  it('is dead at its expiry instant, once rotated, and for a channel archived or deleted since it was minted', async () => {
    const { wsId, code } = await workspaceWith(alice, []);
    // Expired this very millisecond: the code carries its own expiry, checked before the key's TTL fires.
    await rt.kv.update(KEYS.invite(code), { exp: Date.now() });
    const dead = await as(bob).post('/api/join', { code });
    expect(dead.status).toBe(404);
    expect(dead.data.code).toBe('invite_not_found');
    await rt.kv.update(KEYS.invite(code), { exp: Date.now() + 3600_000 });
    // Rotated: the old code is dead the moment the new one stands, the new one joins.
    const rotated = (await as(alice).put(`/api/ws/${wsId}`, { rotateInvite: true })).data.workspace.invite;
    expect(rotated).not.toBe(code);
    expect((await as(bob).post('/api/join', { code })).status).toBe(404);
    expect((await as(bob).post('/api/join', { code: rotated })).ok).toBe(true);
    // A guest link for a channel archived since, or deleted since.
    const mk = async (name) => (await as(alice).post(`/api/ws/${wsId}/channels`, { name, private: true })).data.channel.id;
    const arch = await mk('arch');
    const gone = await mk('gone');
    const archCode = (await as(alice).post(`/api/ws/${wsId}/channels/${arch}/invites`, {})).data.code;
    const goneCode = (await as(alice).post(`/api/ws/${wsId}/channels/${gone}/invites`, {})).data.code;
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${arch}`, { archived: true })).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${gone}`)).ok).toBe(true);
    expect((await as(carol).post('/api/join', { code: archCode })).status).toBe(404);
    expect((await as(carol).post('/api/join', { code: goneCode })).status).toBe(404);
    expect((await rt.kv.get(KEYS.ws(wsId))).members[carol.uuid]).toBeUndefined();
    // Each refusal counted against the guesser's budget; a live code still joins within it.
    expect(Number(await rt.kv.get(`tc:joinfail:${carol.uuid}`))).toBe(2);
  });

  it('is read from full-width letters and digits as from half-width ones', async () => {
    const { normalizeInviteCode } = await import('../src/shared/ids.js');
    expect(normalizeInviteCode('ＡＢＣＤ－ＥＦＧＨ－ＪＫＬＭ')).toBe('ABCD-EFGH-JKLM');
    expect(normalizeInviteCode('ａｂｃｄ ｅｆｇｈ ２３４５')).toBe('ABCD-EFGH-2345');
    expect(normalizeInviteCode('abcd-efgh-jklm')).toBe('ABCD-EFGH-JKLM');
    expect(normalizeInviteCode('ABCD-EFGH-JKL')).toBeNull();
    const { wsId, code } = await workspaceWith(alice, []);
    const wide = code.replace(/[A-Z0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
    expect((await as(bob).post('/api/join', { code: wide })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid]).toBeTruthy();
  });
});

/** A poll that finds the queue due: the next due time is set to the past, then one member syncs. */
async function pollDue(u, wsId) {
  await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
  const r = await as(u).get(`/api/ws/${wsId}/sync?since=0`);
  expect(r.ok).toBe(true);
}

async function upload(u, wsId, name = 'a.txt', bytes = 16) {
  const fd = new FormData();
  fd.append('file', new File([new Uint8Array(bytes)], name, { type: 'text/plain' }));
  const r = await as(u).post(`/api/ws/${wsId}/files`, fd);
  expect(r.ok).toBe(true);
  return r.data.file || r.data;
}

describe('a scheduled entry at its time', () => {
  const texts = async (u, wsId, conv) => (await as(u).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.filter((m) => m.kind === 'msg').map((m) => m.text);

  it('posts the words without a file whose record is gone, and keeps a message of that file alone for its author as not sent', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const f1 = await upload(bob, wsId, 'one.txt');
    const f2 = await upload(bob, wsId, 'two.txt');
    const due = Date.now() - 30_000;
    const withText = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'see file', attachments: [{ id: f1.id }], dueAt: due })).data.scheduled;
    const alone = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: '', attachments: [{ id: f2.id }], dueAt: due })).data.scheduled;
    expect(withText && alone).toBeTruthy();
    await rt.kv.del(KEYS.file(f1.id));
    await rt.kv.del(KEYS.file(f2.id));
    await pollDue(alice, wsId);
    const msgs = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages;
    const posted = msgs.find((m) => m.text === 'see file');
    expect(posted).toBeTruthy();
    expect(posted.attachments).toEqual([]);
    const mine = (await as(bob).get(`/api/ws/${wsId}/scheduled`)).data.scheduled;
    expect(mine.map((e) => e.id)).toEqual([alone.id]);
    expect(mine[0].failed).toMatchObject({ code: 'invalid' });
    expect(mine[0].failed.message).toMatch(/not in this workspace/);
  });

  it('lets a reminder about a message deleted since go, with no line and no entry', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const seq = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'gone soon' })).data.message.seq;
    const r = (await as(bob).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq, dueAt: Date.now() - 30_000 })).data.reminder;
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${seq}`)).ok).toBe(true);
    await pollDue(alice, wsId);
    expect((await rt.kv.get(KEYS.sched(wsId)))?.m?.[r.id]).toBeUndefined();
    expect((await as(bob).get(`/api/ws/${wsId}/scheduled`)).data.reminders).toEqual([]);
    const inbox = (await as(bob).get(`/api/ws/${wsId}/inbox`)).data.items;
    expect(inbox.filter((e) => e.k === 'reminder')).toHaveLength(0);
    expect(Object.keys((await rt.kv.get(KEYS.member(wsId, bob.uuid))).dms || {})).toHaveLength(0);
  });

  it('is kept for its author as not sent when the channel was archived, with the archived words, and goes with a channel deleted', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const mk = async (name) => (await as(alice).post(`/api/ws/${wsId}/channels`, { name })).data.channel.id;
    const arch = await mk('arch');
    const gone = await mk('gone');
    for (const c of [arch, gone]) expect((await as(bob).post(`/api/ws/${wsId}/channels/${c}/join`)).ok).toBe(true);
    const due = Date.now() - 30_000;
    const a = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: arch, text: 'to arch', dueAt: due })).data.scheduled;
    const g = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: gone, text: 'to gone', dueAt: due })).data.scheduled;
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${arch}`, { archived: true })).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${gone}`)).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${wsId}/scheduled`)).data.scheduled.map((e) => e.id)).toEqual([a.id]);
    await pollDue(alice, wsId);
    const mine = (await as(bob).get(`/api/ws/${wsId}/scheduled`)).data.scheduled;
    expect(mine.map((e) => e.id)).toEqual([a.id]);
    expect(mine[0].failed).toMatchObject({ code: 'archived', message: 'This channel is archived' });
    expect((await rt.kv.get(KEYS.sched(wsId))).m[g.id]).toBeUndefined();
  });

  it('takes a time up to a minute ago and refuses one earlier, at the horizon and past it, and anything that is not a time', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const e = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt: Date.now() + 3600_000 })).data.scheduled;
    const past = await as(bob).put(`/api/ws/${wsId}/scheduled/${e.id}`, { dueAt: Date.now() - 120_000 });
    expect(past.status).toBe(400);
    expect(past.data.message).toMatch(/time in the future/);
    expect((await as(bob).put(`/api/ws/${wsId}/scheduled/${e.id}`, { dueAt: Date.now() - 30_000 })).ok).toBe(true);
    const horizon = 400 * 86400_000;
    expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'far', dueAt: Date.now() + horizon - 5000 })).ok).toBe(true);
    const far = await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'too far', dueAt: Date.now() + horizon + 60_000 });
    expect(far.status).toBe(400);
    expect(far.data.message).toMatch(/more than a year/);
    for (const dueAt of ['soon', NaN, -5, null, undefined, {}, [], true]) {
      expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'x', dueAt })).status, String(dueAt)).toBe(400);
    }
    expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'numeric string', dueAt: String(Date.now() + 3600_000) })).ok).toBe(true);
    // The one moved into the last minute goes out on the next poll.
    await pollDue(alice, wsId);
    expect(await texts(alice, wsId, general.id)).toContain('later');
  });

  it('is sent once by two polls at the same instant, and taken over by a later poll once a dead delivery\'s claim is stale', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const e = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'once', dueAt: Date.now() - 30_000 })).data.scheduled;
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    await Promise.all([as(alice).get(`/api/ws/${wsId}/sync?since=0`), as(bob).get(`/api/ws/${wsId}/sync?since=0`)]);
    expect((await texts(alice, wsId, general.id)).filter((t) => t === 'once')).toHaveLength(1);
    const dead = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'dead', dueAt: Date.now() - 30_000 })).data.scheduled;
    await rt.kv.update(KEYS.sched(wsId), { [`m.${dead.id}.claims`]: 1, [`m.${dead.id}.claimedAt`]: Date.now() - 1000 });
    await pollDue(alice, wsId);
    expect(await texts(alice, wsId, general.id)).not.toContain('dead');
    await rt.kv.update(KEYS.sched(wsId), { [`m.${dead.id}.claimedAt`]: Date.now() - 6 * 60_000 });
    await pollDue(alice, wsId);
    expect((await texts(alice, wsId, general.id)).filter((t) => t === 'dead')).toHaveLength(1);
  });

  it('goes with an author an admin removes; one who left the channel is kept as not sent, and one made a guest still in it goes out', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const due = Date.now() + 3600_000;
    const b = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'from bob', dueAt: due })).data.scheduled;
    expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.sched(wsId)))?.m?.[b.id]).toBeUndefined();
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    expect((await as(carol).post(`/api/ws/${wsId}/channels/${ops}/join`)).ok).toBe(true);
    // Carol leaves #ops before her message there is due: it cannot go, and she is told to join the channel.
    const left = (await as(carol).post(`/api/ws/${wsId}/scheduled`, { conv: ops, text: 'from carol', dueAt: Date.now() - 30_000 })).data.scheduled;
    const stays = (await as(carol).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'still here', dueAt: Date.now() - 30_000 })).data.scheduled;
    expect((await as(carol).post(`/api/ws/${wsId}/channels/${ops}/leave`)).ok).toBe(true);
    await pollDue(alice, wsId);
    expect(await texts(alice, wsId, ops)).not.toContain('from carol');
    expect(await texts(alice, wsId, general.id)).toContain('still here');
    let mine = (await as(carol).get(`/api/ws/${wsId}/scheduled`)).data.scheduled;
    expect(mine.map((e) => e.id)).toEqual([left.id]);
    expect(stays.id).not.toBe(left.id);
    expect(mine[0].failed).toMatchObject({ code: 'not_joined', message: 'Join the channel to post' });
    // Made a guest meanwhile, still in #general: a message there goes out as a guest's; the one for #ops, a channel she cannot see now, stays hers to delete.
    expect((await as(alice).post(`/api/ws/${wsId}/members/${carol.uuid}/role`, { role: 'guest' })).ok).toBe(true);
    expect((await as(carol).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'as a guest', dueAt: Date.now() - 30_000 })).ok).toBe(true);
    await pollDue(alice, wsId);
    expect(await texts(alice, wsId, general.id)).toContain('as a guest');
    mine = (await as(carol).get(`/api/ws/${wsId}/scheduled`)).data.scheduled;
    expect(mine.map((e) => e.id)).toEqual([left.id]);
    expect((await as(carol).del(`/api/ws/${wsId}/scheduled/${left.id}`)).ok).toBe(true);
  });
});

describe('presence and typing at their edges', () => {
  it('a tab saying goodbye leaves the member away until another tab of theirs heartbeats, which takes the word off', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    expect((await as(bob).del(`/api/ws/${wsId}/presence`)).ok).toBe(true);
    let act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.ps[bob.uuid]).toBe('off');
    const seen = (await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).data;
    expect(seen.ps[bob.uuid]).toBe('off');
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0&hb=1`)).ok).toBe(true);
    act = await rt.kv.get(KEYS.activity(wsId));
    expect(act.ps?.[bob.uuid]).toBeUndefined();
    expect(act.p[bob.uuid]).toBeGreaterThan(0);
    // Do not disturb, then plain again.
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0&hb=1&st=dnd`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.activity(wsId))).ps[bob.uuid]).toBe('dnd');
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0&hb=1`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.activity(wsId))).ps?.[bob.uuid]).toBeUndefined();
    // A word the worker does not know is no state at all.
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0&hb=1&st=idle`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.activity(wsId))).ps?.[bob.uuid]).toBeUndefined();
  });

  it('typing is refused where the caller cannot read, and written nowhere they cannot post', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${secret}/typing`, {})).status).toBe(404);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${secret}_t1/typing`, {})).status).toBe(404);
    const random = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'random' })).data.channel.id;
    const seq = (await as(alice).post(`/api/ws/${wsId}/conv/${random}/messages`, { text: 'root' })).data.message.seq;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${random}/typing`, {})).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${random}_t${seq}/typing`, {})).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}_t999/typing`, {})).status).toBe(404);
    expect((await rt.kv.get(KEYS.activity(wsId))).t).toBeUndefined();
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/typing`, {})).ok).toBe(true);
    expect((await rt.kv.get(KEYS.activity(wsId))).t[general.id][bob.uuid]).toBeGreaterThan(0);
    // The others see it; the typist does not see their own.
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).data.t[general.id][bob.uuid]).toBeGreaterThan(0);
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).data.t).toBeUndefined();
  });

  it('a device\'s time zone offset out of range or not a number is kept as sent or as none, and never breaks quiet hours', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const sub = (tzOffset) => ({ subscription: { endpoint: `https://push.example.com/${String(tzOffset)}`, keys: { p256dh: 'BPd'.padEnd(87, 'A'), auth: 'x'.padEnd(22, 'B') } }, prefs: { tzOffset, dnd: { enabled: true, from: 1320, to: 480 } } });
    expect((await as(bob).post(`/api/ws/${wsId}/push`, sub(900))).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/push`, sub('abc'))).ok).toBe(true);
    const subs = Object.values((await rt.kv.get(KEYS.member(wsId, bob.uuid))).push);
    expect(subs.map((s) => s.prefs.tzOffset).sort()).toEqual([0, 900]);
    const { pushAllowed } = await import('../worker/push.js');
    for (const s of subs) expect(typeof pushAllowed(s.prefs)).toBe('boolean');
  });
});

describe('quiet hours on the worker', () => {
  it('holds a window across midnight in the device\'s own zone, lets one with no width through, and forgets a pause that has run out', async () => {
    const { pushAllowed } = await import('../worker/push.js');
    const at = (h, m) => Date.UTC(2026, 0, 15, h, m);
    const night = { tzOffset: 0, dnd: { enabled: true, from: 22 * 60, to: 8 * 60 } };
    expect(pushAllowed(night, at(23, 59))).toBe(false);
    expect(pushAllowed(night, at(0, 1))).toBe(false);
    expect(pushAllowed(night, at(7, 59))).toBe(false);
    expect(pushAllowed(night, at(8, 0))).toBe(true);
    expect(pushAllowed(night, at(21, 59))).toBe(true);
    expect(pushAllowed(night, at(22, 0))).toBe(false);
    // Tokyo (+9): 23:59 there is 14:59 UTC.
    const tokyo = { ...night, tzOffset: 540 };
    expect(pushAllowed(tokyo, at(14, 59))).toBe(false);
    expect(pushAllowed(tokyo, at(23, 0))).toBe(true);
    // Los Angeles (-8): 07:59 there is 15:59 UTC.
    const la = { ...night, tzOffset: -480 };
    expect(pushAllowed(la, at(15, 59))).toBe(false);
    expect(pushAllowed(la, at(16, 0))).toBe(true);
    expect(pushAllowed({ tzOffset: 0, dnd: { enabled: true, from: 600, to: 600 } }, at(10, 0))).toBe(true);
    expect(pushAllowed({ tzOffset: 0, dnd: { enabled: false, from: 0, to: 1440 } }, at(10, 0))).toBe(true);
    expect(pushAllowed({ pauseUntil: at(9, 0) }, at(10, 0))).toBe(true);
    expect(pushAllowed({ pauseUntil: at(11, 0) }, at(10, 0))).toBe(false);
    expect(pushAllowed(null, at(10, 0))).toBe(true);
  });

  it('a paused device gets no push for a direct message either', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    // A real key pair, as a browser hands one over: the payload is encrypted to it before anything is sent.
    const { b64url } = await import('../worker/push.js');
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const keys = { p256dh: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
    const sub = (path, prefs) => ({ subscription: { endpoint: `https://push.example.com/${path}`, keys }, prefs });
    expect((await as(bob).post(`/api/ws/${wsId}/push`, sub('paused', { pauseUntil: Date.now() + 3600_000 }))).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/push`, sub('awake', { pauseUntil: Date.now() - 1 }))).ok).toBe(true);
    const origFetch = globalThis.fetch;
    const hit = [];
    globalThis.fetch = async (url) => { hit.push(String(url)); return new Response('', { status: 201 }); };
    try {
      const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).data.conv;
      expect((await as(alice).post(`/api/ws/${wsId}/conv/${dm}/messages`, { text: 'psst' })).ok).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
    expect(hit).toEqual(['https://push.example.com/awake']);
  });
});

describe('changing how a conversation notifies, at the edges', () => {
  it('refuses a level it does not know, a mute that is not yes or no, a follow of a channel or of a root gone without replies, and pokes once for several changes', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const put = (conv, body) => as(bob).put(`/api/ws/${wsId}/conv/${conv}/notify`, body);
    expect((await put(general.id, { level: 'loud' })).status).toBe(400);
    expect((await put(general.id, { mute: 'yes' })).status).toBe(400);
    expect((await put(general.id, { follow: true })).status).toBe(400);
    expect((await put(general.id, {})).status).toBe(400);
    const lone = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'lone' })).data.message.seq;
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${lone}`)).ok).toBe(true);
    expect((await put(`${general.id}_t${lone}`, { follow: true })).status).toBe(404);
    const root = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' })).data.message.seq;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}_t${root}/messages`, { text: 'reply' })).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${root}`)).ok).toBe(true);
    expect((await put(`${general.id}_t${root}`, { follow: false })).ok).toBe(true);
    const orig = rt.kv.incr;
    let pokes = 0;
    rt.kv.incr = async (k, arg) => {
      if (k === KEYS.activity(wsId) && arg && Object.hasOwn(arg, `u.${bob.uuid}`)) pokes++;
      return orig(k, arg);
    };
    try {
      const r = await put(general.id, { level: 'all', mute: true });
      expect(r.ok).toBe(true);
      expect(r.data.notify).toMatchObject({ level: 'all', mute: true });
    } finally {
      rt.kv.incr = orig;
    }
    expect(pokes).toBe(1);
    expect((await rt.kv.get(KEYS.member(wsId, bob.uuid))).notify[general.id]).toMatchObject({ level: 'all', mute: true });
  });
});

describe('a workspace its owner deletes', () => {
  it('leaves nothing reachable: lists, documents, tokens, invites, the queue; a member polling meanwhile is turned away and forgets it', async () => {
    const { wsId, general, code } = await workspaceWith(alice, [bob]);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const bot = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Helper', channels: [general.id], scopes: ['post'] })).data;
    expect(hook.token && bot.token).toBeTruthy();
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    const guestCode = (await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, {})).data.code;
    expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'due now', dueAt: Date.now() - 30_000 })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/huddle`, { invite: 'NJ-7F3A9C' })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'hello' })).ok).toBe(true);
    expect((await as(bob).del(`/api/ws/${wsId}`)).status).toBe(403);
    expect((await as(alice).del(`/api/ws/${wsId}`)).data.deleted).toBe(true);
    for (const key of [KEYS.ws(wsId), KEYS.activity(wsId), KEYS.sched(wsId), KEYS.invite(code), KEYS.invite(guestCode), KEYS.hook(hook.id), KEYS.bot(bot.id), KEYS.member(wsId, alice.uuid), KEYS.member(wsId, bob.uuid), KEYS.seq(general.id), KEYS.block(general.id, 0)]) {
      expect(await rt.kv.get(key), key).toBeFalsy();
    }
    for (const u of [alice, bob]) expect((await rt.kv.get(KEYS.user(u.uuid))).workspaces).not.toContain(wsId);
    expect((await as(bob).get('/api/me')).data.workspaces.map((w) => w.id)).not.toContain(wsId);
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).status).toBe(403);
    expect((await as(bob).get(`/api/ws/${wsId}`)).status).toBe(404);
    // A token whose record went with the workspace is a token nobody has.
    expect([401, 404]).toContain((await as(null).post(`/webhook/${hook.token}`, { text: 'late' })).status);
    expect([401, 404]).toContain((await as(null).post(`/bot/${bot.token}/channels/${general.id}/messages`, { text: 'late' })).status);
    expect((await as(carol).post('/api/join', { code })).status).toBe(404);
    expect((await as(carol).post('/api/join', { code: guestCode })).status).toBe(404);
  });
});

describe('externals and guests at their edges', () => {
  it('lets a lapsed seat go only past the grace, and restores nobody who was never removed', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const grace = 30 * 86400_000;
    const card = (exp) => ({ username: 'carol', name: 'Carol', color: 2, role: 'external', exp, att: exp - 86400_000, org: { ref: 'partner', name: 'Other' }, joinedAt: Date.now() - 86400_000 });
    // A minute inside the grace: not yet let go of.
    await rt.kv.update(KEYS.ws(wsId), { [`members.${carol.uuid}`]: card(Date.now() - grace + 60_000), [`channels.${general.id}.count`]: 3 });
    await rt.kv.set(KEYS.member(wsId, carol.uuid), { channels: [general.id], dms: {}, reads: {}, joinedAt: Date.now() });
    expect((await as(alice).get(`/api/ws/${wsId}`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).members[carol.uuid]).toBeTruthy();
    await rt.kv.update(KEYS.ws(wsId), { [`members.${carol.uuid}.exp`]: Date.now() - grace - 60_000 });
    expect((await as(alice).get(`/api/ws/${wsId}`)).ok).toBe(true);
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.members[carol.uuid]).toBeUndefined();
    expect(ws.channels[general.id].count).toBe(2);
    expect(ws.former[carol.uuid]).toMatchObject({ name: 'Carol', org: { name: 'Other' } });
    expect(await rt.kv.get(KEYS.member(wsId, carol.uuid))).toBeFalsy();
    const r = await as(alice).del(`/api/ws/${wsId}/removed/${carol.uuid}`);
    expect(r.status).toBe(404);
    expect(r.data.message).toMatch(/Nobody by that id/);
    expect((await as(bob).del(`/api/ws/${wsId}/removed/${carol.uuid}`)).status).toBe(403);
  });

  it('a guest of one channel may not leave it once archived either, and is told what to do', async () => {
    const { wsId } = await workspaceWith(alice, []);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, {});
    expect((await as(bob).post('/api/join', { code: inv.data.code })).data.guest).toBe(true);
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${secret}`, { archived: true })).ok).toBe(true);
    const r = await as(bob).post(`/api/ws/${wsId}/channels/${secret}/leave`);
    expect(r.status).toBe(400);
    expect(r.data.code).toBe('last_channel');
    expect(r.data.message).toMatch(/leave the workspace instead/);
    expect((await as(bob).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).members[bob.uuid]).toBeUndefined();
  });
});

describe('editing a scheduled message a poll is sending this moment', () => {
  it('is told the message is being sent, as deleting it is, not that nothing is scheduled', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const dueAt = Date.now() + 3600_000;
    const e = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt })).data.scheduled;
    const seq = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'remind me' })).data.message.seq;
    const r = (await as(bob).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq, dueAt })).data.reminder;
    // A poll has claimed both for delivery.
    await rt.kv.update(KEYS.sched(wsId), { [`m.${e.id}.claims`]: 1, [`m.${e.id}.claimedAt`]: Date.now(), [`m.${r.id}.claims`]: 1, [`m.${r.id}.claimedAt`]: Date.now() });
    const del = await as(bob).del(`/api/ws/${wsId}/scheduled/${e.id}`);
    expect(del.status).toBe(409);
    expect(del.data.code).toBe('sending');
    for (const body of [{ text: 'changed' }, { dueAt: dueAt + 60_000 }, { sendNow: true }]) {
      const put = await as(bob).put(`/api/ws/${wsId}/scheduled/${e.id}`, body);
      expect(put.status).toBe(409);
      expect(put.data.code).toBe('sending');
      expect(put.data.message).toBe(del.data.message);
    }
    const rem = await as(bob).put(`/api/ws/${wsId}/scheduled/${r.id}`, { dueAt: dueAt + 60_000 });
    expect(rem.status).toBe(409);
    expect(rem.data.message).toMatch(/reminder is being delivered/);
    // Another member's entry, or one that is not there, is still nothing to them.
    expect((await as(alice).put(`/api/ws/${wsId}/scheduled/${e.id}`, { text: 'x' })).status).toBe(404);
    expect((await as(bob).put(`/api/ws/${wsId}/scheduled/nope`, { text: 'x' })).status).toBe(404);
    // A claim gone stale (a delivery that died) is no delivery: the entry is the author's again.
    await rt.kv.update(KEYS.sched(wsId), { [`m.${e.id}.claimedAt`]: Date.now() - 6 * 60_000 });
    expect((await as(bob).put(`/api/ws/${wsId}/scheduled/${e.id}`, { text: 'changed' })).ok).toBe(true);
  });
});
