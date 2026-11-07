/**
 * Identity, membership, notification and scheduling routes: what the
 * twenty-third review pass found.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import { cleanText, LIMITS } from '../src/shared/limits.js';
import { countKv } from './helpers/kvcount.js';

const { alice, bob } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

/**
 * A delivery works from the queue as the poll read it, then claims the
 * entry. An edit or a new time landing between the two used to be lost:
 * the poll posted the words it had read, the author was answered that
 * their change had been saved, and a message moved to tomorrow went out now.
 */
describe('a scheduled message edited or moved as the poll delivering it claims it', () => {
  const texts = async (wsId, conv) => (await as(alice).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.map((m) => m.text);
  const claimOf = (id) => (amount) => !!amount && typeof amount === 'object' && Object.hasOwn(amount, `m.${id}.claims`);

  it('goes out with the new words when the edit landed before the claim', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const sid = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'old', dueAt: Date.now() - 30_000 })).data.scheduled.id;
    const incr = rt.kv.incr;
    let edit = null;
    // The poll has read the queue (the entry says "old") and is about to claim it; bob's edit lands first.
    rt.kv.incr = async (k, amount) => {
      if (k === KEYS.sched(wsId) && claimOf(sid)(amount) && !edit) {
        edit = await as(bob).put(`/api/ws/${wsId}/scheduled/${sid}`, { text: 'new' });
      }
      return incr(k, amount);
    };
    try {
      expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    } finally {
      rt.kv.incr = incr;
    }
    expect(edit.data).toEqual({ ok: true });
    expect(await texts(wsId, general.id)).toEqual(['alice created #general', 'bob joined', 'new']);
    expect((await rt.kv.get(KEYS.sched(wsId))).m[sid]).toBeUndefined();
  });

  it('answers the edit as a message being sent already when the claim landed first, and the old words go out', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const sid = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'old', dueAt: Date.now() - 30_000 })).data.scheduled.id;
    const incr = rt.kv.incr;
    const update = rt.kv.update;
    let claimed;
    let release;
    const claimedP = new Promise((r) => { claimed = r; });
    const releaseP = new Promise((r) => { release = r; });
    let poll = null;
    // Bob's edit has read the queue (nothing claimed) and is about to write
    // its words; the poll claims the entry first, and holds there.
    rt.kv.update = async (k, patch) => {
      if (k === KEYS.sched(wsId) && patch && Object.hasOwn(patch, `m.${sid}.text`)) {
        poll = as(alice).get(`/api/ws/${wsId}/sync?since=0`);
        await claimedP;
      }
      return update(k, patch);
    };
    rt.kv.incr = async (k, amount) => {
      const res = await incr(k, amount);
      if (k === KEYS.sched(wsId) && claimOf(sid)(amount)) {
        claimed();
        await releaseP;
      }
      return res;
    };
    let edit;
    try {
      edit = await as(bob).put(`/api/ws/${wsId}/scheduled/${sid}`, { text: 'new' });
      release();
      expect((await poll).ok).toBe(true);
    } finally {
      rt.kv.incr = incr;
      rt.kv.update = update;
    }
    expect(edit.status).toBe(409);
    expect(edit.data).toMatchObject({ code: 'sending' });
    expect(await texts(wsId, general.id)).toEqual(['alice created #general', 'bob joined', 'old']);
    expect((await rt.kv.get(KEYS.sched(wsId))).m[sid]).toBeUndefined();
  });

  it('is not delivered when it was moved to a later time before the claim, and waits for that time', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const sid = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt: Date.now() - 30_000 })).data.scheduled.id;
    const later = Date.now() + 3600_000;
    const incr = rt.kv.incr;
    let moved = null;
    rt.kv.incr = async (k, amount) => {
      if (k === KEYS.sched(wsId) && claimOf(sid)(amount) && !moved) {
        moved = await as(bob).put(`/api/ws/${wsId}/scheduled/${sid}`, { dueAt: later });
      }
      return incr(k, amount);
    };
    try {
      expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    } finally {
      rt.kv.incr = incr;
    }
    expect(moved.data).toEqual({ ok: true });
    expect(await texts(wsId, general.id)).toEqual(['alice created #general', 'bob joined']);
    const entry = (await rt.kv.get(KEYS.sched(wsId))).m[sid];
    expect(entry).toMatchObject({ dueAt: later, text: 'later' });
    // The claim is let go of: the entry is its author's again, listed and editable.
    expect(entry.claims).toBeUndefined();
    expect((await as(bob).get(`/api/ws/${wsId}/scheduled`)).data.scheduled.map((e) => e.id)).toEqual([sid]);
    expect((await rt.kv.get(KEYS.activity(wsId))).nd).toBe(later);
    // And a later poll leaves it be.
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect(await texts(wsId, general.id)).toEqual(['alice created #general', 'bob joined']);
  });
});

