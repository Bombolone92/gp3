/**
 * Shared channels between workspaces: the host mints a share
 * link, a partner's admin accepts it, the partner's members join the channel
 * on the host with attestations their own worker signs, and either side can
 * end it. Both workspaces live on the one worker the harness boots, which
 * the routes cannot tell from two workers: every call names a workspace,
 * and the connection is the only thing they share.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, threadConvId } from '../src/shared/blocks.js';
import { signAttestation, verifyAttestation, ATTEST_TTL_MS, EXTERNAL_TTL_MS } from '../worker/connect.js';

const { alice, bob, carol, dave } = USERS;
const SERVER = 'teamchat-api.test';
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

const now = () => Date.now();
const post = (u, wsId, conv, text) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text });

/**
 * Acme (alice, carol) hosts #design; Globex (alice owns it too, bob is its
 * admin, dave a member) is the partner. Bob accepts the share link, records
 * it on Globex, and joins the channel on Acme.
 */
async function shared() {
  const acme = await workspaceWith(alice, [carol], 'Acme');
  const globex = await workspaceWith(alice, [bob, dave], 'Globex');
  expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
  const design = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'design', topic: 'Pixels' })).data.channel.id;
  await as(carol).post(`/api/ws/${acme.wsId}/channels/${design}/join`);
  const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`, { inviteTtl: '7d' });
  expect(inv.ok).toBe(true);
  const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' }, profile: { name: 'Bob B.' } });
  expect(acc.ok).toBe(true);
  const added = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, {
    ref: `${acme.wsId}@${SERVER}`, ch: design, conn: acc.data.conn, secret: acc.data.secret, name: 'design-with-acme', host: acc.data.workspace.name,
  });
  expect(added.ok).toBe(true);
  const local = added.data.channel.id;
  const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
  expect(att.ok).toBe(true);
  const j = await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token, profile: { name: 'Bob B.', title: 'Globex ops' } });
  expect(j.ok).toBe(true);
  return { acme, globex, design, local, code: inv.data.code, conn: acc.data.conn, secret: acc.data.secret };
}

describe('sharing a channel', () => {
  it('connects two workspaces: the partner\'s admin ends up in the channel as an external member, in it alone', async () => {
    const { acme, globex, design, local, conn } = await shared();
    // The host sees a connection on the channel and bob as an external member from Globex.
    const a = await as(alice).get(`/api/ws/${acme.wsId}`);
    const ch = a.data.workspace.channels[design];
    expect(ch.connections[conn]).toMatchObject({ ref: `${globex.wsId}@${SERVER}`, name: 'Globex', count: 1 });
    expect(ch.count).toBe(3);
    expect(ch.connectInvite).toBeTruthy(); // admins see the live share code
    expect(a.data.workspace.members[bob.uuid]).toMatchObject({ role: 'external', name: 'Bob B.', title: 'Globex ops', org: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' } });
    expect(a.data.workspace.members[bob.uuid].exp).toBeGreaterThan(Date.now());
    // Bob lands caught up through his own arrival: his "joined" line, the
    // channel's latest, is not waiting for him as one unread.
    const bView = (await as(bob).get(`/api/ws/${acme.wsId}`)).data;
    expect(bView.activity.c[design]?.s || 0).toBeGreaterThan(0);
    expect(bView.me.reads[design]).toBe(bView.activity.c[design].s);
    // Members who are not admins never see the share code; the connection itself is no secret.
    const c = await as(carol).get(`/api/ws/${acme.wsId}`);
    expect(c.data.workspace.channels[design].connectInvite).toBeUndefined();
    expect(c.data.workspace.channels[design].connections[conn].name).toBe('Globex');
    // Bob's view of Acme: the shared channel, its people, nothing else.
    const b = await as(bob).get(`/api/ws/${acme.wsId}`);
    expect(b.data.me.role).toBe('external');
    expect(b.data.me.channels).toEqual([design]);
    expect(Object.keys(b.data.workspace.channels)).toEqual([design]);
    expect(b.data.workspace.channels[design].connectInvite).toBeUndefined();
    expect(Object.keys(b.data.workspace.members).sort()).toEqual([alice.uuid, bob.uuid, carol.uuid].sort());
    expect(b.data.workspace.invite).toBeNull();
    // The channel announced it, and bob's arrival names his workspace.
    const page = await as(bob).get(`/api/ws/${acme.wsId}/conv/${design}/messages`);
    const lines = page.data.messages.map((m) => m.text);
    expect(lines).toContain('This channel is now shared with Globex');
    expect(lines.at(-1)).toBe('Bob B. (Globex) joined');
    // Globex holds the entry, with its own name, pointing at the host.
    const g = await as(dave).get(`/api/ws/${globex.wsId}`);
    expect(g.data.workspace.channels[local]).toMatchObject({ name: 'design-with-acme', shared: { ref: `${acme.wsId}@${SERVER}`, ch: design, conn, host: 'Acme' }, count: 1 });
    expect((await as(bob).get(`/api/ws/${globex.wsId}`)).data.me.channels).toContain(local);
    // Acme is not one of bob's workspaces: it is a channel he is in.
    const me = await as(bob).get('/api/me');
    expect(me.data.workspaces.map((w) => w.id)).toEqual([globex.wsId]);
    expect(me.data.workspaces[0].role).toBe('admin');
    // He takes part like anyone: posts, threads, reactions, mentions in both directions.
    const m = (await post(bob, acme.wsId, design, 'hello from Globex @carol')).data.message;
    expect(m.mentions).toEqual([carol.uuid]);
    expect((await as(carol).get(`/api/ws/${acme.wsId}`)).data.me.mentions[design]).toBe(1);
    await post(carol, acme.wsId, threadConvId(design, m.seq), 'welcome @bob');
    const inbox = await as(bob).get(`/api/ws/${acme.wsId}/inbox`);
    expect(inbox.data.items.map((e) => e.k)).toContain('mention');
    expect((await as(bob).post(`/api/ws/${acme.wsId}/conv/${design}/messages/${m.seq}/reactions`, { reaction: 'tada' })).ok).toBe(true);
    // And can see who is in the channel, and message them.
    expect((await as(bob).get(`/api/ws/${acme.wsId}/channels/${design}/members`)).data.members.sort()).toEqual([alice.uuid, bob.uuid, carol.uuid].sort());
    expect((await as(bob).post(`/api/ws/${acme.wsId}/dms`, { members: [carol.uuid] })).ok).toBe(true);
  });

  it('previews a share link, refuses bad ones, and never lets a share code make a guest', async () => {
    const { acme, globex, design, code } = await shared();
    const p = await as(dave).get(`/api/connect/preview?code=${code}`);
    expect(p.data).toMatchObject({ workspace: { id: acme.wsId, name: 'Acme' }, channel: { id: design, name: 'design', topic: 'Pixels', private: false }, connections: ['Globex'] });
    expect((await as(dave).get('/api/connect/preview?code=NOPE')).status).toBe(400);
    expect((await as(dave).get('/api/connect/preview?code=AAAA-BBBB-CCCC')).status).toBe(404);
    // A connect code pasted where a workspace invite goes does nothing.
    const j = await as(dave).post('/api/join', { code });
    expect(j.status).toBe(404);
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.members[dave.uuid]).toBeUndefined();
    // Only admins share, never a default channel, never an entry for someone else's channel.
    expect((await as(carol).post(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`, {})).status).toBe(403);
    expect((await as(alice).post(`/api/ws/${acme.wsId}/channels/${acme.general.id}/connect/invites`, {})).status).toBe(400);
    const local = Object.values((await as(bob).get(`/api/ws/${globex.wsId}`)).data.workspace.channels).find((c) => c.shared).id;
    expect((await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/connect/invites`, {})).status).toBe(400);
    // Accepting needs a workspace to accept for.
    expect((await as(dave).post('/api/connect/accept', { code, partner: { ref: 'nope', name: 'X' } })).status).toBe(400);
    // Minting again replaces the code; revoking leaves none; the failures look alike.
    const again = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`, { inviteTtl: '1d' });
    expect(again.data.code).not.toBe(code);
    expect((await as(dave).get(`/api/connect/preview?code=${code}`)).status).toBe(404);
    expect((await as(dave).get(`/api/connect/preview?code=${again.data.code}`)).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`)).ok).toBe(true);
    expect((await as(dave).get(`/api/connect/preview?code=${again.data.code}`)).status).toBe(404);
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.channels[design].connectInvite).toBeUndefined();
  });

  it('accepts only attestations the partner signed, for the person presenting them, while fresh', async () => {
    const { globex, local, conn, secret } = await shared();
    const good = (await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/join`)).data.shared;
    expect(good).toMatchObject({ conn, ch: expect.any(String), ref: expect.any(String) });
    // Someone else cannot use dave's token.
    expect((await as(carol).post('/api/connect/join', { conn, token: good.token })).status).toBe(401);
    // A token signed with another secret, or tampered with, or for the wrong purpose, or stale.
    const forged = await signAttestation('x'.repeat(32), { conn, uuid: dave.uuid, kind: 'join' });
    expect((await as(dave).post('/api/connect/join', { conn, token: forged })).status).toBe(401);
    const tampered = `${good.token.split('.')[0].slice(0, -2)}AA.${good.token.split('.')[1]}`;
    expect((await as(dave).post('/api/connect/join', { conn, token: tampered })).status).toBe(401);
    const wrongKind = await signAttestation(secret, { conn, uuid: dave.uuid, kind: 'disconnect' });
    expect((await as(dave).post('/api/connect/join', { conn, token: wrongKind })).status).toBe(401);
    const stale = await signAttestation(secret, { conn, uuid: dave.uuid, kind: 'join', now: Date.now() - ATTEST_TTL_MS - 1000 });
    expect((await as(dave).post('/api/connect/join', { conn, token: stale })).status).toBe(401);
    expect(await verifyAttestation(secret, stale, { conn, uuid: dave.uuid, kind: 'join' })).toBeNull();
    expect((await as(dave).post('/api/connect/join', { conn: 'nothere00', token: good.token })).status).toBe(400);
    // The real one works, once dave is in the channel on his side (he is: join recorded it).
    expect((await as(dave).post('/api/connect/join', { conn, token: good.token })).ok).toBe(true);
    // Nobody attests for a channel they are not in, or for a plain channel.
    const erin = { uuid: 'u-erin-0000', username: 'erin' };
    await as(erin).post('/api/join', { code: globex.code });
    expect((await as(erin).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {})).status).toBe(403);
    expect((await as(erin).post(`/api/ws/${globex.wsId}/channels/${globex.general.id}/attest`, {})).status).toBe(404);
    expect((await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, { kind: 'disconnect' })).status).toBe(403); // admins only
  });

  it('keeps an external member to the shared channel, enforced per route, and out of the workspace\'s roles', async () => {
    const { acme, design } = await shared();
    const general = acme.general.id;
    const secret = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    expect((await as(bob).get(`/api/ws/${acme.wsId}/conv/${general}/messages`)).status).toBe(404);
    expect((await post(bob, acme.wsId, general, 'x')).status).toBe(404);
    expect((await as(bob).post(`/api/ws/${acme.wsId}/channels/${general}/join`)).status).toBe(404);
    expect((await as(bob).post(`/api/ws/${acme.wsId}/channels`, { name: 'mine' })).status).toBe(403);
    expect((await as(bob).put(`/api/ws/${acme.wsId}/channels/${design}`, { topic: 'mine now' })).status).toBe(403);
    expect((await as(bob).get(`/api/ws/${acme.wsId}/channels/${general}/members`)).status).toBe(404);
    expect((await as(bob).post(`/api/ws/${acme.wsId}/dms`, { members: [dave.uuid] })).status).toBe(403); // dave is not in Acme at all, which bob is not told
    // Search only finds the shared channel.
    await post(alice, acme.wsId, general, 'roadmap internal');
    await post(carol, acme.wsId, design, 'roadmap shared');
    expect((await as(bob).get(`/api/ws/${acme.wsId}/search?q=roadmap`)).data.results.map((m) => m.conv)).toEqual([design]);
    // Sync shows only the shared channel.
    expect(Object.keys((await as(bob).get(`/api/ws/${acme.wsId}/sync?since=0`)).data.c)).toEqual([design]);
    // Admins cannot give him a role, add him elsewhere, or promote him; they can remove him.
    expect((await as(alice).post(`/api/ws/${acme.wsId}/members/${bob.uuid}/role`, { role: 'member' })).status).toBe(400);
    expect((await as(alice).post(`/api/ws/${acme.wsId}/members/${carol.uuid}/role`, { role: 'external' })).status).toBe(400);
    expect((await as(alice).post(`/api/ws/${acme.wsId}/channels/${secret}/members`, { uuids: [bob.uuid] })).data.added).toEqual([]);
    expect((await as(bob).get(`/api/ws/${acme.wsId}`)).data.me.channels).toEqual([design]);
    expect((await as(alice).del(`/api/ws/${acme.wsId}/members/${bob.uuid}`)).ok).toBe(true);
    const a = await as(alice).get(`/api/ws/${acme.wsId}`);
    expect(a.data.workspace.members[bob.uuid]).toBeUndefined();
    expect(a.data.workspace.channels[design].count).toBe(2);
    expect(Object.values(a.data.workspace.channels[design].connections)[0].count).toBe(0);
  });

  it('lets an external membership lapse after a day unless the partner vouches again', async () => {
    const { acme, globex, design, local } = await shared();
    await rt.kv.update(KEYS.ws(acme.wsId), { [`members.${bob.uuid}.exp`]: Date.now() - 1 });
    const gone = await as(bob).get(`/api/ws/${acme.wsId}`);
    expect(gone.status).toBe(403);
    expect(gone.data.code).toBe('reattest');
    expect((await as(bob).get(`/api/ws/${acme.wsId}/sync?since=0`)).data.code).toBe('reattest');
    expect((await post(bob, acme.wsId, design, 'x')).data.code).toBe('reattest');
    // A fresh attestation from Globex renews it; someone Globex removed gets none.
    const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
    expect((await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token })).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${acme.wsId}`)).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.channels[design].count).toBe(3); // renewed, not counted twice
    await as(alice).del(`/api/ws/${globex.wsId}/members/${bob.uuid}`);
    expect((await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {})).status).toBe(403);
  });

  it('renews an external member\'s standing without telling the whole workspace: only a card that changed, or someone entering, is news to the others', async () => {
    const { acme, globex, local } = await shared();
    const wOf = async () => (await as(alice).get(`/api/ws/${acme.wsId}/sync?since=0`)).data.w;
    const renew = async (profile) => {
      const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
      const j = await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token, profile });
      expect(j.ok).toBe(true);
      return j.data;
    };
    const before = await wOf();
    // The same card, a day's standing more: nothing anyone else needs to fetch.
    const r1 = await renew({ name: 'Bob B.', title: 'Globex ops' });
    expect(r1.exp).toBeGreaterThan(now() + EXTERNAL_TTL_MS - 5000);
    expect(await wOf()).toBe(before);
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.members[bob.uuid].exp).toBe(r1.exp);
    // A new name travels with the attestation, and that everyone should see.
    await renew({ name: 'Robert', title: 'Globex ops' });
    expect(await wOf()).toBeGreaterThan(before);
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.members[bob.uuid].name).toBe('Robert');
  });

  it('keeps an external member in a channel the host archived: their renewal goes through, nobody new enters', async () => {
    const { acme, globex, design, local, conn } = await shared();
    await post(carol, acme.wsId, design, 'last word');
    expect((await as(alice).put(`/api/ws/${acme.wsId}/channels/${design}`, { archived: true })).ok).toBe(true);
    // Bob's standing lapses a day later; Globex vouching for him again is what keeps him reading.
    await rt.kv.update(KEYS.ws(acme.wsId), { [`members.${bob.uuid}.exp`]: Date.now() - 1 });
    expect((await as(bob).get(`/api/ws/${acme.wsId}`)).data.code).toBe('reattest');
    let att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
    const renewed = await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token });
    expect(renewed.ok).toBe(true);
    expect(renewed.data.exp).toBeGreaterThan(Date.now());
    const boot = await as(bob).get(`/api/ws/${acme.wsId}`);
    expect(boot.ok).toBe(true);
    expect(boot.data.workspace.channels[design].archived).toBe(true);
    expect((await as(bob).get(`/api/ws/${acme.wsId}/conv/${design}/messages`)).data.messages.map((m) => m.text)).toContain('last word');
    expect((await post(bob, acme.wsId, design, 'x')).data.code).toBe('archived');
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.channels[design].count).toBe(3); // renewed, not counted twice
    // Dave, not in the channel yet, is turned away as anyone joining an archived channel is.
    const j = await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/join`);
    expect(j.ok).toBe(true);
    const refused = await as(dave).post('/api/connect/join', { conn, token: j.data.shared.token, profile: { name: 'Dave' } });
    expect(refused.status).toBe(403);
    expect(refused.data.code).toBe('archived');
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.members[dave.uuid]).toBeUndefined();
  });

  it('joins and leaves on both sides, and leaving the last shared channel leaves the host workspace', async () => {
    const { acme, globex, design, local, conn } = await shared();
    // Dave joins on Globex (recorded there, attestation handed back) and then on Acme.
    const j = await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/join`);
    expect(j.ok).toBe(true);
    expect(j.data.shared.token).toBeTruthy();
    expect((await as(dave).get(`/api/ws/${globex.wsId}`)).data.me.channels).toContain(local);
    expect((await as(alice).get(`/api/ws/${globex.wsId}`)).data.workspace.channels[local].count).toBe(2);
    expect((await as(dave).post('/api/connect/join', { conn, token: j.data.shared.token, profile: { name: 'Dave' } })).ok).toBe(true);
    let a = await as(alice).get(`/api/ws/${acme.wsId}`);
    expect(a.data.workspace.channels[design].connections[conn].count).toBe(2);
    expect(a.data.workspace.channels[design].count).toBe(4);
    // Nothing was ever posted into the entry on Globex.
    expect((await as(dave).get(`/api/ws/${globex.wsId}/conv/${local}/messages`)).status).toBe(404);
    expect(await rt.kv.get(KEYS.seq(local))).toBeNull();
    // Dave leaves on Acme: out of the channel and, having no other, out of the workspace.
    expect((await as(dave).post(`/api/ws/${acme.wsId}/channels/${design}/leave`)).ok).toBe(true);
    a = await as(alice).get(`/api/ws/${acme.wsId}`);
    expect(a.data.workspace.members[dave.uuid]).toBeUndefined();
    expect(a.data.workspace.channels[design].connections[conn].count).toBe(1);
    expect((await as(dave).get(`/api/ws/${acme.wsId}`)).status).toBe(403);
    // And on Globex, quietly (no conversation to announce in).
    expect((await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/leave`)).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${globex.wsId}`)).data.workspace.channels[local].count).toBe(1);
  });

  it('counts someone new to the host once when two tabs present attestations at the same moment', async () => {
    const { acme, globex, design, local, conn } = await shared();
    const before = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.channels[design];
    const j = await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/join`);
    const body = { conn, token: j.data.shared.token, profile: { name: 'Dave D.' } };
    // Verifying the attestation waits on the platform's crypto, a real
    // asynchronous hop, after which the fake store answers everything at
    // once: the first request through would run to its end before the
    // second read anything. Both read the host's workspace document before
    // either goes on, as two tabs presenting attestations at once do.
    const key = KEYS.ws(acme.wsId);
    const kv = rt.kv;
    const get = kv.get.bind(kv);
    let waiting = [];
    kv.get = async (k) => {
      const v = await get(k);
      if (k === key && waiting) {
        if (!waiting.length) await new Promise((r) => waiting.push(r));
        else {
          waiting.forEach((r) => r());
          waiting = null;
        }
      }
      return v;
    };
    let r1;
    let r2;
    try {
      [r1, r2] = await Promise.all([as(dave).post('/api/connect/join', body), as(dave).post('/api/connect/join', body)]);
    } finally {
      kv.get = get;
    }
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    const after = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.channels[design];
    expect(after.count).toBe(before.count + 1);
    expect(after.connections[conn].count).toBe(before.connections[conn].count + 1);
    const lines = (await as(dave).get(`/api/ws/${acme.wsId}/conv/${design}/messages`)).data.messages.filter((m) => m.text === 'Dave D. (Globex) joined');
    expect(lines).toHaveLength(1);
    const me = (await as(dave).get(`/api/ws/${acme.wsId}`)).data.me;
    expect(me.channels).toEqual([design]);
    expect(me.reads[design]).toBe(lines[0].seq);
  });

  it('refuses a join of the entry once the connection is gone from this side, recording nothing', async () => {
    const { globex, local, conn } = await shared();
    // The partner's half of the connection is gone (the host's admins re-shared under a new one, or the record was lost).
    await rt.kv.del(KEYS.connectPartner(conn));
    const j = await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/join`);
    expect(j.status).toBe(409);
    expect(j.data.code).toBe('connection_lost');
    // Dave is not in the entry: it was not recorded on a word this workspace cannot give.
    expect((await as(dave).get(`/api/ws/${globex.wsId}`)).data.me.channels).not.toContain(local);
    expect((await as(alice).get(`/api/ws/${globex.wsId}`)).data.workspace.channels[local].count).toBe(1);
  });

  it('disconnects from either side: the partner\'s people are let go and no new attestation is honoured', async () => {
    const { acme, globex, design, local, conn } = await shared();
    // From the host: admins only.
    expect((await as(carol).del(`/api/ws/${acme.wsId}/channels/${design}/connections/${conn}`)).status).toBe(403);
    expect((await as(alice).del(`/api/ws/${acme.wsId}/channels/${design}/connections/${conn}`)).ok).toBe(true);
    let a = await as(alice).get(`/api/ws/${acme.wsId}`);
    expect(a.data.workspace.channels[design].connections).toEqual({});
    expect(a.data.workspace.members[bob.uuid]).toBeUndefined();
    expect(a.data.workspace.channels[design].count).toBe(2);
    const page = await as(alice).get(`/api/ws/${acme.wsId}/conv/${design}/messages`);
    expect(page.data.messages.at(-1).text).toBe('alice disconnected Globex');
    // Globex can still sign, but the host no longer listens.
    const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
    expect(att.ok).toBe(true);
    const j = await as(bob).post('/api/connect/join', { conn, token: att.data.token });
    expect(j.status).toBe(404);
    expect(j.data.code).toBe('connection_ended');
    // Removing the entry on Globex takes the partner's half with it.
    expect((await as(dave).del(`/api/ws/${globex.wsId}/channels/${local}`)).status).toBe(403);
    expect((await as(bob).del(`/api/ws/${globex.wsId}/channels/${local}`)).ok).toBe(true);
    expect(await rt.kv.get(KEYS.connectPartner(conn))).toBeNull();
    expect((await as(bob).get(`/api/ws/${globex.wsId}`)).data.workspace.channels[local]).toBeUndefined();

    // From the partner, with a disconnect attestation.
    const again = await shared();
    const dis = await as(bob).post(`/api/ws/${again.globex.wsId}/channels/${again.local}/attest`, { kind: 'disconnect' });
    expect(dis.ok).toBe(true);
    const wrong = await as(bob).post('/api/connect/disconnect', { conn: again.conn, token: (await as(bob).post(`/api/ws/${again.globex.wsId}/channels/${again.local}/attest`, {})).data.token });
    expect(wrong.status).toBe(401); // a join token does not disconnect
    expect((await as(bob).post('/api/connect/disconnect', { conn: again.conn, token: dis.data.token })).ok).toBe(true);
    a = await as(alice).get(`/api/ws/${again.acme.wsId}`);
    expect(a.data.workspace.channels[again.design].connections).toEqual({});
    expect(a.data.workspace.members[bob.uuid]).toBeUndefined();
    expect((await as(alice).get(`/api/ws/${again.acme.wsId}/conv/${again.design}/messages`)).data.messages.at(-1).text).toBe('Globex disconnected from this channel');
    // Once more is a no-op.
    expect((await as(bob).post('/api/connect/disconnect', { conn: again.conn, token: dis.data.token })).data.already).toBe(true);
  });

  it('treats the partner\'s entry as a pointer: renamed locally by admins, never posted into, never wired to integrations', async () => {
    const { acme, globex, design, local } = await shared();
    expect((await as(dave).put(`/api/ws/${globex.wsId}/channels/${local}`, { name: 'acme-design' })).status).toBe(403);
    expect((await as(bob).put(`/api/ws/${globex.wsId}/channels/${local}`, { topic: 'x' })).status).toBe(400);
    expect((await as(bob).put(`/api/ws/${globex.wsId}/channels/${local}`, { name: 'general' })).status).toBe(409);
    const renamed = await as(bob).put(`/api/ws/${globex.wsId}/channels/${local}`, { name: 'acme-design' });
    expect(renamed.data.channel.name).toBe('acme-design');
    expect((await as(dave).get(`/api/ws/${globex.wsId}`)).data.workspace.channels[local].name).toBe('acme-design');
    // The host's name is untouched.
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.channels[design].name).toBe('design');
    expect((await post(bob, globex.wsId, local, 'x')).status).toBe(404);
    expect((await as(bob).post(`/api/ws/${globex.wsId}/webhooks`, { channel: local, name: 'CI' })).status).toBe(400);
    const bot = await as(bob).post(`/api/ws/${globex.wsId}/bots`, { name: 'Bot', channels: [local, globex.general.id] });
    expect(bot.data.channels).toEqual([globex.general.id]);
    expect((await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/members`, { uuids: [dave.uuid] })).status).toBe(400);
    expect((await as(bob).get(`/api/ws/${globex.wsId}/channels/${local}/members`)).status).toBe(404);
    expect((await as(bob).post(`/api/ws/${globex.wsId}/scheduled`, { conv: local, text: 'later', dueAt: Date.now() + 3600_000 })).status).toBe(404);
  });

  it('connects a workspace once per channel, several workspaces per channel, and members of both as themselves', async () => {
    const { acme, globex, design, code, conn, secret } = await shared();
    // Accepting again for the same workspace renews the secret on the same connection.
    const twice = await as(bob).post('/api/connect/accept', { code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex Inc' } });
    expect(twice.data.conn).toBe(conn);
    expect(twice.data.secret).not.toBe(secret);
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.channels[design].connections[conn].name).toBe('Globex Inc');
    // The old secret signs nothing any more; the entry on Globex picks up the new one without moving.
    const local = Object.values((await as(bob).get(`/api/ws/${globex.wsId}`)).data.workspace.channels).find((c) => c.shared).id;
    const re = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, { ref: `${acme.wsId}@${SERVER}`, ch: design, conn, secret: twice.data.secret, name: 'whatever', host: 'Acme' });
    expect(re.data.already).toBe(true);
    expect(re.data.channel.id).toBe(local);
    const old = await signAttestation(secret, { conn, uuid: dave.uuid, kind: 'join' });
    expect((await as(dave).post('/api/connect/join', { conn, token: old })).status).toBe(401);
    await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/join`);
    const fresh = (await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {})).data;
    expect((await as(dave).post('/api/connect/join', { conn, token: fresh.token })).ok).toBe(true);
    // A third workspace: its own connection.
    const initech = await workspaceWith(alice, [], 'Initech');
    const acc = await as(alice).post('/api/connect/accept', { code, partner: { ref: `${initech.wsId}@${SERVER}`, name: 'Initech' } });
    expect(acc.data.conn).not.toBe(conn);
    expect(Object.keys((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.channels[design].connections)).toHaveLength(2);
    // Alice is in both Acme and Initech: joining through Initech's entry makes her nothing new on Acme.
    const entry = await as(alice).post(`/api/ws/${initech.wsId}/channels/shared`, { ref: `${acme.wsId}@${SERVER}`, ch: design, conn: acc.data.conn, secret: acc.data.secret, name: 'design', host: 'Acme' });
    const att = await as(alice).post(`/api/ws/${initech.wsId}/channels/${entry.data.channel.id}/attest`, {});
    const j = await as(alice).post('/api/connect/join', { conn: acc.data.conn, token: att.data.token });
    expect(j.data.member).toBe(true);
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.members[alice.uuid].role).toBe('owner');
  });

  it('re-keys a connection only for the admin who set it up, not for anyone else who holds the share code', async () => {
    const { acme, globex, design, code, conn, secret } = await shared();
    const globexRef = `${globex.wsId}@${SERVER}`;
    // The share code is one code for every partner, and a partner's ref sits
    // in the channel's connection list that all its members read. carol holds
    // the code but did not set Globex's connection up: naming its ref must not
    // let her rotate the secret the host vouches with, nor rename it.
    const attack = await as(carol).post('/api/connect/accept', { code, partner: { ref: globexRef, name: 'Not Globex' } });
    expect(attack.status).toBe(403);
    expect(attack.data.error).toBe('connection_owned');
    // Untouched: the label stands, and the secret the real partner still holds keeps vouching for its people.
    const conns = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.channels[design].connections;
    expect(conns[conn].name).toBe('Globex');
    const token = await signAttestation(secret, { conn, uuid: dave.uuid, kind: 'join' });
    expect((await as(dave).post('/api/connect/join', { conn, token })).ok).toBe(true);
  });

  it('lets go of someone whose own workspace is no longer connected, whichever partner labelled them last', async () => {
    const { acme, globex, design, local } = await shared();
    // Acme also shares #ops with Initech, where bob is a member too.
    const initech = await workspaceWith(alice, [bob], 'Initech');
    const ops = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'ops' })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${ops}/connect/invites`, {});
    const acc = await as(alice).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${initech.wsId}@${SERVER}`, name: 'Initech' } });
    const entry = (await as(alice).post(`/api/ws/${initech.wsId}/channels/shared`, { ref: `${acme.wsId}@${SERVER}`, ch: ops, conn: acc.data.conn, secret: acc.data.secret, name: 'ops', host: 'Acme' })).data.channel.id;
    const j = await as(bob).post(`/api/ws/${initech.wsId}/channels/${entry}/join`);
    expect((await as(bob).post('/api/connect/join', { conn: acc.data.conn, token: j.data.shared.token })).ok).toBe(true);
    // Bob is in both channels on Acme, labelled with whichever workspace vouched last.
    let b = await as(bob).get(`/api/ws/${acme.wsId}`);
    expect(b.data.me.channels.sort()).toEqual([design, ops].sort());
    expect(b.data.workspace.members[bob.uuid].org.name).toBe('Initech');
    // Acme disconnects Globex from #design: bob came to #design through Globex, so he leaves it, and stays in #ops.
    const globexConn = Object.entries((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.channels[design].connections).find(([, c]) => c.ref === `${globex.wsId}@${SERVER}`)[0];
    expect((await as(alice).del(`/api/ws/${acme.wsId}/channels/${design}/connections/${globexConn}`)).ok).toBe(true);
    b = await as(bob).get(`/api/ws/${acme.wsId}`);
    expect(b.data.me.channels).toEqual([ops]);
    expect((await as(bob).get(`/api/ws/${acme.wsId}/conv/${design}/messages`)).status).toBe(404);
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.channels[design].count).toBe(2);
    expect(local).toBeTruthy();
  });

  it('keeps guests out of it: none invited to the entry, none vouched for, and a host guest joining as themselves is counted as one', async () => {
    const { acme, globex, design, local } = await shared();
    // No guest invites for the entry: a guest here would be vouched for towards the host as one of ours.
    expect((await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/invites`, {})).status).toBe(400);
    // A guest of the partner who somehow has the entry in their list gets no attestation.
    const side = (await as(bob).post(`/api/ws/${globex.wsId}/channels`, { name: 'side' })).data.channel.id;
    const ginv = await as(bob).post(`/api/ws/${globex.wsId}/channels/${side}/invites`, {});
    const erin = { uuid: 'u-erin-0000', username: 'erin' };
    expect((await as(erin).post('/api/join', { code: ginv.data.code })).data.guest).toBe(true);
    await rt.kv.add(KEYS.member(globex.wsId, erin.uuid), { channels: [local] });
    expect((await as(erin).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {})).status).toBe(403);
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.members[erin.uuid]).toBeUndefined();
    // Dave is a guest of Acme (in #side there) and a member of Globex: through Globex's entry he
    // joins #design on Acme as what he is there, a guest, and the guest count follows him in and out.
    const aside = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'aside' })).data.channel.id;
    const ainv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${aside}/invites`, {});
    expect((await as(dave).post('/api/join', { code: ainv.data.code })).data.guest).toBe(true);
    const j = await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/join`);
    const joined = await as(dave).post('/api/connect/join', { conn: j.data.shared.conn, token: j.data.shared.token });
    expect(joined.data.member).toBe(true);
    let a = await as(alice).get(`/api/ws/${acme.wsId}`);
    expect(a.data.workspace.members[dave.uuid].role).toBe('guest');
    expect(a.data.workspace.channels[design].guests).toBe(1);
    expect(a.data.workspace.channels[design].count).toBe(4);
    expect((await as(dave).post(`/api/ws/${acme.wsId}/channels/${design}/leave`)).ok).toBe(true);
    a = await as(alice).get(`/api/ws/${acme.wsId}`);
    expect(a.data.workspace.channels[design].guests).toBe(0);
    expect(a.data.workspace.members[dave.uuid].role).toBe('guest'); // still a guest of Acme, in #aside
  });

  it('takes the shared channels away from a member made a guest: the entry leaves their sidebar, and the workspace vouches for them no more', async () => {
    const { acme, globex, design, local, conn } = await shared();
    const j = await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/join`);
    expect((await as(dave).post('/api/connect/join', { conn, token: j.data.shared.token, profile: { name: 'Dave' } })).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${globex.wsId}`)).data.workspace.channels[local].count).toBe(2);
    expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${dave.uuid}/role`, { role: 'guest' })).ok).toBe(true);
    const g = await as(dave).get(`/api/ws/${globex.wsId}`);
    expect(g.data.me.channels).not.toContain(local);
    expect(g.data.workspace.channels[local]).toBeUndefined(); // a guest sees only the channels they are in
    const a = await as(alice).get(`/api/ws/${globex.wsId}`);
    expect(a.data.workspace.channels[local].count).toBe(1);
    expect(a.data.workspace.channels[local].guests || 0).toBe(0);
    expect(a.data.workspace.channels[globex.general.id].guests).toBe(1);
    expect((await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {})).status).toBe(403);
    // On Acme his standing lapses on its own; until then he is still counted there.
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.channels[design].connections[conn].count).toBe(2);
  });

  it('turns a partner\'s member away when the host workspace is full, as a join would', async () => {
    const { acme, globex, local } = await shared();
    const crowd = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`u-crowd-${i}`, { role: 'member', name: `c${i}`, username: `c${i}`, color: 1 }]));
    await rt.kv.update(KEYS.ws(acme.wsId), Object.fromEntries(Object.entries(crowd).map(([u, m]) => [`members.${u}`, m])));
    const j = await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/join`);
    const res = await as(dave).post('/api/connect/join', { conn: j.data.shared.conn, token: j.data.shared.token });
    expect(res.status).toBe(400);
    expect(res.data.code).toBe('limit');
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.members[dave.uuid]).toBeUndefined();
    // Someone already in it renews regardless.
    const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
    expect((await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token })).ok).toBe(true);
  });

  it('takes what a disconnected partner\'s people had waiting to be sent out of the host\'s queue with them', async () => {
    const { acme, design, conn } = await shared();
    const s = await as(bob).post(`/api/ws/${acme.wsId}/scheduled`, { conv: design, text: 'from Globex, later', dueAt: Date.now() + 3600_000 });
    expect(s.ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${acme.wsId}/channels/${design}/connections/${conn}`)).ok).toBe(true);
    const queue = await rt.kv.get(KEYS.sched(acme.wsId));
    expect(Object.values(queue?.m || {}).filter((e) => e.u === bob.uuid)).toEqual([]);
  });

  it('exports connections as they are and imports a copy unshared', async () => {
    const { acme, globex, design } = await shared();
    const exp = await as(alice).get(`/api/ws/${acme.wsId}/export`);
    expect(exp.data.header.members[bob.uuid].role).toBe('external');
    expect(exp.data.header.channels[design].connectInvite).toBeUndefined();
    const imp = await as(alice).post('/api/workspaces/import', { header: exp.data.header });
    expect(imp.ok).toBe(true);
    const copy = await as(alice).get(`/api/ws/${imp.data.workspace.id}`);
    expect(copy.data.workspace.members[bob.uuid]).toBeUndefined();
    const gexp = await as(bob).get(`/api/ws/${globex.wsId}/export`);
    const gimp = await as(alice).post('/api/workspaces/import', { header: gexp.data.header });
    expect(Object.values((await as(alice).get(`/api/ws/${gimp.data.workspace.id}`)).data.workspace.channels).some((c) => c.shared)).toBe(false);
  });
});

describe('deleting a workspace with shared channels', () => {
  it('takes its half of every connection with it: a partner presenting an attestation learns the connection has ended', async () => {
    const { acme, globex, design, local, conn } = await shared();
    // Globex also hosts a channel shared with nobody yet, with a live share link, to see codes go too.
    const other = (await as(bob).post(`/api/ws/${globex.wsId}/channels`, { name: 'ops' })).data.channel.id;
    const inv = await as(bob).post(`/api/ws/${globex.wsId}/channels/${other}/connect/invites`, {});
    expect(await rt.kv.get(KEYS.connect(conn))).toBeTruthy();
    expect((await as(alice).del(`/api/ws/${acme.wsId}`)).ok).toBe(true);
    expect(await rt.kv.get(KEYS.connect(conn))).toBeNull();
    expect(await rt.kv.get(KEYS.invite(inv.data.code))).toBeTruthy();
    const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
    expect(att.ok).toBe(true); // Globex still holds its half, and can sign
    const j = await as(bob).post('/api/connect/join', { conn, token: att.data.token });
    expect(j.status).toBe(404);
    expect(j.data.code).toBe('connection_ended');
    // And the partner's own deletion takes its half and its share codes.
    expect(await rt.kv.get(KEYS.connectPartner(conn))).toBeTruthy();
    expect((await as(alice).del(`/api/ws/${globex.wsId}`)).ok).toBe(true);
    expect(await rt.kv.get(KEYS.connectPartner(conn))).toBeNull();
    expect(await rt.kv.get(KEYS.invite(inv.data.code))).toBeNull();
    expect(design).toBeTruthy();
  });
});

describe('people who left a workspace', () => {
  it('keep their name on what they wrote: the host remembers a disconnected partner\'s people, with their workspace', async () => {
    const { acme, globex, design, conn } = await shared();
    await post(bob, acme.wsId, design, 'for the record');
    expect((await as(alice).del(`/api/ws/${acme.wsId}/channels/${design}/connections/${conn}`)).ok).toBe(true);
    const a = await as(alice).get(`/api/ws/${acme.wsId}`);
    expect(a.data.workspace.members[bob.uuid]).toBeUndefined();
    expect(a.data.workspace.former[bob.uuid]).toMatchObject({ name: 'Bob B.', username: 'bob', org: { name: 'Globex' } });
    // A member removed by an admin, or leaving, is remembered the same way; a guest is shown neither.
    expect((await as(alice).del(`/api/ws/${acme.wsId}/members/${carol.uuid}`)).ok).toBe(true);
    const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/invites`, {});
    await as(dave).post('/api/join', { code: inv.data.code });
    const again = await as(alice).get(`/api/ws/${acme.wsId}`);
    expect(again.data.workspace.former[carol.uuid]).toMatchObject({ name: 'carol' });
    expect(again.data.workspace.former[carol.uuid].org).toBeUndefined();
    expect((await as(dave).get(`/api/ws/${acme.wsId}`)).data.workspace.former).toBeUndefined();
    // Back in the workspace, the card in members is the one that counts again.
    await as(carol).post('/api/join', { code: (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.invite });
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.former[carol.uuid]).toBeUndefined();
    expect(globex.wsId).toBeTruthy();
  });

  it('are remembered a hundred at a time, the oldest making room', async () => {
    const { wsId } = await workspaceWith(alice, [], 'Acme');
    const ws = await rt.kv.get(KEYS.ws(wsId));
    const former = {};
    for (let i = 0; i < 100; i++) former[`u-old-${i}`] = { username: `old${i}`, name: `Old ${i}`, color: 1, at: i };
    await rt.kv.update(KEYS.ws(wsId), { former, [`members.${bob.uuid}`]: { username: 'bob', name: 'Bob', color: 2, role: 'member', joinedAt: 1 } });
    await rt.kv.set(KEYS.member(wsId, bob.uuid), { channels: [], dms: {}, reads: {}, mentions: {} });
    expect((await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`)).ok).toBe(true);
    const after = (await rt.kv.get(KEYS.ws(wsId))).former;
    expect(Object.keys(after)).toHaveLength(100);
    expect(after['u-old-0']).toBeUndefined();
    expect(after[bob.uuid]).toMatchObject({ name: 'Bob' });
    expect(ws.id).toBe(wsId);
  });
});

describe('an external member\'s card on the host', () => {
  it('follows their profile: a new name, photo, or status reaches the host like it reaches their own workspace', async () => {
    const { acme, globex, design, local, conn } = await shared();
    // Bob changes his name and status, and puts up a photo, the way the app does it: on every worker he has a workspace on.
    expect((await as(bob).put('/api/me', { name: 'Robert B.', status: { emoji: '🌴', text: 'Away' } })).ok).toBe(true);
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([137, 80, 78, 71])], 'me.png', { type: 'image/png' }));
    const up = await as(bob).post('/api/me/avatar', fd);
    expect(up.ok).toBe(true);
    const card = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.members[bob.uuid];
    expect(card).toMatchObject({ role: 'external', name: 'Robert B.', status: { text: 'Away' }, avatar: up.data.avatar });
    expect((await as(carol).get(`/api/ws/${acme.wsId}/members/${bob.uuid}/avatar`)).status).toBe(200);
    // Acme is still not one of his workspaces.
    expect((await as(bob).get('/api/me')).data.workspaces.map((w) => w.id)).toEqual([globex.wsId]);
    // A renewal carries the profile along too, for a client that never called the host directly.
    const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
    expect((await as(bob).post('/api/connect/join', { conn, token: att.data.token, profile: { name: 'Rob', title: 'Ops lead' } })).ok).toBe(true);
    const renewed = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.members[bob.uuid];
    expect(renewed).toMatchObject({ role: 'external', name: 'Rob', title: 'Ops lead', org: { name: 'Globex' } });
    expect(renewed.joinedAt).toBe(card.joinedAt);
    // Out of the channel, Acme is out of his profile's list altogether.
    expect((await as(bob).post(`/api/ws/${acme.wsId}/channels/${design}/leave`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.user(bob.uuid))).workspaces).toEqual([globex.wsId]);
  });
});

describe('an admin removing someone from a connected workspace', () => {
  it('keeps them out: their workspace\'s next attestation is refused until an admin restores them, or they join in their own right', async () => {
    const { acme, globex, design, local, conn } = await shared();
    // Dave comes in through Globex too.
    const dj = await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/join`);
    expect((await as(dave).post('/api/connect/join', { conn, token: dj.data.shared.token, profile: { name: 'Dave' } })).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${acme.wsId}/members/${bob.uuid}`)).ok).toBe(true);
    // Globex still vouches for bob (his app does this on its own); Acme says no, in words his app can tell from a connection that ended.
    let att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
    const refused = await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token });
    expect(refused.status).toBe(403);
    expect(refused.data.code).toBe('removed');
    let a = await as(alice).get(`/api/ws/${acme.wsId}`);
    expect(a.data.workspace.members[bob.uuid]).toBeUndefined();
    expect(a.data.workspace.removed[bob.uuid]).toMatchObject({ name: 'Bob B.', org: { name: 'Globex' }, by: alice.uuid });
    expect(a.data.workspace.channels[design].connections[conn].count).toBe(1);
    // Only admins see the list; dave, still in, is not on it and still renews.
    expect((await as(carol).get(`/api/ws/${acme.wsId}`)).data.workspace.removed).toBeUndefined();
    att = await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
    expect((await as(dave).post('/api/connect/join', { conn: att.data.conn, token: att.data.token })).ok).toBe(true);
    // Someone leaving on their own is not kept out.
    expect((await as(dave).post(`/api/ws/${acme.wsId}/channels/${design}/leave`)).ok).toBe(true);
    att = await as(dave).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
    expect((await as(dave).post('/api/connect/join', { conn: att.data.conn, token: att.data.token })).ok).toBe(true);
    // Restoring is for admins; once done, Globex's word counts again.
    expect((await as(carol).del(`/api/ws/${acme.wsId}/removed/${bob.uuid}`)).status).toBe(403);
    expect((await as(alice).del(`/api/ws/${acme.wsId}/removed/${dave.uuid}`)).status).toBe(404);
    expect((await as(alice).del(`/api/ws/${acme.wsId}/removed/${bob.uuid}`)).ok).toBe(true);
    att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
    expect((await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token })).ok).toBe(true);
    a = await as(alice).get(`/api/ws/${acme.wsId}`);
    expect(a.data.workspace.removed).toBeUndefined();
    expect(a.data.workspace.members[bob.uuid].role).toBe('external');
    // Removed again, then invited into Acme itself: a member in their own right is kept out of nothing.
    expect((await as(alice).del(`/api/ws/${acme.wsId}/members/${bob.uuid}`)).ok).toBe(true);
    expect((await as(bob).post('/api/join', { code: acme.code })).ok).toBe(true);
    a = await as(alice).get(`/api/ws/${acme.wsId}`);
    expect(a.data.workspace.removed).toBeUndefined();
    expect(a.data.workspace.members[bob.uuid].role).toBe('member');
    att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
    expect((await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token })).data.member).toBe(true);
  });
});

describe('an external member invited into the host itself', () => {
  it('becomes a member in their own right, keeping the channel, direct messages, and cursors they had', async () => {
    const { acme, globex, design, local, conn } = await shared();
    const dm = (await as(carol).post(`/api/ws/${acme.wsId}/dms`, { members: [bob.uuid] })).data.conv;
    await post(carol, acme.wsId, dm, 'hi bob');
    const before = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace;
    expect(before.channels[design].connections[conn].count).toBe(1);
    // Alice sends bob Acme's own invite. Before, the join answered "already a
    // member" and left him external: Acme never showed in his list, and
    // #general stayed out of reach, unless an admin removed him first.
    const j = await as(bob).post('/api/join', { code: acme.code });
    expect(j.ok).toBe(true);
    expect(j.data.already).toBeUndefined();
    const a = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace;
    expect(a.members[bob.uuid].role).toBe('member');
    expect(a.members[bob.uuid].org).toBeUndefined();
    expect(a.members[bob.uuid].exp).toBeUndefined();
    expect(a.channels[design].count).toBe(before.channels[design].count);
    expect(a.channels[design].connections[conn].count).toBe(0);
    expect(a.channels[acme.general.id].count).toBe(before.channels[acme.general.id].count + 1);
    const b = (await as(bob).get(`/api/ws/${acme.wsId}`)).data;
    expect(b.me.role).toBe('member');
    expect(b.me.channels.sort()).toEqual([design, acme.general.id].sort());
    expect(b.me.dms[dm]).toBeTruthy();
    expect((await as(bob).get(`/api/ws/${acme.wsId}/conv/${dm}/messages`)).data.messages[0].text).toBe('hi bob');
    expect((await as(bob).get('/api/me')).data.workspaces.map((w) => w.id).sort()).toEqual([acme.wsId, globex.wsId].sort());
    expect((await post(bob, acme.wsId, acme.general.id, 'hello from inside')).ok).toBe(true);
    // A renewal from Globex now says he is a member here.
    const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
    expect((await as(bob).post('/api/connect/join', { conn, token: att.data.token })).data.member).toBe(true);
    // Joining again is the usual "already".
    expect((await as(bob).post('/api/join', { code: acme.code })).data.already).toBe(true);
  });
});

describe('a connection\'s partner record', () => {
  it('cannot be taken over by another workspace on the same worker', async () => {
    const { acme, globex, design, local, conn, secret } = await shared();
    // Carol, an admin of a workspace of her own here, knows the connection's
    // id (every member of Acme sees it) and records it as hers.
    await as(alice).put('/api/server', { open: true });
    const hers = await workspaceWith(carol, [], 'Carol Co');
    const grab = await as(carol).post(`/api/ws/${hers.wsId}/channels/shared`, {
      ref: `${acme.wsId}@${SERVER}`, ch: design, conn, secret: 'a'.repeat(secret.length), name: 'design-grab', host: 'Acme',
    });
    expect(grab.status).toBe(409);
    expect((await as(carol).get(`/api/ws/${hers.wsId}`)).data.workspace.channels[design]).toBeUndefined();
    // Globex's people still renew their seats through it.
    const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${local}/attest`, {});
    expect(att.ok).toBe(true);
    expect((await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.connectPartner(conn))).ws).toBe(globex.wsId);
  });
});

