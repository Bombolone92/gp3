/**
 * Identity, membership, notification and scheduling routes: what the
 * twenty-fifth review pass found.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, threadConvId } from '../src/shared/blocks.js';
import { b64url } from '../worker/push.js';

const { alice, bob, carol } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

afterEach(() => {
  expect(rt.kv._calls.list).toBe(0);
});

const memberDoc = (wsId, u) => rt.kv.get(KEYS.member(wsId, u));
const pokeOf = async (wsId, u) => Number((await rt.kv.get(KEYS.activity(wsId)))?.u?.[u]) || 0;

/**
 * The author's own post moves their cursor to the newest message, which is
 * a read to the end: the mention and reply counts such a read clears (see
 * the read route) went on standing, so a mention that landed in the moment
 * before one's own post badged a conversation whose cursor stood at its end.
 */
describe('posting clears the counts a read to the end would clear', () => {
  it('a mention of the author standing unread goes with their own post, and their other tabs are told', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    expect((await as(carol).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: '@bob look at this' })).ok).toBe(true);
    expect((await memberDoc(wsId, bob.uuid)).mentions[general.id]).toBe(1);
    const poked = await pokeOf(wsId, bob.uuid);
    const mine = await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'on it' });
    expect(mine.ok).toBe(true);
    const doc = await memberDoc(wsId, bob.uuid);
    expect(doc.reads[general.id]).toBe(mine.data.message.seq);
    expect(doc.mentions[general.id]).toBe(0);
    expect(await pokeOf(wsId, bob.uuid)).toBeGreaterThan(poked);
  });

  it('a follower replying in a thread clears its unread replies', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const root = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' });
    const tid = threadConvId(general.id, root.data.message.seq);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${tid}/messages`, { text: 'a reply' })).ok).toBe(true);
    expect((await memberDoc(wsId, alice.uuid)).threads[tid]).toBe(1);
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${tid}/messages`, { text: 'thanks' })).ok).toBe(true);
    expect((await memberDoc(wsId, alice.uuid)).threads[tid]).toBe(0);
  });

  it('a post with nothing counted writes no count and pokes nobody', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const poked = await pokeOf(wsId, bob.uuid);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'plain' })).ok).toBe(true);
    const doc = await memberDoc(wsId, bob.uuid);
    expect(Object.hasOwn(doc.mentions, general.id)).toBe(false);
    expect(await pokeOf(wsId, bob.uuid)).toBe(poked);
  });

  it('a message delivered from the queue leaves the count standing: its author is not looking', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const sched = await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', dueAt: Date.now() - 30_000 });
    expect(sched.ok).toBe(true);
    expect((await as(carol).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: '@bob before it goes' })).ok).toBe(true);
    expect((await memberDoc(wsId, bob.uuid)).mentions[general.id]).toBe(1);
    // A poll delivers it.
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect(Object.keys((await rt.kv.get(KEYS.sched(wsId))).m)).toEqual([]);
    expect((await memberDoc(wsId, bob.uuid)).mentions[general.id]).toBe(1);
  });
});

/**
 * The other side of the in-flight window (see the read route, and the
 * pass-24 test that keeps a mention whose message is NEWER than the read): a
 * mention that took its number before another message, and is still being
 * appended when the reader reads to that newer message, is behind the
 * reader's cursor by the time it lands. The cursor says it is read, and the
 * count goes with the cursor, as it stands: kept, the count would badge a
 * conversation whose cursor is at its end, which the reader's own tab (the
 * one that sent the read, looking at the conversation) masks and heals only
 * on its next scroll, while the message itself lands in that very tab, a
 * line above the newest, the moment it is stored. Pinned, so a later change
 * of either side is made on purpose.
 */
