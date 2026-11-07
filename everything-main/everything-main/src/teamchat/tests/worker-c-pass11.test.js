/**
 * Eleventh review pass, region C: integrations, export/import/transfer, link
 * previews, files, and their client-side counterparts. Each test here
 * reproduces a defect found in that pass and proves the fix.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import { importArchive, transferWorkspace } from '../src/lib/archive.js';
import { api, bodyTimeoutFor } from '../src/lib/api.js';
import { serverKeyOf, trustServer, parseRef } from '../src/lib/refs.js';
import { parseEmails } from '../src/lib/email.js';

const { alice, bob } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

/** The app's bridge to a worker, pointed at the real one under test: every call goes out as `who`. */
function bridgeTo(who) {
  return { workers: { exec: (url, init) => rt.dispatch(url, init, who) } };
}

/** Walk the export pages the way the client does. */
async function exportAll(u, wsId) {
  let res = await as(u).get(`/api/ws/${wsId}/export`);
  expect(res.ok).toBe(true);
  const archive = { header: res.data.header, pages: [...res.data.pages], files: [...res.data.files] };
  while (!res.data.done) {
    res = await as(u).get(`/api/ws/${wsId}/export?cursor=${encodeURIComponent(JSON.stringify(res.data.cursor))}`);
    expect(res.ok).toBe(true);
    archive.pages.push(...res.data.pages);
    archive.files.push(...res.data.files);
  }
  return archive;
}

describe('an import page naming one message number twice', () => {
  it('keeps one record for it, counted once against its file', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const header = {
      format: 'teamchat-export', version: 1, workspace: { id: 'dupimp0001', name: 'Old' },
      channels: { dupconv001: { name: 'general', def: true } },
      members: { [alice.uuid]: { name: 'alice', username: 'alice', role: 'owner' } },
      memberDocs: { [alice.uuid]: { channels: ['dupconv001'], dms: {}, reads: {}, notify: {} } },
    };
    const created = await as(alice).post('/api/workspaces/import', { header });
    expect(created.ok).toBe(true);
    const newId = created.data.workspace.id;
    const att = { id: 'dupfile0001', name: 'a.txt', size: 3, type: 'text/plain' };
    const page = await as(alice).post(`/api/ws/${newId}/import`, {
      conv: 'dupconv001', seq: 3,
      messages: [
        { seq: 1, user: alice.uuid, text: 'first', ts: 1000 },
        { seq: 2, user: alice.uuid, text: 'second', ts: 2000, attachments: [att] },
        { seq: 2, user: alice.uuid, text: 'second again', ts: 2001, attachments: [att] },
        { seq: 3, user: alice.uuid, text: 'third', ts: 3000 },
      ],
    });
    expect(page.ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    const block = await rt.kv.get(KEYS.block('dupconv001', 0));
    expect(block.m.map((m) => m.s)).toEqual([1, 2, 3]);
    const list = (await as(alice).get(`/api/ws/${newId}/conv/dupconv001/messages`)).data.messages;
    expect(list.map((m) => [m.seq, m.text])).toEqual([[1, 'first'], [2, 'second'], [3, 'third']]);
    // One message holds the file, so one reference: deleting it lets the file go.
    expect((await rt.kv.get(KEYS.file('dupfile0001'))).refs).toBe(1);
    expect((await as(alice).del(`/api/ws/${newId}/conv/dupconv001/messages/2`)).ok).toBe(true);
    expect(await rt.kv.get(KEYS.file('dupfile0001'))).toBeNull();
    expect(wsId).not.toBe(newId);
    expect(general).toBeTruthy();
  });
});

