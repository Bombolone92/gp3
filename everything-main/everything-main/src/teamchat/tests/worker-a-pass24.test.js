/**
 * Identity, membership, notification and scheduling routes: what the
 * twenty-fourth review pass found.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, BLOCK_SIZE, lastSeqOfBlock, jsonBytes } from '../src/shared/blocks.js';
import { VALUE_BYTES_MAX } from '../dev/worker-runtime.js';
import { countKv } from './helpers/kvcount.js';

const { alice, bob, carol, dave } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

/**
 * A message's number is taken, its counters moved (a mention of the reader
 * among them), and only then is it appended to its block. A read to the last
 * message standing that runs in that window finds the counter past what the
 * block holds and no message past its own: judged read to the end, it wiped
 * the count the mention in flight had just raised, and the badge for that
 * mention never showed on any device, though the message stood unread.
 */
describe('a read to the last standing message while a mention of the reader is in flight', () => {
  const mentionsOf = async (wsId, u, conv) => Number((await rt.kv.get(KEYS.member(wsId, u)))?.mentions?.[conv]) || 0;

  it('keeps the count of the mention whose message is about to land', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const first = await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: '@alice first' });
    expect(first.ok).toBe(true);
    expect(await mentionsOf(wsId, alice.uuid, general.id)).toBe(1);
    const add = rt.kv.add;
    let read = null;
    // Bob's second mention has taken its number and moved alice's count; as
    // it is about to be appended, alice's tab reads to the first one.
    rt.kv.add = async (k, value) => {
      if (k === KEYS.block(general.id, 0) && !read && value && Array.isArray(value.m)) {
        read = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: first.data.message.seq });
      }
      return add(k, value);
    };
    let second;
    try {
      second = await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: '@alice second' });
    } finally {
      rt.kv.add = add;
    }
    expect(second.ok).toBe(true);
    expect(read.ok).toBe(true);
    // The second mention is counted for alice: not read to the end while it was on its way.
    expect(await mentionsOf(wsId, alice.uuid, general.id)).toBeGreaterThanOrEqual(1);
    // Reading to it clears the count, as before.
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: second.data.message.seq })).ok).toBe(true);
    expect(await mentionsOf(wsId, alice.uuid, general.id)).toBe(0);
  });

  it('a read to the last standing message when the newer ones were deleted still clears the badge', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const first = await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: '@alice first' });
    const second = await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'later, deleted' });
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${general.id}/messages/${second.data.message.seq}`)).ok).toBe(true);
    expect(await mentionsOf(wsId, alice.uuid, general.id)).toBe(1);
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: first.data.message.seq })).ok).toBe(true);
    expect(await mentionsOf(wsId, alice.uuid, general.id)).toBe(0);
  });
});

/**
 * The newest message is the first of a new block, and deleted since: a read
 * to the last message standing, in the block before, was judged within its
 * own block alone and cleared nothing, so the mention badge stood on every
 * device until someone posted again. The counter's block is read beside
 * the read's where it is the next one.
 */
describe('a read to the last standing message when the deleted newest one opened the next block', () => {
  const mentionsOf = async (wsId, u, conv) => Number((await rt.kv.get(KEYS.member(wsId, u)))?.mentions?.[conv]) || 0;
  const post = (wsId, conv, text) => as(alice).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text });
  const read = (wsId, conv, seq) => as(bob).post(`/api/ws/${wsId}/conv/${conv}/read`, { seq });
  /** Block 0 closed as a roll closes it: the counter at its last number, the block marked full. */
  async function closeBlock0(conv) {
    await rt.kv.set(KEYS.seq(conv), lastSeqOfBlock(0));
    await rt.kv.update(KEYS.block(conv, 0), { full: 1 });
  }

  it('clears the badge when block n was closed early and the first message of n+1 is deleted', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const early = (await post(wsId, general.id, '@bob early')).data.message;
    await closeBlock0(general.id);
    const first = (await post(wsId, general.id, 'first of the next block')).data.message;
    expect(first.seq).toBe(lastSeqOfBlock(0) + 1);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${first.seq}`)).ok).toBe(true);
    expect(await mentionsOf(wsId, bob.uuid, general.id)).toBe(1);
    expect((await read(wsId, general.id, early.seq)).ok).toBe(true);
    expect(await mentionsOf(wsId, bob.uuid, general.id)).toBe(0);
  });

  it('clears the badge when a full block n is followed by a deleted first message of n+1', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    let last = null;
    for (let i = 0; i < BLOCK_SIZE - 2; i++) last = (await post(wsId, general.id, i === 0 ? '@bob hi' : `m${i}`)).data.message;
    expect(last.seq).toBe(lastSeqOfBlock(0));
    const first = (await post(wsId, general.id, 'first of the next block')).data.message;
    expect(first.seq).toBe(lastSeqOfBlock(0) + 1);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${first.seq}`)).ok).toBe(true);
    expect((await read(wsId, general.id, last.seq)).ok).toBe(true);
    expect(await mentionsOf(wsId, bob.uuid, general.id)).toBe(0);
  });

  it('a message standing in block n+1 keeps the badge until the reader reaches it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const early = (await post(wsId, general.id, '@bob early')).data.message;
    await closeBlock0(general.id);
    const later = (await post(wsId, general.id, '@bob later')).data.message;
    expect(await mentionsOf(wsId, bob.uuid, general.id)).toBe(2);
    expect((await read(wsId, general.id, early.seq)).ok).toBe(true);
    expect(await mentionsOf(wsId, bob.uuid, general.id)).toBe(2);
    expect((await read(wsId, general.id, later.seq)).ok).toBe(true);
    expect(await mentionsOf(wsId, bob.uuid, general.id)).toBe(0);
  });

  it('a mention on its way as the first message of block n+1 is not read over (cross-block)', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const early = (await post(wsId, general.id, '@bob early')).data.message;
    await closeBlock0(general.id);
    const add = rt.kv.add;
    let r = null;
    rt.kv.add = async (k, value) => {
      if (k === KEYS.block(general.id, 1) && !r && value && Array.isArray(value.m)) r = await read(wsId, general.id, early.seq);
      return add(k, value);
    };
    let later;
    try {
      later = await post(wsId, general.id, '@bob later');
    } finally {
      rt.kv.add = add;
    }
    expect(later.ok && r.ok).toBe(true);
    expect(await mentionsOf(wsId, bob.uuid, general.id)).toBeGreaterThanOrEqual(1);
    expect((await read(wsId, general.id, later.data.message.seq)).ok).toBe(true);
    expect(await mentionsOf(wsId, bob.uuid, general.id)).toBe(0);
  });
});

/**
 * The activity document keeps one entry per conversation ever written in,
 * threads included, and the poll let go only of thread and direct-message
 * entries quiet for a month. A workspace busy enough to have more of them
 * fresh than the store's value cap holds grew the document to the cap, after
 * which every post failed (each writes the entry of its conversation there),
 * with nothing that would ever shrink it. Past a byte budget, the quietest
 * thread and direct-message entries go whatever their age, as many as bring
 * the document under it; the channels' entries stay.
 */
describe('the activity document of a busy workspace stays under the store\'s cap', () => {
  const entryKey = (wsId) => KEYS.activity(wsId);
  /** Fresh thread entries under `conv` until the document is at least `bytes` long: sized once, then topped up. */
  function fill(act, conv, u, bytes, now) {
    const entry = (i) => ({ s: 3, t: now - i, u, x: now - i });
    const per = jsonBytes({ [`${conv}_t1000`]: entry(1000) }) + 1;
    let i = 1000;
    for (const need = Math.ceil((bytes - jsonBytes(act)) / per); i - 1000 < need; i++) act.c[`${conv}_t${i}`] = entry(i);
    while (jsonBytes(act) < bytes) {
      act.c[`${conv}_t${i}`] = entry(i);
      i++;
    }
    return i - 1000;
  }

  it('a post lands after the poll has made room, and the channel entry is kept', async () => {
    rt = await boot({ strictSize: true });
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const root = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' })).data.message;
    const act = await rt.kv.get(entryKey(wsId));
    const now = Date.now();
    const added = fill(act, general.id, alice.uuid, VALUE_BYTES_MAX - 200, now);
    expect(added).toBeGreaterThan(1000);
    await rt.kv.set(entryKey(wsId), act);
    // A few polls: what they prune is what stands between this workspace and the cap.
    for (let i = 0; i < 3; i++) expect((await as(bob).get(`/api/ws/${wsId}/sync?since=${now + 60_000}`)).ok).toBe(true);
    const reply = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}_t${root.seq}/messages`, { text: 'a reply opens a new entry' });
    expect(reply.status).toBe(200);
    const after = await rt.kv.get(entryKey(wsId));
    expect(jsonBytes(after)).toBeLessThan(VALUE_BYTES_MAX - 100_000);
    expect(after.c[general.id]).toBeDefined();
    expect(after.c[`${general.id}_t${root.seq}`]).toBeDefined();
    // The quietest went first: the freshest fabricated entries stand, the oldest do not.
    expect(after.c[`${general.id}_t1000`]).toBeDefined();
    expect(after.c[`${general.id}_t${999 + added}`]).toBeUndefined();
  }, 20_000);

  it('a document a little over the budget loses only enough, quietest first, and never a channel', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const act = await rt.kv.get(entryKey(wsId));
    const now = Date.now();
    // The channel's own entry made the oldest of all.
    act.c[general.id].t = 1;
    act.c[general.id].x = 1;
    const added = fill(act, general.id, alice.uuid, 250 * 1024 + 3000, now);
    await rt.kv.set(entryKey(wsId), act);
    const before = jsonBytes(act);
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=${now + 60_000}`)).ok).toBe(true);
    const after = await rt.kv.get(entryKey(wsId));
    expect(jsonBytes(after)).toBeLessThanOrEqual(250 * 1024);
    expect(jsonBytes(after)).toBeGreaterThan(before - 6000);
    expect(after.c[general.id]).toBeDefined();
    expect(after.c[`${general.id}_t1000`]).toBeDefined();
    expect(after.c[`${general.id}_t${999 + added}`]).toBeUndefined();
  }, 20_000);
});

/**
 * A member's photo is served on their membership, which the workspace's
 * record says; the route read the caller's own document for every photo
 * (once per card on screen) and looked at it only for a guest or someone
 * from a connected workspace, whose check still reads it, beside the
 * photo's record rather than ahead of it.
 */
describe('round trips: a member\'s photo is served on their membership alone', () => {
  const upload = async (who) => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(64)], { type: 'image/png' }), 'me.png');
    expect((await as(who).post('/api/me/avatar', fd)).ok).toBe(true);
  };

  it('reads the workspace and the photo\'s record, not the caller\'s own document', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    await upload(bob);
    const c = countKv(rt);
    try {
      const res = await as(alice).get(`/api/ws/${wsId}/members/${bob.uuid}/avatar`);
      expect(res.status).toBe(200);
      expect(c.keys.get).not.toContain(KEYS.member(wsId, alice.uuid));
      expect([...c.keys.get].sort()).toEqual([KEYS.user(bob.uuid), KEYS.ws(wsId)].sort());
      // Both in one round trip: neither is keyed on the caller, so they come
      // up together rather than one after the other (see requireMember).
      expect(c.total()).toBe(1);
    } finally {
      c.restore();
    }
  });

  it('a guest still sees the photos of the people they share a channel with and nobody else\'s', async () => {
    const { wsId } = await workspaceWith(alice, [bob, dave]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'proj' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).ok).toBe(true);
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${ch}/invites`, {});
    expect((await as(carol).post('/api/join', { code: inv.data.code })).ok).toBe(true);
    await upload(bob);
    await upload(dave);
    await upload(carol);
    // The bootstrap records who the guest may see.
    expect((await as(carol).get(`/api/ws/${wsId}`)).ok).toBe(true);
    const c = countKv(rt);
    try {
      expect((await as(carol).get(`/api/ws/${wsId}/members/${bob.uuid}/avatar`)).status).toBe(200);
      expect(c.keys.get).toContain(KEYS.member(wsId, carol.uuid));
      c.reset();
      expect((await as(carol).get(`/api/ws/${wsId}/members/${dave.uuid}/avatar`)).status).toBe(404);
      c.reset();
      // Their own photo needs no such check, and no read of their document.
      expect((await as(carol).get(`/api/ws/${wsId}/members/${carol.uuid}/avatar`)).status).toBe(200);
      expect(c.keys.get).not.toContain(KEYS.member(wsId, carol.uuid));
    } finally {
      c.restore();
    }
  });
});

