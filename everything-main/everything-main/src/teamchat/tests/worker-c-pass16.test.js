/**
 * Sixteenth review pass, region C: integrations, export/import/transfer,
 * files, link previews, search, the email worker and their client-side
 * counterparts. Each test here reproduces a defect found in that pass and
 * proves the fix.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, blockIndexOf, lastSeqOfBlock } from '../src/shared/blocks.js';
import { dmConvId } from '../src/shared/ids.js';
import { importArchive, transferWorkspace, renderArchiveHtml, writeArchiveToDrive, leftBehindText } from '../src/lib/archive.js';

const { alice, bob } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

/** The app's bridge to a worker, pointed at the in-memory runtime for every server name. */
function bridgeTo(user) {
  return { workers: { exec: async (url, init = {}) => rt.dispatch(url, init, user) } };
}

describe('a conversation whose every message was deleted, carried across by a move', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });

  it('keeps its message counter on the copy, so members’ cursors still mean what they did and the next message is counted unread', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).data.conv;
    for (const text of ['one', 'two', 'three']) expect((await as(alice).post(`/api/ws/${wsId}/conv/${dm}/messages`, { text })).ok).toBe(true);
    // Bob read the conversation to its end; then Alice took every message back.
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${dm}/read`, { seq: 3 })).ok).toBe(true);
    for (const seq of [1, 2, 3]) expect((await as(alice).del(`/api/ws/${wsId}/conv/${dm}/messages/${seq}`)).ok).toBe(true);
    const exported = await as(alice).get(`/api/ws/${wsId}/export`);
    expect(exported.ok).toBe(true);
    const page = exported.data.pages.find((p) => p.conv === dm);
    // The archive names the counter and carries no message for it.
    expect(page).toMatchObject({ seq: 3, messages: [] });
    expect(exported.data.header.memberDocs[bob.uuid].reads[dm]).toBe(3);

    globalThis.puter = bridgeTo(alice);
    const ref = await importArchive('https://teamchat-new.puter.work', { header: exported.data.header, pages: exported.data.pages, files: exported.data.files }, { profile: { name: 'Alice' } });
    const copy = ref.split('@')[0];
    expect((await rt.kv.get(KEYS.ws(copy))).importing).toBeUndefined();
    const conv = dmConvId([alice.uuid, bob.uuid], copy);
    // The counter came across with the page and stands past every number a
    // message stands under (all three were deleted): the copy closes the
    // record behind them, as the original closes one grown large (see the
    // import route and rollBlock), so the counter is at the record's last
    // number and the run of numbers standing for nothing is noted for every
    // reader, rather than counted as unread by each of them.
    expect(Number(await rt.kv.get(KEYS.seq(conv)))).toBe(lastSeqOfBlock(0));
    expect((await rt.kv.get(KEYS.block(conv, 0))).full).toBe(1);
    expect((await rt.kv.get(KEYS.activity(copy))).c[conv].k).toEqual([1, lastSeqOfBlock(0)]);
    // The block the next message lands in is there, as it is after any other page (see appendToBlock).
    expect(await rt.kv.get(KEYS.block(conv, blockIndexOf(lastSeqOfBlock(0) + 1)))).toMatchObject({ m: [] });
    // Bob's cursor means what it did, and the first new message counts as unread for him.
    expect((await rt.kv.get(KEYS.member(copy, bob.uuid))).reads[conv]).toBe(3);
    const posted = await as(alice).post(`/api/ws/${copy}/conv/${conv}/messages`, { text: 'again' });
    expect(posted.ok).toBe(true);
    expect(posted.data.message.seq).toBe(lastSeqOfBlock(0) + 1);
  });
});

describe('files of a direct message that does not travel with a move', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const CH = 'general001';
  const DM = 'dm_ext1ext2'; // between two people from a connected workspace, who are not in the copy
  const ONLY_DM = 'fileonlydm01';
  const BOTH = 'filebothab02';
  const IN_CH = 'fileinchan03';
  const att = (id) => ({ id, name: `${id}.txt`, size: 5, type: 'text/plain' });
  const header = {
    format: 'teamchat-export', version: 1, workspace: { id: 'abcdef1234', name: 'Acme' },
    channels: { [CH]: { id: CH, name: 'general', def: true } },
    members: {
      [alice.uuid]: { username: 'alice', name: 'Alice', role: 'owner' },
      ext1: { username: 'ext1', name: 'Ext One', role: 'external', org: { ref: 'partner01@teamchat-p', name: 'Partner' } },
      ext2: { username: 'ext2', name: 'Ext Two', role: 'external', org: { ref: 'partner01@teamchat-p', name: 'Partner' } },
    },
    memberDocs: { [alice.uuid]: { channels: [CH] }, ext1: { channels: [CH], dms: { [DM]: { members: ['ext1', 'ext2'] } } }, ext2: { channels: [CH], dms: { [DM]: { members: ['ext1', 'ext2'] } } } },
    dms: { [DM]: { members: ['ext1', 'ext2'] } },
  };
  const pages = [
    { conv: DM, seq: 2, messages: [{ seq: 1, user: 'ext1', text: 'for you', ts: 1, attachments: [att(ONLY_DM)] }, { seq: 2, user: 'ext2', text: 'and this', ts: 2, attachments: [att(BOTH)] }] },
    { conv: CH, seq: 1, messages: [{ seq: 1, user: alice.uuid, text: 'for everyone', ts: 3, attachments: [att(BOTH), att(IN_CH)] }] },
  ];
  // As the export lists them: once per message page, the direct message's first.
  const files = [{ ...att(ONLY_DM), conv: DM, seq: 1 }, { ...att(BOTH), conv: DM, seq: 2 }, { ...att(BOTH), conv: CH, seq: 1 }, { ...att(IN_CH), conv: CH, seq: 1 }];

  it('stay behind, rather than landing in the new owner’s drive held by nothing; a file shared in a channel too comes across', async () => {
    const asked = [];
    globalThis.puter = { workers: { exec: async (url, init = {}) => {
      const u = new URL(url);
      if (u.hostname === 'teamchat-old.puter.work') {
        asked.push(u.pathname);
        const m = /^\/api\/ws\/abcdef1234\/files\/(\w+)$/.exec(u.pathname);
        if (m) return new Response(new Blob(['hello'], { type: 'text/plain' }), { status: 200, headers: { 'Content-Type': 'text/plain' } });
        return json({ code: 'not_found', message: 'No such endpoint' }, 404);
      }
      return rt.dispatch(url, init, alice);
    } } };
    const ref = await importArchive('https://teamchat-new.puter.work', { header, pages, files }, { from: 'abcdef1234@teamchat-old', fromRef: 'abcdef1234@teamchat-old', profile: { name: 'Alice' } });
    const copy = ref.split('@')[0];
    expect((await rt.kv.get(KEYS.ws(copy))).importing).toBeUndefined();
    // The direct message was refused (nobody in the copy is in it) and passed over; its file alone was not asked for, and is not here.
    expect(asked).not.toContain(`/api/ws/abcdef1234/files/${ONLY_DM}`);
    expect(await rt.kv.get(KEYS.file(ONLY_DM))).toBeFalsy();
    expect(rt.fs._files.has(`teamchat-files/${copy}/${ONLY_DM}`)).toBe(false);
    // The channel's files came across, the one the direct message also carried among them, held by the channel's message.
    for (const id of [BOTH, IN_CH]) {
      expect(asked).toContain(`/api/ws/abcdef1234/files/${id}`);
      expect(await rt.kv.get(KEYS.file(id))).toMatchObject({ ws: copy, refs: 1 });
      expect(rt.fs._files.has(`teamchat-files/${copy}/${id}`)).toBe(true);
    }
    // Each was asked for once, whatever the archive listed it under.
    expect(asked.filter((p) => p.startsWith('/api/ws/abcdef1234/files/')).length).toBe(2);
  });
});

describe('a blocks payload whose text is blank beside its blocks or attachments', () => {
  it('posts what the blocks or attachments say, with text as the notification fallback alone', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const post = (body) => as(null).post(`/webhook/${hook.token}`, body);
    // Many webhook libraries send `text: ""` (or a space) with the blocks that carry the message.
    const blocks = await post({ text: '', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Build <https://ci.example.com/42|#42> passed' } }] });
    expect([blocks.status, blocks.data.text]).toEqual([200, 'Build #42 (https://ci.example.com/42) passed']);
    const fallback = await post({ text: '   ', attachments: [{ fallback: 'Deploy done' }] });
    expect([fallback.status, fallback.data.text]).toEqual([200, 'Deploy done']);
    // Text beside blocks is the notification fallback: the blocks are the message (see worker-c-pass19); and nothing anywhere is still refused.
    const both = await post({ text: 'fallback line', blocks: [{ type: 'section', text: { type: 'plain_text', text: 'rich line' } }] });
    expect([both.status, both.data.text]).toEqual([200, 'rich line']);
    const nothing = await post({ text: '', blocks: [{ type: 'divider' }] });
    expect([nothing.status, nothing.data.code]).toEqual([400, 'invalid']);
    // A bot token reads the payload the same way.
    const bot = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Robo', channels: [general.id], scopes: ['post'] })).data;
    const viaBot = await as(null).post(`/bot/${bot.token}/channels/${general.id}/messages`, { text: '', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'from a bot' } }] });
    expect([viaBot.status, viaBot.data.text]).toEqual([200, 'from a bot']);
  });
});

describe('a blocks payload with a context line or rich text', () => {
  it('keeps the context line with the message, and reads rich text by its runs', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const post = (body) => as(null).post(`/webhook/${hook.token}`, body);
    // The small print under a build notice used to be dropped without a word.
    const withContext = await post({ blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Deploy finished' } },
      { type: 'section', text: { type: 'mrkdwn', text: '*prod* is on v42' } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'triggered by <https://ci.example.com/u/alice|alice>' }, { type: 'image', image_url: 'https://ci.example.com/a.png', alt_text: 'avatar' }, { type: 'plain_text', text: 'at 10:15' }] },
      { type: 'divider' },
    ] });
    expect([withContext.status, withContext.data.text]).toEqual([200, 'Deploy finished\n*prod* is on v42\ntriggered by alice (https://ci.example.com/u/alice) at 10:15']);
    // Context alone is a message too.
    const contextOnly = await post({ text: '', blocks: [{ type: 'context', elements: [{ type: 'plain_text', text: 'just context' }] }] });
    expect([contextOnly.status, contextOnly.data.text]).toEqual([200, 'just context']);
    // Rich text as a chat client composes it: sections and list items one line each, their inline runs joined as written.
    const rich = await post({ blocks: [{ type: 'rich_text', elements: [
      { type: 'rich_text_section', elements: [{ type: 'text', text: 'Release ' }, { type: 'text', text: 'v42', style: { bold: true } }, { type: 'text', text: ' is out ' }, { type: 'emoji', name: 'tada' }] },
      { type: 'rich_text_list', style: 'bullet', elements: [
        { type: 'rich_text_section', elements: [{ type: 'text', text: 'notes: ' }, { type: 'link', url: 'https://example.com/notes' }] },
        { type: 'rich_text_section', elements: [{ type: 'link', url: 'https://example.com/diff', text: 'the diff' }] },
      ] },
    ] }] });
    // A link with words posts its address beside them, as <address|label> in a payload's text does; a styled run takes the app's mark, and a list its items' dashes (see worker-c-pass17).
    expect([rich.status, rich.data.text]).toEqual([200, 'Release **v42** is out :tada:\n- notes: https://example.com/notes\n- the diff (https://example.com/diff)']);
    // Blocks that say nothing are still nothing.
    const nothing = await post({ blocks: [{ type: 'divider' }, { type: 'context', elements: [{ type: 'image', image_url: 'https://x/y.png', alt_text: 'a' }] }] });
    expect([nothing.status, nothing.data.code]).toEqual([400, 'invalid']);
  });
});

describe('a file whose long name is cut through an emoji', () => {
  it('can still be downloaded, its name clamped to whole characters', async () => {
    const { wsId, general } = await workspaceWith(alice);
    // 119 letters, then an emoji (two UTF-16 units), then the extension: a clamp at 120 units would cut the emoji in half.
    const name = `${'a'.repeat(119)}\u{1F600}.png`;
    const form = new FormData();
    form.append('file', new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' }));
    const up = await as(alice).post(`/api/ws/${wsId}/files`, form);
    expect(up.status).toBe(200);
    // The download worked (a name cut through the emoji left a lone surrogate that the headers could not encode: a 500 on every try).
    const got = await as(alice).get(`/api/ws/${wsId}/files/${up.data.id}`);
    expect(got.status).toBe(200);
    expect(up.data.name).toBe('a'.repeat(119));
    expect(/[\uD800-\uDBFF]$/.test(up.data.name)).toBe(false);
    expect(got.data.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent('a'.repeat(119))}`);
    // The same name on a message keeps the clamped form, and an import's attachment names are clamped the same way.
    const sent = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: '', attachments: [{ id: up.data.id }] });
    expect(sent.data.message.attachments[0].name).toBe('a'.repeat(119));
  });

  it('is served all the same when its record already carries the half-cut name an older server wrote', async () => {
    const { wsId } = await workspaceWith(alice);
    const form = new FormData();
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' }));
    const up = await as(alice).post(`/api/ws/${wsId}/files`, form);
    expect(up.status).toBe(200);
    // As the record stood after an upload on a server from before the clamp kept characters whole.
    await rt.kv.update(KEYS.file(up.data.id), { name: `${'a'.repeat(119)}\uD83D` });
    const got = await as(alice).get(`/api/ws/${wsId}/files/${up.data.id}`);
    expect(got.status).toBe(200);
    expect(got.data.headers.get('content-disposition')).toBe(`attachment; filename="${'a'.repeat(119)}"; filename*=UTF-8''${'a'.repeat(119)}`);
    expect(got.data.headers.get('x-file-name')).toBe('a'.repeat(119));
  });
});