describe('the stamp an import page leaves on its conversation', () => {
  it('names the newest message as stored, not an entry the page carried that was admitted nowhere', async () => {
    const conv = 'stampconv1';
    const header = {
      format: 'teamchat-export', version: 1, workspace: { id: 'stampimp01', name: 'Old' },
      channels: { [conv]: { name: 'general', def: true } },
      members: { [alice.uuid]: { name: 'alice', username: 'alice', role: 'owner' }, [bob.uuid]: { name: 'bob', username: 'bob', role: 'member' } },
      memberDocs: { [alice.uuid]: { channels: [conv] }, [bob.uuid]: { channels: [conv] } },
    };
    const created = await as(alice).post('/api/workspaces/import', { header });
    expect(created.ok).toBe(true);
    const newId = created.data.workspace.id;
    const page = await as(alice).post(`/api/ws/${newId}/import`, {
      conv, seq: 2,
      messages: [
        { seq: 1, user: alice.uuid, text: 'first', ts: 1000 },
        { seq: 2, user: bob.uuid, text: 'second', ts: 2000 },
        // No number, so no record; its author was nonetheless stamped as the last to write, at any length.
        { seq: 'none', user: 'x'.repeat(5000), text: 'ghost', ts: 9000 },
      ],
    });
    expect(page.ok).toBe(true);
    expect((await rt.kv.get(KEYS.activity(newId))).c[conv]).toEqual({ s: 2, t: 2000, u: bob.uuid });
    // A page with nothing admitted leaves the stamp as it was.
    expect((await as(alice).post(`/api/ws/${newId}/import`, { conv, seq: 2, messages: [{ seq: 0, user: alice.uuid, text: 'x', ts: 1 }] })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.activity(newId))).c[conv]).toEqual({ s: 2, t: 2000, u: bob.uuid });
  });
});

describe('a channel bookmark pointing at an uploaded file', () => {
  it('travels with the archive: the export lists the file, and a copy fed the bytes serves it from the bookmark', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const fd = new FormData();
    fd.append('file', new Blob(['handbook'], { type: 'text/plain' }), 'handbook.txt');
    const file = (await as(alice).post(`/api/ws/${wsId}/files`, fd)).data;
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { bookmarks: [{ label: 'Handbook', file: file.id }] })).ok).toBe(true);
    const archive = await exportAll(alice, wsId);
    // Named in the manifest with what the bookmark knows of it, so the client
    // that writes the export to a drive, or moves it to another server, copies it.
    expect(archive.files.find((f) => f.id === file.id)).toMatchObject({ id: file.id, name: 'handbook.txt', size: 8, type: 'text/plain' });
    // A transfer: the copy is created, the bytes are sent as the client sends them, and the bookmark works there.
    const created = await as(alice).post('/api/workspaces/import', { header: archive.header, from: `${wsId}@old-server` });
    expect(created.ok).toBe(true);
    const newId = created.data.workspace.id;
    for (const page of archive.pages) expect((await as(alice).post(`/api/ws/${newId}/import`, { conv: page.conv, seq: page.seq, messages: page.messages })).ok).toBe(true);
    // On another server the file's record is not there yet; here the
    // original still holds it, so the record is cleared to stand in for that.
    const bytes = await rt.fs.read(`teamchat-files/${wsId}/${file.id}`);
    await rt.kv.del(KEYS.file(file.id));
    for (const f of archive.files) {
      const upf = new FormData();
      upf.append('file', bytes, f.name);
      upf.append('id', f.id);
      upf.append('name', f.name);
      expect((await as(alice).post(`/api/ws/${newId}/import/file`, upf)).ok).toBe(true);
    }
    expect((await as(alice).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    const copy = (await as(alice).get(`/api/ws/${newId}`)).data.workspace;
    const ch = Object.values(copy.channels).find((c) => c.name === 'general');
    expect(ch.bookmarks).toEqual([{ id: expect.any(String), label: 'Handbook', file: file.id, name: 'handbook.txt' }]);
    const got = await as(bob).get(`/api/ws/${newId}/files/${file.id}`);
    expect(got.status).toBe(200);
    expect(await got.data.text()).toBe('handbook');
  });
});