/**
 * Deleting a scheduled message read the queue, found the entry unclaimed,
 * and took it off; a poll that claimed it between the two posted it all the
 * same, and the author was answered "deleted" for a message that went out.
 */
describe('a scheduled message deleted as the poll delivering it claims it', () => {
  const texts = async (wsId, conv) => (await as(alice).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.map((m) => m.text);
  const claimOf = (id) => (amount) => !!amount && typeof amount === 'object' && Object.hasOwn(amount, `m.${id}.claims`);

  it('is answered as a message being sent already, and goes out', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const sid = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'going', dueAt: Date.now() - 30_000 })).data.scheduled.id;
    const get = rt.kv.get;
    const incr = rt.kv.incr;
    let claimed;
    let release;
    const claimedP = new Promise((r) => { claimed = r; });
    const releaseP = new Promise((r) => { release = r; });
    let poll = null;
    let claims = 0;
    // Bob's deletion reads the queue (nothing claimed); before it goes on, a
    // poll claims the entry and holds there, about to post it.
    rt.kv.get = async (k) => {
      const res = await get(k);
      if (k === KEYS.sched(wsId) && !poll) {
        poll = as(alice).get(`/api/ws/${wsId}/sync?since=0`);
        await claimedP;
      }
      return res;
    };
    rt.kv.incr = async (k, amount) => {
      const res = await incr(k, amount);
      if (k === KEYS.sched(wsId) && claimOf(sid)(amount) && ++claims === 1) {
        claimed();
        await releaseP;
      }
      return res;
    };
    let del;
    try {
      del = await as(bob).del(`/api/ws/${wsId}/scheduled/${sid}`);
      release();
      expect((await poll).ok).toBe(true);
    } finally {
      rt.kv.get = get;
      rt.kv.incr = incr;
    }
    expect(del.status).toBe(409);
    expect(del.data).toMatchObject({ code: 'sending' });
    expect(await texts(wsId, general.id)).toEqual(['alice created #general', 'bob joined', 'going']);
    expect((await rt.kv.get(KEYS.sched(wsId))).m[sid]).toBeUndefined();
  });

  it('"Send now" that finds the entry gone (another tab deleted it) is answered as nothing scheduled, not as being sent', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const sid = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'going', dueAt: Date.now() + 3600_000 })).data.scheduled.id;
    const get = rt.kv.get;
    let taken = false;
    // The queue may be read on its own or as one key of a batched read (see
    // getMany), and the race is the same either way: the moment it has been
    // read, another tab takes the entry out.
    rt.kv.get = async (k) => {
      const res = await get(k);
      if ([].concat(k).includes(KEYS.sched(wsId)) && !taken) {
        taken = true;
        expect((await as(bob).del(`/api/ws/${wsId}/scheduled/${sid}`)).ok).toBe(true);
      }
      return res;
    };
    let send;
    try {
      send = await as(bob).put(`/api/ws/${wsId}/scheduled/${sid}`, { sendNow: true });
    } finally {
      rt.kv.get = get;
    }
    expect(send.status).toBe(404);
    expect(send.data).toMatchObject({ code: 'not_found', message: 'Nothing scheduled with that id' });
    expect((await rt.kv.get(KEYS.sched(wsId))).m).toEqual({});
    expect((await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.map((m) => m.text)).toEqual(['alice created #general', 'bob joined']);
  });

  it('a deletion that finds the entry gone (another tab deleted it) is answered as nothing scheduled, not as deleted twice', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const sid = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'going', dueAt: Date.now() + 3600_000 })).data.scheduled.id;
    const get = rt.kv.get;
    let taken = false;
    rt.kv.get = async (k) => {
      const res = await get(k);
      if (k === KEYS.sched(wsId) && !taken) {
        taken = true;
        expect((await as(bob).del(`/api/ws/${wsId}/scheduled/${sid}`)).ok).toBe(true);
      }
      return res;
    };
    let del;
    try {
      del = await as(bob).del(`/api/ws/${wsId}/scheduled/${sid}`);
    } finally {
      rt.kv.get = get;
    }
    expect(del.status).toBe(404);
    expect(del.data).toMatchObject({ code: 'not_found' });
    // Nothing of the claim is left where the entry was.
    expect((await rt.kv.get(KEYS.sched(wsId))).m).toEqual({});
  });
});