/**
 * A multipart body is parsed whole before the file's size was checked, so a
 * body of any declared length was buffered on the owner's worker before it
 * was refused. One declared past the route's cap is refused before the body
 * is read; one with no usable length is read and measured as before.
 */
describe('an upload declared larger than the route allows is refused before its body is read', () => {
  const formSpy = () => {
    const orig = Request.prototype.formData;
    let calls = 0;
    Request.prototype.formData = function spied() {
      calls++;
      return orig.call(this);
    };
    return { count: () => calls, restore: () => { Request.prototype.formData = orig; } };
  };
  const smallPng = () => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(64)], { type: 'image/png' }), 'me.png');
    return fd;
  };
  // The request built by hand, so it carries a declared length of the test's choosing.
  const upload = async (who, path, fd, bytes = null) => {
    const req = new Request(`https://teamchat-api.test${path}`, { method: 'POST', body: fd, headers: bytes == null ? {} : { 'content-length': String(bytes) } });
    const res = await rt.dispatch(req, {}, who);
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() : null };
  };

  it('a file, a workspace icon and a profile photo, each with the route\'s own words; a plain upload still goes through', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const spy = formSpy();
    try {
      const file = await upload(bob, `/api/ws/${wsId}/files`, smallPng(), 11 * 1024 * 1024);
      expect(file.status).toBe(413);
      expect(file.data).toMatchObject({ code: 'too_large', message: 'Files can be up to 10 MB' });
      const icon = await upload(alice, `/api/ws/${wsId}/icon`, smallPng(), 400 * 1024);
      expect(icon.status).toBe(413);
      expect(icon.data).toMatchObject({ code: 'too_large', message: 'Workspace icons can be up to 300 KB' });
      const photo = await upload(bob, '/api/me/avatar', smallPng(), 400 * 1024);
      expect(photo.status).toBe(413);
      expect(photo.data).toMatchObject({ code: 'too_large', message: 'Profile photos can be up to 300 KB' });
      expect(spy.count()).toBe(0);
      // A length within the cap, or none at all, is read as before.
      expect((await upload(bob, `/api/ws/${wsId}/files`, smallPng(), 200)).status).toBe(200);
      expect((await upload(alice, `/api/ws/${wsId}/icon`, smallPng())).status).toBe(200);
      expect((await upload(bob, '/api/me/avatar', smallPng())).status).toBe(200);
      expect(spy.count()).toBe(3);
      // Non-members and non-admins are still answered for what they are, ahead of the size.
      expect((await upload(carol, `/api/ws/${wsId}/files`, smallPng(), 11 * 1024 * 1024)).status).toBe(403);
      expect((await upload(bob, `/api/ws/${wsId}/icon`, smallPng(), 400 * 1024)).status).toBe(403);
    } finally {
      spy.restore();
    }
  });
});

