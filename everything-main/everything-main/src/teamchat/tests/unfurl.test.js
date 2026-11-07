/**
 * Link previews: the worker reaches the open internet here, so the guards
 * are what these tests are about. fetch is replaced with a small fake site.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The linearity test below parses a head at the body cap, four tenths of a
// second alone and a few seconds under several test runs at once (six
// review gates on one machine), where it ran past the default five. Room
// beyond the test's own twenty-second bound, so a slow run is judged by
// that bound and not cut off before it.
vi.setConfig({ testTimeout: 30_000 });
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import { LIMITS, firstLinkOf, firstUnfurlableLink, isAppLink } from '../src/shared/limits.js';
import { allowedUrl, isPrivateIp, parseHead } from '../worker/unfurl.js';

const { alice, bob, carol } = USERS;
let rt;
let calls;
const realFetch = globalThis.fetch;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Fallback &amp; title</title>
<meta property="og:title" content="Release notes 2.0"><meta name="description" content="What changed in the &quot;big&quot; release">
<meta property="og:site_name" content="Example Docs"><meta property="og:image" content="/cover.png"></head><body>${'x'.repeat(500000)}</body></html>`;

function fakeSite() {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    const u = new URL(url);
    const html = (body, status = 200, headers = {}) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } });
    if (u.pathname === '/notes') return html(PAGE);
    if (u.pathname === '/cover.png') return new Response(new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]), { headers: { 'Content-Type': 'image/png', 'Content-Length': '8' } });
    if (u.pathname === '/photo.jpg') return new Response(new Uint8Array(1024), { headers: { 'Content-Type': 'image/jpeg' } });
    if (u.pathname === '/huge.png') return new Response(new Uint8Array(1024), { headers: { 'Content-Type': 'image/png', 'Content-Length': String(LIMITS.unfurlImageBytes + 1) } });
    // A chunked (no Content-Length) or dishonestly labelled body, larger than the limit.
    if (u.pathname === '/chunked.png') return new Response(new Uint8Array(LIMITS.unfurlImageBytes + 1), { headers: { 'Content-Type': 'image/png' } });
    if (u.pathname === '/liar.png') return new Response(new Uint8Array(LIMITS.unfurlImageBytes + 1), { headers: { 'Content-Type': 'image/png', 'Content-Length': '8' } });
    if (u.pathname === '/nasty') return html('<html><head><title>Nasty &#9999999999; title &#128512;</title></head></html>');
    if (u.pathname === '/bad-redirect') return new Response('', { status: 302, headers: { Location: 'http://[bad' } });
    if (u.pathname === '/to-private') return new Response('', { status: 302, headers: { Location: 'http://10.0.0.5/admin' } });
    if (u.pathname === '/to-notes') return new Response('', { status: 301, headers: { Location: '/notes' } });
    // A short link on another host, to a page that names no site and links its image relatively.
    if (u.hostname === 'short.example.com') return new Response('', { status: 301, headers: { Location: 'https://docs.example.com/plain' } });
    // Pages not in utf-8: one says so in its header, one only in its head.
    const latin = (head) => new Uint8Array([...new TextEncoder().encode(`<html><head>${head}<title>Caf`), 0xe9, ...new TextEncoder().encode(' du coin</title></head></html>')]);
    if (u.pathname === '/latin-header') return new Response(latin(''), { headers: { 'Content-Type': 'text/html; charset=ISO-8859-1' } });
    if (u.pathname === '/latin-meta') return new Response(latin('<meta charset="windows-1252">'), { headers: { 'Content-Type': 'text/html' } });
    if (u.pathname === '/latin-equiv') return new Response(latin('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">'), { headers: { 'Content-Type': 'text/html' } });
    if (u.pathname === '/plain') return html('<html><head><title>Plain page</title><meta property="og:image" content="/cover.png"></head></html>');
    if (u.pathname === '/loop') return new Response('', { status: 302, headers: { Location: '/loop' } });
    if (u.pathname === '/binary') return new Response('zip', { headers: { 'Content-Type': 'application/zip' } });
    if (u.pathname === '/empty') return html('<html><head></head><body>nothing</body></html>');
    if (u.pathname === '/slow') throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    if (u.pathname === '/big') return html(`<html><head>${'<meta name="x" content="y">'.repeat(20000)}<title>Late title</title></head></html>`);
    return html('not found', 404);
  };
}

beforeEach(async () => {
  rt = await boot();
  fakeSite();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  expect(rt.kv._calls.list).toBe(0);
});

describe('url guards', () => {
  it('allows only public http(s) hosts', () => {
    expect(allowedUrl('https://example.com/x')).toBeTruthy();
    expect(allowedUrl('http://example.com')).toBeTruthy();
    for (const bad of ['ftp://example.com', 'javascript:alert(1)', 'file:///etc/passwd', 'https://user:pw@example.com', 'http://localhost/x',
      'http://foo.localhost/', 'http://printer.local/', 'http://127.0.0.1/', 'http://10.1.2.3/', 'http://192.168.1.1/', 'http://172.16.0.1/',
      'http://169.254.169.254/latest/meta-data', 'http://0.0.0.0/', 'http://[::1]/', 'http://[fd00::1]/', 'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/',
      'http://100.64.0.1/', 'http://224.0.0.1/', 'http://192.0.0.9/', 'http://198.18.0.1/', 'http://198.19.255.1/',
      'http://[::7f00:1]/', 'http://[64:ff9b::a9fe:a9fe]/', 'http://[2001:db8::1]/', 'http://[2002:7f00:1::1]/', 'not a url']) {
      expect(allowedUrl(bad), bad).toBeNull();
    }
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
    expect(isPrivateIp('198.20.0.1')).toBe(false);
    expect(isPrivateIp('192.0.1.1')).toBe(false);
    expect(isPrivateIp('[2606:4700::6810:84e5]')).toBe(false);
    expect(isPrivateIp('[::ffff:8.8.8.8]')).toBe(false);
  });

  it('parses a document head, preferring Open Graph, resolving the image', () => {
    const meta = parseHead(PAGE, 'https://docs.example.com/notes');
    expect(meta).toEqual({ title: 'Release notes 2.0', desc: 'What changed in the "big" release', site: 'Example Docs', image: 'https://docs.example.com/cover.png' });
    expect(parseHead('<html><head><title>Only &lt;title&gt;</title></head></html>', 'https://www.x.io/a')).toMatchObject({ title: 'Only <title>', site: 'x.io', image: null });
  });

  it('decodes hex and the common named entities in metadata', () => {
    const page = `<head><meta property="og:title" content="Bob&#x27;s notes &mdash; part&nbsp;1&hellip; &copy; 2026 &unknown; &#1114112;"></head>`;
    expect(parseHead(page, 'https://x.io/').title).toBe("Bob's notes \u2014 part 1\u2026 \u00a9 2026 &unknown;");
  });

  it('keeps an apostrophe or the other kind of quote inside an attribute value', () => {
    const page = `<head><meta property="og:title" content="What's new in 2.0"><meta name='description' content='Say "hi" to Bob&#39;s page'>
<meta property=og:site_name content=Bare><meta name="twitter:title" content="ignored: og wins"></head>`;
    expect(parseHead(page, 'https://x.io/')).toMatchObject({ title: "What's new in 2.0", desc: 'Say "hi" to Bob\'s page', site: 'Bare' });
  });

  it('reads a head built to make the scans quadratic in linear time', () => {
    // As many tag starts as the body cap allows, none of them closed: each
    // start must not scan to the end of the head.
    const metas = '<meta '.repeat(LIMITS.unfurlBodyBytes / 6);
    const titles = '<title>'.repeat(LIMITS.unfurlBodyBytes / 7);
    const t0 = performance.now();
    expect(parseHead(`${metas}<title>Late</title>`, 'https://x.io/').title).toBe('Late');
    expect(parseHead(titles, 'https://x.io/').title).toBe('');
    // Linear, these two take about four tenths of a second alone and a few
    // seconds when several test runs share the machine (six review gates at
    // once ran this file a dozen times slower); quadratic (each start
    // scanning to the end of a 200 KB head) they take tens of seconds. The
    // bound sits between the two with room for the loaded machine, so a
    // regression still fails it. Judged by the clock alone on purpose: a
    // ratio between a half-size and a full-size read, tried instead, read
    // 4.6 under that load where the same code reads 1.6 alone.
    expect(performance.now() - t0).toBeLessThan(20_000);
  });

  it('finds the first link outside code', () => {
    expect(firstLinkOf('see https://a.io/x and https://b.io')).toBe('https://a.io/x');
    expect(firstLinkOf('`https://a.io/x` then https://b.io/y.')).toBe('https://b.io/y');
    expect(firstLinkOf('```\nhttps://a.io\n```')).toBeNull();
    expect(firstLinkOf('no links')).toBeNull();
    // The same address the renderer makes clickable: a bracket pair inside it is part of it.
    expect(firstLinkOf('https://en.wikipedia.org/wiki/Foo_(bar) x')).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
    expect(firstLinkOf('(https://a.io/b) ok')).toBe('https://a.io/b');
    expect(firstLinkOf('https://a.io/?a=1& ok')).toBe('https://a.io/?a=1&');
    // What the renderer draws: emphasis marks are not part of an address
    // written in bold, italics or strikethrough, and a quote or angle
    // bracket ends it inside a bracket group as it does outside one.
    expect(firstLinkOf('**https://a.io/z**')).toBe('https://a.io/z');
    expect(firstLinkOf('_https://a.io/z_ then')).toBe('https://a.io/z');
    expect(firstLinkOf('~https://a.io/z~')).toBe('https://a.io/z');
    expect(firstLinkOf("https://a.io/(it's)")).toBe('https://a.io/(it');
    expect(firstLinkOf('https://a.io/[a<b]')).toBe('https://a.io/[a');
  });

  it('passes over links into the app itself, whatever host serves it', () => {
    const permalink = 'https://teamchat.puter.com/#/ws/nx9h0kshcl%40teamchat-cle4gwm/c/ch_a1/t/5';
    for (const app of [permalink, 'http://localhost:5173/#/ws/abc@teamchat-x/c/ch_1/m/3',
      'https://teamchat.puter.com/#/join/teamchat-x/AAAA-BBBB-CCCC', 'https://teamchat.puter.com/#/connect/teamchat-x/AAAA-BBBB-CCCC']) {
      expect(isAppLink(app), app).toBe(true);
      expect(firstUnfurlableLink(`from a thread: ${app}`), app).toBeNull();
    }
    // The app's front page, a fragment that is no route of the app's, or no fragment at all: a real preview.
    for (const page of ['https://teamchat.puter.com/', 'https://teamchat.puter.com/#/', 'https://example.com/#/wsx', 'https://example.com/app#/workspace/1', 'https://docs.example.com/notes']) {
      expect(isAppLink(page), page).toBe(false);
      expect(firstUnfurlableLink(`see ${page} ok`), page).toBe(page);
    }
    // The first link worth showing wins, wherever the app link sits.
    expect(firstUnfurlableLink(`look ${permalink} and https://docs.example.com/notes`)).toBe('https://docs.example.com/notes');
    expect(firstUnfurlableLink(`https://docs.example.com/notes then ${permalink}`)).toBe('https://docs.example.com/notes');
    expect(firstUnfurlableLink('nothing here')).toBeNull();
    expect(isAppLink('not a url')).toBe(false);
  });
});

describe('unfurl route', () => {
  const post = (u, wsId, conv, text) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text });
  const unfurl = (u, wsId, conv, seq) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages/${seq}/unfurl`);

  it('stores one card on the message for everyone, fetched once, image copied not hotlinked', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(alice, wsId, general.id, 'read this https://docs.example.com/notes please')).data.message;
    const r = await unfurl(alice, wsId, general.id, m.seq);
    expect(r.ok).toBe(true);
    expect(r.data.unfurl).toMatchObject({ url: 'https://docs.example.com/notes', title: 'Release notes 2.0', site: 'Example Docs', kind: 'page' });
    expect(r.data.unfurl.image).toMatch(/^[0-9a-f]{64}$/);
    expect(calls).toEqual(['https://docs.example.com/notes', 'https://docs.example.com/cover.png']);
    // Every reader gets the same card from the message, and the image from the worker.
    const page = await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(page.data.messages.find((x) => x.seq === m.seq).unfurl.title).toBe('Release notes 2.0');
    const img = await as(bob).get(`/api/ws/${wsId}/unfurl-image/${r.data.unfurl.image}`);
    expect(img.status).toBe(200);
    expect(img.data.headers.get('content-type')).toBe('image/png');
    expect((await as(carol).get(`/api/ws/${wsId}/unfurl-image/${r.data.unfurl.image}`)).status).toBe(403);
    // The same link elsewhere: served from the cache, no second fetch.
    const m2 = (await post(bob, wsId, general.id, 'https://docs.example.com/notes again')).data.message;
    await unfurl(bob, wsId, general.id, m2.seq);
    expect(calls).toHaveLength(2);
    // Calling again for the same message is idempotent.
    await unfurl(alice, wsId, general.id, m.seq);
    expect(calls).toHaveLength(2);
    // The body was read only until </head>, not the 500 KB of body.
    expect(rt.kv._ttl.get(KEYS.unfurl(await (await import('../worker/lib.js')).sha256('https://docs.example.com/notes')))).toBe(7 * 86400);
  });

  it('refuses private, loopback, non-http, oversized and empty targets quietly', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const cases = [
      'http://127.0.0.1/secret', 'http://10.0.0.1/', 'http://169.254.169.254/latest', 'http://localhost:8080/', 'ftp://example.com/x',
      'https://docs.example.com/to-private', 'https://docs.example.com/loop', 'https://docs.example.com/binary', 'https://docs.example.com/empty',
      'https://docs.example.com/slow', 'https://docs.example.com/missing',
    ];
    for (const url of cases) {
      const m = (await post(alice, wsId, general.id, `look ${url}`)).data.message;
      const r = await unfurl(alice, wsId, general.id, m.seq);
      expect(r.ok, url).toBe(true);
      expect(r.data.unfurl, url).toBeNull();
    }
    // A redirect towards a private address stopped before it was followed.
    expect(calls.some((c) => c.includes('10.0.0.5'))).toBe(false);
    expect(calls.filter((c) => c.includes('/loop'))).toHaveLength(4); // 1 + MAX_REDIRECTS
    // An oversized image is skipped, the card survives without it; a huge head is capped and still parsed.
    const big = (await post(alice, wsId, general.id, 'https://docs.example.com/big')).data.message;
    expect((await unfurl(alice, wsId, general.id, big.seq)).data.unfurl).toBeNull(); // title lies past the cap
    // Following a redirect to a public page works.
    const ok = (await post(alice, wsId, general.id, 'https://docs.example.com/to-notes')).data.message;
    expect((await unfurl(alice, wsId, general.id, ok.seq)).data.unfurl.title).toBe('Release notes 2.0');
    // A page in another encoding is decoded as its header, or its head, declares.
    for (const path of ['latin-header', 'latin-meta', 'latin-equiv']) {
      const m = (await post(alice, wsId, general.id, `https://docs.example.com/${path}`)).data.message;
      expect((await unfurl(alice, wsId, general.id, m.seq)).data.unfurl.title, path).toBe('Café du coin');
    }
    // A relative image and the site's name come from the page that answered, not the short link.
    const short = (await post(alice, wsId, general.id, 'https://short.example.com/r1')).data.message;
    const sr = (await unfurl(alice, wsId, general.id, short.seq)).data.unfurl;
    expect(sr).toMatchObject({ url: 'https://short.example.com/r1', title: 'Plain page', site: 'docs.example.com' });
    expect(sr.image).toMatch(/^[0-9a-f]{64}$/);
    expect(calls.at(-1)).toBe('https://docs.example.com/cover.png');
    // Direct image links preview as images.
    const photo = (await post(alice, wsId, general.id, 'https://cdn.example.com/photo.jpg')).data.message;
    const pr = await unfurl(alice, wsId, general.id, photo.seq);
    expect(pr.data.unfurl).toMatchObject({ kind: 'image', site: 'cdn.example.com' });
    expect(pr.data.unfurl.image).toMatch(/^[0-9a-f]{64}$/);
    const huge = (await post(alice, wsId, general.id, 'https://cdn.example.com/huge.png')).data.message;
    expect((await unfurl(alice, wsId, general.id, huge.seq)).data.unfurl).toBeNull();
    // The bound holds while reading, not only on the header: nothing is stored.
    for (const path of ['chunked.png', 'liar.png']) {
      const big = (await post(alice, wsId, general.id, `https://cdn.example.com/${path}`)).data.message;
      expect((await unfurl(alice, wsId, general.id, big.seq)).data.unfurl, path).toBeNull();
      expect(rt.fs._files?.has?.(`teamchat-unfurls/${await (await import('../worker/lib.js')).sha256(`https://cdn.example.com/${path}`)}`) || false).toBe(false);
    }
    // The stored thumbnail stays as long as the message points at it.
    expect(rt.kv._ttl.get(`tc:unfurlimg:${pr.data.unfurl.image}`)).toBeUndefined();
  });

  it('treats a hostile page as a failed preview, remembered once, never an error', async () => {
    const { wsId, general } = await workspaceWith(alice);
    // An entity outside Unicode is dropped; the card is still built.
    const nasty = (await post(alice, wsId, general.id, 'https://docs.example.com/nasty')).data.message;
    const r = await unfurl(alice, wsId, general.id, nasty.seq);
    expect(r.ok).toBe(true);
    expect(r.data.unfurl.title).toBe('Nasty title 😀');
    // An unparsable Location header ends the redirect chase quietly, and the failure is cached.
    const bad = (await post(alice, wsId, general.id, 'https://docs.example.com/bad-redirect')).data.message;
    expect((await unfurl(alice, wsId, general.id, bad.seq)).data).toEqual({ unfurl: null });
    const fetched = calls.length;
    const again = (await post(alice, wsId, general.id, 'https://docs.example.com/bad-redirect once more')).data.message;
    expect((await unfurl(alice, wsId, general.id, again.seq)).data).toEqual({ unfurl: null });
    expect(calls).toHaveLength(fetched);
  });

  it('never unfurls a link into the app itself, and previews the first external link beside one', async () => {
    const { wsId, general } = await workspaceWith(alice);
    // The issue's case: "Also send to #channel" appends a thread permalink; nothing is fetched for it.
    const permalink = `https://teamchat.puter.com/#/ws/${wsId}%40teamchat-x7k2q9pw1a/c/${general.id}/t/5`;
    const m = (await post(alice, wsId, general.id, `replying here too\n\n> Also sent from a thread: ${permalink}`)).data.message;
    expect((await unfurl(alice, wsId, general.id, m.seq)).data).toEqual({ unfurl: null });
    expect(calls).toHaveLength(0);
    // An external link in the same message still gets its card, and it is the one previewed.
    const both = (await post(alice, wsId, general.id, `${permalink} explains https://docs.example.com/notes`)).data.message;
    const r = await unfurl(alice, wsId, general.id, both.seq);
    expect(r.data.unfurl).toMatchObject({ url: 'https://docs.example.com/notes', title: 'Release notes 2.0' });
    expect(calls[0]).toBe('https://docs.example.com/notes');
  });

  it('never unfurls code, respects the workspace switch, rate-limits, and lets the author remove a card', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const code = (await post(alice, wsId, general.id, 'run `curl https://docs.example.com/notes` and ```\nhttps://docs.example.com/notes\n```')).data.message;
    expect((await unfurl(alice, wsId, general.id, code.seq)).data.unfurl).toBeNull();
    expect(calls).toHaveLength(0);
    // Off for the workspace: nothing fetched, and the client is told.
    await as(alice).put(`/api/ws/${wsId}`, { unfurl: false });
    expect((await as(bob).get(`/api/ws/${wsId}`)).data.workspace.unfurl).toBe(false);
    const m = (await post(alice, wsId, general.id, 'https://docs.example.com/notes')).data.message;
    expect((await unfurl(alice, wsId, general.id, m.seq)).data).toEqual({ unfurl: null, disabled: true });
    expect(calls).toHaveLength(0);
    await as(alice).put(`/api/ws/${wsId}`, { unfurl: true });
    const r = await unfurl(bob, wsId, general.id, m.seq); // any member may trigger it
    expect(r.data.unfurl.title).toBe('Release notes 2.0');
    // Remove: the author (or an admin), and it is not fetched again.
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/unfurl`)).status).toBe(403);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/unfurl`)).ok).toBe(true);
    const page = await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`);
    expect(page.data.messages.find((x) => x.seq === m.seq).unfurl).toBeNull();
    expect((await unfurl(alice, wsId, general.id, m.seq)).data.unfurl).toBeNull();
    // Rate limit per member: the budget is counted, then refused.
    for (let i = 0; i < LIMITS.unfurlsPerMember; i++) {
      const x = (await post(bob, wsId, general.id, `https://docs.example.com/p${i}`)).data.message;
      await unfurl(bob, wsId, general.id, x.seq);
    }
    const over = (await post(bob, wsId, general.id, 'https://docs.example.com/p-over')).data.message;
    expect((await unfurl(bob, wsId, general.id, over.seq)).status).toBe(429);
    expect(rt.kv._ttl.get(`tc:unfurlrate:${wsId}:${bob.uuid}`)).toBe(LIMITS.unfurlWindowSeconds);
    expect((await unfurl(alice, wsId, general.id, over.seq)).ok).toBe(true); // another member is unaffected
  });
});
