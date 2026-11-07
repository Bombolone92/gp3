/**
 * Review pass 16, the message plane: channels, messages, threads, reactions,
 * pins, saved messages, direct messages, huddles, shared channels, transfer.
 * Each test here is a hole that was found in the worker's routes and closed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, overlayKey } from '../src/shared/blocks.js';

const { alice, bob } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

const post = (u, wsId, conv, text, extra = {}) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text, ...extra });

describe('a preview for the old link landing in the instant a message is edited to another', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  /** Two sites, each answering a page titled after its host. */
  function sites() {
    globalThis.fetch = async (url) => {
      const u = new URL(url);
      return new Response(`<html><head><title>${u.hostname}</title></head></html>`, { status: 200, headers: { 'Content-Type': 'text/html' } });
    };
  }

  it('does not leave the old card under the new link, nor answer it to the ask that follows the edit', async () => {
    sites();
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(alice, wsId, general.id, 'see https://a.example.com/one')).data.message;
    const key = KEYS.block(general.id, 0);
    const k = overlayKey(m.seq);
    // The card for the first link lands after the edit has read the message
    // (no card yet) and before it writes the new text: the fetch was begun
    // when the message was posted, and takes seconds.
    const realUpdate = rt.kv.update.bind(rt.kv);
    let landed = false;
    rt.kv.update = async (kk, patch) => {
      if (!landed && kk === key && Object.hasOwn(patch || {}, `x.${k}.t`)) {
        landed = true;
        await realUpdate(key, { [`x.${k}.uf`]: { url: 'https://a.example.com/one', title: 'a.example.com', kind: 'page', ts: Date.now() } });
      }
      return realUpdate(kk, patch);
    };
    let edit;
    try {
      edit = await as(alice).put(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}`, { text: 'see https://b.example.com/two' });
    } finally {
      rt.kv.update = realUpdate;
    }
    expect(landed).toBe(true);
    expect(edit.data.relink).toBe(true);
    // The edit took the old link's card down, whether or not it had seen one.
    expect((await rt.kv.get(key)).x[k].uf).toBeUndefined();
    // The ask the app makes after a relink builds the new link's card.
    const card = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/unfurl`)).data.unfurl;
    expect(card).toMatchObject({ url: 'https://b.example.com/two', title: 'b.example.com' });
    expect((await rt.kv.get(key)).x[k].uf).toMatchObject({ url: 'https://b.example.com/two' });
    // And a repeated ask answers the card that stands, fetching nothing.
    let fetched = 0;
    const serving = globalThis.fetch;
    globalThis.fetch = async (...a) => { fetched++; return serving(...a); };
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/unfurl`)).data.unfurl).toMatchObject({ url: 'https://b.example.com/two' });
    expect(fetched).toBe(0);
  });

  it('a card for the old link that landed after the edit is not answered as the message\'s, and is replaced by the new link\'s', async () => {
    sites();
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(alice, wsId, general.id, 'see https://a.example.com/one')).data.message;
    const key = KEYS.block(general.id, 0);
    const k = overlayKey(m.seq);
    expect((await as(alice).put(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}`, { text: 'see https://b.example.com/two' })).data.relink).toBe(true);
    // The old link's fetch, which had read the message before the edit, lands its card now.
    await rt.kv.update(key, { [`x.${k}.uf`]: { url: 'https://a.example.com/one', title: 'a.example.com', kind: 'page', ts: Date.now() } });
    const card = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/unfurl`)).data.unfurl;
    expect(card).toMatchObject({ url: 'https://b.example.com/two', title: 'b.example.com' });
    expect((await rt.kv.get(key)).x[k].uf).toMatchObject({ url: 'https://b.example.com/two' });
    // A card taken down stays down, whatever link it was for; a card for the
    // link the message carries is answered as before, without a fetch.
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/unfurl`)).ok).toBe(true);
    let fetched = 0;
    const serving = globalThis.fetch;
    globalThis.fetch = async (...a) => { fetched++; return serving(...a); };
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/unfurl`)).data).toEqual({ unfurl: null });
    expect(fetched).toBe(0);
  });
});

describe('asking for a link preview where one may not post', () => {
  const realFetch = globalThis.fetch;
  let fetched = 0;
  beforeEach(() => {
    fetched = 0;
    globalThis.fetch = async (url) => {
      fetched++;
      return new Response(`<html><head><title>${new URL(url).hostname}</title></head></html>`, { status: 200, headers: { 'Content-Type': 'text/html' } });
    };
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const unfurl = (u, wsId, conv, seq) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages/${seq}/unfurl`);

  it('is refused in an archived channel and to someone merely previewing a public channel, fetching nothing and writing no card; the author in the channel still gets theirs', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'links' })).data.channel;
    const m = (await post(alice, wsId, ch.id, 'see https://docs.example.com/page')).data.message;
    // Bob has not joined #links: he reads it, and changes nothing in it.
    const preview = await unfurl(bob, wsId, ch.id, m.seq);
    expect(preview.status).toBe(403);
    expect(preview.data.code).toBe('not_joined');
    expect(fetched).toBe(0);
    expect((await rt.kv.get(KEYS.block(ch.id, 0))).x?.[overlayKey(m.seq)]?.uf).toBeUndefined();
    // Archived, the channel takes no card either, from its author included.
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch.id}`, { archived: true })).ok).toBe(true);
    const closed = await unfurl(alice, wsId, ch.id, m.seq);
    expect(closed.status).toBe(403);
    expect(closed.data.code).toBe('archived');
    expect(fetched).toBe(0);
    expect((await rt.kv.get(KEYS.block(ch.id, 0))).x?.[overlayKey(m.seq)]?.uf).toBeUndefined();
    // Open again, the author's ask builds the card; a reply's in a thread of it too.
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch.id}`, { archived: false })).ok).toBe(true);
    expect((await unfurl(alice, wsId, ch.id, m.seq)).data.unfurl).toMatchObject({ url: 'https://docs.example.com/page', title: 'docs.example.com' });
    expect(fetched).toBe(1);
    const tid = `${ch.id}_t${m.seq}`;
    const r = (await post(alice, wsId, tid, 'and https://docs.example.com/reply')).data.message;
    expect((await unfurl(alice, wsId, tid, r.seq)).data.unfurl).toMatchObject({ url: 'https://docs.example.com/reply' });
    // Taking a card down in an archived channel stays as it was (a removal, not a card).
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch.id}`, { archived: true })).ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${ch.id}/messages/${m.seq}/unfurl`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.block(ch.id, 0))).x[overlayKey(m.seq)].uf).toEqual({ off: 1 });
    // A direct message is always one's own to ask in.
    const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).data.conv;
    const d = (await post(bob, wsId, dm, 'https://docs.example.com/dm')).data.message;
    expect((await unfurl(bob, wsId, dm, d.seq)).data.unfurl).toMatchObject({ url: 'https://docs.example.com/dm' });
    expect((await unfurl(alice, wsId, general.id, 1)).status).toBe(404); // a system line, as before
  });
});

