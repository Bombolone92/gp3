/**
 * Review pass 17, the message plane: channels, messages, threads, reactions,
 * pins, saved messages, direct messages, huddles, shared channels, transfer.
 * Each test here is a hole that was found in the worker's routes and closed.
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

describe('someone added to a private channel in the same instant an admin removes them from the workspace', () => {
  /** What the channel and the person are left as. */
  const state = async (wsId, ch) => {
    const ws = await rt.kv.get(KEYS.ws(wsId));
    const c = ws.channels[ch];
    const msgs = (await as(alice).get(`/api/ws/${wsId}/conv/${ch}/messages`)).data.messages.map((m) => m.text);
    return { count: c.count, members: [...(c.members || [])].sort(), card: ws.members[bob.uuid] || null, doc: await rt.kv.get(KEYS.member(wsId, bob.uuid)), addedLine: msgs.some((t) => /added/.test(t)) };
  };

  it('leaves no name of theirs on the list with no card behind it, so the last real member can neither leave it unreachable nor find it locked', async () => {
    // The removal runs whole between the append onto bob's document and the
    // count: it counted him out of the channel his document named and
    // rewrote the list from its own reading, which did not have him yet.
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    const priv = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    const realAdd = rt.kv.add.bind(rt.kv);
    let removed = null;
    rt.kv.add = async (k, v) => {
      if (removed === null && k === KEYS.member(wsId, bob.uuid)) {
        removed = 'pending';
        const res = await realAdd(k, v);
        removed = await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`);
        return res;
      }
      return realAdd(k, v);
    };
    let added;
    try {
      added = await as(alice).post(`/api/ws/${wsId}/channels/${priv}/members`, { uuids: [bob.uuid] });
    } finally {
      rt.kv.add = realAdd;
    }
    expect(removed?.data.ok).toBe(true);
    expect(added.ok).toBe(true);
    // Nobody was added: bob is out of the workspace.
    expect(added.data.added).toEqual([]);
    const s = await state(wsId, priv);
    expect(s).toEqual({ count: 1, members: [alice.uuid], card: null, doc: null, addedLine: false });
    // Alice, the one real member, is held in as the last one, rather than
    // let out past a name with nobody behind it into a channel nobody could open.
    const leave = await as(alice).post(`/api/ws/${wsId}/channels/${priv}/leave`);
    expect(leave.status).toBe(400);
    expect(leave.data.code).toBe('last_member');
    // In peace, adding counts and lists as before.
    expect((await as(alice).post(`/api/ws/${wsId}/channels/${priv}/members`, { uuids: [carol.uuid] })).data.added).toEqual([carol.uuid]);
    expect(await state(wsId, priv)).toMatchObject({ count: 2, members: [alice.uuid, carol.uuid].sort(), addedLine: true });
  });
});

describe('a group message naming several guests', () => {
  /** Count reads of member documents (tc:ws:{ws}:u:{uuid}, not their inbox/threads/saved) while `run` runs. */
  async function memberDocReads(wsId, run) {
    const realGet = rt.kv.get.bind(rt.kv);
    const re = new RegExp(`^${KEYS.member(wsId, '')}[^:]+$`);
    let n = 0;
    rt.kv.get = async (k) => {
      if (re.test(k)) n++;
      return realGet(k);
    };
    try {
      return { res: await run(), reads: n };
    } finally {
      rt.kv.get = realGet;
    }
  }

  it('reads the workspace\'s member documents once, not once per guest, to see who shares a channel with whom', async () => {
    // Alice (admin) and bob, carol and dave as guests of the public #project, alongside three plain members.
    const extra = [
      { uuid: 'u-erin-0000', username: 'erin' }, { uuid: 'u-fay-0000', username: 'fay' }, { uuid: 'u-gus-0000', username: 'gus' },
    ];
    const { wsId } = await workspaceWith(alice, extra);
    const project = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'project' })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${project}/invites`, {});
    for (const g of [bob, carol, USERS.dave]) expect((await as(g).post('/api/join', { code: inv.data.code })).data.guest).toBe(true);
    const members = Object.keys((await rt.kv.get(KEYS.ws(wsId))).members).length;
    expect(members).toBe(7);
    const { res, reads } = await memberDocReads(wsId, () => as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid, carol.uuid, USERS.dave.uuid] }));
    expect(res.ok).toBe(true);
    expect(res.data.members.sort()).toEqual([alice.uuid, bob.uuid, carol.uuid, USERS.dave.uuid].sort());
    // One scan of every member's document, plus the caller's own, each
    // guest's, and each participant's once more for the conversation they
    // may already have: never a scan per guest (three guests used to cost
    // three scans, twenty-one reads of seven documents).
    const guests = 3;
    expect(reads).toBeLessThanOrEqual(members + 1 + guests + guests);
    // The rule itself still holds: a guest may not be put in with someone they share nothing with.
    const lone = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'lone', private: true })).data.channel.id;
    const linv = await as(alice).post(`/api/ws/${wsId}/channels/${lone}/invites`, {});
    expect((await as({ uuid: 'u-hal-0000', username: 'hal' }).post('/api/join', { code: linv.data.code })).data.guest).toBe(true);
    const refused = await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid, 'u-hal-0000'] });
    expect(refused.status).toBe(403);
  });
});

