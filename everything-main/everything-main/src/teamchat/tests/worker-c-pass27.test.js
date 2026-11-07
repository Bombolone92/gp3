/**
 * Twenty-seventh review pass, region C: export/import/transfer, link
 * previews, files, search, the email worker and their client-side halves.
 * Each test here reproduces a defect found in that pass and proves the fix.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { attachmentUrl, clearAttachmentCache } from '../src/lib/files.js';
import { parseHead } from '../worker/unfurl.js';
import { appendPostings } from '../worker/search.js';
import { encodePosting } from '../src/shared/search.js';
import { KEYS } from '../src/shared/blocks.js';
import { VALUE_BYTES_MAX } from '../dev/worker-runtime.js';
import { renderArchiveHtml } from '../src/lib/archive.js';

const { alice, bob } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

describe('the readable pages an export writes into the drive', () => {
  it('escape every piece of what members wrote for its place: no tag, no handler, no script and no javascript: link comes through live', async () => {
    // Hostile text in every field the pages draw: the workspace's name, a
    // member's display name (drawn as a mention chip and in the People
    // list), messages (a tag, an attribute breakout, a javascript: address,
    // a closing script tag, a fence trying to close the code block, an
    // address followed by a quote), a file's name (link text and href), a
    // webhook's name, a direct message's title, a thread's page.
    const { wsId, general } = await workspaceWith(alice, [bob], '<svg onload=alert(1)> Acme');
    expect((await as(bob).put('/api/me', { name: '<img src=x onerror=alert(1)>' })).status).toBe(200);
    const post = async (conv, body) => {
      const res = await as(alice).post(`/api/ws/${wsId}/conv/${conv}/messages`, body);
      expect(res.status).toBe(200);
      return res.data.message;
    };
    const first = await post(general.id, { text: '<img src=x onerror=alert(1)> "onmouseover=alert(2) javascript:alert(3) </script><script>alert(4)</script> @bob' });
    await post(general.id, { text: 'see https://example.com/x"onmouseover="alert(5) and https://example.com/y?a=1&b=2 then <a href="javascript:alert(9)">here</a>' });
    await post(general.id, { text: '```html\n</pre></code><script>alert(6)</script>\n```' });
    await post(`${general.id}_t${first.seq}`, { text: 'reply </div><img src=x onerror=alert(10)>' });
    const fd = new FormData();
    const fileName = '"><img src=x onerror=alert(7)>.png';
    fd.append('file', new File([new Uint8Array([1, 2, 3])], fileName, { type: 'image/png' }), fileName);
    const up = (await as(alice).post(`/api/ws/${wsId}/files`, fd)).data;
    await post(general.id, { text: 'a picture', attachments: [{ id: up.id }] });
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { name: '<b onmouseover=alert(8)>Deploys', channel: general.id })).data;
    const posted = await rt.dispatch(`https://teamchat-api.test/webhook/${hook.token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'built <i onload=alert(11)>' }) }, null);
    expect(posted.status).toBe(200);
    const dm = (await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).data;
    const dmId = dm.id || dm.conv || dm.dm?.id;
    expect(typeof dmId).toBe('string');
    await post(dmId, { text: 'private <script>alert(12)</script>' });

    // The archive as the export answers it (one page here), rendered as the dialog renders it.
    const res = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
    expect(res.done).toBe(true);
    const html = renderArchiveHtml({ header: res.header, pages: res.pages, files: res.files });
    const all = [html.index, ...Object.values(html.pages)].join('\n');
    expect(Object.keys(html.pages).length).toBeGreaterThanOrEqual(3); // general, its thread, the direct message
    // Nothing a member wrote stands as markup: no image, no svg, no script
    // (the pages carry none of their own), no tag with an event handler.
    expect(all).not.toMatch(/<img[\s>]/i);
    expect(all).not.toMatch(/<svg[\s>]/i);
    expect(all).not.toMatch(/<\/?script/i);
    expect(all).not.toMatch(/<[^>]*\son\w+\s*=/i);
    // Every link leads to a page of the archive, a file of it, a place on
    // the page, or an http(s) address; never to a scheme the browser runs.
    const hrefs = [...all.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(5);
    for (const h of hrefs) expect(h).toMatch(/^(#m\d+$|\.\.\/index\.html$|\.\.\/files\/[a-z0-9]+-|channels\/[a-z0-9_]+\.html$|[a-z0-9_]+\.html$|https?:\/\/)/);
    expect(all).not.toMatch(/href="\s*(javascript|data|vbscript):/i);
    // What was written is there to read, as text.
    expect(all).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(all).toContain('&lt;/script&gt;&lt;script&gt;alert(4)&lt;/script&gt;');
    expect(all).toContain('&lt;/pre&gt;&lt;/code&gt;&lt;script&gt;alert(6)&lt;/script&gt;');
    expect(all).toContain('&quot;&gt;&lt;img src=x onerror=alert(7)&gt;.png');
    expect(all).toContain('&lt;b onmouseover=alert(8)&gt;Deploys');
    expect(html.index).toMatch(/<title>&lt;svg onload=alert\(1\)&gt; Acme<\/title>/);
    // The address ends at the quote, as the app draws it; the quote and the handler after it are text.
    expect(all).toContain('href="https://example.com/x"');
    expect(all).toContain('href="https://example.com/y?a=1&amp;b=2"');
  });
});

describe('a month\'s search shard holding more distinct words than one document takes', () => {
  it('lets go of the words whose newest posting is oldest and takes the new ones, rather than losing every write to it for the rest of the month', async () => {
    rt = await boot({ strictSize: true });
    const key = KEYS.searchBucket('wsshardfull', '202609', 7);
    const base = 1_700_000_000_000;
    // A shard within a few kilobytes of the store's ceiling: thousands of
    // words each posted once (a month of long messages in many words), which
    // the per-word cap on postings cannot shorten. Sized as it is built, so
    // the build is not quadratic.
    const doc = {};
    let size = 2;
    for (let i = 0; size < VALUE_BYTES_MAX - 2 * 1024; i++) {
      const word = `word${String(i).padStart(6, '0')}`;
      doc[word] = [encodePosting('chanshard01', i + 1, base + i * 60_000)];
      size += JSON.stringify(word).length + 1 + JSON.stringify(doc[word]).length + (i ? 1 : 0);
    }
    await rt.kv.set(key, doc);
    const words = Object.keys(doc);
    const oldest = words.slice(0, 10);
    const newest = words.slice(-10);
    // One message's worth of new words: more than the room left.
    const fresh = {};
    for (let k = 0; k < 200; k++) fresh[`fresh${String(k).padStart(4, '0')}`] = [encodePosting('chanshard01', 900_000 + k, base + (words.length + k) * 60_000)];
    // Used to throw: the append refused past the ceiling, and the rewrite
    // after it refused the same way, so the message's words never landed.
    await appendPostings(key, fresh);
    const after = await rt.kv.get(key);
    expect(JSON.stringify(after).length).toBeLessThanOrEqual(VALUE_BYTES_MAX);
    for (const t of Object.keys(fresh)) expect(after[t]).toEqual(fresh[t]);
    for (const t of newest) expect(after[t]).toEqual(doc[t]);
    for (const t of oldest) expect(after).not.toHaveProperty(t);
  });
});

/** A lone surrogate: half of a character, which no encoder takes. */
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('a page title, description or site name cut at the card\'s length', () => {
  const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'; // eleven UTF-16 units, one character
  const html = (title, desc, site) => `<html><head><title>${title}</title><meta name="description" content="${desc}"><meta property="og:site_name" content="${site}"></head></html>`;

  it('is cut between whole characters: no half of an emoji, a flag or a family is left at the end', () => {
    // Cut by the count alone, the two-hundredth unit fell inside the emoji
    // and the card ended in a lone surrogate, drawn as a blank glyph.
    const meta = parseHead(html(`${'a'.repeat(199)}\u{1F600}`, `${'b'.repeat(399)}\u{1F1EB}\u{1F1F7}`, `${'c'.repeat(79)}${family}`), 'https://example.com/');
    expect(meta.title).toBe('a'.repeat(199));
    expect(meta.desc).toBe('b'.repeat(399));
    expect(meta.site).toBe('c'.repeat(79));
    expect(LONE.test(meta.title + meta.desc + meta.site)).toBe(false);
    // One that fits keeps its last character whole, as before.
    expect(parseHead(html(`${'a'.repeat(189)}${family}`, 'd', 'e'), 'https://example.com/').title).toBe(`${'a'.repeat(189)}${family}`);
  });
});