/**
 * A Puter account renamed: the handle on every card of theirs follows (see
 * ensureProfile), and so does the card on a workspace the account's record
 * here did not list yet (a moved workspace opened here for the first time,
 * a join cut short), which used to keep the old handle for good.
 */
describe('a Puter account renamed', () => {
  const robert = { uuid: bob.uuid, username: 'robert' };

  it('folds the new handle into every card the record lists, and the mention moves with it', async () => {
    const a = await workspaceWith(alice, [bob]);
    const b = await workspaceWith(alice, [bob], 'Other');
    const me = await as(robert).get('/api/me');
    expect(me.ok).toBe(true);
    expect(me.data.profile.username).toBe('robert');
    expect((await rt.kv.get(KEYS.ws(a.wsId))).members[bob.uuid].username).toBe('robert');
    expect((await rt.kv.get(KEYS.ws(b.wsId))).members[bob.uuid].username).toBe('robert');
    // The new handle rings; the old one is text; the display name is theirs and stays.
    expect((await as(alice).post(`/api/ws/${a.wsId}/conv/${a.general.id}/messages`, { text: '@robert hi' })).data.message.mentions).toEqual([bob.uuid]);
    expect((await as(alice).post(`/api/ws/${a.wsId}/conv/${a.general.id}/messages`, { text: '@bob hi' })).data.message.mentions).toEqual([]);
    expect((await rt.kv.get(KEYS.member(a.wsId, bob.uuid))).mentions[a.general.id]).toBe(1);
    expect((await rt.kv.get(KEYS.ws(a.wsId))).members[bob.uuid].name).toBe('bob');
  });

  it('a card on a workspace the record did not list takes the handle when the workspace is opened', async () => {
    const a = await workspaceWith(alice, [bob]);
    // As after a move: the card is here, the account's record on this server does not name the workspace.
    await rt.kv.update(KEYS.user(bob.uuid), { workspaces: [] });
    expect((await as(robert).get('/api/me')).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(a.wsId))).members[bob.uuid].username).toBe('bob');
    const w = (await rt.kv.get(KEYS.activity(a.wsId))).w || 0;
    const opened = await as(robert).get(`/api/ws/${a.wsId}`);
    expect(opened.ok).toBe(true);
    expect(opened.data.workspace.members[bob.uuid].username).toBe('robert');
    expect((await rt.kv.get(KEYS.ws(a.wsId))).members[bob.uuid].username).toBe('robert');
    expect((await rt.kv.get(KEYS.activity(a.wsId))).w).toBeGreaterThan(w);
    expect((await rt.kv.get(KEYS.user(bob.uuid))).workspaces).toEqual([a.wsId]);
    expect((await as(alice).post(`/api/ws/${a.wsId}/conv/${a.general.id}/messages`, { text: '@robert there' })).data.message.mentions).toEqual([bob.uuid]);
    // Opened again, nothing more is written for it.
    const c = countKv(rt);
    try {
      expect((await as(robert).get(`/api/ws/${a.wsId}`)).ok).toBe(true);
      expect(c.counts.update).toBe(0);
    } finally {
      c.restore();
    }
  });
});