describe('an export to the drive holding a file whose name is cut through an emoji', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });

  it('writes its pages and files rather than stopping on a name no address can carry', async () => {
    // 59 letters, then an emoji: the readable page's file names are clamped at 60 units, through the emoji.
    const name = `${'b'.repeat(59)}\u{1F600}.png`;
    const archive = {
      header: { exportedAt: Date.UTC(2026, 8, 6, 12), workspace: { id: 'abcdef1234', name: 'Acme' }, channels: { c1: { name: 'general' } }, members: {} },
      pages: [{ conv: 'c1', seq: 1, messages: [{ seq: 1, user: 'u', text: 'pic', ts: 1, attachments: [{ id: 'fileaaaa0001', name, size: 4, type: 'image/png' }] }] }],
      files: [{ id: 'fileaaaa0001', name, size: 4, type: 'image/png', conv: 'c1', seq: 1 }],
    };
    const html = renderArchiveHtml(archive);
    expect(html.pages.c1).toContain(`href="../files/${encodeURIComponent(`fileaaaa0001-${'b'.repeat(59)}`)}"`);
    const written = [];
    globalThis.puter = {
      fs: { write: async (path) => { written.push(path); } },
      workers: { exec: async () => new Response(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }), { status: 200, headers: { 'Content-Type': 'image/png' } }) },
    };
    const folder = await writeArchiveToDrive('abcdef1234@teamchat-old', archive);
    // The folder is named in the exporter's own time (see exportStamp), so the expected name is built the same way.
    const at = new Date(Date.UTC(2026, 8, 6, 12));
    const p = (n) => String(n).padStart(2, '0');
    expect(folder).toBe(`Teamchat exports/Acme ${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}.${p(at.getMinutes())}`);
    const file = written.find((p) => p.includes('/files/'));
    expect(file).toBe(`${folder}/files/fileaaaa0001-${'b'.repeat(59)}`);
    expect(written.some((p) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(p))).toBe(false);
  });
});

