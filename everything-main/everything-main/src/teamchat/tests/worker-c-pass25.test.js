/**
 * Twenty-fifth review pass, region C: integrations, export/import/transfer,
 * files, link previews, search, the email worker and their client-side
 * counterparts. Each test here reproduces a defect found in that pass and
 * proves the fix.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { domainToASCII, domainToUnicode } from 'node:url';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { parseHead } from '../worker/unfurl.js';
import { parseEmails } from '../src/lib/email.js';
import { updateOwnWorker, resetBundleCache } from '../src/lib/deploy.js';
import { exportWorkspace, importArchive } from '../src/lib/archive.js';
import { parseRef } from '../src/lib/refs.js';
import { KEYS } from '../src/shared/blocks.js';

const { alice } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

describe('a link to a host whose name mixes the letters of two look-alike alphabets', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const site = (h) => parseHead('<html><head><title>T</title></head></html>', `https://${h}/p`).site;

  it('is credited on its card to the host as the parser writes it, not to the look-alike its letters spell', async () => {
    // A Cyrillic а before Latin "pple", a Greek ρ before Latin "aypal", a
    // Cyrillic о inside "google": each decodes to a word the eye reads as a
    // well-known name, and the card used to credit the page to it.
    for (const lookalike of ['аpple.com', 'ρaypal.com', 'goоgle.com', 'mιcrоsoft.example']) {
      const ascii = domainToASCII(lookalike);
      expect(ascii, lookalike).toMatch(/^xn--/);
      expect(site(ascii), lookalike).toBe(ascii);
      expect(site(`www.${ascii}`), lookalike).toBe(ascii);
    }
    // A name written in one alphabet, whichever it is, is its owner's and is
    // shown as written: German, Greek, Russian, Chinese, and Japanese beside
    // Latin, which share no letters that look alike.
    for (const h of ['xn--bcher-kva.example', 'xn--nxasmq6b.gr', 'xn--80ak6aa92e.com', 'xn--fsqu00a.xn--3lr804guic', domainToASCII('東京tower.jp'), 'plain.example.com']) {
      expect(site(h), h).toBe(domainToUnicode(h));
    }
    // Digits, hyphens and accents belong to no alphabet: a Latin name with
    // them decodes as before.
    expect(site(domainToASCII('café-24.example'))).toBe('café-24.example');
    // And through the route: a page, and a bare picture, on such a host.
    globalThis.fetch = async (url) => {
      const u = new URL(url);
      if (u.pathname === '/login') return new Response('<html><head><title>Sign in</title><meta name="description" content="Your account"></head></html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      if (u.pathname === '/logo.png') return new Response(new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]), { headers: { 'Content-Type': 'image/png', 'Content-Length': '8' } });
      return new Response('no', { status: 404 });
    };
    const { wsId, general } = await workspaceWith(alice);
    const page = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'https://аpple.com/login' })).data.message;
    const card = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages/${page.seq}/unfurl`)).data.unfurl;
    expect(card).toMatchObject({ title: 'Sign in', site: 'xn--pple-43d.com' });
    const pic = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'https://www.аpple.com/logo.png' })).data.message;
    const picCard = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages/${pic.seq}/unfurl`)).data.unfurl;
    expect(picCard).toMatchObject({ kind: 'image', site: 'xn--pple-43d.com' });
  });
});

describe('a contact link copied whole into the invitation dialog', () => {
  it('loses the subject or the copies its query carried, and keeps the address alone', () => {
    // "Email us" links carry a subject, a body, sometimes a cc, after a
    // question mark; the scheme came off and the rest used to stay on the
    // address, which passed for one and reached the mail as one nobody has.
    expect(parseEmails('mailto:pat@example.com?subject=Hello%20there')).toEqual({ emails: ['pat@example.com'], bad: [] });
    // (The words before a bracketed address are its display name, as they always were.)
    expect(parseEmails('Contact: <mailto:pat@example.com?subject=hi&body=x>')).toEqual({ emails: ['pat@example.com'], bad: [] });
    expect(parseEmails('mailto:pat@example.com?cc=ann@example.com, ann@example.com')).toEqual({ emails: ['pat@example.com', 'ann@example.com'], bad: [] });
    expect(parseEmails('(mailto:Pat@Example.com?subject=hi).')).toEqual({ emails: ['pat@example.com'], bad: [] });
    // The same tail without the scheme (a link whose scheme the source took off) is read the same way.
    expect(parseEmails('pat@example.com?subject=hi')).toEqual({ emails: ['pat@example.com'], bad: [] });
    // A question mark before the @ may be part of a name, and stays.
    expect(parseEmails('what?@example.com')).toEqual({ emails: ['what?@example.com'], bad: [] });
  });
});

describe('bringing an owner\'s worker up to the shipped build', () => {
  const worker = { url: 'https://teamchat-x.puter.work', path: '/me/teamchat-worker.js', name: 'teamchat-x' };
  const realFetch = globalThis.fetch;
  const realPuter = globalThis.puter;
  let writes;
  let health;
  /** The app ships build `aaaa…`; the worker answers /health with whatever `health` says at the time. */
  function ship() {
    globalThis.fetch = async () => new Response('/* teamchat-worker build=aaaaaaaaaaaa at=2000 */\nconsole.log(1);', { status: 200 });
    globalThis.puter = {
      fs: { write: async (path) => { writes.push(path); return { path }; } },
      workers: { exec: async () => new Response(JSON.stringify(health()), { status: 200, headers: { 'Content-Type': 'application/json' } }) },
    };
  }
  beforeEach(() => {
    writes = [];
    resetBundleCache();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    globalThis.puter = realPuter;
  });

  it('is reported as done only once the worker answers with the new build; a worker still on the old one is no update yet', async () => {
    // The bundle is written, but the worker goes on answering with the build
    // it ran before (a redeploy slow to take, or a bundle it cannot start on):
    // no update has taken, and none is reported (the caller used to be told
    // one had, and said so to the owner).
    ship();
    health = () => ({ ok: true, build: 'bbbbbbbbbbbb' });
    expect(await updateOwnWorker(worker, 'bbbbbbbbbbbb', 1000, { wait: { attempts: 3, delay: 1 } })).toBeNull();
    expect(writes).toEqual(['/me/teamchat-worker.js']);
    // A worker that does not answer at all while the wait runs is not updated either.
    globalThis.puter.workers.exec = async () => { throw new Error('offline'); };
    expect(await updateOwnWorker(worker, 'bbbbbbbbbbbb', 1000, { wait: { attempts: 2, delay: 1 } })).toBeNull();
    // One that comes up on the new build within the wait is: the third answer says so.
    let asked = 0;
    health = () => ({ ok: true, build: ++asked >= 3 ? 'aaaaaaaaaaaa' : 'bbbbbbbbbbbb' });
    ship();
    expect(await updateOwnWorker(worker, 'bbbbbbbbbbbb', 1000, { wait: { attempts: 5, delay: 1 } })).toBe('aaaaaaaaaaaa');
    expect(asked).toBe(3);
  });
});