/**
 * An edit whose entry another tab deleted between its read and its write
 * makes a stub of the patched fields, which is taken off again and the edit
 * refused; on a store that answers a write with the part it changed, a stub
 * already swept away by a poll before the edit read again left nothing to
 * judge by, and the edit was answered as saved.
 */
describe('a scheduled edit whose entry is gone by the time it reads the queue again', () => {
  it('is answered as nothing scheduled, not as saved', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const sid = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'old', dueAt: Date.now() + 3600_000 })).data.scheduled.id;
    const update = rt.kv.update;
    rt.kv.update = async (k, patch) => {
      const res = await update(k, patch);
      if (k === KEYS.sched(wsId) && patch && Object.hasOwn(patch, `m.${sid}.text`)) {
        // Another tab's deletion landed before this write (the write made a
        // stub), and a poll swept the stub before this request reads again.
        await rt.kv.remove(k, `m.${sid}`);
        // A store that answers with the part it changed.
        return { m: { [sid]: { text: patch[`m.${sid}.text`] } } };
      }
      return res;
    };
    let edit;
    try {
      edit = await as(bob).put(`/api/ws/${wsId}/scheduled/${sid}`, { text: 'new' });
    } finally {
      rt.kv.update = update;
    }
    expect(edit.status).toBe(404);
    expect(edit.data).toMatchObject({ code: 'not_found' });
    expect((await rt.kv.get(KEYS.sched(wsId))).m).toEqual({});
  });
});

/**
 * Every bounded text on the server (a name, a title, a status, a workspace's
 * name, a topic, a note, a message) is cut by UTF-16 units; the cut must
 * fall between whole characters as the reader sees them, not inside an
 * emoji written as a sequence (see cleanText, cutWhole).
 */
describe('a server-side cut that falls inside an emoji sequence', () => {
  const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'; // 11 units
  const flag = '\u{1F1FA}\u{1F1F8}'; // 4 units
  const keycap = '1️⃣'; // 3 units
  const toned = '\u{1F44D}\u{1F3FD}'; // 4 units

  it('cuts before the sequence, whole, rather than through it', () => {
    expect(cleanText(`${'a'.repeat(58)}${family}`, 60)).toBe('a'.repeat(58));
    expect(cleanText(`${'a'.repeat(58)}${flag}`, 60)).toBe('a'.repeat(58));
    expect(cleanText(`${'a'.repeat(59)}${keycap}`, 60)).toBe('a'.repeat(59));
    expect(cleanText(`${'a'.repeat(58)}${toned}`, 60)).toBe('a'.repeat(58));
    // One that fits whole stays whole; the plain cases as before.
    expect(cleanText(`${'a'.repeat(49)}${family}`, 60)).toBe(`${'a'.repeat(49)}${family}`);
    expect(cleanText(`${'a'.repeat(49)}${family}b`, 60)).toBe(`${'a'.repeat(49)}${family}`);
    expect(cleanText('ab 😀', 4)).toBe('ab');
    expect(cleanText('😀', 1)).toBe('');
    expect(cleanText('x'.repeat(10), 4)).toBe('xxxx');
    expect(cleanText(`${'a'.repeat(4000)}${family}`, LIMITS.messageText)).toBe('a'.repeat(4000));
    expect(cleanText(`${'a'.repeat(3995)}${family}`, LIMITS.messageText)).toBe('a'.repeat(3995));
  });

  it('a run of combining marks longer than the window is cut by units where nothing else ends before the cut, never emptied', () => {
    const zalgo = `a${'́'.repeat(200)}`;
    expect(cleanText(zalgo, 60)).toHaveLength(60);
    // With whole characters before it, the run is one character that does not fit, and goes whole.
    expect(cleanText(`${'b'.repeat(10)}${zalgo}`, 60)).toBe('b'.repeat(10));
  });

  it('a name, a status and a workspace name sent longer than the app allows keep whole emoji at the edge', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const name = `${'n'.repeat(58)}${family}`;
    const me = await as(bob).put('/api/me', { name, status: { emoji: '', text: `${'s'.repeat(58)}${flag}` } });
    expect(me.data.profile.name).toBe('n'.repeat(58));
    expect(me.data.profile.status.text).toBe('s'.repeat(58));
    const card = (await as(alice).get(`/api/ws/${wsId}`)).data.workspace.members[bob.uuid];
    expect(card.name).toBe('n'.repeat(58));
    expect(card.status.text).toBe('s'.repeat(58));
    const ws = await as(alice).put(`/api/ws/${wsId}`, { name: `${'w'.repeat(59)}${keycap}` });
    expect(ws.data.workspace.name).toBe('w'.repeat(59));
  });
});