describe('an archive naming a channel by a name every object inherits', () => {
  it('is imported without that channel, as one naming a member so is, with its counts whole numbers and its pins held to the copy’s conversations', async () => {
    // "constructor" is the one such name that passes for a channel id ([a-z0-9], 6 to 20 characters).
    const header = {
      format: 'teamchat-export', version: 1, workspace: { id: 'abcdef1234', name: 'Acme' },
      channels: { constructor: { id: 'constructor', name: 'proto', def: true }, general001: { id: 'general001', name: 'general', def: true } },
      members: { [alice.uuid]: { username: 'alice', name: 'Alice', role: 'owner' }, [bob.uuid]: { username: 'bob', name: 'Bob', role: 'member' } },
      memberDocs: { [alice.uuid]: { channels: ['constructor', 'general001'] }, [bob.uuid]: { channels: ['constructor', 'general001'] } },
      // Pins of that channel, and of a conversation the archive has no channel for at all.
      pins: { constructor: [{ seq: 1, by: alice.uuid, ts: 1 }], ghost00001: [{ seq: 1, by: alice.uuid, ts: 1 }], general001: [{ seq: 1, by: alice.uuid, ts: 1 }] },
    };
    const res = await as(alice).post('/api/workspaces/import', { header, profile: { name: 'Alice' } });
    expect(res.status).toBe(200);
    const copy = res.data.workspace.id;
    const ws = await rt.kv.get(KEYS.ws(copy));
    expect(Object.hasOwn(ws.channels, 'constructor')).toBe(false);
    expect(Object.keys(ws.channels)).toEqual(['general001']);
    // Counted from the documents: two people, as numbers (a count keyed by an inherited name was a function with a one glued on).
    expect(ws.channels.general001.count).toBe(2);
    expect((await rt.kv.get(KEYS.member(copy, bob.uuid))).channels).toEqual(['general001']);
    // Pins are written for the copy's conversations alone.
    expect(await rt.kv.get(KEYS.pins(copy, 'constructor'))).toBeFalsy();
    expect(await rt.kv.get(KEYS.pins(copy, 'ghost00001'))).toBeFalsy();
    expect((await rt.kv.get(KEYS.pins(copy, 'general001'))).items).toHaveLength(1);
    expect(Object.keys((await rt.kv.get(KEYS.activity(copy))).c)).toEqual(['general001']);
  });
});