describe('an upload taken out of the box again before it was sent', () => {
  const { bob, carol } = USERS;
  const upload = async (who, wsId, name = 'a.txt') => {
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'text/plain' }), name);
    return (await as(who).post(`/api/ws/${wsId}/files`, fd)).data;
  };

  it('is let go of by its uploader while nothing names it, and kept with a word once a message, a scheduled message or a bookmark does', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    // Picked and taken out again: the bytes and the record go.
    const loose = await upload(alice, wsId);
    expect((await as(alice).del(`/api/ws/${wsId}/files/${loose.id}`)).data).toEqual({ ok: true });
    expect((await as(alice).get(`/api/ws/${wsId}/files/${loose.id}`)).status).toBe(404);
    expect(await rt.kv.get(KEYS.file(loose.id))).toBeFalsy();
    await expect(rt.fs.read(`teamchat-files/${wsId}/${loose.id}`)).rejects.toThrow();
    // Only the uploader's own; a member of nothing here is no one to ask.
    const mine = await upload(alice, wsId);
    const other = await as(bob).del(`/api/ws/${wsId}/files/${mine.id}`);
    expect([other.status, other.data.code, other.data.message]).toEqual([403, 'forbidden', 'Only the person who uploaded a file can remove it']);
    expect((await as(carol).del(`/api/ws/${wsId}/files/${mine.id}`)).status).toBe(403);
    // Attached to a message: kept, with the way to take it out.
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'here', attachments: [{ id: mine.id }] })).ok).toBe(true);
    const attached = await as(alice).del(`/api/ws/${wsId}/files/${mine.id}`);
    expect([attached.status, attached.data.code, attached.data.message]).toEqual([409, 'in_use', 'This file is attached to a message; delete the message instead']);
    expect((await as(alice).get(`/api/ws/${wsId}/files/${mine.id}`)).status).toBe(200);
    // Waiting with a scheduled message: kept for it.
    const later = await upload(alice, wsId, 'later.txt');
    expect((await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'soon', attachments: [{ id: later.id }], dueAt: Date.now() + 3600_000 })).ok).toBe(true);
    const queued = await as(alice).del(`/api/ws/${wsId}/files/${later.id}`);
    expect([queued.status, queued.data.message]).toEqual([409, 'This file is waiting to go out with a scheduled message; edit that message instead']);
    // Bookmarked in a channel: kept for the bookmark.
    const marked = await upload(alice, wsId, 'spec.txt');
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { bookmarks: [{ label: 'Spec', file: marked.id }] })).ok).toBe(true);
    const bookmarked = await as(alice).del(`/api/ws/${wsId}/files/${marked.id}`);
    expect([bookmarked.status, bookmarked.data.message]).toEqual([409, 'This file is bookmarked in a channel; remove the bookmark instead']);
    // A record from before files were counted says nothing of what holds it, and stays; an id of no shape, or of another workspace's file, is not found.
    const legacy = await upload(alice, wsId, 'old.txt');
    await rt.kv.set(KEYS.file(legacy.id), { ws: wsId, u: alice.uuid, name: 'old.txt', size: 4, type: 'text/plain', ts: Date.now() });
    expect((await as(alice).del(`/api/ws/${wsId}/files/${legacy.id}`)).status).toBe(409);
    expect((await as(alice).del(`/api/ws/${wsId}/files/not-an-id`)).status).toBe(404);
    const elsewhere = await workspaceWith(alice, [], 'Other');
    expect((await as(alice).del(`/api/ws/${elsewhere.wsId}/files/${mine.id}`)).status).toBe(404);
    // A hold landing in the same instant as the removal keeps the file: the count is moved atomically and read back.
    const raced = await upload(alice, wsId, 'race.txt');
    const orig = rt.kv.incr;
    rt.kv.incr = async (k, amount) => {
      if (k === KEYS.file(raced.id) && amount?.refs === -1) await orig.call(rt.kv, k, { refs: 1 }); // a post's hold lands first
      return orig.call(rt.kv, k, amount);
    };
    try {
      expect((await as(alice).del(`/api/ws/${wsId}/files/${raced.id}`)).status).toBe(409);
    } finally {
      rt.kv.incr = orig;
    }
    expect((await rt.kv.get(KEYS.file(raced.id))).refs).toBe(1);
    expect((await as(alice).get(`/api/ws/${wsId}/files/${raced.id}`)).status).toBe(200);
  });
});