describe('an import that stops short (the client side of an import or transfer)', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });

  it('takes the half-made copy down with the failure, so nothing is left counting against its owner, and a clean try succeeds', async () => {
    globalThis.puter = bridgeTo(alice);
    const conv = 'stopconv01';
    const msg = (seq) => ({ seq, user: alice.uuid, text: `m${seq}`, ts: 1000 + seq });
    const header = {
      format: 'teamchat-export', version: 1, workspace: { id: 'stopped001', name: 'Acme' },
      channels: { [conv]: { name: 'general', def: true } },
      members: { [alice.uuid]: { name: 'alice', username: 'alice', role: 'owner' } },
      memberDocs: { [alice.uuid]: { channels: [conv], dms: {}, reads: {}, notify: {} } },
    };
    // The second page names a channel the archive has not got: the worker refuses it and the import stops there.
    const broken = { header, pages: [{ conv, seq: 2, messages: [msg(1), msg(2)] }, { conv: 'nochan0001', seq: 1, messages: [msg(1)] }], files: [] };
    const stopped = await importArchive('https://teamchat-x.puter.work', broken, { profile: { name: 'A' } }).then(() => 'finished', (e) => e.code);
    expect(stopped).toBe('not_found');
    // The copy had been created under the archive's own id, with a page in; none of it remains.
    expect(await rt.kv.get(KEYS.ws('stopped001'))).toBeNull();
    expect(await rt.kv.get(KEYS.member('stopped001', alice.uuid))).toBeNull();
    expect(await rt.kv.get(KEYS.block(conv, 0))).toBeNull();
    expect(await rt.kv.get(KEYS.seq(conv))).toBeNull();
    expect((await rt.kv.get(KEYS.user(alice.uuid))).workspaces).toEqual([]);
    // Tried again with a sound archive, the workspace is made under its own id and opened.
    const ref = await importArchive('https://teamchat-x.puter.work', { ...broken, pages: [broken.pages[0]] }, { profile: { name: 'A' } });
    expect(ref).toBe('stopped001@teamchat-x');
    const ws = (await as(alice).get('/api/ws/stopped001')).data.workspace;
    expect(ws.importing).toBe(false);
    expect((await as(alice).get(`/api/ws/stopped001/conv/${conv}/messages`)).data.messages.map((m) => m.text)).toEqual(['m1', 'm2']);
  });
});

describe('completing a transfer that has already been completed', () => {
  it('is answered with where the workspace went, to the nominee no longer nominated as much as to the owner', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { to: bob.uuid })).ok).toBe(true);
    const first = await as(bob).post(`/api/ws/${wsId}/transfer/complete`, { to: 'copyone001@teamchat-new' });
    expect(first.data).toEqual({ ok: true, movedTo: 'copyone001@teamchat-new' });
    // The nomination is spent with the move; the nominee asking again (an
    // answer lost on the way) is told where it went rather than refused.
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.transferTo).toBeNull();
    const again = await as(bob).post(`/api/ws/${wsId}/transfer/complete`, { to: 'copyone001@teamchat-new' });
    expect(again.data).toEqual({ ok: true, movedTo: 'copyone001@teamchat-new', already: true });
    // Naming another copy changes nothing: the first completion stands, and the answer says so.
    const other = await as(bob).post(`/api/ws/${wsId}/transfer/complete`, { to: 'copytwo002@teamchat-new' });
    expect(other.data).toEqual({ ok: true, movedTo: 'copyone001@teamchat-new', already: true });
    expect((await as(alice).post(`/api/ws/${wsId}/transfer/complete`, { to: 'copytwo002@teamchat-new' })).data.movedTo).toBe('copyone001@teamchat-new');
    expect((await rt.kv.get(KEYS.ws(wsId))).movedTo).toBe('copyone001@teamchat-new');
  });
});