describe('the trace a revoked integration’s last call leaves on the workspace', () => {
  it('counts neither toward the fifty integrations a workspace may have nor in the admin’s count of them', async () => {
    const { wsId, general } = await workspaceWith(alice);
    // What a "last used" note leaves under an integration revoked while its call was in flight (see GET /webhooks, which sweeps it).
    await rt.kv.update(KEYS.ws(wsId), { 'webhooks.stub0000001': { lastUsed: 1 } });
    for (let i = 0; i < 49; i++) expect((await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: `CI ${i}` })).status).toBe(200);
    // Forty-nine live and one trace: the fiftieth live one is allowed.
    const fiftieth = await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Robo', channels: [general.id], scopes: ['post'] });
    expect([fiftieth.status, fiftieth.data.code]).toEqual([200, undefined]);
    expect((await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'One too many' })).data.code).toBe('limit');
    // The admin's count is of live integrations.
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.integrations).toBe(50);
    // And the list still tidies the trace away.
    const listed = await as(alice).get(`/api/ws/${wsId}/webhooks`);
    expect(listed.data.webhooks.length + listed.data.bots.length).toBe(50);
    expect(Object.hasOwn((await rt.kv.get(KEYS.ws(wsId))).webhooks, 'stub0000001')).toBe(false);
  });
});