describe('a file name cut at its length', () => {
  const upload = async (wsId, name) => {
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([1, 2, 3])], name, { type: 'text/plain' }), name);
    const res = await as(alice).post(`/api/ws/${wsId}/files`, fd);
    expect(res.status).toBe(200);
    return res.data.name;
  };

  it('is cut between whole characters: a flag or a keycap at the cut goes whole rather than staying as a boxed letter or a bare digit', async () => {
    const { wsId } = await workspaceWith(alice);
    // A flag is two regional indicators (four units): cut by the count, one
    // indicator stayed and drew as a boxed letter F; a keycap (a digit, a
    // presentation selector and the combining keycap) lost its keycap and
    // drew as a bare digit; half of an emoji was a lone surrogate.
    expect(await upload(wsId, `${'x'.repeat(118)}\u{1F1EB}\u{1F1F7}`)).toBe('x'.repeat(118));
    expect(await upload(wsId, `${'x'.repeat(118)}1️⃣`)).toBe('x'.repeat(118));
    expect(await upload(wsId, `${'x'.repeat(119)}\u{1F600}`)).toBe('x'.repeat(119));
    // A name that fits keeps its last character whole, as before.
    expect(await upload(wsId, `${'x'.repeat(116)}\u{1F1EB}\u{1F1F7}`)).toBe(`${'x'.repeat(116)}\u{1F1EB}\u{1F1F7}`);
  });
});