/**
 * Store round trips of the identity plane's routes (see tests/helpers/kvcount.js).
 */
describe('round trips: a route that reads nothing of the caller\'s own document does not read it', () => {
  const me = (wsId, u) => KEYS.member(wsId, u.uuid);

  it('a role given, a member removed, a setting changed, a device unsubscribed, a scheduled message deleted', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const sid = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt: Date.now() + 3600_000 })).data.scheduled.id;
    const c = countKv(rt);
    try {
      expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
      expect(c.keys.get).toEqual([KEYS.ws(wsId)]);
      c.reset();
      expect((await as(alice).put(`/api/ws/${wsId}`, { name: 'Acme Ltd' })).ok).toBe(true);
      expect(c.keys.get).toEqual([KEYS.ws(wsId)]);
      c.reset();
      expect((await as(bob).del(`/api/ws/${wsId}/push`, { endpoint: 'https://push.example.com/e/1' })).ok).toBe(true);
      expect(c.keys.get).toEqual([KEYS.ws(wsId)]);
      expect(c.total()).toBe(2);
      c.reset();
      expect((await as(bob).del(`/api/ws/${wsId}/scheduled/${sid}`)).ok).toBe(true);
      expect(c.keys.get.filter((k) => k === me(wsId, bob))).toEqual([]);
      c.reset();
      // A removal reads the target's document as its closing hands it back, and never the admin's.
      expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
      expect(c.keys.get.filter((k) => k === me(wsId, alice) || k === me(wsId, bob))).toEqual([]);
    } finally {
      c.restore();
    }
  });
});

describe('round trips: a member\'s poke and the workspace\'s bump go in one write', () => {
  const act = (wsId) => rt.kv.get(KEYS.activity(wsId));

  it('a role given costs the activity document one write, and both stamps move', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const before = await act(wsId);
    const c = countKv(rt);
    try {
      expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
      expect(c.keys.incr.filter((k) => k === KEYS.activity(wsId))).toHaveLength(1);
      expect(c.total()).toBe(4);
    } finally {
      c.restore();
    }
    const after = await act(wsId);
    expect(after.w).toBe(before.w + 1);
    expect(after.u[bob.uuid] || 0).toBe((before.u?.[bob.uuid] || 0) + 1);
  });

  it('a member entering a channel by its link, and a guest made a member by the workspace\'s link, likewise', async () => {
    const { wsId, code } = await workspaceWith(alice, [bob]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel;
    const ginv = (await as(alice).post(`/api/ws/${wsId}/channels/${ops.id}/invites`, {})).data.code;
    expect((await as(USERS.carol).post('/api/join', { code: ginv })).data).toMatchObject({ guest: true });
    const c = countKv(rt);
    try {
      expect((await as(bob).post('/api/join', { code: ginv })).data).toMatchObject({ already: true, joined: true });
      expect(c.keys.incr.filter((k) => k === KEYS.activity(wsId))).toHaveLength(1);
      c.reset();
      expect((await as(USERS.carol).post('/api/join', { code })).data).toMatchObject({ promoted: true });
      // Landing in #general bumps the workspace once more on its own way (see landInDefaults); the poke rides with the last bump.
      const actIncrs = c.keys.incr.filter((k) => k === KEYS.activity(wsId));
      expect(actIncrs.length).toBeLessThanOrEqual(2);
    } finally {
      c.restore();
    }
    const a = await act(wsId);
    expect(a.u[bob.uuid]).toBeGreaterThan(0);
    expect(a.u[USERS.carol.uuid]).toBeGreaterThan(0);
  });
});