/**
 * The account's list of workspaces is appended to wherever a workspace turns
 * out to be missing from it, and two tabs doing so at once named it twice:
 * listed twice by /api/me, counted twice toward the cap. Read as distinct
 * wherever it is read, healed once when found repeating, and each append
 * takes a second copy off when the answer shows one.
 */
describe('the account\'s list of workspaces names each once', () => {
  it('a record naming a workspace twice lists it once, and is put right', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    await rt.kv.add(KEYS.user(bob.uuid), { workspaces: [wsId] });
    expect((await rt.kv.get(KEYS.user(bob.uuid))).workspaces).toEqual([wsId, wsId]);
    const me = await as(bob).get('/api/me');
    expect(me.ok).toBe(true);
    expect(me.data.workspaces.map((w) => w.id)).toEqual([wsId]);
    expect((await rt.kv.get(KEYS.user(bob.uuid))).workspaces).toEqual([wsId]);
  });

  it('two tabs opening a workspace missing from the record at once name it once', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    // As after a move or an import: the card is here, the record does not name the workspace.
    await rt.kv.update(KEYS.user(bob.uuid), { workspaces: [] });
    const [r1, r2] = await Promise.all([as(bob).get(`/api/ws/${wsId}`), as(bob).get(`/api/ws/${wsId}`)]);
    expect(r1.ok && r2.ok).toBe(true);
    expect((await rt.kv.get(KEYS.user(bob.uuid))).workspaces).toEqual([wsId]);
    // The same for the invite link opened again by someone already in.
    const code = (await as(alice).get(`/api/ws/${wsId}`)).data.workspace.invite;
    await rt.kv.update(KEYS.user(bob.uuid), { workspaces: [] });
    const [j1, j2] = await Promise.all([as(bob).post('/api/join', { code }), as(bob).post('/api/join', { code })]);
    expect(j1.data).toMatchObject({ already: true });
    expect(j2.data).toMatchObject({ already: true });
    expect((await rt.kv.get(KEYS.user(bob.uuid))).workspaces).toEqual([wsId]);
  });

  it('a workspace its owner deleted leaves the list at the next look', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const other = await workspaceWith(alice, [bob], 'Other');
    expect((await as(alice).del(`/api/ws/${wsId}`)).ok).toBe(true);
    const me = await as(bob).get('/api/me');
    expect(me.data.workspaces.map((w) => w.id)).toEqual([other.wsId]);
    expect((await rt.kv.get(KEYS.user(bob.uuid))).workspaces).toEqual([other.wsId]);
  });
});