describe('a share link opened by an admin of the host itself', () => {
  it('is refused as a partner: a channel cannot be shared with its own workspace', async () => {
    const { acme, code, design } = await shared();
    const self = await as(alice).post('/api/connect/accept', { code, partner: { ref: `${acme.wsId}@${SERVER}`, name: 'Acme' } });
    expect(self.status).toBe(400);
    expect(self.data.code).toBe('invalid');
    const a = await as(alice).get(`/api/ws/${acme.wsId}`);
    expect(Object.values(a.data.workspace.channels[design].connections).map((c) => c.name)).toEqual(['Globex']);
    // The link itself still works for another workspace.
    const initech = await workspaceWith(alice, [], 'Initech');
    expect((await as(alice).post('/api/connect/accept', { code, partner: { ref: `${initech.wsId}@${SERVER}`, name: 'Initech' } })).ok).toBe(true);
  });
});

describe('exporting a workspace with shared channels', () => {
  it('leaves people from connected workspaces out of the copy, and counts the channel afresh without them', async () => {
    const { acme, design } = await shared();
    let res = await as(alice).get(`/api/ws/${acme.wsId}/export`);
    expect(res.ok).toBe(true);
    const header = res.data.header;
    const pages = [...res.data.pages];
    while (!res.data.done) {
      res = await as(alice).get(`/api/ws/${acme.wsId}/export?cursor=${encodeURIComponent(JSON.stringify(res.data.cursor))}`);
      pages.push(...res.data.pages);
    }
    // The archive carries the channel's counter as it stood, bob (from Globex) included.
    expect(header.channels[design].count).toBe(3);
    const created = await as(alice).post('/api/workspaces/import', { header });
    expect(created.ok).toBe(true);
    const newId = created.data.workspace.id;
    for (const page of pages) expect((await as(alice).post(`/api/ws/${newId}/import`, { conv: page.conv, seq: page.seq, messages: page.messages })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    const copy = (await as(alice).get(`/api/ws/${newId}`)).data.workspace;
    expect(copy.members[bob.uuid]).toBeUndefined();
    // The channel keeps its name (its id is taken on this worker by the original, so the copy minted another).
    const ch = Object.values(copy.channels).find((c) => c.name === 'design');
    expect(ch.connections).toBeUndefined();
    // Two people are in the copy's #design (alice and carol): the count says so, not three.
    expect(ch.count).toBe(2);
    expect((await as(carol).get(`/api/ws/${newId}`)).data.me.channels).toContain(ch.id);
  });

  it('cuts a private channel\'s list to the people in the copy', async () => {
    const acme = await workspaceWith(alice, [carol], 'Acme');
    const globex = await workspaceWith(alice, [bob], 'Globex');
    await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    const vault = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'vault', private: true })).data.channel.id;
    await as(alice).post(`/api/ws/${acme.wsId}/channels/${vault}/members`, { uuids: [carol.uuid] });
    const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${vault}/connect/invites`, {});
    const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' } });
    const entry = (await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, { ref: `${acme.wsId}@${SERVER}`, ch: vault, conn: acc.data.conn, secret: acc.data.secret, name: 'vault' })).data.channel.id;
    const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${entry}/attest`, {});
    expect((await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token })).ok).toBe(true);
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.channels[vault].members).toEqual([alice.uuid, carol.uuid, bob.uuid]);
    const header = (await as(alice).get(`/api/ws/${acme.wsId}/export`)).data.header;
    const newId = (await as(alice).post('/api/workspaces/import', { header })).data.workspace.id;
    expect((await as(alice).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    const copy = (await as(alice).get(`/api/ws/${newId}`)).data.workspace;
    const ch = Object.values(copy.channels).find((c) => c.name === 'vault');
    // Bob is not in the copy, so he is not on its list either: what the
    // header, the count, and the members route say of the channel agree.
    expect(copy.members[bob.uuid]).toBeUndefined();
    expect(ch.members).toEqual([alice.uuid, carol.uuid]);
    expect(ch.count).toBe(2);
    expect((await as(carol).get(`/api/ws/${newId}/channels/${ch.id}/members`)).data.members).toEqual([alice.uuid, carol.uuid]);
  });
});

describe('a store that refuses add on a missing key', () => {
  it('still lets someone new to the host into the shared channel, counted once, with a whole document', async () => {
    rt = await boot({ strictAdd: true });
    // Bob is new to Acme when shared() has him join: his member document
    // there does not exist yet, and the claim (an append to it) is refused.
    const { acme, design, conn } = await shared();
    const ws = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace;
    expect(ws.channels[design].count).toBe(3);
    expect(ws.channels[design].connections[conn].count).toBe(1);
    const me = (await as(bob).get(`/api/ws/${acme.wsId}`)).data.me;
    expect(me.channels).toEqual([design]);
    expect(me.dms).toEqual({});
    expect(me.mentions).toEqual({});
    expect(typeof me.joinedAt).toBe('number');
    const lines = (await as(bob).get(`/api/ws/${acme.wsId}/conv/${design}/messages`)).data.messages.filter((m) => m.text === 'Bob B. (Globex) joined');
    expect(lines).toHaveLength(1);
    expect(me.reads[design]).toBe(lines[0].seq);
  });
});