describe('a broadcast in a public channel with guests in it', () => {
  async function memberDocReads(wsId, run) {
    const realGet = rt.kv.get.bind(rt.kv);
    const re = new RegExp(`^${KEYS.member(wsId, '')}[^:]+$`);
    let n = 0;
    rt.kv.get = async (k) => {
      if (re.test(k)) n++;
      return realGet(k);
    };
    try {
      return { res: await run(), reads: n };
    } finally {
      rt.kv.get = realGet;
    }
  }

  it('reads each member\'s document once for the whole post: who is in the channel, who may hear of it, and who gets a push come from one reading', async () => {
    const extra = [
      { uuid: 'u-erin-0000', username: 'erin' }, { uuid: 'u-fay-0000', username: 'fay' }, { uuid: 'u-gus-0000', username: 'gus' },
    ];
    const { wsId } = await workspaceWith(alice, extra);
    const project = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'project' })).data.channel.id;
    for (const m of extra) expect((await as(m).post(`/api/ws/${wsId}/channels/${project}/join`)).ok).toBe(true);
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${project}/invites`, {});
    for (const g of [bob, carol, USERS.dave]) expect((await as(g).post('/api/join', { code: inv.data.code })).data.guest).toBe(true);
    const members = Object.keys((await rt.kv.get(KEYS.ws(wsId))).members).length;
    expect(members).toBe(7);
    const { res, reads } = await memberDocReads(wsId, () => as(alice).post(`/api/ws/${wsId}/conv/${project}/messages`, { text: '@channel stand-up in five' }));
    expect(res.ok).toBe(true);
    // Everyone in the channel but the sender heard of it (the counting is what the documents were read for).
    expect(res.data.notified).toBe(6);
    for (const u of [bob.uuid, 'u-erin-0000']) expect((await rt.kv.get(KEYS.member(wsId, u))).mentions[project]).toBe(1);
    // The caller's own document, and one scan of every member's: the guests
    // among those reached, and the people pushed, are answered from the
    // scan (three guests and six push targets used to be read again).
    expect(reads).toBeLessThanOrEqual(members + 1);
  });
});

describe('an admin adding people to a public channel they have not joined', () => {
  it('is told to join it, not that the channel is not there; a private channel they are not in stays unknown to them, and a guest is refused as before', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    expect((await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const design = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'design' })).data.channel.id;
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    // Bob, an admin, can see #design in the browser and its details, and has not joined it.
    const res = await as(bob).post(`/api/ws/${wsId}/channels/${design}/members`, { uuids: [carol.uuid] });
    expect(res.status).toBe(403);
    expect(res.data.code).toBe('not_joined');
    expect(res.data.message).toMatch(/join the channel/i);
    // Nobody was added or counted.
    expect((await rt.kv.get(KEYS.ws(wsId))).channels[design].count).toBe(1);
    expect((await rt.kv.get(KEYS.member(wsId, carol.uuid))).channels).not.toContain(design);
    // A private channel he is not in is no channel to him, admin or not.
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [carol.uuid] })).status).toBe(404);
    // Joined, he adds as before.
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${design}/join`)).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${design}/members`, { uuids: [carol.uuid] })).data.added).toEqual([carol.uuid]);
    // A guest handed a public channel's id they are not in learns nothing of it.
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${secret}/invites`, {});
    expect((await as(USERS.dave).post('/api/join', { code: inv.data.code })).ok).toBe(true);
    expect((await as(USERS.dave).post(`/api/ws/${wsId}/channels/${design}/members`, { uuids: [carol.uuid] })).status).toBe(404);
    // And one in the channel cannot add people, as before.
    const guestIn = await as(USERS.dave).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [carol.uuid] });
    expect(guestIn.status).toBe(403);
    expect(guestIn.data.code).toBe('forbidden');
  });
});