describe('a link preview on a runtime that follows redirects on its own', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('reads no card off a page at a private address the chain ended at, and still reads one off a public page answered under its own address', async () => {
    // The fetch is asked not to follow redirects (`manual`), each hop being
    // checked by hand; a runtime that follows all the same answers the last
    // page of the chain under its address (Response.url), here a private one.
    const answered = (html, url) => {
      const res = new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
      Object.defineProperty(res, 'url', { value: url });
      return res;
    };
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      const u = new URL(url);
      if (u.pathname === '/short') return answered('<html><head><title>Internal admin</title><meta name="description" content="secret panel"></head></html>', 'http://10.0.0.5/admin');
      if (u.pathname === '/moved') return answered('<html><head><title>Public notes</title><meta name="description" content="fine"></head></html>', 'https://docs.example.com/notes/');
      if (u.pathname === '/pic') return answered('<html><head><title>Pic</title><meta name="description" content="d"><meta property="og:image" content="/logo.png"></head></html>', 'https://pub.example/pic');
      if (u.pathname === '/logo.png') {
        const res = new Response(new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]), { headers: { 'Content-Type': 'image/png', 'Content-Length': '8' } });
        Object.defineProperty(res, 'url', { value: 'http://169.254.169.254/latest/meta-data' });
        return res;
      }
      return new Response('no', { status: 404 });
    };
    const { wsId, general } = await workspaceWith(alice);
    const card = async (text) => {
      const m = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text })).data.message;
      return { seq: m.seq, ...(await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/unfurl`)).data };
    };
    // The private page's words reach no card, and nothing is written for the message.
    const short = await card('https://pub.example/short');
    expect(short.unfurl).toBeNull();
    const block = await rt.kv.get(KEYS.block(general.id, 0));
    expect(block.x[`s${short.seq}`]?.uf).toBeUndefined();
    // A public page answered under its own (moved) address reads as before, credited to where it answered from.
    const moved = await card('https://pub.example/moved');
    expect(moved.unfurl).toMatchObject({ title: 'Public notes', site: 'docs.example.com' });
    // A picture answered from a private address is no picture for the card; the card itself stands.
    const pic = await card('https://pub.example/pic');
    expect(pic.unfurl).toMatchObject({ title: 'Pic', image: null });
    expect(calls.filter((c) => /10\.0\.0\.5|169\.254/.test(c))).toEqual([]);
  });
});

describe('a webhook payload in the shapes the oldest integrations send it', () => {
  it('reads the JSON out of a form-encoded payload= field, and a byte order mark ahead of JSON, as the JSON itself', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { name: 'CI', channel: general.id })).data;
    const bot = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'B', scopes: ['post'], channels: [general.id] })).data;
    const send = async (path, body, type) => {
      const res = await rt.dispatch(`https://teamchat-api.test${path}`, { method: 'POST', headers: type ? { 'content-type': type } : {}, body }, null);
      return { status: res.status, data: await res.json().catch(() => null) };
    };
    const hookPath = `/webhook/${hook.token}`;
    // What `curl -d payload=…` and a decade of webhook integrations send: the JSON in a form field. Used to be refused as not JSON.
    const form = await send(hookPath, `payload=${encodeURIComponent(JSON.stringify({ text: 'from a form', attachments: [{ title: 'Build 1' }] }))}`, 'application/x-www-form-urlencoded');
    expect([form.status, form.data.text]).toEqual([200, 'from a form\nBuild 1']);
    // A form encoder's plus signs are spaces; a charset on the type is fine; no type at all with a body that opens as a form is read as one.
    const plus = await send(hookPath, 'payload=%7B%22text%22%3A%22hello+world%22%7D', 'application/x-www-form-urlencoded; charset=utf-8');
    expect([plus.status, plus.data.text]).toEqual([200, 'hello world']);
    const untyped = await send(hookPath, `payload=${encodeURIComponent('{"text":"no type"}')}`, null);
    expect([untyped.status, untyped.data.text]).toEqual([200, 'no type']);
    // The bot route reads bodies the same way.
    const viaBot = await send(`/bot/${bot.token}/channels/${general.id}/messages`, `payload=${encodeURIComponent('{"text":"bot form"}')}`, 'application/x-www-form-urlencoded');
    expect([viaBot.status, viaBot.data.text]).toEqual([200, 'bot form']);
    // A form with no payload field, and a payload that is not JSON, are refused with what would do.
    const none = await send(hookPath, 'text=hi', 'application/x-www-form-urlencoded');
    expect([none.status, none.data.code, none.data.message]).toEqual([400, 'invalid', 'Body must be JSON, or a form with a JSON payload field']);
    const notJson = await send(hookPath, 'payload=hello', 'application/x-www-form-urlencoded');
    expect([notJson.status, notJson.data.message]).toEqual([400, 'The payload field must be JSON']);
    // A byte order mark ahead of the JSON (a script on Windows writing its payload through a file) is no part of it.
    const bom = await send(hookPath, new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"text":"after a mark"}')]), 'application/json');
    expect([bom.status, bom.data.text]).toEqual([200, 'after a mark']);
    // JSON as before.
    const json = await send(hookPath, '{"text":"plain json"}', 'application/json');
    expect([json.status, json.data.text]).toEqual([200, 'plain json']);
    const bad = await send(hookPath, 'not json', 'application/json');
    expect([bad.status, bad.data.message]).toEqual([400, 'Body must be JSON']);
  });
});