describe('a mention still being appended when the reader reads past its number', () => {
  const holdAppend = (conv, author) => {
    const add = rt.kv.add;
    let release;
    const gate = new Promise((r) => { release = r; });
    const state = { held: false, release, restore: () => { rt.kv.add = add; release(); } };
    rt.kv.add = async (k, value) => {
      if (k === KEYS.block(conv, 0) && !state.held && value && Array.isArray(value.m) && value.m[0]?.u === author) {
        state.held = true;
        await gate;
      }
      return add(k, value);
    };
    return state;
  };
  const untilHeld = async (state) => {
    for (let i = 0; i < 100 && !state.held; i++) await new Promise((r) => setTimeout(r, 5));
    expect(state.held).toBe(true);
  };

  it('the count is cleared with the cursor, and the message stands behind it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const hold = holdAppend(general.id, carol.uuid);
    let mention;
    let plain;
    try {
      mention = as(carol).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: '@bob first' });
      await untilHeld(hold);
      // Counted before it is appended (see writeMessage's `before`).
      expect((await memberDoc(wsId, bob.uuid)).mentions[general.id]).toBe(1);
      plain = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'plain' });
      expect(plain.ok).toBe(true);
      const read = await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/read`, { seq: plain.data.message.seq });
      expect(read.ok).toBe(true);
      hold.release();
      const landed = await mention;
      expect(landed.ok).toBe(true);
      expect(landed.data.message.seq).toBe(plain.data.message.seq - 1);
    } finally {
      hold.restore();
    }
    const doc = await memberDoc(wsId, bob.uuid);
    expect(doc.reads[general.id]).toBe(plain.data.message.seq);
    expect(doc.mentions[general.id]).toBe(0);
    // The mention stands in the block, a line above the newest.
    const block = await rt.kv.get(KEYS.block(general.id, 0));
    expect(block.m.some((m) => m.u === carol.uuid && m.mn?.includes(bob.uuid))).toBe(true);
  });

  it('and a reply the reader follows, the same', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    const root = await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' });
    const tid = threadConvId(general.id, root.data.message.seq);
    const hold = holdAppend(tid, carol.uuid);
    let reply;
    try {
      reply = as(carol).post(`/api/ws/${wsId}/conv/${tid}/messages`, { text: 'carol reply' });
      await untilHeld(hold);
      expect((await memberDoc(wsId, bob.uuid)).threads[tid]).toBe(1);
      const later = await as(alice).post(`/api/ws/${wsId}/conv/${tid}/messages`, { text: 'alice reply' });
      expect(later.ok).toBe(true);
      expect((await as(bob).post(`/api/ws/${wsId}/conv/${tid}/read`, { seq: later.data.message.seq })).ok).toBe(true);
      hold.release();
      expect((await reply).ok).toBe(true);
    } finally {
      hold.restore();
    }
    expect((await memberDoc(wsId, bob.uuid)).threads[tid]).toBe(0);
  });
});

/**
 * A push and the banner the page draws for the same message must carry one
 * name, so the browser replaces the one with the other: the page names its
 * banners with the workspace (`${ref}:${event}-${conv}`, see shell.js's
 * maybeNotify, since a direct message keeps its id across workspaces), and
 * the push was still named without it, so a phone with the app open in the
 * background (the service worker leaves the push alone only for a focused,
 * visible window on the workspace) showed the news twice.
 */
describe('a push is named as the page names its own banner', () => {
  const subtle = crypto.subtle;
  const enc = new TextEncoder();
  const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0)); let o = 0; for (const p of parts) { out.set(new Uint8Array(p), o); o += p.byteLength; } return out; };
  const hkdf = async (salt, ikm, info, length) => new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), length * 8));
  /** A device: its keys, and what a browser does with an aes128gcm push body. */
  const device = async () => {
    const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const subscription = { endpoint: `https://push.example.com/send/${b64url(crypto.getRandomValues(new Uint8Array(8)))}`, keys: { p256dh: b64url(await subtle.exportKey('raw', pair.publicKey)), auth: b64url(auth) } };
    const decrypt = async (body) => {
      const buf = new Uint8Array(body);
      const idlen = buf[20];
      const asPub = buf.slice(21, 21 + idlen);
      const uaPub = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
      const asKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, pair.privateKey, 256));
      const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
      const cek = await hkdf(buf.slice(0, 16), ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
      const nonce = await hkdf(buf.slice(0, 16), ikm, enc.encode('Content-Encoding: nonce\0'), 12);
      const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), buf.slice(21 + idlen)));
      return JSON.parse(new TextDecoder().decode(plain.slice(0, plain.lastIndexOf(2))));
    };
    return { subscription, decrypt };
  };

  it('the tag carries the workspace as the app refers to it, ahead of the kind and the conversation', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const dev = await device();
    const orig = globalThis.fetch;
    const sent = [];
    globalThis.fetch = async (url, init) => {
      sent.push(new Uint8Array(await new Response(init.body).arrayBuffer()));
      return new Response('', { status: 201 });
    };
    let payloads;
    try {
      expect((await as(bob).post(`/api/ws/${wsId}/push`, { subscription: dev.subscription })).ok).toBe(true);
      const root = await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' });
      const tid = threadConvId(general.id, root.data.message.seq);
      expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: '@bob in channel' })).ok).toBe(true);
      expect((await as(alice).post(`/api/ws/${wsId}/conv/${tid}/messages`, { text: '@bob in thread' })).ok).toBe(true);
      const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).data.conv;
      expect((await as(alice).post(`/api/ws/${wsId}/conv/${dm}/messages`, { text: 'psst' })).ok).toBe(true);
      expect(sent.length).toBe(3);
      payloads = await Promise.all(sent.map((b) => dev.decrypt(b)));
    } finally {
      globalThis.fetch = orig;
    }
    // The workspace, as the deep link in the same push names it (`#/ws/<ref>/…`), then the page's own name for the news.
    const ref = `${wsId}@teamchat-api.test`;
    for (const p of payloads) expect(p.route.startsWith(`#/ws/${ref}/`)).toBe(true);
    expect(payloads[0].tag).toBe(`${ref}:mention-${general.id}`);
    // A mention inside a thread is named by the channel, as the page names its banner for it.
    expect(payloads[1].tag).toBe(`${ref}:mention-${general.id}`);
    expect(payloads[2].tag).toBe(`${ref}:message-${payloads[2].route.split('/c/')[1].split('/')[0]}`);
  });
});

