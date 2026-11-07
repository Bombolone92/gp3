/**
 * Eighteenth review pass, region C: integrations, export/import/transfer,
 * files, link previews, search, the email worker and their client-side
 * counterparts. Each test here reproduces a defect found in that pass and
 * proves the fix.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, blockIndexOf } from '../src/shared/blocks.js';
import { LIMITS } from '../src/shared/limits.js';
import { renderArchiveHtml } from '../src/lib/archive.js';

const { alice } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

describe('a bot token taking off the last reaction of its kind', () => {
  it('leaves the message showing no reaction, as a member does, and the export drawing none, rather than "thumbsup 0"', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const m = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'hello' })).data.message;
    const bot = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'B', channels: [general.id], scopes: ['react'] })).data;
    const react = (body) => as(null).post(`/bot/${bot.token}/channels/${general.id}/messages/${m.seq}/reactions`, body);
    expect((await react({ reaction: 'thumbsup', on: true })).data).toEqual({ ok: true, on: true });
    expect((await react({ reaction: 'thumbsup', on: false })).data).toEqual({ ok: true, on: false });
    // The token's name is off the record; the entry it was under stays with
    // nobody under it (a name comes off on its own, see the reaction routes),
    // and no reader is shown it (see mergeBlock).
    const block = await rt.kv.get(KEYS.block(general.id, blockIndexOf(m.seq)));
    expect(Object.keys(block.x?.[`s${m.seq}`]?.r?.thumbsup || {})).toEqual([]);
    expect((await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.find((x) => x.seq === m.seq).reactions).toEqual({});
    // What the export's readable page draws for the message: no reaction line at all.
    const exp = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
    const html = renderArchiveHtml({ header: exp.header, pages: exp.pages, files: exp.files });
    const page = Object.values(html.pages).find((p) => p.includes('hello'));
    expect(page).not.toContain('thumbsup 0');
    expect(page).not.toMatch(/<div class="r">[^<]*thumbsup/);
    // A member's reaction beside the bot's stays when the bot's goes.
    await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/reactions`, { reaction: 'eyes', on: true });
    expect((await react({ reaction: 'eyes', on: true })).data).toEqual({ ok: true, on: true });
    expect((await react({ reaction: 'eyes', on: false })).data).toEqual({ ok: true, on: false });
    const again = await rt.kv.get(KEYS.block(general.id, blockIndexOf(m.seq)));
    expect(Object.keys(again.x[`s${m.seq}`].r.eyes)).toEqual([alice.uuid]);
  });
});

describe('a rich text preformatted run holding a run of four or more backticks', () => {
  it('stays one fenced block to its end, rather than closing where the run leaves three backticks together', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const post = (code) => as(null).post(`/webhook/${hook.token}`, { blocks: [{ type: 'rich_text', elements: [
      { type: 'rich_text_section', elements: [{ type: 'text', text: 'snippet:' }] },
      { type: 'rich_text_preformatted', elements: [{ type: 'text', text: code }] },
      { type: 'rich_text_section', elements: [{ type: 'text', text: 'after' }] },
    ] }] });
    const { formatMessage } = await import('../src/lib/format.js');
    // The four-backtick fence Markdown allows, quoted in a snippet; then runs of five and six.
    for (const run of ['````', '`````', '``````']) {
      const res = await post(`see:\n${run}md\nfour\n${run}\nend`);
      expect(res.status).toBe(200);
      const text = res.data.text;
      // Nowhere in the stored text do three backticks stand together but the two fences.
      expect((text.match(/```/g) || []).length).toBe(2);
      expect(text.startsWith('snippet:\n```\n') && text.endsWith('\n```\nafter')).toBe(true);
      // Drawn: one code block, holding the whole snippet, the run's backticks all there, and "after" outside it.
      const html = formatMessage(text);
      expect((html.match(/<pre class="code-block">/g) || []).length).toBe(1);
      const body = /<pre class="code-block"><code>([\s\S]*?)<\/code><\/pre>/.exec(html)[1];
      expect(body.replace(/\u200b/g, '')).toBe(`see:\n${run}md\nfour\n${run}\nend`);
      expect(html).toMatch(/<\/pre>(<br>)?after$/);
    }
    // A plain triple is broken as it was.
    const triple = await post('echo ```oops```\nnext');
    expect(triple.data.text).toBe('snippet:\n```\necho `\u200b``oops`\u200b``\nnext\n```\nafter');
  });
});

describe('a webhook text with one fence the writer left open', () => {
  it('posts as written, the backticks drawn as such, as a member\u2019s message would; a fence the clamp opened is still closed', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const post = (body) => as(null).post(`/webhook/${hook.token}`, body);
    const { formatMessage } = await import('../src/lib/format.js');
    const lone = await post({ text: 'Use ``` to open a code block' });
    expect([lone.status, lone.data.text]).toEqual([200, 'Use ``` to open a code block']);
    expect(formatMessage(lone.data.text)).toBe('Use ``` to open a code block');
    // The same in an attachment's text, and in a section's.
    const att = await post({ attachments: [{ text: 'Type ``` first' }] });
    expect(att.data.text).toBe('Type ``` first');
    const sect = await post({ blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Type ``` first' } }] });
    expect(sect.data.text).toBe('Type ``` first');
    // A block the clamp cut through is closed, as before.
    const long = await post({ text: `log:\n\`\`\`\n${'x'.repeat(3000)}\n${'y'.repeat(3000)}\n\`\`\`` });
    expect(long.data.text.length).toBeLessThanOrEqual(4000);
    expect((long.data.text.match(/```/g) || []).length).toBe(2);
    expect(long.data.text.endsWith('\n```')).toBe(true);
    // A writer's lone fence past the clamp is cut off with the rest, and nothing is closed.
    const past = await post({ text: `${'z'.repeat(3990)} and then \`\`\` open` });
    expect((past.data.text.match(/```/g) || []).length).toBe(0);
  });

  it('closes a block the clamp cut through even when a lone fence of the writer’s stood past the cut, and leaves the writer’s own open fence alone when nothing was cut past it', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const post = (body) => as(null).post(`/webhook/${hook.token}`, body);
    const { formatMessage } = await import('../src/lib/format.js');
    // A block of 4500 characters, then a lone fence: three fences in all, the cut inside the block.
    const cut = await post({ text: `\`\`\`\n${'x'.repeat(4500)}\n\`\`\`\nsee \`\`\` here` });
    expect(cut.status).toBe(200);
    expect(cut.data.text.length).toBeLessThanOrEqual(4000);
    expect((cut.data.text.match(/```/g) || []).length).toBe(2);
    expect(cut.data.text.endsWith('\n```')).toBe(true);
    expect(formatMessage(cut.data.text)).toMatch(/^<pre class="code-block"><code>x+<\/code><\/pre>$/);
    // The writer's own open fence within the kept text, with only plain words cut off past it: nothing is closed.
    const own = await post({ text: `open \`\`\` here ${'w'.repeat(4500)}` });
    expect((own.data.text.match(/```/g) || []).length).toBe(1);
    expect(own.data.text.startsWith('open ``` here w')).toBe(true);
    expect(formatMessage(own.data.text)).not.toContain('<pre');
  });
});

describe('webhook escapes and link markup inside a rich text block', () => {
  it('are read as written, since rich text carries plain words, while a section’s, a context’s and an attachment’s markup is still read as incoming-webhook markup', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const post = (body) => as(null).post(`/webhook/${hook.token}`, body);
    const code = 'if (a &lt; b &amp;&amp; c &gt; d) { echo "<https://x.io|y>"; }';
    const rich = await post({ blocks: [{ type: 'rich_text', elements: [
      { type: 'rich_text_section', elements: [{ type: 'text', text: 'Tom &amp; Jerry <b>x</b> <!channel> <@U1|al>' }] },
      { type: 'rich_text_preformatted', elements: [{ type: 'text', text: code }] },
    ] }] });
    expect([rich.status, rich.data.text]).toEqual([200, `Tom &amp; Jerry <b>x</b> <!channel> <@U1|al>\n\`\`\`\n${code}\n\`\`\``]);
    const { formatMessage } = await import('../src/lib/format.js');
    expect(formatMessage(rich.data.text)).toContain(`<code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</code>`);
    // Markdown text is incoming-webhook markup, read as before: a section, its fields, a context line, a header.
    const md = await post({ blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Tom &amp; Jerry' } },
      { type: 'section', text: { type: 'mrkdwn', text: 'see <https://x.io|the link> &lt;3' }, fields: [{ type: 'mrkdwn', text: '*A*\n&amp;' }] },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'by <@U1|alice>' }] },
    ] });
    expect([md.status, md.data.text]).toEqual([200, 'Tom & Jerry\nsee the link (https://x.io) <3\n*A*\n&\nby @alice']);
    // An attachment's own pieces are markup; a rich text block it carries is not.
    const att = await post({ attachments: [{
      pretext: 'Build <https://ci.io/1|#1> &amp; co', title: 'R&amp;D', title_link: 'https://ci.io/rd', text: 'a &lt; b', fields: [{ title: 'Took', value: '2 &amp; 3' }], footer: 'CI &amp; me',
      blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'raw &amp; kept' }] }] }, { type: 'section', text: { type: 'mrkdwn', text: 'md &amp; read' } }],
    }] });
    expect([att.status, att.data.text]).toEqual([200, ['Build #1 (https://ci.io/1) & co', 'R&D (https://ci.io/rd)', 'a < b', 'Took: 2 & 3', 'raw &amp; kept', 'md & read', 'CI & me'].join('\n')]);
    // Nothing but a fallback, with markup, reads it.
    const fb = await post({ attachments: [{ fallback: 'Deploy &amp; done' }] });
    expect(fb.data.text).toBe('Deploy & done');
  });
});

describe('a file uploaded with a content type that carries a parameter', () => {
  it('is recorded as the type before the semicolon, in lower case, and served inline as such; a type in no shape at all is still an unknown kind', async () => {
    const { wsId } = await workspaceWith(alice);
    const up = async (name, type) => {
      const form = new FormData();
      form.append('file', new File(['x'], name, { type }), name);
      return (await as(alice).post(`/api/ws/${wsId}/files`, form)).data;
    };
    const pic = await up('pic.png', 'image/png; charset=binary');
    expect(pic.type).toBe('image/png');
    const res = await as(alice).get(`/api/ws/${wsId}/files/${pic.id}`);
    expect([res.status, res.data.headers.get('content-type'), res.data.headers.get('content-disposition').split(';')[0]]).toEqual([200, 'image/png', 'inline']);
    expect((await up('notes.txt', 'text/plain;charset=utf-8')).type).toBe('text/plain');
    expect((await up('blob.bin', 'not a type')).type).toBe('application/octet-stream');
    expect((await up('blob2.bin', '')).type).toBe('application/octet-stream');
    // The bytes an import sends for an attachment take the same reading.
    const header = { format: 'teamchat-export', version: 1, workspace: { id: 'abcdef1236', name: 'Acme' }, channels: { chan000003: { name: 'general', def: true } }, members: {}, memberDocs: {} };
    const copy = (await as(alice).post('/api/workspaces/import', { header, profile: { name: 'Alice' } })).data.workspace.id;
    const form = new FormData();
    form.append('file', new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg; q=1' }), 'photo.jpg');
    form.append('id', 'abcdefgh12345678');
    form.append('name', 'photo.jpg');
    expect((await as(alice).post(`/api/ws/${copy}/import/file`, form)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.file('abcdefgh12345678'))).type).toBe('image/jpeg');
  });
});

describe('a request that times out on its way up', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });

  it('is reported as the upload taking too long when it carried a file or a page of an archive, and as the server taking too long otherwise', async () => {
    const { api, ApiError } = await import('../src/lib/api.js');
    globalThis.puter = { workers: { exec: async () => { throw new DOMException('The request timed out', 'TimeoutError'); } } };
    const said = async (p) => {
      try {
        await p;
        return 'resolved';
      } catch (e) {
        return e instanceof ApiError ? `${e.code}: ${e.message}` : `other: ${e.message}`;
      }
    };
    expect(await said(api.upload('abcdef@srv', new File(['x'], 'big.bin', { type: 'application/octet-stream' })))).toBe('timeout: The upload took too long to finish; check your connection and try again');
    expect(await said(api.importFile('abcdef@srv', 'abcdefgh12345678', new Blob(['x']), 'x.bin', null))).toBe('timeout: The upload took too long to finish; check your connection and try again');
    expect(await said(api.importPage('abcdef@srv', { conv: 'c', seq: 1, messages: [{ seq: 1, text: 'y'.repeat(300 * 1024) }] }))).toBe('timeout: The upload took too long to finish; check your connection and try again');
    expect(await said(api.health('https://srv.puter.work'))).toBe('timeout: The server took too long to answer');
    expect(await said(api.send('abcdef@srv', 'c', { text: 'hello' }))).toBe('timeout: The server took too long to answer');
  });
});

describe('a member’s link-preview budget', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('is counted per workspace: previews spent in one workspace do not refuse their first link in another on the same server', async () => {
    // Every page is out of reach: a preview is counted and then found to be nothing, so each call spends one of the budget and writes no card.
    globalThis.fetch = async () => { throw new Error('offline'); };
    const A = await workspaceWith(alice, [], 'A');
    const B = await workspaceWith(alice, [], 'B');
    const ma = (await as(alice).post(`/api/ws/${A.wsId}/conv/${A.general.id}/messages`, { text: 'see https://example.com/a' })).data.message;
    const mb = (await as(alice).post(`/api/ws/${B.wsId}/conv/${B.general.id}/messages`, { text: 'see https://example.com/b' })).data.message;
    const ask = (w, m) => as(alice).post(`/api/ws/${w.wsId}/conv/${w.general.id}/messages/${m.seq}/unfurl`);
    for (let i = 0; i < LIMITS.unfurlsPerMember; i++) expect((await ask(A, ma)).status).toBe(200);
    expect((await ask(A, ma)).status).toBe(429);
    // Her budget in B is her own.
    const b = await ask(B, mb);
    expect([b.status, b.data]).toEqual([200, { unfurl: null }]);
    // Counted under the workspace and the member, for the window; the workspace's own budget is counted as before (the call refused on the member's budget is not counted on the workspace's).
    expect(rt.kv._ttl.get(`tc:unfurlrate:${A.wsId}:${alice.uuid}`)).toBe(LIMITS.unfurlWindowSeconds);
    expect(rt.kv._ttl.get(`tc:unfurlrate:${B.wsId}:${alice.uuid}`)).toBe(LIMITS.unfurlWindowSeconds);
    expect(await rt.kv.get(`tc:unfurlrate:ws:${A.wsId}`)).toBe(LIMITS.unfurlsPerMember);
    expect(await rt.kv.get(`tc:unfurlrate:ws:${B.wsId}`)).toBe(1);
    expect([...rt.kv._map().keys()].some((k) => k === `tc:unfurlrate:${alice.uuid}`)).toBe(false);
  });
});