/**
 * The routes that run without the caller's own document (see
 * requireMembership's `doc`, and requireMember) judge who the caller is by
 * their card, and what a guest or someone from a connected workspace may
 * take by their document, read for them alone: nothing their document kept
 * them from is reached through the slimmed routes.
 */
describe('guests and people from connected workspaces on the routes that read no document of the caller\'s', () => {
  const png = () => {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(64)], { type: 'image/png' }), 'x.png');
    return fd;
  };
  const upload = async (who, wsId) => {
    const r = await as(who).post(`/api/ws/${wsId}/files`, png());
    expect(r.ok).toBe(true);
    return r.data.id;
  };

  it('the admin-only and owner-only routes refuse a guest and a plain member by their card, their documents gone', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'proj' })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${ch}/invites`, {});
    expect((await as(carol).post('/api/join', { code: inv.data.code })).data.guest).toBe(true);
    // The role is the card's: with no document at all the answer is the same.
    await rt.kv.del(KEYS.member(wsId, carol.uuid));
    await rt.kv.del(KEYS.member(wsId, bob.uuid));
    const routes = [
      ['put', `/api/ws/${wsId}`, { name: 'Taken over' }],
      ['post', `/api/ws/${wsId}/icon`, png()],
      ['del', `/api/ws/${wsId}/icon`],
      ['del', `/api/ws/${wsId}`],
      ['post', `/api/ws/${wsId}/members/${alice.uuid}/role`, { role: 'member' }],
      ['del', `/api/ws/${wsId}/members/${alice.uuid}`],
      ['del', `/api/ws/${wsId}/removed/${dave.uuid}`],
      ['del', `/api/ws/${wsId}/webhooks/nohook`],
      ['del', `/api/ws/${wsId}/bots/nobot`],
      ['get', `/api/ws/${wsId}/export`],
      ['post', `/api/ws/${wsId}/search/reindex`, {}],
      ['post', `/api/ws/${wsId}/transfer`, { to: bob.uuid }],
      ['post', `/api/ws/${wsId}/transfer/begin`, { session: 's1' }],
      ['post', `/api/ws/${wsId}/transfer/cancel`, {}],
      ['post', `/api/ws/${wsId}/transfer/complete`, { ref: `x@teamchat-api.test` }],
      ['post', `/api/ws/${wsId}/import`, { conv: ch, messages: [] }],
      ['post', `/api/ws/${wsId}/import/file`, png()],
    ];
    for (const who of [carol, bob]) {
      for (const [method, path, body] of routes) {
        const r = await as(who)[method](path, body);
        expect(`${method} ${path} as ${who.username}: ${r.status}`).toBe(`${method} ${path} as ${who.username}: 403`);
      }
    }
    // Nothing above changed the workspace.
    const ws = await rt.kv.get(KEYS.ws(wsId));
    expect(ws.name).toBe('Acme');
    expect(ws.members[alice.uuid].role).toBe('owner');
    expect(ws.members[carol.uuid].role).toBe('guest');
  });

  it('a guest downloads what is shared where they can read, and their own uploads, and nothing else; attaching is judged the same way', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'proj' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).ok).toBe(true);
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${ch}/invites`, {});
    expect((await as(carol).post('/api/join', { code: inv.data.code })).data.guest).toBe(true);
    const inGeneral = await upload(alice, wsId);
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'for members', attachments: [{ id: inGeneral }] })).ok).toBe(true);
    const inProj = await upload(bob, wsId);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${ch}/messages`, { text: 'for the project', attachments: [{ id: inProj }] })).ok).toBe(true);
    const own = await upload(carol, wsId);
    expect((await as(carol).get(`/api/ws/${wsId}/files/${inGeneral}`)).status).toBe(404);
    expect((await as(carol).get(`/api/ws/${wsId}/files/${inProj}`)).status).toBe(200);
    expect((await as(carol).get(`/api/ws/${wsId}/files/${own}`)).status).toBe(200);
    // A member downloads any of them.
    for (const id of [inGeneral, inProj, own]) expect((await as(bob).get(`/api/ws/${wsId}/files/${id}`)).status).toBe(200);
    // Attaching another's file from a channel they cannot read is refused as no file of the workspace.
    const attach = await as(carol).post(`/api/ws/${wsId}/conv/${ch}/messages`, { text: '', attachments: [{ id: inGeneral }] });
    expect(attach.status).toBe(400);
    expect(attach.data).toMatchObject({ message: 'Those files are not in this workspace' });
    expect((await as(carol).post(`/api/ws/${wsId}/conv/${ch}/messages`, { text: '', attachments: [{ id: own }] })).ok).toBe(true);
    // And the general channel itself is not theirs to read.
    expect((await as(carol).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).status).toBe(404);
  });

  it('a guest whose document records no peers yet (before their first bootstrap) is still judged by who they share a channel with', async () => {
    const { wsId } = await workspaceWith(alice, [bob, dave]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'proj' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).ok).toBe(true);
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${ch}/invites`, {});
    expect((await as(carol).post('/api/join', { code: inv.data.code })).data.guest).toBe(true);
    for (const who of [bob, dave]) {
      const fd = png();
      expect((await as(who).post('/api/me/avatar', fd)).ok).toBe(true);
    }
    expect((await rt.kv.get(KEYS.member(wsId, carol.uuid))).peers).toBeUndefined();
    expect((await as(carol).get(`/api/ws/${wsId}/members/${bob.uuid}/avatar`)).status).toBe(200);
    expect((await as(carol).get(`/api/ws/${wsId}/members/${dave.uuid}/avatar`)).status).toBe(404);
  });

  it('someone from a connected workspace downloads what is shared in the channel shared with them, nothing shared elsewhere, and nothing once their standing has run out', async () => {
    const SERVER = 'teamchat-api.test';
    const acme = await workspaceWith(alice, [carol], 'Acme');
    const globex = await workspaceWith(alice, [bob, dave], 'Globex');
    expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const design = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'design' })).data.channel.id;
    const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`, { inviteTtl: '7d' });
    const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' }, profile: { name: 'Bob B.' } });
    expect(acc.ok).toBe(true);
    const added = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, { ref: `${acme.wsId}@${SERVER}`, ch: design, conn: acc.data.conn, secret: acc.data.secret, name: 'design-with-acme', host: acc.data.workspace.name });
    expect(added.ok).toBe(true);
    const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${added.data.channel.id}/attest`, {});
    expect((await as(bob).post('/api/connect/join', { conn: att.data.conn, token: att.data.token, profile: { name: 'Bob B.' } })).ok).toBe(true);
    const inDesign = await upload(alice, acme.wsId);
    expect((await as(alice).post(`/api/ws/${acme.wsId}/conv/${design}/messages`, { text: 'shared', attachments: [{ id: inDesign }] })).ok).toBe(true);
    const inGeneral = await upload(alice, acme.wsId);
    expect((await as(alice).post(`/api/ws/${acme.wsId}/conv/${acme.general.id}/messages`, { text: 'ours', attachments: [{ id: inGeneral }] })).ok).toBe(true);
    expect((await as(bob).get(`/api/ws/${acme.wsId}/files/${inDesign}`)).status).toBe(200);
    expect((await as(bob).get(`/api/ws/${acme.wsId}/files/${inGeneral}`)).status).toBe(404);
    // Standing run out: the card says so, and every route of theirs asks for a renewal first.
    await rt.kv.update(KEYS.ws(acme.wsId), { [`members.${bob.uuid}.exp`]: Date.now() - 1000 });
    const lapsed = await as(bob).get(`/api/ws/${acme.wsId}/files/${inDesign}`);
    expect(lapsed.status).toBe(403);
    expect(lapsed.data).toMatchObject({ code: 'reattest' });
    expect((await as(bob).get(`/api/ws/${acme.wsId}/unfurl-image/0000000000000000000000000000000000000000000000000000000000000000`)).status).toBe(403);
  });
});