describe('a channel made in the same instant its maker is removed from the workspace', () => {
  const SERVER = 'teamchat-api.test';
  /** What is left of a channel named `name` after the race: its entry, its first block, the maker's document, and whether an admin's bootstrap lists it. */
  const leftover = async (wsId, name) => {
    const ws = await rt.kv.get(KEYS.ws(wsId));
    const ch = Object.values(ws.channels || {}).find((c) => c.name === name);
    return {
      entry: ch ? { count: ch.count, members: ch.members } : null,
      block: ch ? await rt.kv.get(KEYS.block(ch.id, 0)) : null,
      card: ws.members[bob.uuid] || null,
      doc: await rt.kv.get(KEYS.member(wsId, bob.uuid)),
      listed: ch ? Object.hasOwn((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels, ch.id) : false,
      channels: Object.keys(ws.channels || {}).length,
    };
  };
  const clean = { entry: null, block: null, card: null, doc: null, listed: false, channels: 1 };

  it('leaves no channel counting them, no private channel nobody can open, and no document for someone gone', async () => {
    // The removal closes the maker's document right before their append onto it.
    let { wsId } = await workspaceWith(alice, [bob]);
    const realAdd = rt.kv.add.bind(rt.kv);
    let removed = null;
    rt.kv.add = async (k, v) => {
      if (removed === null && k === KEYS.member(wsId, bob.uuid)) {
        removed = 'pending';
        removed = await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`);
      }
      return realAdd(k, v);
    };
    let made;
    try {
      made = await as(bob).post(`/api/ws/${wsId}/channels`, { name: 'mine' });
    } finally {
      rt.kv.add = realAdd;
    }
    expect(removed?.data.ok).toBe(true);
    expect(made.status).toBe(403);
    expect(made.data.code).toBe('forbidden');
    expect(await leftover(wsId, 'mine')).toEqual(clean);

    // The removal runs whole between the entry's write and the append: a private channel.
    ({ wsId } = await workspaceWith(alice, [bob]));
    const realUpdate = rt.kv.update.bind(rt.kv);
    removed = null;
    rt.kv.update = async (k, patch) => {
      if (!removed && k === KEYS.ws(wsId) && Object.keys(patch || {}).some((p) => p.startsWith('channels.'))) {
        removed = 'pending';
        const res = await realUpdate(k, patch);
        removed = await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`);
        return res;
      }
      return realUpdate(k, patch);
    };
    try {
      made = await as(bob).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true });
    } finally {
      rt.kv.update = realUpdate;
    }
    expect(removed?.data.ok).toBe(true);
    expect(made.status).toBe(403);
    expect(await leftover(wsId, 'secret')).toEqual(clean);

    // The removal lands between the append and the count: the count's answer says the card is gone.
    ({ wsId } = await workspaceWith(alice, [bob]));
    const realIncr = rt.kv.incr.bind(rt.kv);
    removed = null;
    rt.kv.incr = async (k, by) => {
      if (removed === null && k === KEYS.ws(wsId) && by && typeof by === 'object' && Object.keys(by).some((p) => p.endsWith('.count') && p.startsWith('channels.'))) {
        removed = 'pending'; // the removal counts too: it must not find this hook waiting for it
        removed = await as(alice).del(`/api/ws/${wsId}/members/${bob.uuid}`);
      }
      return realIncr(k, by);
    };
    try {
      made = await as(bob).post(`/api/ws/${wsId}/channels`, { name: 'late' });
    } finally {
      rt.kv.incr = realIncr;
    }
    expect(removed?.data.ok).toBe(true);
    expect(made.status).toBe(403);
    expect(await leftover(wsId, 'late')).toEqual(clean);
  });

  it('nor an entry for a channel hosted elsewhere, whose connection record goes with it; made in peace, a channel counts its maker as before', async () => {
    const acme = await workspaceWith(alice, [USERS.carol], 'Acme');
    const globex = await workspaceWith(alice, [bob], 'Globex');
    expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const design = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'design' })).data.channel;
    expect(design.count).toBe(1);
    const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design.id}/connect/invites`, {});
    const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' }, profile: { name: 'Bob B.' } });
    expect(acc.ok).toBe(true);
    const realAdd = rt.kv.add.bind(rt.kv);
    let removed = null;
    rt.kv.add = async (k, v) => {
      if (removed === null && k === KEYS.member(globex.wsId, bob.uuid)) {
        removed = 'pending';
        removed = await as(alice).del(`/api/ws/${globex.wsId}/members/${bob.uuid}`);
      }
      return realAdd(k, v);
    };
    let made;
    try {
      made = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, { ref: `${acme.wsId}@${SERVER}`, ch: design.id, conn: acc.data.conn, secret: acc.data.secret, name: 'design-with-acme', host: 'Acme' });
    } finally {
      rt.kv.add = realAdd;
    }
    expect(removed?.data.ok).toBe(true);
    expect(made.status).toBe(403);
    const ws = await rt.kv.get(KEYS.ws(globex.wsId));
    expect(Object.values(ws.channels).find((c) => c.name === 'design-with-acme')).toBeUndefined();
    expect(ws.members[bob.uuid]).toBeUndefined();
    expect(await rt.kv.get(KEYS.member(globex.wsId, bob.uuid))).toBeFalsy();
    expect(await rt.kv.get(KEYS.connectPartner(acc.data.conn))).toBeFalsy();
    // Made in peace: the maker is in, counted once, on a private channel's list, with the "created" line.
    const priv = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'quiet', private: true })).data.channel;
    expect(priv).toMatchObject({ count: 1, members: [alice.uuid] });
    const stored = (await rt.kv.get(KEYS.ws(acme.wsId))).channels[priv.id];
    expect(stored).toMatchObject({ count: 1, members: [alice.uuid] });
    expect((await rt.kv.get(KEYS.member(acme.wsId, alice.uuid))).channels).toContain(priv.id);
    expect((await as(alice).get(`/api/ws/${acme.wsId}/conv/${priv.id}/messages`)).data.messages.map((m) => m.text)).toEqual(['alice created #quiet']);
  });
});

describe('someone from a connected workspace entering a shared channel in the instant the host removes them', () => {
  const SERVER = 'teamchat-api.test';
  /** Acme hosts a private #design (alice, carol); Globex (bob admin) is connected; bob has not entered yet. */
  async function connected() {
    const acme = await workspaceWith(alice, [USERS.carol], 'Acme');
    const globex = await workspaceWith(alice, [bob], 'Globex');
    expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const design = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'design', private: true })).data.channel.id;
    expect((await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/members`, { uuids: [USERS.carol.uuid] })).ok).toBe(true);
    const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`, {});
    const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' }, profile: { name: 'Bob B.' } });
    const added = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, { ref: `${acme.wsId}@${SERVER}`, ch: design, conn: acc.data.conn, secret: acc.data.secret, name: 'design-with-acme', host: 'Acme' });
    const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${added.data.channel.id}/attest`, {});
    return { acme, design, conn: acc.data.conn, token: att.data.token };
  }
  const state = async (wsId, design) => {
    const ws = await rt.kv.get(KEYS.ws(wsId));
    const c = ws.channels[design];
    const msgs = (await as(alice).get(`/api/ws/${wsId}/conv/${design}/messages`)).data.messages.map((m) => m.text);
    return { count: c.count, conn: Object.values(c.connections)[0].count, members: [...c.members].sort(), card: ws.members[bob.uuid] || null, doc: await rt.kv.get(KEYS.member(wsId, bob.uuid)), joinedLine: msgs.some((t) => /joined$/.test(t)), keptOut: !!ws.removed?.[bob.uuid] };
  };
  const out = { count: 2, conn: 0, members: [alice.uuid, USERS.carol.uuid].sort(), card: null, doc: null, joinedLine: false, keptOut: true };

  it('leaves the channel counting and listing nobody who is out, no line and no document for them; the removal landing before the append, or after it', async () => {
    // After the append, before the count: the removal counted them out of the channel their document named.
    let { acme, design, conn, token } = await connected();
    const realIncr = rt.kv.incr.bind(rt.kv);
    let removed = null;
    rt.kv.incr = async (k, by) => {
      if (removed === null && k === KEYS.ws(acme.wsId) && by && typeof by === 'object' && Object.hasOwn(by, `channels.${design}.count`)) {
        removed = 'pending';
        removed = await as(alice).del(`/api/ws/${acme.wsId}/members/${bob.uuid}`);
      }
      return realIncr(k, by);
    };
    let join;
    try {
      join = await as(bob).post('/api/connect/join', { conn, token, profile: { name: 'Bob B.' } });
    } finally {
      rt.kv.incr = realIncr;
    }
    expect(removed?.data.ok).toBe(true);
    expect(join.status).toBe(409);
    expect(join.data.code).toBe('retry');
    expect(await state(acme.wsId, design)).toEqual(out);

    // Before the append: the removal found no channel to count them out of, and the append alone made their document.
    ({ acme, design, conn, token } = await connected());
    const realAdd = rt.kv.add.bind(rt.kv);
    removed = null;
    rt.kv.add = async (k, v) => {
      if (removed === null && k === KEYS.member(acme.wsId, bob.uuid)) {
        removed = 'pending';
        removed = await as(alice).del(`/api/ws/${acme.wsId}/members/${bob.uuid}`);
      }
      return realAdd(k, v);
    };
    try {
      join = await as(bob).post('/api/connect/join', { conn, token, profile: { name: 'Bob B.' } });
    } finally {
      rt.kv.add = realAdd;
    }
    expect(removed?.data.ok).toBe(true);
    expect(join.status).toBe(409);
    expect(await state(acme.wsId, design)).toEqual(out);
    // Kept out, the next word from Globex is refused as before; in peace, entering counts once and lists them.
    expect((await as(bob).post('/api/connect/join', { conn, token, profile: { name: 'Bob B.' } })).data.code).toBe('removed');
    expect((await as(alice).del(`/api/ws/${acme.wsId}/removed/${bob.uuid}`)).ok).toBe(true);
    expect((await as(bob).post('/api/connect/join', { conn, token, profile: { name: 'Bob B.' } })).ok).toBe(true);
    const s = await state(acme.wsId, design);
    expect(s).toMatchObject({ count: 3, conn: 1, members: [alice.uuid, bob.uuid, USERS.carol.uuid].sort(), joinedLine: true, keptOut: false });
    expect(s.card).toMatchObject({ role: 'external' });
    expect(s.doc).toMatchObject({ channels: [design] });
    expect(typeof s.doc.joinedAt).toBe('number');
  });
});