describe('round trips: a first arrival on a server with a profile in hand', () => {
  it('writes the profile once, with what the seed says, and the card carries it', async () => {
    const { wsId, code } = await workspaceWith(alice, []);
    const c = countKv(rt);
    try {
      const r = await as(bob).post('/api/join', { code, profile: { name: 'Robert', title: 'Ops', color: 3, status: { emoji: '🌴', text: 'Away' } } });
      expect(r.ok).toBe(true);
      expect(c.keys.set.filter((k) => k === KEYS.user(bob.uuid))).toHaveLength(1);
      expect(c.keys.update.filter((k) => k === KEYS.user(bob.uuid))).toEqual([]);
    } finally {
      c.restore();
    }
    const profile = await rt.kv.get(KEYS.user(bob.uuid));
    expect(profile).toMatchObject({ uuid: bob.uuid, username: 'bob', name: 'Robert', title: 'Ops', color: 3, status: { emoji: '🌴', text: 'Away', until: null }, workspaces: [wsId] });
    const card = (await as(alice).get(`/api/ws/${wsId}`)).data.workspace.members[bob.uuid];
    expect(card).toMatchObject({ name: 'Robert', title: 'Ops', color: 3, status: { text: 'Away' } });
    // A later arrival with a changed seed still patches the record and the card, as before.
    expect((await as(bob).post('/api/join', { code, profile: { name: 'Bob R' } })).data).toMatchObject({ already: true });
    expect((await rt.kv.get(KEYS.user(bob.uuid))).name).toBe('Bob R');
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.members[bob.uuid].name).toBe('Bob R');
  });
});

describe('round trips: scheduling a message', () => {
  const actKey = (wsId) => KEYS.activity(wsId);

  it('reads the activity document twice (the count of changes, before and after), not four times, and writes the due time once', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const c = countKv(rt);
    const soon = Date.now() + 3600_000;
    try {
      expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'a', dueAt: soon })).ok).toBe(true);
      expect(c.keys.get.filter((k) => k === actKey(wsId))).toHaveLength(2);
      expect(c.keys.update.filter((k) => k === actKey(wsId))).toHaveLength(1);
      expect(c.total()).toBe(9);
      expect((await rt.kv.get(actKey(wsId))).nd).toBe(soon);
      // A later message lowers nothing: no write of the due time, no recompute, and no read of the activity document beyond the bump's answer.
      c.reset();
      expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'b', dueAt: soon + 60_000 })).ok).toBe(true);
      expect(c.keys.update.filter((k) => k === actKey(wsId))).toEqual([]);
      expect(c.keys.get.filter((k) => k === actKey(wsId))).toEqual([]);
      expect(c.total()).toBe(5);
      expect((await rt.kv.get(actKey(wsId))).nd).toBe(soon);
      // An earlier one lowers it, once.
      c.reset();
      expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'c', dueAt: soon - 60_000 })).ok).toBe(true);
      expect(c.keys.update.filter((k) => k === actKey(wsId))).toHaveLength(1);
      expect((await rt.kv.get(actKey(wsId))).nd).toBe(soon - 60_000);
    } finally {
      c.restore();
    }
  });

  it('the due time as a write hands it back is trusted only where the answer is the document itself', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const soon = Date.now() + 3600_000;
    expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'a', dueAt: soon })).ok).toBe(true);
    // A store answering the bump with the part it changed: the lowering reads the document, and a later time still lowers nothing.
    const incr = rt.kv.incr;
    rt.kv.incr = async (k, amount) => {
      const res = await incr(k, amount);
      return k === actKey(wsId) && amount && Object.hasOwn(amount, 'qv') ? { qv: res.qv } : res;
    };
    const c = countKv(rt);
    try {
      expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'b', dueAt: soon + 60_000 })).ok).toBe(true);
      expect(c.keys.update.filter((k) => k === actKey(wsId))).toEqual([]);
      expect((await rt.kv.get(actKey(wsId))).nd).toBe(soon);
    } finally {
      c.restore();
      rt.kv.incr = incr;
    }
  });

  it('two people scheduling in the same instant still leave the earlier time standing', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const soon = Date.now() + 3600_000;
    const [a, b] = await Promise.all([
      as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'a', dueAt: soon }),
      as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'b', dueAt: soon + 3600_000 }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect((await rt.kv.get(actKey(wsId))).nd).toBe(soon);
    // And the queue emptied takes the due time off.
    expect((await as(alice).del(`/api/ws/${wsId}/scheduled/${a.data.scheduled.id}`)).ok).toBe(true);
    expect((await rt.kv.get(actKey(wsId))).nd).toBe(soon + 3600_000);
    expect((await as(bob).del(`/api/ws/${wsId}/scheduled/${b.data.scheduled.id}`)).ok).toBe(true);
    expect((await rt.kv.get(actKey(wsId))).nd).toBeUndefined();
  });
});