describe('a link remembered as having no preview, whose hour the store failed to time', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = realFetch;
  });

  it('is asked for again once the hour is up, by the entry’s own stamp, rather than never again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { wsId, general } = await workspaceWith(alice);
    let up = false;
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(new URL(url).pathname);
      if (!up) return new Response('gone', { status: 404, headers: { 'Content-Type': 'text/html' } });
      return new Response('<html><head><title>Back up</title></head></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    };
    const unfurl = async (text) => {
      const m = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text })).data.message;
      return (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/unfurl`)).data.unfurl;
    };
    // The site is down, and the store takes the "no preview" entry but fails to give it its hour.
    const expire = rt.kv.expire;
    rt.kv.expire = async () => { throw new Error('the store is busy'); };
    try {
      expect(await unfurl('see https://docs.example.com/status')).toBeNull();
    } finally {
      rt.kv.expire = expire;
    }
    expect(calls).toEqual(['/status']);
    // Within the hour the answer stands, and the site is not asked again.
    up = true;
    vi.setSystemTime(Date.now() + 30 * 60_000);
    expect(await unfurl('still https://docs.example.com/status')).toBeNull();
    expect(calls).toEqual(['/status']);
    // The hour up, the link is fetched anew and gets its card.
    vi.setSystemTime(Date.now() + 31 * 60_000);
    expect(await unfurl('now https://docs.example.com/status')).toMatchObject({ title: 'Back up', kind: 'page' });
    expect(calls).toEqual(['/status', '/status']);
    // A card is kept for its week by the same stamp, and fetched anew after it.
    vi.setSystemTime(Date.now() + 8 * 86_400_000);
    expect(await unfurl('later https://docs.example.com/status')).toMatchObject({ title: 'Back up' });
    expect(calls).toEqual(['/status', '/status', '/status']);
  });
});

describe('an archive whose waiting messages do not all fit the copy’s queue', () => {
  it('keeps the soonest that fit, says how many were left behind, and lets their files go at the end of the import', async () => {
    const CH = 'general001';
    const N = 70; // ~4.15 KB each: about 290 KB together, past the 250 KB a queue may hold
    const base = Math.floor(Date.now() / 60_000) * 60_000 + 22_000 + 3_600_000;
    const sched = Array.from({ length: N }, (_, i) => ({
      id: `sched${String(i).padStart(5, '0')}`, kind: 'message', u: bob.uuid, conv: CH, text: `${i} ${'x'.repeat(3990)}`,
      attachments: [{ id: `filesched${String(i).padStart(3, '0')}` }], dueAt: base + i * 60_000, createdAt: base - 1000,
    }));
    const header = {
      format: 'teamchat-export', version: 1, workspace: { id: 'abcdef1234', name: 'Acme' },
      channels: { [CH]: { id: CH, name: 'general', def: true } },
      members: { [alice.uuid]: { username: 'alice', name: 'Alice', role: 'owner' }, [bob.uuid]: { username: 'bob', name: 'Bob', role: 'member' } },
      memberDocs: { [alice.uuid]: { channels: [CH] }, [bob.uuid]: { channels: [CH] } },
      sched,
    };
    const made = await as(alice).post('/api/workspaces/import', { header, profile: { name: 'Alice' } });
    expect(made.status).toBe(200);
    const copy = made.data.workspace.id;
    const { kept, dropped } = made.data.scheduled;
    expect(kept + dropped).toBe(N);
    expect(kept).toBeGreaterThan(50);
    expect(dropped).toBeGreaterThan(0);
    const queue = await rt.kv.get(KEYS.sched(copy));
    expect(JSON.stringify(queue).length).toBeLessThanOrEqual(250_000);
    // The soonest are kept, in due order; what did not fit is the latest.
    expect(Object.keys(queue.m).sort()).toEqual(sched.slice(0, kept).map((e) => e.id));
    expect((await rt.kv.get(KEYS.activity(copy))).nd).toBe(base);
    // Every file the archive listed for the queue arrives, as the app sends them.
    for (const e of sched) {
      const form = new FormData();
      form.append('file', new File([new Uint8Array([1, 2, 3])], 'plan.txt', { type: 'text/plain' }));
      form.append('id', e.attachments[0].id);
      form.append('name', 'plan.txt');
      form.append('owner', bob.uuid);
      expect((await as(alice).post(`/api/ws/${copy}/import/file`, form)).status).toBe(200);
    }
    expect((await as(alice).post(`/api/ws/${copy}/import/finish`)).status).toBe(200);
    const ws = await rt.kv.get(KEYS.ws(copy));
    expect(ws.importing).toBeUndefined();
    expect(ws.importDropped).toBeUndefined();
    // Files of the kept entries stay for them; files of the dropped ones, held by nothing, are gone.
    for (const e of sched.slice(0, kept)) {
      expect(await rt.kv.get(KEYS.file(e.attachments[0].id))).toMatchObject({ ws: copy, u: bob.uuid, refs: 0 });
      expect(rt.fs._files.has(`teamchat-files/${copy}/${e.attachments[0].id}`)).toBe(true);
    }
    for (const e of sched.slice(kept)) {
      expect(await rt.kv.get(KEYS.file(e.attachments[0].id))).toBeFalsy();
      expect(rt.fs._files.has(`teamchat-files/${copy}/${e.attachments[0].id}`)).toBe(false);
    }
    // Bob sees what waits for him, and nothing of what was left behind.
    const list = (await as(bob).get(`/api/ws/${copy}/scheduled`)).data.scheduled;
    expect(list).toHaveLength(kept);
  });
});

describe('what the new server said of the archive’s waiting messages', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const HEADER = { format: 'teamchat-export', version: 1, workspace: { id: 'abcdef1234', name: 'Acme' }, channels: { c1: { name: 'general', def: true } }, members: {}, memberDocs: {} };
  const PAGE = { conv: 'c1', seq: 1, messages: [{ seq: 1, user: 'u', text: 'hi', ts: 1 }] };
  function servers(scheduled) {
    globalThis.puter = { workers: { exec: async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === '/api/ws/abcdef1234') return json({ workspace: { id: 'abcdef1234', name: 'Acme', movedTo: null } });
      if (path.endsWith('/transfer/begin')) return json({ ok: true, transferring: { by: 'me', at: 1 } });
      if (path.endsWith('/transfer/complete')) return json({ ok: true, movedTo: JSON.parse(init.body).to });
      if (path === '/api/ws/abcdef1234/export') return json({ header: HEADER, pages: [PAGE], files: [], done: true, cursor: null, progress: { done: 1, total: 1 } });
      if (path === '/api/workspaces/import') return json({ workspace: { id: 'copy0000001', name: 'Acme' }, ...(scheduled ? { scheduled } : {}) });
      if (/^\/api\/ws\/copy\d+\/import$/.test(path)) return json({ ok: true, conv: 'c1', count: 1 });
      if (/^\/api\/ws\/copy\d+\/import\/finish$/.test(path)) return json({ ok: true });
      return json({ code: 'not_found', message: 'No such endpoint' }, 404);
    } } };
  }

  it('reaches the caller of an import as the copy is made, and the caller of a move with its result', async () => {
    servers({ kept: 3, dropped: 2 });
    const told = [];
    const ref = await importArchive('https://teamchat-new.puter.work', { header: HEADER, pages: [PAGE], files: [] }, { profile: { name: 'Bob' }, onCreated: (made, info) => told.push([made, info]) });
    expect(ref).toBe('copy0000001@teamchat-new');
    expect(told).toEqual([['copy0000001@teamchat-new', { scheduled: { kept: 3, dropped: 2 } }]]);
    const moved = await transferWorkspace('abcdef1234@teamchat-old', 'https://teamchat-new.puter.work', { copy: null }, { profile: { name: 'Bob' } });
    expect(moved).toMatchObject({ ref: 'copy0000001@teamchat-new', mine: true, scheduled: { kept: 3, dropped: 2 } });
    // A server from before it said anything: nothing to say.
    servers(null);
    const quiet = [];
    await importArchive('https://teamchat-new.puter.work', { header: HEADER, pages: [PAGE], files: [] }, { profile: { name: 'Bob' }, onCreated: (made, info) => quiet.push(info) });
    expect(quiet).toEqual([{ scheduled: null }]);
    // And a move's result then carries no such field, as it never did.
    expect(await transferWorkspace('abcdef1234@teamchat-old', 'https://teamchat-new.puter.work', { copy: null }, { profile: { name: 'Bob' } })).toEqual({ ref: 'copy0000001@teamchat-new', icon: null, mine: true });
  });

  it('is worded for the dialogs only when something was left behind', () => {
    expect(leftBehindText(null)).toBe('');
    expect(leftBehindText({ kept: 12, dropped: 0 })).toBe('');
    expect(leftBehindText({ kept: 60, dropped: 1 })).toBe('1 scheduled message or reminder could not be brought across (the copy\'s queue holds no more; the 60 due soonest were). It is still listed in the old copy\'s Later view, to schedule again.');
    expect(leftBehindText({ kept: 1, dropped: 9 })).toBe('9 scheduled messages and reminders could not be brought across (the copy\'s queue holds no more; the 1 due soonest was). They are still listed in the old copy\'s Later view, to schedule again.');
  });
});

describe('a rich text run naming a person, a channel or everyone', () => {
  it('posts the name as the payload wrote it, and leaves no gap where a run the worker cannot read stood', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const post = (blocks) => as(null).post(`/webhook/${hook.token}`, { blocks });
    const named = await post([{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [
      { type: 'user', user_id: 'U1' }, { type: 'text', text: ' owns ' }, { type: 'channel', channel_id: 'C9' }, { type: 'text', text: ' for ' }, { type: 'usergroup', usergroup_id: 'S2' }, { type: 'text', text: ', ' }, { type: 'broadcast', range: 'channel' },
    ] }] }]);
    expect([named.status, named.data.text]).toEqual([200, '@U1 owns #C9 for @S2, @channel']);
    // A run of a kind the worker has no words for (a date, a colour) leaves one space where it stood, and none at the ends.
    const gappy = await post([{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [
      { type: 'date', timestamp: 1 }, { type: 'text', text: ' due ' }, { type: 'color', value: '#ff0000' }, { type: 'text', text: ' soon ' }, { type: 'date', timestamp: 2 },
    ] }] }]);
    expect([gappy.status, gappy.data.text]).toEqual([200, 'due soon']);
  });
});

describe('a move whose original refused to close, and whose whole copy could not then be taken down', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const OLD = 'abcdef1234@teamchat-old';
  const NEW_URL = 'https://teamchat-new.puter.work';
  const HEADER = { format: 'teamchat-export', version: 1, workspace: { id: 'abcdef1234', name: 'Acme' }, channels: { c1: { name: 'general', def: true } }, members: {}, memberDocs: {} };
  const PAGE = { conv: 'c1', seq: 1, messages: [{ seq: 1, user: 'u', text: 'hi', ts: 1 }] };
  /** Two faked servers; `mode` is changed between tries. Each copy made gets the next id. Returns the calls made, in order. */
  function servers(mode) {
    const made = [];
    let copies = 0;
    globalThis.puter = { workers: { exec: async (url, init = {}) => {
      const path = new URL(url).pathname;
      const method = init.method || 'GET';
      made.push(`${method} ${path}`);
      if (path === '/api/ws/abcdef1234') return json({ workspace: { id: 'abcdef1234', name: 'Acme', movedTo: null } });
      if (path.endsWith('/transfer/begin')) return json({ ok: true, transferring: { by: 'me', at: 1 } });
      if (path.endsWith('/transfer/cancel')) return json({ ok: true });
      if (path.endsWith('/transfer/complete')) {
        if (mode.refuseComplete) return json({ code: 'forbidden', message: 'Only the owner or the nominated admin can complete a transfer' }, 403);
        return json({ ok: true, movedTo: JSON.parse(init.body).to });
      }
      if (path === '/api/ws/abcdef1234/export') return json({ header: HEADER, pages: [PAGE], files: [], done: true, cursor: null, progress: { done: 1, total: 1 } });
      if (path === '/api/workspaces/import') return json({ workspace: { id: `copy000000${++copies}`, name: 'Acme' } });
      if (/^\/api\/ws\/copy\d+\/import$/.test(path)) return json({ ok: true, conv: 'c1', count: 1 });
      if (/^\/api\/ws\/copy\d+\/import\/finish$/.test(path)) return json({ ok: true });
      if (method === 'DELETE') {
        if (mode.failDelete) throw new Error('the server is down');
        return json({ ok: true });
      }
      return json({ code: 'not_found', message: 'No such endpoint' }, 404);
    } } };
    return made;
  }
  const attempt = (state) => transferWorkspace(OLD, NEW_URL, state, { profile: { name: 'Bob' } }).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

  it('remembers the copy as one to take down first when the move is tried again, as it remembers a copy stopped short', async () => {
    const mode = { refuseComplete: true, failDelete: true };
    const made = servers(mode);
    const state = { copy: null };
    const first = await attempt(state);
    expect([first.ok, first.e.status, first.e.code]).toEqual([false, 403, 'forbidden']);
    // The copy was whole, the original would not close, and the copy could not be taken down: it is not kept as the copy to finish with (the refusal is final), but it is not forgotten either.
    expect(made.filter((x) => x.startsWith('DELETE'))).toEqual(['DELETE /api/ws/copy0000001']);
    expect(state.copy).toBeNull();
    expect(state.partial).toEqual(['copy0000001@teamchat-new']);
    // Nominated again, and the new server reachable: the leftover goes before anything else is made, and the move goes through with a fresh copy.
    made.length = 0;
    mode.refuseComplete = false;
    mode.failDelete = false;
    const second = await attempt(state);
    expect(made[0]).toBe('DELETE /api/ws/copy0000001');
    expect(made.indexOf('DELETE /api/ws/copy0000001')).toBeLessThan(made.indexOf('POST /api/workspaces/import'));
    expect(second.ok).toBe(true);
    expect(second.v.ref).toBe('copy0000002@teamchat-new');
    expect(state.partial).toEqual([]);
  });

  it('remembers nothing when the copy was taken down with the refusal, as before', async () => {
    const mode = { refuseComplete: true, failDelete: false };
    const made = servers(mode);
    const state = { copy: null };
    expect((await attempt(state)).ok).toBe(false);
    expect(made.filter((x) => x.startsWith('DELETE'))).toEqual(['DELETE /api/ws/copy0000001']);
    expect(state.copy).toBeNull();
    expect(state.partial).toEqual([]);
  });
});