describe('accepting a transfer again after a failure (the client side)', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });

  /** Alice's workspace with bob nominated; the worker open to bob's own workspaces. Returns the original's reference. */
  async function nominated() {
    await as(alice).put('/api/server', { open: true });
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'before the move' });
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { to: bob.uuid })).ok).toBe(true);
    return { wsId, oldRef: `${wsId}@teamchat-x` };
  }
  /** Bob's app talking to the worker, with `hook(path, init)` able to stand in for one call. */
  function bobsApp(hook) {
    const calls = [];
    globalThis.puter = { workers: { exec: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push(`${init?.method || 'GET'} ${path}`);
      const out = hook ? await hook(path, init) : undefined;
      return out === undefined ? rt.dispatch(url, init, bob) : out;
    } } };
    return calls;
  }
  const copies = async () => (await rt.kv.list('tc:ws:*')).filter((k) => /^tc:ws:[a-z0-9]+$/.test(k)).length;
  const TARGET = 'https://teamchat-x.puter.work';

  it('closes the original for the copy it already made when only the completion had failed', async () => {
    const { wsId, oldRef } = await nominated();
    let failComplete = true;
    const calls = bobsApp(async (path) => {
      if (failComplete && path.endsWith('/transfer/complete')) throw new TypeError('connection dropped');
    });
    const state = { copy: null };
    const first = await transferWorkspace(oldRef, TARGET, state, { profile: { name: 'Bob' } }).then(() => 'moved', (e) => e.code);
    expect(first).toBe('network');
    expect(state.copy?.ref).toMatch(/^[a-z0-9]{6,20}@teamchat-x$/);
    expect(await copies()).toBe(2); // the original and the one copy
    expect((await rt.kv.get(KEYS.ws(wsId))).movedTo).toBeUndefined();
    // Again: no export, no import; the same copy is what the original is closed for.
    failComplete = false;
    calls.length = 0;
    const moved = await transferWorkspace(oldRef, TARGET, state, { profile: { name: 'Bob' } });
    expect(moved).toEqual({ ref: state.copy.ref, icon: null, mine: true });
    expect(calls.filter((c) => c.includes('/import') || c.includes('/export'))).toEqual([]);
    expect(await copies()).toBe(2);
    expect((await rt.kv.get(KEYS.ws(wsId))).movedTo).toBe(state.copy.ref);
    const copy = (await as(bob).get(`/api/ws/${state.copy.ref.split('@')[0]}`)).data.workspace;
    expect(copy.owner).toBe(bob.uuid);
    expect(copy.importing).toBe(false);
  });

  it('follows the move when the completion had landed but its answer was lost, rather than copying again', async () => {
    const { wsId, oldRef } = await nominated();
    let loseAnswer = true;
    bobsApp(async (path, init) => {
      if (loseAnswer && path.endsWith('/transfer/complete')) {
        await rt.dispatch(`https://teamchat-x.puter.work${path}`, init, bob); // it lands
        throw new TypeError('answer lost');
      }
    });
    const state = { copy: null };
    expect(await transferWorkspace(oldRef, TARGET, state, { profile: { name: 'Bob' } }).then(() => 'moved', (e) => e.code)).toBe('network');
    expect((await rt.kv.get(KEYS.ws(wsId))).movedTo).toBe(state.copy.ref);
    loseAnswer = false;
    const calls = bobsApp();
    const moved = await transferWorkspace(oldRef, TARGET, state, { profile: { name: 'Bob' } });
    expect(moved).toEqual({ ref: state.copy.ref, icon: null, mine: true });
    expect(calls).toEqual([`GET /api/ws/${wsId}`]); // read the original, saw it moved, done
    expect(await copies()).toBe(2);
    // And a fresh dialog (no copy remembered) follows it the same way, making nothing.
    const fresh = await transferWorkspace(oldRef, TARGET, { copy: null }, { profile: { name: 'Bob' } });
    expect(fresh).toEqual({ ref: state.copy.ref, icon: null, mine: false });
    expect(await copies()).toBe(2);
  });

  it('gives way when the original was moved elsewhere first, and takes its own copy down', async () => {
    const { wsId, oldRef } = await nominated();
    // Between bob's check of the original and his completion, the owner closes it for another copy.
    bobsApp(async (path) => {
      if (path.endsWith('/transfer/complete')) expect((await as(alice).post(`/api/ws/${wsId}/transfer/complete`, { to: 'elsewhere01@teamchat-y' })).ok).toBe(true);
    });
    const state = { copy: null };
    const moved = await transferWorkspace(oldRef, TARGET, state, { profile: { name: 'Bob' } });
    expect(moved).toEqual({ ref: 'elsewhere01@teamchat-y', icon: null, mine: false });
    expect(state.copy).toBeNull();
    expect(await copies()).toBe(1); // bob's copy is gone: nobody is sent to it
    expect((await rt.kv.get(KEYS.ws(wsId))).movedTo).toBe('elsewhere01@teamchat-y');
  });
});