describe('a huddle heartbeat read just before a poll ends the huddle, and written just after', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('begins the huddle anew rather than leaving a roster nobody started under a line saying it ended', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    vi.useFakeTimers({ toFake: ['Date'] });
    const T = Date.now();
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/huddle`, { invite: 'NJ-7F3A9C', sid: 'tab1', join: true })).data.started).toBe(true);
    // Bob's tab, throttled in the background, beats again a tenth of a second
    // before its seat lapses: the beat reads the roster live...
    vi.setSystemTime(T + 89_900);
    const realUpdate = rt.kv.update.bind(rt.kv);
    let ended = null;
    rt.kv.update = async (k, patch) => {
      if (ended === null && k === KEYS.activity(wsId) && Object.keys(patch || {}).some((p) => p.startsWith(`h.${general.id}.m.`))) {
        ended = 'pending';
        // ...and before its write lands, the bound passes and alice's poll ends the huddle.
        vi.setSystemTime(T + 90_200);
        ended = (await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).data;
      }
      return realUpdate(k, patch);
    };
    let beat;
    try {
      beat = await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/huddle`, { invite: 'NJ-7F3A9C', sid: 'tab1' });
    } finally {
      rt.kv.update = realUpdate;
    }
    expect(ended?.h).toBeUndefined();
    const lines = async () => (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.map((m) => m.text);
    expect(await lines()).toEqual(['alice created #general', 'bob joined', 'bob started a huddle', 'Huddle ended after 2 min', 'bob started a huddle']);
    // The beat is told it started the huddle, and the roster has its start again: alice sees who began it and when.
    expect(beat.data.started).toBe(true);
    expect(beat.data.huddle).toMatchObject({ by: bob.uuid, at: T + 89_900 });
    const seen = (await as(alice).get(`/api/ws/${wsId}`)).data.activity.h[general.id];
    expect(seen).toMatchObject({ by: bob.uuid, at: T + 89_900 });
    expect(Object.keys(seen.m)).toEqual([bob.uuid]);
    // Its end, when it comes, has a duration to give.
    vi.setSystemTime(T + 90_200 + 3 * 60_000);
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${general.id}/huddle?sid=tab1`)).data).toEqual({ ok: true, ended: true });
    expect((await lines()).at(-1)).toBe('Huddle ended after 3 min');
    // A beat into a roster that stands is a beat, not a start, as before.
    vi.setSystemTime(T + 200_000);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/huddle`, { invite: 'NJ-7F3A9C', sid: 'tab1', join: true })).data.started).toBe(true);
    vi.setSystemTime(T + 215_000);
    const again = await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/huddle`, { invite: 'NJ-7F3A9C', sid: 'tab1' });
    expect(again.data.started).toBe(false);
    expect(again.data.huddle).toMatchObject({ by: bob.uuid, at: T + 200_000 });
  });
});

describe('a revocation arriving for someone whose standing lapsed long ago, as the sweep lets them go', () => {
  const SERVER = 'teamchat-api.test';
  const DAY = 86_400_000;

  it('counts them out of the channel once, whichever of the two is first', async () => {
    const acme = await workspaceWith(alice, [USERS.carol], 'Acme');
    const globex = await workspaceWith(alice, [bob], 'Globex');
    expect((await as(alice).post(`/api/ws/${globex.wsId}/members/${bob.uuid}/role`, { role: 'admin' })).ok).toBe(true);
    const design = (await as(alice).post(`/api/ws/${acme.wsId}/channels`, { name: 'design' })).data.channel.id;
    await as(USERS.carol).post(`/api/ws/${acme.wsId}/channels/${design}/join`);
    const inv = await as(alice).post(`/api/ws/${acme.wsId}/channels/${design}/connect/invites`, {});
    const acc = await as(bob).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${globex.wsId}@${SERVER}`, name: 'Globex' }, profile: { name: 'Bob B.' } });
    const added = await as(bob).post(`/api/ws/${globex.wsId}/channels/shared`, { ref: `${acme.wsId}@${SERVER}`, ch: design, conn: acc.data.conn, secret: acc.data.secret, name: 'design-with-acme', host: 'Acme' });
    const att = await as(bob).post(`/api/ws/${globex.wsId}/channels/${added.data.channel.id}/attest`, {});
    expect((await as(bob).post('/api/connect/join', { conn: acc.data.conn, token: att.data.token, profile: { name: 'Bob B.' } })).ok).toBe(true);
    const designOn = async () => (await rt.kv.get(KEYS.ws(acme.wsId))).channels[design];
    expect(await designOn()).toMatchObject({ count: 3, connections: { [acc.data.conn]: { count: 1 } } });
    // Bob's standing on Acme ran out a month and more ago: the next bootstrap's sweep lets him go.
    await rt.kv.update(KEYS.ws(acme.wsId), { [`members.${bob.uuid}.exp`]: Date.now() - 32 * DAY });
    // Globex removes him now; its word for Acme is signed after his vouching, and would end the seat.
    await new Promise((r) => setTimeout(r, 5));
    const removed = await as(alice).del(`/api/ws/${globex.wsId}/members/${bob.uuid}`);
    expect(removed.data.revocations).toHaveLength(1);
    const word = removed.data.revocations[0];
    // The word lands as the sweep closes his document, having taken its claim on the card.
    const realUpdate = rt.kv.update.bind(rt.kv);
    let revoked = null;
    rt.kv.update = async (k, patch) => {
      if (revoked === null && k === KEYS.member(acme.wsId, bob.uuid) && Object.hasOwn(patch || {}, 'gone')) {
        revoked = 'pending';
        revoked = await as(alice).post('/api/connect/revoke', { conn: word.conn, token: word.token });
      }
      return realUpdate(k, patch);
    };
    let boot;
    try {
      boot = await as(alice).get(`/api/ws/${acme.wsId}`);
    } finally {
      rt.kv.update = realUpdate;
    }
    expect(boot.ok).toBe(true);
    expect(revoked?.data).toEqual({ ok: true, already: true });
    expect(boot.data.workspace.members[bob.uuid]).toBeUndefined();
    expect(await designOn()).toMatchObject({ count: 2, connections: { [acc.data.conn]: { count: 0 } } });
    expect(await rt.kv.get(KEYS.member(acme.wsId, bob.uuid))).toBeFalsy();
    // Said again, and a later bootstrap: nothing more to do, nothing more counted.
    expect((await as(alice).post('/api/connect/revoke', { conn: word.conn, token: word.token })).data).toEqual({ ok: true, already: true });
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).ok).toBe(true);
    expect(await designOn()).toMatchObject({ count: 2, connections: { [acc.data.conn]: { count: 0 } } });
    expect((await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace.former[bob.uuid]).toMatchObject({ name: 'Bob B.' });
  });
});