/**
 * The read cursor moves forward only, whatever order two tabs' reads reach
 * the worker in; "Mark unread from here" (`back`) alone moves it back. The
 * answer says where the cursor stands, not what was asked.
 */
describe('the read cursor of two tabs reading out of order', () => {
  const cursor = async (wsId, u, conv) => (await rt.kv.get(KEYS.member(wsId, u.uuid))).reads[conv];

  it('a lower read arriving after a higher one leaves the higher standing, and is answered so', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    for (let i = 0; i < 8; i++) expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: `m${i}` })).ok).toBe(true);
    // The active tab, at the bottom; then a stale tab, still showing message 8.
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 10 })).data).toEqual({ ok: true, seq: 10 });
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 8 })).data).toEqual({ ok: true, seq: 10 });
    expect(await cursor(wsId, bob, general.id)).toBe(10);
    // The same read again writes nothing.
    const c = countKv(rt);
    try {
      expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 10 })).data).toEqual({ ok: true, seq: 10 });
      expect(c.counts.update).toBe(0);
    } finally {
      c.restore();
    }
  });

  it('only "mark unread" moves the cursor back, and it answers the place asked for', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    for (let i = 0; i < 8; i++) expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: `m${i}` })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 10 })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 7, back: true })).data).toEqual({ ok: true, seq: 7 });
    expect(await cursor(wsId, bob, general.id)).toBe(7);
    // A plain read below the cursor is refused again, one above moves it.
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 5 })).data).toEqual({ ok: true, seq: 7 });
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: 9 })).data).toEqual({ ok: true, seq: 9 });
    expect(await cursor(wsId, bob, general.id)).toBe(9);
  });
});

/**
 * The push a mention sends carries the first 120 characters of the message
 * (see postMessage). Cut by UTF-16 units alone, a character written as two
 * of them (an emoji) straddling the cut left its first half at the end of
 * the body, which the encoder turns into a replacement mark on the device.
 */
describe('the body of a push whose cut falls inside an emoji', () => {
  const subtle = crypto.subtle;
  const enc = new TextEncoder();
  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0)); let o = 0; for (const p of parts) { out.set(new Uint8Array(p), o); o += p.byteLength; } return out; };
  const hkdf = async (salt, ikm, info, length) => new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), length * 8));
  async function subscriber() {
    const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const auth = crypto.getRandomValues(new Uint8Array(16));
    return { pair, auth, subscription: { endpoint: 'https://push.example.com/send/abc', keys: { p256dh: b64url(await subtle.exportKey('raw', pair.publicKey)), auth: b64url(auth) } } };
  }
  /** What a browser does with an aes128gcm push body (as tests/push.test.js has it). */
  async function decrypt(sub, body) {
    const buf = new Uint8Array(body);
    const salt = buf.slice(0, 16);
    const idlen = buf[20];
    const asPub = buf.slice(21, 21 + idlen);
    const cipher = buf.slice(21 + idlen);
    const uaPub = new Uint8Array(await subtle.exportKey('raw', sub.pair.publicKey));
    const asKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, sub.pair.privateKey, 256));
    const ikm = await hkdf(sub.auth, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const aes = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, cipher));
    return new TextDecoder().decode(plain.slice(0, plain.lastIndexOf(2)));
  }

  it('ends on the last whole character rather than half of one', async () => {
    const realFetch = globalThis.fetch;
    const received = [];
    globalThis.fetch = async (url, init) => {
      received.push(new Uint8Array(await new Response(init.body).arrayBuffer()));
      return new Response('', { status: 201 });
    };
    try {
      const { wsId, general } = await workspaceWith(alice, [bob]);
      const dev = await subscriber();
      expect((await as(bob).post(`/api/ws/${wsId}/push`, { subscription: dev.subscription })).ok).toBe(true);
      // 119 characters, then an emoji whose two halves sit at 119 and 120.
      const head = `@bob ${'a'.repeat(114)}`;
      expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: `${head}\u{1F600} and more` })).ok).toBe(true);
      expect(received).toHaveLength(1);
      const payload = JSON.parse(await decrypt(dev, received[0]));
      expect(payload.body).toBe(head);
      expect(payload.body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|�/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