describe('the bytes the worker serves', () => {
  const upload = async (u, wsId, name, type, bytes = 'x') => {
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type }), name);
    const res = await as(u).post(`/api/ws/${wsId}/files`, fd);
    expect(res.ok).toBe(true);
    return res.data;
  };

  it('are never sniffed into another type, and only what the app shows inline is offered inline', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const cases = [
      ['photo.png', 'image/png', 'inline'],
      ['clip.mp4', 'video/mp4', 'inline'],
      ['talk.mp3', 'audio/mpeg', 'inline'],
      ['paper.pdf', 'application/pdf', 'inline'],
      ['logo.svg', 'image/svg+xml', 'attachment'],
      ['page.html', 'text/html', 'attachment'],
      ['app.js', 'text/javascript', 'attachment'],
      ['blob.bin', '', 'attachment'],
    ];
    for (const [name, type, disposition] of cases) {
      const f = await upload(alice, wsId, name, type);
      const got = await as(bob).get(`/api/ws/${wsId}/files/${f.id}`);
      expect(got.status, name).toBe(200);
      const h = got.data.headers;
      expect(h.get('content-type'), name).toBe(type || 'application/octet-stream');
      expect(h.get('x-content-type-options'), name).toBe('nosniff');
      expect(h.get('content-disposition'), name).toBe(`${disposition}; filename="${name}"; filename*=UTF-8''${name}`);
      expect(h.get('cache-control'), name).toBe('private, max-age=3600');
    }
  });

  it('carry a name in any alphabet, encoded, with an ASCII stand-in beside it', async () => {
    const { wsId } = await workspaceWith(alice);
    const f = await upload(alice, wsId, 'résumé ☃ (final)*.pdf', 'application/pdf');
    const h = (await as(alice).get(`/api/ws/${wsId}/files/${f.id}`)).data.headers;
    expect(h.get('content-disposition')).toBe(`inline; filename="r_sum_ _ (final)*.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%E2%98%83%20%28final%29%2A.pdf`);
    expect(h.get('x-file-name')).toBe(encodeURIComponent('résumé ☃ (final)*.pdf'));
    // A quote or a backslash cannot break out of the quoted stand-in.
    const q = await upload(alice, wsId, 'a"b\\c;d.txt', 'text/plain');
    expect((await as(alice).get(`/api/ws/${wsId}/files/${q.id}`)).data.headers.get('content-disposition')).toBe(`attachment; filename="a_b_c_d.txt"; filename*=UTF-8''a%22b%5Cc%3Bd.txt`);
  });

  it('serve a photo, an icon and a preview\'s image with the same guard', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const img = (type) => { const fd = new FormData(); fd.append('file', new Blob([new Uint8Array(16)], { type }), 'pic'); return fd; };
    expect((await as(alice).post('/api/me/avatar', img('image/png'))).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/icon`, img('image/webp'))).ok).toBe(true);
    const hash = 'a'.repeat(64);
    await rt.fs.write(`teamchat-unfurls/${hash}`, new Blob([new Uint8Array(8)], { type: 'image/jpeg' }));
    await rt.kv.set(`tc:unfurlimg:${hash}`, { type: 'image/jpeg', size: 8, ts: Date.now() });
    for (const [path, type] of [[`/api/ws/${wsId}/members/${alice.uuid}/avatar`, 'image/png'], [`/api/ws/${wsId}/icon`, 'image/webp'], [`/api/ws/${wsId}/unfurl-image/${hash}`, 'image/jpeg']]) {
      const got = await as(bob).get(path);
      expect(got.status, path).toBe(200);
      expect(got.data.headers.get('content-type'), path).toBe(type);
      expect(got.data.headers.get('x-content-type-options'), path).toBe('nosniff');
      expect(got.data.headers.get('content-disposition'), path).toMatch(/^inline; filename="/);
      expect(got.data.headers.get('cache-control'), path).toBe('private, max-age=86400');
    }
  });
});

describe('a server address with its scheme in capitals', () => {
  it('names the same server as the lowercase one, wherever it is typed or pasted', () => {
    expect(serverKeyOf('HTTPS://Teamchat-X7k2.puter.work/')).toBe('teamchat-x7k2');
    expect(serverKeyOf('Https://Api.Example.com/base')).toBe('api.example.com');
    expect(serverKeyOf('HTTP://localhost:5173')).toBe('localhost:5173');
    // Trusting it and parsing a reference to it agree with the key.
    expect(trustServer('HTTPS://Api.Example.com/')).toBe('api.example.com');
    expect(parseRef('abc123@api.example.com')).toEqual({ id: 'abc123', server: 'api.example.com', url: 'https://api.example.com' });
  });
});

describe('a pasted recipient list with quoted display names', () => {
  it('reads "Last, First" <addr> as its address, reporting nothing as unreadable', () => {
    expect(parseEmails('"Fry, Ellis" <ellis@example.com>, ann@y.org; "Solo" <s@t.io>')).toEqual({ emails: ['ellis@example.com', 's@t.io', 'ann@y.org'], bad: [] });
    expect(parseEmails('"Bob, Jr" <bob@z.net>')).toEqual({ emails: ['bob@z.net'], bad: [] });
    // A quoted name shaped like an address is still only a name.
    expect(parseEmails('"pat@x.com" <bob@z.net>')).toEqual({ emails: ['bob@z.net'], bad: [] });
    // Quotes elsewhere are left to the split, as before.
    expect(parseEmails('"nope" pat@x.com')).toEqual({ emails: ['pat@x.com'], bad: ['"nope"'] });
  });
});

describe('the time a download gets', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    vi.useRealTimers();
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });

  /**
   * A worker whose answer begins at once and whose body brings a byte every
   * `gapMs`, `count` times, then falls silent for good; aborting the request
   * errors the body, as fetch does.
   */
  function steadyBody(headers, gapMs, count) {
    const seen = { signal: null };
    let sent = 0;
    let ctl = null;
    const stream = new ReadableStream({
      start(c) {
        ctl = c;
      },
      pull(c) {
        return new Promise((r) => {
          if (sent >= count) return; // silence from here on
          setTimeout(() => { sent++; c.enqueue(new Uint8Array([1])); r(); }, gapMs);
        });
      },
    });
    globalThis.puter = { workers: { exec: async (url, init) => {
      seen.signal = init.signal;
      init.signal?.addEventListener('abort', () => { try { ctl.error(init.signal.reason); } catch { /* closed already */ } });
      return new Response(stream, { status: 200, headers });
    } } };
    return seen;
  }

  it('is measured by the length the answer declares, as an upload of that size is', () => {
    expect(bodyTimeoutFor(new Response('', { headers: { 'Content-Length': '1000' } }))).toBe(20_020);
    expect(bodyTimeoutFor(new Response('', { headers: { 'Content-Length': String(10 * 1024 * 1024) } }))).toBe(20_000 + Math.ceil((10 * 1024 * 1024) / 50));
    expect(bodyTimeoutFor(new Response('', { headers: { 'Content-Length': String(100 * 1024 * 1024) } }))).toBe(5 * 60_000);
    expect(bodyTimeoutFor(new Response(''))).toBe(5 * 60_000);
    expect(bodyTimeoutFor(null)).toBe(5 * 60_000);
  });

  it('lets a large file\'s bytes arrive past the plain timeout, and gives up on them only once they stop coming', async () => {
    vi.useFakeTimers();
    // Five megabytes declared; a byte every fifteen seconds, six times over (ninety seconds, well past the plain timeout), then nothing more.
    const seen = steadyBody({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(5 * 1024 * 1024) }, 15_000, 6);
    const pending = api.fileBlob('abcdef@teamchat-x', 'file0001').then((b) => ({ ok: true, b }), (e) => ({ ok: false, e }));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.signal).toBeTruthy();
    // Well past the plain timeout, with the body still coming in, the request is not abandoned.
    await vi.advanceTimersByTimeAsync(90_000);
    expect(seen.signal.aborted).toBe(false);
    // Once the bytes stop, the plain timeout of silence gives up on them, whatever length was promised.
    await vi.advanceTimersByTimeAsync(19_000);
    expect(seen.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(seen.signal.aborted).toBe(true);
    expect(seen.signal.reason?.name).toBe('TimeoutError');
    const out = await pending;
    expect(out.ok).toBe(false);
    expect([out.e.code, out.e.message]).toEqual(['timeout', 'The download took too long']);
  });

  it('still holds a plain answer to the short timeout', async () => {
    vi.useFakeTimers();
    let signal = null;
    globalThis.puter = { workers: { exec: (url, init) => { signal = init.signal; return new Promise(() => {}); } } };
    const pending = api.health('https://teamchat-x.puter.work');
    await vi.advanceTimersByTimeAsync(19_000);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(signal.aborted).toBe(true);
    expect(signal.reason?.name).toBe('TimeoutError');
    expect(pending).toBeInstanceOf(Promise);
  });
});