describe('a reply in a thread that names someone', () => {
  const read = (u, wsId, conv, seq) => as(u).post(`/api/ws/${wsId}/conv/${conv}/read`, { seq });

  it('is counted on the channel only once the thread\'s own entry says the reply is in, and before the channel\'s stamp moves for it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, USERS.carol]);
    const root = (await post(alice, wsId, general.id, 'hey @bob, thoughts?')).data.message;
    const tid = `${general.id}_t${root.seq}`;
    // Bob has read #general to its end: the mention in the root is cleared.
    expect((await read(bob, wsId, general.id, root.seq)).ok).toBe(true);
    const before = (await rt.kv.get(KEYS.activity(wsId))).c[general.id];
    // What bob's app would see if its poll landed as his count was written:
    // the activity document at that instant.
    const incr = rt.kv.incr;
    let seen = null;
    rt.kv.incr = async (k, amount) => {
      if (!seen && k === KEYS.member(wsId, bob.uuid) && amount && typeof amount === 'object' && Object.hasOwn(amount, `mentions.${general.id}`)) {
        seen = { act: await rt.kv.get(KEYS.activity(wsId)) };
      }
      return incr(k, amount);
    };
    let reply;
    try {
      reply = (await post(USERS.carol, wsId, tid, '@bob look at this')).data.message;
    } finally {
      rt.kv.incr = incr;
    }
    expect(seen).not.toBeNull();
    // The thread's entry already names the reply (bob's app tells a thread
    // mention from a stuck one by it), and the channel's own stamp has not
    // moved yet (the count comes before the announcement, as for a post).
    expect(seen.act.c[tid]).toMatchObject({ s: reply.seq, u: USERS.carol.uuid });
    expect(seen.act.c[general.id]).toEqual(before);
    // Once the reply is in, bob's count stands on #general and its stamp has moved for the reply.
    const doc = await rt.kv.get(KEYS.member(wsId, bob.uuid));
    expect(doc.mentions[general.id]).toBe(1);
    const after = (await rt.kv.get(KEYS.activity(wsId))).c[general.id];
    expect(after.x).toBeGreaterThan(before.x || 0);
    expect(after.s).toBe(before.s);
  });
});