describe('an archive attachment declared larger than files may be', () => {
  const headerFor = (wsId, ch) => ({
    format: 'teamchat-export', version: 1, workspace: { id: wsId, name: 'Acme' },
    channels: { [ch]: { id: ch, name: 'general', def: true } },
    members: { [alice.uuid]: { username: 'alice', name: 'Alice', role: 'owner' }, [bob.uuid]: { username: 'bob', name: 'Bob', role: 'member' } },
    memberDocs: { [alice.uuid]: { channels: [ch] }, [bob.uuid]: { channels: [ch] } },
  });
  const formSpy = () => {
    const orig = Request.prototype.formData;
    let calls = 0;
    Request.prototype.formData = function spied() {
      calls++;
      return orig.call(this);
    };
    return { count: () => calls, restore: () => { Request.prototype.formData = orig; } };
  };

  it('is refused before its body is read, with the words an upload is refused with; one within the cap goes through as before', async () => {
    const wsId = 'wsimpsize01';
    const ch = 'chimpsize01';
    expect((await as(alice).post('/api/workspaces/import', { header: headerFor(wsId, ch), profile: { name: 'Alice' } })).status).toBe(200);
    const fd = () => {
      const f = new FormData();
      f.set('file', new Blob(['hello'], { type: 'text/plain' }), 'hello.txt');
      f.set('id', 'fileimpsz01');
      f.set('name', 'hello.txt');
      return f;
    };
    // The request built by hand, so it carries a declared length of the test's choosing.
    const send = async (bytes) => {
      const req = new Request(`https://teamchat-api.test/api/ws/${wsId}/import/file`, { method: 'POST', body: fd(), headers: bytes == null ? {} : { 'content-length': String(bytes) } });
      const res = await rt.dispatch(req, {}, alice);
      return { status: res.status, data: await res.json() };
    };
    const spy = formSpy();
    try {
      const big = await send(11 * 1024 * 1024);
      expect(big.status).toBe(413);
      expect(big.data).toMatchObject({ code: 'too_large', message: 'Files can be up to 10 MB' });
      // Refused by its declared length alone: the body was never parsed (it used to be buffered whole and then measured).
      expect(spy.count()).toBe(0);
      // A length within the cap and the multipart margin, or none at all, is read as before.
      expect((await send(10 * 1024 * 1024 + 1000)).status).toBe(200);
      expect((await send(null)).status).toBe(200);
      expect(spy.count()).toBe(2);
    } finally {
      spy.restore();
    }
  });
});

describe('a video attachment asked for with a Range header', () => {
  it('is answered whole with a 200 and no Content-Range, never a broken 206: the app plays it from the blob it fetched, and seeking asks the worker for nothing', async () => {
    const { wsId } = await workspaceWith(alice);
    const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
    const fd = new FormData();
    fd.append('file', new File([bytes], 'clip.mp4', { type: 'video/mp4' }), 'clip.mp4');
    const up = (await as(alice).post(`/api/ws/${wsId}/files`, fd)).data;
    for (const range of ['bytes=0-1', 'bytes=4-', 'bytes=-3']) {
      const res = await rt.dispatch(new Request(`https://teamchat-api.test/api/ws/${wsId}/files/${up.id}`, { headers: { range } }), {}, alice);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-range')).toBeNull();
      expect(res.headers.get('accept-ranges')).toBeNull();
      expect(res.headers.get('content-type')).toBe('video/mp4');
      expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    }
  });
});

describe('an SVG attachment drawn in a message', () => {
  const realPuter = globalThis.puter;
  afterEach(() => {
    clearAttachmentCache();
    globalThis.puter = realPuter;
  });

  it('is drawn from a data: URL and never from an object URL of the app\'s origin; every other picture keeps its object URL', async () => {
    // An object URL carries the app's origin, and an SVG opened on its own
    // (the browser's "Open image in new tab" on the <img> that draws it) is
    // a document whose scripts run there. The app's own open-in-tab keeps
    // SVGs out (canOpenInTab), but the browser's menu did not.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>';
    globalThis.puter = { workers: { exec: async (url) => {
      if (String(url).endsWith('/files/svg0000001')) return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
      if (String(url).endsWith('/files/png0000001')) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    } } };
    const ref = 'abcdef1234@teamchat-x';
    const url = await attachmentUrl(ref, 'svg0000001');
    const lead = 'data:image/svg+xml;base64,';
    expect(url.startsWith(lead)).toBe(true);
    expect(atob(url.slice(lead.length))).toBe(svg);
    // The same picture is the same URL for the life of the tab, as before.
    expect(await attachmentUrl(ref, 'svg0000001')).toBe(url);
    // A raster picture is inert wherever it is opened, and keeps the cheap object URL.
    expect((await attachmentUrl(ref, 'png0000001')).startsWith('blob:')).toBe(true);
    // Forgetting the cache revokes what can be revoked and passes over the rest.
    expect(() => clearAttachmentCache()).not.toThrow();
  });
});
