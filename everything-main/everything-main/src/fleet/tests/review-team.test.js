import { describe, it, expect, beforeEach } from 'vitest';
import { loadWorker, OWNER, SAM, ALEX } from './review-team-helpers.js';

let w;
beforeEach(() => {
  w = loadWorker();
});

async function invite(role, user) {
  const inv = (await w.api(OWNER, { op: 'invite', role })).body;
  return (await w.api(user, { op: 'join', token: inv.token })).body;
}

const b64 = (s) => Buffer.from(s).toString('base64');

describe('team worker files', () => {
  it('accepts file names with several dots in a row', async () => {
    // files.js keeps dots, so "Scan...jpg" or "v2..final.pdf" reach the worker as is.
    for (const path of ['files/issues/x-Scan...jpg', 'files/fuel/x-v2..final.pdf']) {
      expect((await w.api(OWNER, { op: 'fileWrite', path, data: b64('x') })).status, path).toBe(200);
      expect((await w.api(OWNER, { op: 'fileRead', path })).status, path).toBe(200);
    }
  });

  it('still keeps paths inside the team folder', async () => {
    for (const path of ['../x', 'files/../../x', 'files/..', '..', '/files/x', 'files//x']) {
      expect((await w.api(OWNER, { op: 'fileWrite', path, data: b64('x') })).status, path).toBe(400);
    }
  });
});

describe('team worker invitations', () => {
  it('lets only one person in when two open the same link at once', async () => {
    const inv = (await w.api(OWNER, { op: 'invite', role: 'admin' })).body;
    const [a, b] = await Promise.all([w.api(SAM, { op: 'join', token: inv.token }), w.api(ALEX, { op: 'join', token: inv.token })]);
    expect([a.status, b.status].sort()).toEqual([200, 410]);
    const { members } = (await w.api(OWNER, { op: 'members' })).body;
    expect(members).toHaveLength(1);
  });
});

describe('team worker driver comments', () => {
  beforeEach(async () => {
    await w.api(OWNER, { op: 'put', bucket: 'comments', records: [{ id: 'k1', text: 'owner note', author: 'olivia', authorUuid: 'owner-1' }] });
    await invite('driver', SAM);
  });

  it('does not let a driver take over or rewrite someone else’s comment', async () => {
    expect((await w.api(SAM, { op: 'put', bucket: 'comments', records: [{ id: 'k1', text: 'changed', author: 'sam', authorUuid: 'user-2' }] })).status).toBe(403);
    expect((await w.api(SAM, { op: 'del', bucket: 'comments', ids: ['k1'] })).status).toBe(403);
    expect(w.kv.data.get('fl1:r:comments:k1').text).toBe('owner note');
  });

  it('does not let a driver post as someone else', async () => {
    expect((await w.api(SAM, { op: 'put', bucket: 'comments', records: [{ id: 'k2', text: 'hi', author: 'olivia', authorUuid: 'owner-1' }] })).status).toBe(403);
    expect((await w.api(SAM, { op: 'put', bucket: 'comments', records: [{ id: 'k3', text: 'hi', author: 'olivia', authorUuid: 'user-2' }] })).status).toBe(200);
    expect(w.kv.data.get('fl1:r:comments:k3')).toMatchObject({ author: 'sam', authorUuid: 'user-2' });
  });
});

describe('team worker leaving', () => {
  it('takes a member who leaves off the team, along with their invitations', async () => {
    await invite('admin', SAM);
    const theirs = (await w.api(SAM, { op: 'invite', role: 'member' })).body;
    expect((await w.api(SAM, { op: 'leave' })).status).toBe(200);
    expect((await w.api(SAM, { op: 'whoami' })).body.error).toBe('not_a_member');
    expect((await w.api(OWNER, { op: 'members' })).body.members).toEqual([]);
    expect((await w.api(ALEX, { op: 'join', token: theirs.token })).status).toBe(410);
    // Coming back needs a new invitation.
    expect((await w.api(SAM, { op: 'join', token: 'AAAAAAAAAAAAAAAAAAAAAAAA' })).status).toBe(410);
  });

  it('does not let the owner leave their own fleet', async () => {
    expect((await w.api(OWNER, { op: 'leave' })).status).toBe(400);
    expect((await w.api(OWNER, { op: 'whoami' })).body.role).toBe('owner');
  });
});

describe('team worker role changes', () => {
  it('drops the open invitations of an admin who is no longer an admin', async () => {
    await invite('admin', SAM);
    await w.api(SAM, { op: 'invite', role: 'admin', label: 'from sam' });
    await w.api(OWNER, { op: 'invite', role: 'driver', label: 'from owner' });
    await w.api(OWNER, { op: 'setRole', uuid: 'user-2', role: 'member' });
    // The list must not show a link that can no longer be used.
    expect((await w.api(OWNER, { op: 'invites' })).body.invites.map((i) => i.label)).toEqual(['from owner']);
  });
});

describe('team worker owner lookups', () => {
  it('keeps an owner’s invitation when the owner cannot be looked up for a moment', async () => {
    const { token } = (await w.api(OWNER, { op: 'invite', role: 'member' })).body;
    // The worker restarts, and Puter's auth does not answer for a moment.
    const restarted = loadWorker({
      kv: w.kv,
      ownerGetUser: async () => {
        throw new Error('auth service unavailable');
      },
    });
    expect((await restarted.api(SAM, { op: 'join', token })).status).not.toBe(200);
    // Once the owner can be looked up again, the same link still works.
    expect((await w.api(SAM, { op: 'join', token })).status).toBe(200);
  });
});

describe('team worker driver meter updates', () => {
  it('records a driver’s new reading on a vehicle someone else just edited', async () => {
    await w.api(OWNER, { op: 'put', bucket: 'vehicles', records: [{ id: 'v1', name: 'Van', status: 'active', meter: 100, meterDate: '2026-10-01', updatedAt: 'a' }] });
    await invite('driver', SAM);
    // An admin puts the van out of service; the driver's phone has not synced yet.
    await w.api(OWNER, { op: 'put', bucket: 'vehicles', records: [{ id: 'v1', name: 'Van', status: 'out_of_service', meter: 100, meterDate: '2026-10-01', updatedAt: 'b' }] });
    const res = await w.api(SAM, { op: 'put', bucket: 'vehicles', records: [{ id: 'v1', name: 'Van', status: 'active', meter: 180, meterDate: '2026-10-02', updatedAt: 'c' }] });
    expect(res.status).toBe(200);
    // The reading lands, and the admin's change is not undone.
    expect(w.kv.data.get('fl1:r:vehicles:v1')).toMatchObject({ status: 'out_of_service', meter: 180, meterDate: '2026-10-02', updatedAt: 'c' });
  });

  it('still refuses a driver’s other vehicle edits', async () => {
    await w.api(OWNER, { op: 'put', bucket: 'vehicles', records: [{ id: 'v1', name: 'Van', meter: 100, meterDate: '2026-10-01', updatedAt: 'a' }] });
    await invite('driver', SAM);
    expect((await w.api(SAM, { op: 'put', bucket: 'vehicles', records: [{ id: 'v1', name: 'Mine now', meter: 100, meterDate: '2026-10-01', updatedAt: 'b' }] })).status).toBe(403);
    expect((await w.api(SAM, { op: 'put', bucket: 'vehicles', records: [{ id: 'v9', meter: 5 }] })).status).toBe(403);
    expect(w.kv.data.get('fl1:r:vehicles:v1').name).toBe('Van');
  });
});