describe('a post whose counting takes seconds', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const sync = (u, wsId, since) => as(u).get(`/api/ws/${wsId}/sync?since=${since}`);

  it('is still delivered to a tab that polled meanwhile: the activity stamps are of the moment they are written, not of the moment the post began', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, USERS.carol]);
    const root = (await post(alice, wsId, general.id, 'root')).data.message;
    const tid = `${general.id}_t${root.seq}`;
    vi.useFakeTimers({ toFake: ['Date'] });
    const T = Date.now();
    // Bob's poll, three seconds into the post: the clock is three seconds on
    // by the time the message is appended (a broadcast in a large channel is
    // counted for hundreds of members first).
    const add = rt.kv.add;
    let polled = null;
    const slowAppend = (key) => {
      polled = null;
      rt.kv.add = async (k, v) => {
        if (!polled && k === key) {
          vi.setSystemTime(Date.now() + 3000);
          polled = (await sync(bob, wsId, 0)).data;
        }
        return add(k, v);
      };
    };
    try {
      slowAppend(KEYS.block(general.id, 0));
      const sent = await post(alice, wsId, general.id, '@channel all hands');
      expect(sent.ok).toBe(true);
      const m = sent.data.message;
      expect(polled).not.toBeNull();
      // Bob's next poll, from where the last one left him, brings the message.
      let next = (await sync(bob, wsId, polled.now)).data;
      expect(next.c[general.id]).toMatchObject({ s: m.seq, u: alice.uuid });
      // The same for a reply: the channel's stamp moves for it in the poll after.
      vi.setSystemTime(Date.now() + 10_000);
      slowAppend(KEYS.block(tid, 0));
      const r = (await post(USERS.carol, wsId, tid, 'and in the thread')).data.message;
      expect(polled).not.toBeNull();
      next = (await sync(bob, wsId, polled.now)).data;
      expect(next.c[tid]).toMatchObject({ s: r.seq });
      expect(next.c[general.id]).toMatchObject({ s: m.seq });
    } finally {
      rt.kv.add = add;
    }
    expect(Date.now()).toBeGreaterThanOrEqual(T + 16_000);
  });
});
