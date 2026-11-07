/**
 * Twenty-first review pass, region C: integrations, export/import/transfer,
 * files, link previews, search, the email worker and their client-side
 * counterparts. Each test here reproduces a defect found in that pass and
 * proves the fix.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { LIMITS } from '../src/shared/limits.js';
import { writeArchiveToDrive, exportStamp } from '../src/lib/archive.js';
import { KEYS } from '../src/shared/blocks.js';
import { bucketOf, SEARCH_SHARDS } from '../src/shared/search.js';

const { alice } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

describe('rotating a token that has run through its minute', () => {
  it('gives the webhook a fresh minute under its new token; the old one is refused as invalid, not as over the limit', async () => {
    const { wsId, general } = await workspaceWith(alice, []);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    // A runaway script (or whoever got hold of the token) runs it past its limit.
    let last;
    for (let i = 0; i <= LIMITS.hookRatePerMinute; i++) last = await as(null).post(`/webhook/${hook.token}`, { text: `m${i}` });
    expect(last.status).toBe(429);
    const rotated = await as(alice).post(`/api/ws/${wsId}/webhooks/${hook.id}/rotate`);
    expect(rotated.ok).toBe(true);
    // The old token is dead, and says so; the new one posts at once rather
    // than waiting out the minute the old one had spent.
    expect((await as(null).post(`/webhook/${hook.token}`, { text: 'old' })).status).toBe(401);
    const fresh = await as(null).post(`/webhook/${rotated.data.token}`, { text: 'after the rotation' });
    expect([fresh.status, fresh.data.text]).toEqual([200, 'after the rotation']);
    expect(await rt.kv.get(`tc:hookrate:${hook.id}`)).toBe(1);
  });

  it('does the same for a bot token, whose reads count against the minute too', async () => {
    const { wsId, general } = await workspaceWith(alice, []);
    const bot = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Bot', scopes: ['read', 'post'], channels: [general.id] })).data;
    let last;
    for (let i = 0; i <= LIMITS.hookRatePerMinute; i++) last = await as(null).get(`/bot/${bot.token}/channels/${general.id}/messages`);
    expect(last.status).toBe(429);
    const rotated = await as(alice).post(`/api/ws/${wsId}/bots/${bot.id}/rotate`);
    expect(rotated.ok).toBe(true);
    expect((await as(null).get(`/bot/${bot.token}/channels/${general.id}/messages`)).status).toBe(401);
    expect((await as(null).get(`/bot/${rotated.data.token}/channels/${general.id}/messages`)).status).toBe(200);
    expect(await rt.kv.get(`tc:hookrate:${bot.id}`)).toBe(1);
  });
});

describe('an export whose drive write is refused', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  const archive = {
    header: { workspace: { id: 'abcdef1234', name: 'Acme' }, exportedAt: Date.UTC(2026, 8, 6, 12), members: {}, channels: { c1: { name: 'general' } } },
    pages: [{ conv: 'c1', seq: 1, messages: [{ seq: 1, user: 'u', text: 'hi', ts: 1, kind: 'msg', attachments: [{ id: 'fileaaaa0001', name: 'a.png', size: 4, type: 'image/png' }], reactions: {} }] }],
    files: [{ id: 'fileaaaa0001', name: 'a.png', size: 4, type: 'image/png', conv: 'c1', seq: 1 }],
  };
  const drive = (refuse) => {
    const written = [];
    globalThis.puter = {
      fs: { write: async (path) => { written.push(path); if (refuse(path)) throw refuse(path); return { path }; } },
      workers: { exec: async () => new Response(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }), { status: 200, headers: { 'Content-Type': 'image/png' } }) },
    };
    return written;
  };
  const folder = `Teamchat exports/Acme ${exportStamp(archive.header.exportedAt)}`;

  it('names the file, the folder and the drive\'s reason, and says what was written is there, even when the drive\'s refusal carries no message', async () => {
    const written = drive((path) => (path.endsWith('channels/c1.html') ? { code: 'storage_limit_reached' } : null));
    await expect(writeArchiveToDrive('abcdef1234@teamchat-old', archive)).rejects.toThrow(`could not write channels/c1.html into "${folder}" in your Puter drive (storage_limit_reached); what was written before it is in that folder`);
    // What the dialog prints is the message: never "Stopped: undefined".
    expect(written).toEqual([`${folder}/messages.json`, `${folder}/index.html`, `${folder}/channels/c1.html`]);
    drive((path) => (path.endsWith('messages.json') ? new Error('Storage limit reached') : null));
    await expect(writeArchiveToDrive('abcdef1234@teamchat-old', archive)).rejects.toThrow(`could not write messages.json into "${folder}" in your Puter drive (Storage limit reached)`);
    drive((path) => (path.endsWith('index.html') ? 'quota' : null));
    await expect(writeArchiveToDrive('abcdef1234@teamchat-old', archive)).rejects.toThrow('could not write index.html into');
    drive((path) => (path.endsWith('index.html') ? {} : null));
    await expect(writeArchiveToDrive('abcdef1234@teamchat-old', archive)).rejects.toThrow('(the drive refused the write)');
  });

  it('still lets an attachment that could not be written pass, as before: the archive stands without its bytes', async () => {
    const written = drive((path) => (path.includes('/files/') ? { code: 'storage_limit_reached' } : null));
    await expect(writeArchiveToDrive('abcdef1234@teamchat-old', archive)).resolves.toBe(folder);
    expect(written.some((p) => p.includes('/files/'))).toBe(true);
  });
});

describe('an archive message dated when no message could be', () => {
  const CH = 'general001';
  const header = {
    format: 'teamchat-export', version: 1, workspace: { id: 'abcdef1234', name: 'Acme' },
    channels: { [CH]: { id: CH, name: 'general', def: true } },
    members: { [alice.uuid]: { username: 'alice', name: 'Alice', role: 'owner' } },
    memberDocs: { [alice.uuid]: { channels: [CH] } },
  };

  it('is brought across dated now, findable by search, with no nameless month left in the index', async () => {
    const before = Date.now();
    expect((await as(alice).post('/api/workspaces/import', { header, profile: { name: 'Alice' } })).status).toBe(200);
    const sane = Date.UTC(2026, 0, 15, 12);
    const page = { conv: CH, seq: 4, messages: [
      { seq: 1, user: alice.uuid, text: 'future words', ts: 1e20, kind: 'msg' },
      { seq: 2, user: alice.uuid, text: 'negative words', ts: -5, kind: 'msg' },
      { seq: 3, user: alice.uuid, text: 'garbled words', ts: 'abc', kind: 'msg' },
      { seq: 4, user: alice.uuid, text: 'sane words', ts: sane, kind: 'msg' },
    ] };
    expect((await as(alice).post(`/api/ws/abcdef1234/import`, page)).ok).toBe(true);
    expect((await as(alice).post('/api/ws/abcdef1234/import/finish')).ok).toBe(true);
    const msgs = (await as(alice).get(`/api/ws/abcdef1234/conv/${CH}/messages`)).data.messages.filter((m) => m.kind === 'msg');
    const at = Object.fromEntries(msgs.map((m) => [m.seq, m.ts]));
    for (const seq of [1, 2, 3]) {
      expect(at[seq]).toBeGreaterThanOrEqual(before);
      expect(at[seq]).toBeLessThanOrEqual(Date.now());
    }
    expect(at[4]).toBe(sane);
    // Each is found by its words; the one dated in the year 5138 used to go
    // into a month called "NaNNaN" that no query read.
    for (const [word, seq] of [['future', 1], ['negative', 2], ['garbled', 3], ['sane', 4]]) {
      const r = await as(alice).get(`/api/ws/abcdef1234/search?q=${word}`);
      expect([word, r.data.results.map((x) => x.seq)]).toEqual([word, [seq]]);
    }
    const meta = await rt.kv.get(KEYS.searchMeta('abcdef1234'));
    expect(Object.keys(meta.months).every((b) => /^\d{6}$/.test(b))).toBe(true);
    for (let n = 0; n < SEARCH_SHARDS; n++) expect(await rt.kv.get(KEYS.searchBucket('abcdef1234', 'NaNNaN', n))).toBeFalsy();
  });

  it('a time past what a Date can hold falls in the index\'s oldest bucket rather than a nameless one', () => {
    expect(bucketOf(1e20)).toBe('000000');
    expect(bucketOf(-1e20)).toBe('000000');
    expect(bucketOf(Date.UTC(2026, 0, 15))).toBe('202601');
    expect(bucketOf('x')).toBe('000000');
  });
});