/**
 * Deleting a workspace took its files' bytes (one directory) and every
 * message, counter, pin, list and index, and left the files' own records
 * (`tc:file:<id>`, named by the file alone) in the owner's store for good,
 * one per file ever shared. They go with the rest now, gathered from the
 * message records the deletion reads for its threads, from the channels'
 * bookmarks and from the queue.
 */
describe('deleting a workspace takes its files\' records with their bytes', () => {
  const upload = async (user, wsId, name) => {
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array(64)], name, { type: 'application/octet-stream' }));
    const r = await as(user).post(`/api/ws/${wsId}/files`, fd);
    expect(r.ok).toBe(true);
    return r.data.id;
  };
  const naming = (ids) => [...rt.kv._map()].filter(([k, v]) => ids.some((id) => (k + JSON.stringify(v)).includes(id))).map(([k]) => k);

  it('records of files posted, shared in a thread, bookmarked or waiting in the queue are gone, and every other key of the workspace', async () => {
    const { wsId, general, code } = await workspaceWith(alice, [bob]);
    const pub = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'pub' })).data.channel;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${pub.id}/join`, {})).ok).toBe(true);
    const root = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'root' });
    const tid = threadConvId(general.id, root.data.message.seq);
    const [posted, inReply, marked, queued] = await Promise.all([upload(bob, wsId, 'a.bin'), upload(bob, wsId, 'b.bin'), upload(alice, wsId, 'c.bin'), upload(bob, wsId, 'd.bin')]);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${pub.id}/messages`, { text: 'file', attachments: [{ id: posted }] })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${tid}/messages`, { text: 'reply file', attachments: [{ id: inReply }] })).ok).toBe(true);
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${pub.id}`, { bookmarks: [{ label: 'doc', file: marked }] })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: pub.id, text: 'later', attachments: [{ id: queued }], dueAt: Date.now() + 3600_000 })).ok).toBe(true);
    const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).data.conv;
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${dm}/messages`, { text: 'psst' })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/pins`, { seq: root.data.message.seq })).ok).toBe(true);
    for (const id of [posted, inReply, marked, queued]) expect(await rt.kv.get(KEYS.file(id))).toMatchObject({ ws: wsId });
    expect((await as(alice).del(`/api/ws/${wsId}`)).ok).toBe(true);
    for (const id of [posted, inReply, marked, queued]) expect(await rt.kv.get(KEYS.file(id))).toBeFalsy();
    expect([...rt.fs._files.keys()].filter((p) => p.includes(wsId))).toEqual([]);
    // Nothing else of the workspace's stays but the budget counters, which
    // expire on their own (see assertUploadBudget).
    const left = naming([wsId, general.id, pub.id, tid, dm, code, posted, inReply, marked, queued]).filter((k) => !k.startsWith('tc:user:') && !k.startsWith('tc:uprate:') && !k.startsWith('tc:upbytes:'));
    expect(left).toEqual([]);
    for (const k of [...rt.kv._map().keys()].filter((k) => k.startsWith('tc:uprate:') || k.startsWith('tc:upbytes:'))) expect(rt.kv._ttl.get(k)).toBeGreaterThan(0);
  });
});

/**
 * A one-line field of combining marks alone (accents, vowel signs, variation
 * selectors with nothing to sit on) passed for a line with something to show,
 * since a mark is a character by category: a workspace named "́́"
 * or a person named so drew as stray accents on nothing. Refused as an empty
 * line is; a mark on a letter, a digit or an emoji keeps the line.
 */
describe('one-line fields of combining marks alone', () => {
  it('a workspace name, a display name, a title and a status of marks alone are refused or dropped; marked letters stay', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const marks = '́́ ́';
    const name = await as(alice).put(`/api/ws/${wsId}`, { name: marks });
    expect(name.status).toBe(400);
    expect(name.data.message).toBe('Workspace name cannot be empty');
    const me = await as(bob).put('/api/me', { name: '️️' });
    expect(me.status).toBe(400);
    expect(me.data.message).toBe('Display name cannot be empty');
    // A title or a status of marks alone is an empty one, as a blank is.
    const titled = await as(bob).put('/api/me', { title: '́', status: { emoji: '️', text: '̈̈' } });
    expect(titled.ok).toBe(true);
    expect(titled.data.profile.title).toBe('');
    expect(titled.data.profile.status).toBeNull();
    // Marks on letters, and a name in a script written with them, stay whole.
    for (const ok of ['Zoë', 'नमस्ते', 'ที่ตั้ง', 'Nguyễn Văn A', '👍️']) {
      const r = await as(alice).put(`/api/ws/${wsId}`, { name: ok });
      expect(r.ok).toBe(true);
      expect(r.data.workspace.name).toBe(ok);
    }
  });
});