describe('a block the original closed early, through an export and an import', () => {
  const { bob } = USERS;
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  /** The app's bridge to the (real) worker as alice. */
  const bridge = () => ({ workers: { exec: async (url, init = {}) => rt.dispatch(url, init, alice) } });

  it('is closed on the copy the same way: marked full, its run noted for every reader, the counter past it, and a badge over the run cleared as on the original', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    // Long messages until the first block grows past its budget and is
    // closed early (see rollBlock): the counter jumps to the block's last
    // number, and the next message opens the next block at 51.
    let seq = 0;
    for (let i = 0; i < 60 && seq <= 50; i++) seq = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'x'.repeat(4000) })).data.message.seq;
    expect(seq).toBe(51);
    const origBlock = await rt.kv.get(KEYS.block(general.id, 0));
    expect(Number(origBlock.full)).toBeGreaterThan(0);
    const lastRecord = Math.max(...origBlock.m.map((m) => m.s));
    const run = (await rt.kv.get(KEYS.activity(wsId))).c[general.id].k;
    expect(run).toEqual([lastRecord + 1, 50]);
    // The export names the closed block with the number its records end at.
    const direct = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
    expect(direct.pages.find((p) => p.conv === general.id).closed).toEqual([{ block: 0, after: lastRecord }]);
    expect(direct.pages.filter((p) => p.conv !== general.id).every((p) => p.closed === undefined)).toBe(true);
    // Through the app's own export and import.
    globalThis.puter = bridge();
    const archive = await exportWorkspace(`${wsId}@teamchat-old`);
    const newRef = await importArchive('https://teamchat-api.test', archive, { profile: { name: 'Alice' } });
    const copyId = parseRef(newRef).id;
    const copyGeneral = Object.values((await rt.kv.get(KEYS.ws(copyId))).channels).find((c) => c.name === 'general').id;
    expect(copyGeneral).not.toBe(general.id); // the original's id is in use on this worker
    const copyBlock = await rt.kv.get(KEYS.block(copyGeneral, 0));
    expect(Number(copyBlock.full)).toBeGreaterThan(0);
    expect(copyBlock.m.map((m) => m.s)).toEqual(origBlock.m.map((m) => m.s));
    expect((await rt.kv.get(KEYS.activity(copyId))).c[copyGeneral].k).toEqual(run);
    expect(await rt.kv.get(KEYS.seq(copyGeneral))).toBe(51);
    // Whether the run reads as a hole: on each copy, alice mentions bob in a
    // message, then deletes it and the one before it (their records stay),
    // and bob reads to the last message he can see, the last before the run.
    // Every number past it is accounted for (a record, or the block closed
    // early), so the read reaches the end and the mention's badge clears, on
    // the original as before and now on the copy, where the open block used
    // to leave the badge standing over numbers no message ever stood under.
    for (const [ws, conv] of [[wsId, general.id], [copyId, copyGeneral]]) {
      const m = (await as(alice).post(`/api/ws/${ws}/conv/${conv}/messages`, { text: 'ping @bob' })).data.message;
      expect(m.seq).toBe(52);
      expect((await as(bob).get(`/api/ws/${ws}`)).data.me.mentions[conv]).toBe(1);
      expect((await as(alice).del(`/api/ws/${ws}/conv/${conv}/messages/51`)).ok).toBe(true);
      expect((await as(alice).del(`/api/ws/${ws}/conv/${conv}/messages/${m.seq}`)).ok).toBe(true);
      expect((await as(bob).post(`/api/ws/${ws}/conv/${conv}/read`, { seq: lastRecord })).ok).toBe(true);
      expect((await as(bob).get(`/api/ws/${ws}`)).data.me.mentions[conv] || 0).toBe(0);
    }
    // The closed blocks travel with every chunk of a page: one naming the
    // block before its messages arrive closes it ahead of them, the chunk
    // with the messages keeps it closed, and a chunk sent again (an answer
    // lost on the way) changes nothing.
    const page = archive.pages.find((p) => p.conv === general.id);
    const again = (await as(alice).post('/api/workspaces/import', { header: archive.header })).data.workspace.id;
    const conv2 = Object.values((await rt.kv.get(KEYS.ws(again))).channels).find((c) => c.name === 'general').id;
    for (const messages of [[], page.messages, page.messages]) {
      expect((await as(alice).post(`/api/ws/${again}/import`, { conv: general.id, seq: page.seq, messages, closed: page.closed })).ok).toBe(true);
    }
    const twice = await rt.kv.get(KEYS.block(conv2, 0));
    expect(Number(twice.full)).toBeGreaterThan(0);
    expect(twice.m.map((m) => m.s)).toEqual(origBlock.m.map((m) => m.s));
    expect((await rt.kv.get(KEYS.activity(again))).c[conv2].k).toEqual(run);
    expect(await rt.kv.get(KEYS.seq(conv2))).toBe(51);
  });
});
