/**
 * Seventeenth review pass, region C: integrations, export/import/transfer,
 * files, link previews, search, the email worker and their client-side
 * counterparts. Each test here reproduces a defect found in that pass and
 * proves the fix.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import { importArchive } from '../src/lib/archive.js';

const { alice } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

describe('a rich text blocks payload with a preformatted run', () => {
  it('keeps the indentation of its code as written, in a fenced block the app draws as code', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const post = (blocks) => as(null).post(`/webhook/${hook.token}`, { blocks });
    const code = 'def f():\n    if x:\n        return 1';
    const pre = await post([{ type: 'rich_text', elements: [
      { type: 'rich_text_section', elements: [{ type: 'text', text: 'Traceback:' }] },
      { type: 'rich_text_preformatted', elements: [{ type: 'text', text: code }] },
    ] }]);
    expect([pre.status, pre.data.text]).toEqual([200, `Traceback:\n\`\`\`\n${code}\n\`\`\``]);
    // A run the worker cannot read still leaves one space where it stood, and none at the ends of a plain line.
    const gappy = await post([{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [
      { type: 'date', timestamp: 1 }, { type: 'text', text: ' due ' }, { type: 'color', value: '#ff0000' }, { type: 'text', text: ' soon ' }, { type: 'date', timestamp: 2 },
    ] }] }]);
    expect([gappy.status, gappy.data.text]).toEqual([200, 'due soon']);
  });
});

describe('rich text blocks posted in the marks the app draws', () => {
  const hook = async () => {
    const { wsId, general } = await workspaceWith(alice);
    const h = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    return { post: (blocks) => as(null).post(`/webhook/${h.token}`, { blocks }), wsId, general };
  };
  const rich = (...elements) => [{ type: 'rich_text', elements }];
  const section = (...elements) => ({ type: 'rich_text_section', elements });
  const text = (t, style = undefined) => ({ type: 'text', text: t, ...(style ? { style } : {}) });

  it('draws a preformatted run as a fenced block: the app reads a fence, a fence inside the code cannot close it, and a first line that looks like a language hint is set off', async () => {
    const { post } = await hook();
    const inner = await post(rich({ type: 'rich_text_preformatted', elements: [text('echo ```oops```\nnext')] }));
    expect([inner.status, inner.data.text]).toEqual([200, '```\necho `\u200b``oops`\u200b``\nnext\n```']);
    // The app would hide "import" as the block's language: a blank line keeps it as code (the app takes the blank line off).
    const hint = await post(rich({ type: 'rich_text_preformatted', elements: [text('import os\nprint(1)')] }));
    expect([hint.status, hint.data.text]).toEqual([200, '```\nimport os\nprint(1)\n```']);
    const word = await post(rich({ type: 'rich_text_preformatted', elements: [text('error\n  at foo')] }));
    expect([word.status, word.data.text]).toEqual([200, '```\n\nerror\n  at foo\n```']);
    const { formatMessage } = await import('../src/lib/format.js');
    expect(formatMessage(word.data.text)).toBe('<pre class="code-block"><code>error\n  at foo</code></pre>');
    // Whitespace alone is no code.
    const blank = await post(rich(section(text('note')), { type: 'rich_text_preformatted', elements: [text('  \n ')] }));
    expect([blank.status, blank.data.text]).toEqual([200, 'note']);
  });

  it('closes a fenced block the message clamp cut open, rather than leaving the rest of the channel drawn as code', async () => {
    const { post } = await hook();
    const long = await post(rich(section(text('log:')), { type: 'rich_text_preformatted', elements: [text(`${'x'.repeat(3000)}\n${'y'.repeat(3000)}`)] }));
    expect(long.status).toBe(200);
    expect(long.data.text.length).toBeLessThanOrEqual(4000);
    expect((long.data.text.match(/```/g) || []).length).toBe(2);
    expect(long.data.text.endsWith('\n```')).toBe(true);
    const { formatMessage } = await import('../src/lib/format.js');
    expect(formatMessage(long.data.text)).toMatch(/^log:<br><pre class="code-block"><code>x+\ny+<\/code><\/pre>$/);
    // A clamp that took the opening fence with it leaves a plain message.
    const late = await post(rich(section(text('x'.repeat(3998))), { type: 'rich_text_preformatted', elements: [text('code here')] }));
    expect([late.status, (late.data.text.match(/```/g) || []).length]).toEqual([200, 0]);
  });

  it('draws a quote with the app’s arrows, every line of it', async () => {
    const { post } = await hook();
    const quoted = await post(rich(section(text('They said:')), { type: 'rich_text_quote', elements: [text('first line\nsecond '), { type: 'link', url: 'https://x.io/q', text: 'source' }] }, section(text('and that was that'))));
    expect([quoted.status, quoted.data.text]).toEqual([200, 'They said:\n> first line\n> second source (https://x.io/q)\nand that was that']);
    const { formatMessage } = await import('../src/lib/format.js');
    expect(formatMessage(quoted.data.text)).toContain('<blockquote class="quote">first line<br>second source (<a href="https://x.io/q"');
  });

  it('draws a list one item to a line, dashed or numbered, nested lists indented so they stay readable where the body collapses spaces', async () => {
    const { post } = await hook();
    const list = await post(rich(
      section(text('Todo:')),
      { type: 'rich_text_list', style: 'bullet', elements: [section(text('one')), section(text('two\nstill two'))] },
      { type: 'rich_text_list', style: 'bullet', indent: 1, elements: [section(text('two point one'))] },
      { type: 'rich_text_list', style: 'ordered', elements: [section(text('first')), section(text('second'), text(' and ', { bold: true }), text('more'))] },
      { type: 'rich_text_list', style: 'ordered', indent: 2, elements: [section(text('deep'))] },
    ));
    // Indentation in no-break spaces: the message body collapses ordinary ones.
    const nb = '\u00a0\u00a0';
    expect([list.status, list.data.text]).toEqual([200, [
      'Todo:', '- one', '- two', `${nb}still two`, `${nb}- two point one`, '1. first', '2. second and more', `${nb}${nb}1. deep`,
    ].join('\n')]);
  });

  it('draws styled runs in the app’s marks where they would draw, and leaves them plain where they would not', async () => {
    const { post } = await hook();
    const styled = await post(rich(section(
      text('Release '), text('v42', { bold: true }), text(' is '), text('out', { italic: true }), text(', '), text('old', { strike: true }), text(' and '), text('npm ci', { code: true }),
      text(' by '), { type: 'user', user_id: 'U1', style: { bold: true } }, text(' '), text('now', { bold: true, italic: true }),
    )));
    expect([styled.status, styled.data.text]).toEqual([200, 'Release **v42** is _out_, ~old~ and `npm ci` by @U1 **_now_**']);
    // Where the mark would not draw, the words stay plain: a space at the run's end, the mark's own character inside, an italic inside a word, a line break.
    const plain = await post(rich(section(
      text('a'), text(' b', { bold: true }), text(' c*d', { bold: true }), text(' re'), text('ally', { italic: true }), text(' '), text('x_y', { italic: true }), text(' '), text('two\nlines', { bold: true }), text(' '), text('a`b', { code: true }),
    )));
    expect([plain.status, plain.data.text]).toEqual([200, 'a b c*d really x_y two\nlines a`b']);
    const { formatMessage } = await import('../src/lib/format.js');
    expect(formatMessage(styled.data.text)).toBe('Release <strong>v42</strong> is <em>out</em>, <s>old</s> and <code class="code-inline">npm ci</code> by @U1 <strong><em>now</em></strong>');
  });
});

describe('a link with words in a rich text run', () => {
  it('posts its address beside the words, as the same link in a payload’s text does, rather than the words alone', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const post = (body) => as(null).post(`/webhook/${hook.token}`, body);
    const rich = await post({ blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [
      { type: 'text', text: 'See ' }, { type: 'link', url: 'https://example.com/diff', text: 'the diff' }, { type: 'text', text: ' and ' },
      { type: 'link', url: 'https://example.com/notes' }, { type: 'text', text: ' or ' }, { type: 'link', url: 'https://example.com/x', text: 'https://example.com/x' },
    ] }] }] });
    expect([rich.status, rich.data.text]).toEqual([200, 'See the diff (https://example.com/diff) and https://example.com/notes or https://example.com/x']);
    // The same link in a payload's text has always read so.
    const text = await post({ text: 'See <https://example.com/diff|the diff> and <https://example.com/notes>' });
    expect([text.status, text.data.text]).toEqual([200, 'See the diff (https://example.com/diff) and https://example.com/notes']);
  });
});

describe('a section block whose message is in its fields', () => {
  it('posts the fields, one to a line after the section’s text, rather than dropping them or refusing a payload made of them', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const post = (blocks) => as(null).post(`/webhook/${hook.token}`, { blocks });
    // The shape a deploy notice takes in Block Kit: a section of fields, two columns of small facts.
    const fieldsOnly = await post([{ type: 'section', fields: [
      { type: 'mrkdwn', text: '*Environment*\nproduction' }, { type: 'mrkdwn', text: '*Version*\nv42' }, { type: 'plain_text', text: 'by alice' }, { type: 'image', image_url: 'https://x/y.png' },
    ] }]);
    expect([fieldsOnly.status, fieldsOnly.data.text]).toEqual([200, '*Environment*\nproduction\n*Version*\nv42\nby alice']);
    // With a text of its own, the section's text comes first and the fields follow it.
    const both = await post([{ type: 'section', text: { type: 'mrkdwn', text: 'Deploy finished' }, fields: [{ type: 'mrkdwn', text: '*Took*\n2m' }] }]);
    expect([both.status, both.data.text]).toEqual([200, 'Deploy finished\n*Took*\n2m']);
  });
});

describe('a webhook payload in the legacy attachments shape', () => {
  it('posts each attachment whole: pretext, title with its link, text, fields, footer, its markup read as the payload writes it; the fallback only when nothing else says anything', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const post = (body) => as(null).post(`/webhook/${hook.token}`, body);
    // The shape a build server or a monitoring tool has sent for a decade: no text beside the attachments at all.
    const full = await post({ attachments: [{
      fallback: 'Build 42 failed on main', color: 'danger', pretext: 'A build <https://ci.example.com|finished>', author_name: 'CI',
      title: 'Build #42 failed', title_link: 'https://ci.example.com/builds/42', text: 'Tests: 3 failed &amp; 2 skipped',
      fields: [{ title: 'Branch', value: 'main', short: true }, { title: 'Took', value: '2m 10s', short: true }, { value: 'no title' }, { title: 'no value' }, { title: {}, value: 5 }],
      footer: 'CI · <!date^1700000000^{date_short}|Nov 14>', ts: 1700000000,
    }] });
    expect([full.status, full.data.text]).toEqual([200, [
      'A build finished (https://ci.example.com)',
      'Build #42 failed (https://ci.example.com/builds/42)',
      'Tests: 3 failed & 2 skipped',
      'Branch: main',
      'Took: 2m 10s',
      'no title',
      'no value',
      'CI · Nov 14',
    ].join('\n')]);
    // Two attachments follow one another; a title whose link is not a web address, or is the title itself, stands alone; the fallback is not repeated beside what says something.
    const two = await post({ text: '', attachments: [{ title: 'One', title_link: 'javascript:alert(1)', text: 'first' }, { fallback: 'ignored', title: 'https://x.io/two', title_link: 'https://x.io/two' }] });
    expect([two.status, two.data.text]).toEqual([200, 'One\nfirst\nhttps://x.io/two']);
    // Nothing but the fallback: the fallback. Nothing at all: refused as before.
    const only = await post({ attachments: [{ fallback: 'Deploy done', color: 'good', fields: [] }] });
    expect([only.status, only.data.text]).toEqual([200, 'Deploy done']);
    const nothing = await post({ attachments: [{ color: 'good' }, null, 'x'] });
    expect([nothing.status, nothing.data.code]).toEqual([400, 'invalid']);
    // An attachment carrying blocks (the shape that keeps the colour bar) posts what they say.
    const blocks = await post({ attachments: [{ color: '#36a64f', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*prod* is on v42' } }, { type: 'context', elements: [{ type: 'mrkdwn', text: 'by alice' }] }] }] });
    expect([blocks.status, blocks.data.text]).toEqual([200, '*prod* is on v42\nby alice']);
    // The text keeps its lines; the whole stays within a message's length.
    const long = await post({ attachments: [{ text: 'x'.repeat(5000) }] });
    expect([long.status, long.data.text.length]).toEqual([200, 4000]);
  });
});

describe('a user group in a webhook payload’s text', () => {
  it('posts as its handle, or as @group without one, rather than as the markup the payload wrote it in', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const post = (text) => as(null).post(`/webhook/${hook.token}`, { text });
    const named = await post('paging <!subteam^S02ABCDEF|@backend> and <!subteam^S02XYZ> about <#C1|general>');
    expect([named.status, named.data.text]).toEqual([200, 'paging @backend and @group about #general']);
  });
});

describe('a bot token’s reaction that changes nothing', () => {
  it('leaves the conversation’s stamp where it was, as a member’s repeated tap does; a change still moves it', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const m = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'hello' })).data.message;
    const bot = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'B', channels: [general.id], scopes: ['react'] })).data;
    const react = (body) => as(null).post(`/bot/${bot.token}/channels/${general.id}/messages/${m.seq}/reactions`, body);
    const stamp = async () => (await rt.kv.get(KEYS.activity(wsId))).c?.[general.id]?.x || 0;
    // Nothing to take off yet: no change, no stamp.
    const before = await stamp();
    await new Promise((r) => setTimeout(r, 2));
    expect((await react({ reaction: 'thumbsup', on: false })).data).toEqual({ ok: true, on: false });
    expect(await stamp()).toBe(before);
    // Put on: a change, stamped.
    expect((await react({ reaction: 'thumbsup', on: true })).data).toEqual({ ok: true, on: true });
    const after = await stamp();
    expect(after).toBeGreaterThan(before);
    // Put on again (a retry, a tab behind): nothing changes, and every open window is not made to re-read for it.
    await new Promise((r) => setTimeout(r, 2));
    expect((await react({ reaction: 'thumbsup', on: true })).data).toEqual({ ok: true, on: true });
    expect(await stamp()).toBe(after);
    // Taken off: a change again.
    expect((await react({ reaction: 'thumbsup', on: false })).data).toEqual({ ok: true, on: false });
    expect(await stamp()).toBeGreaterThan(after);
  });
});

describe('one archive imported twice in the same instant', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });

  it('makes two copies, each whole, rather than one written by both and then taken down by the one that lost', async () => {
    const header = { format: 'teamchat-export', version: 1, workspace: { id: 'abcdef1234', name: 'Acme' }, channels: { chan000001: { name: 'general', def: true } }, members: { [alice.uuid]: { username: 'alice', name: 'Alice', role: 'owner' } }, memberDocs: { [alice.uuid]: { channels: ['chan000001'] } } };
    const pages = Array.from({ length: 3 }, (_, i) => ({ conv: 'chan000001', seq: 3, from: 0, messages: [{ seq: i + 1, user: alice.uuid, text: `m${i + 1}`, ts: i + 1 }] }));
    globalThis.puter = { workers: { exec: async (url, init = {}) => rt.dispatch(url, init, alice) } };
    const refs = await Promise.all([0, 1].map(() => importArchive('https://teamchat-new.puter.work', { header, pages, files: [] }, { profile: { name: 'Alice' } })));
    const ids = refs.map((r) => r.split('@')[0]);
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) {
      const ws = await rt.kv.get(KEYS.ws(id));
      expect(ws).toBeTruthy();
      expect(ws.importing).toBeUndefined();
      const read = await as(alice).get(`/api/ws/${id}/conv/chan000001/messages`);
      expect(read.data.messages.map((m) => m.text)).toEqual(['m1', 'm2', 'm3']);
    }
    // The archive's own id went to one of them.
    expect(ids).toContain('abcdef1234');
  });
});

describe('a guest downloading a file they uploaded themselves', () => {
  it('is served it whatever conversations it is shared in now, as they may attach it anywhere; another guest is judged by the sharing as before', async () => {
    const { wsId, general } = await workspaceWith(alice, [USERS.bob]);
    // A private channel with a guest invite: carol and dave join it as guests.
    const priv = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'clients', private: true })).data.channel;
    const inv = (await as(alice).post(`/api/ws/${wsId}/channels/${priv.id}/invites`, {})).data;
    for (const g of [USERS.carol, USERS.dave]) expect((await as(g).post('/api/join', { code: inv.code })).ok).toBe(true);
    const form = new FormData();
    form.append('file', new File(['brief'], 'brief.txt', { type: 'text/plain' }));
    const up = (await as(USERS.carol).post(`/api/ws/${wsId}/files`, form)).data;
    // Carol shares it in the channel; alice forwards it into #general, which the guests cannot read; carol's message is then deleted.
    const m = (await as(USERS.carol).post(`/api/ws/${wsId}/conv/${priv.id}/messages`, { text: 'the brief', attachments: [{ id: up.id }] })).data.message;
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'fwd', attachments: [{ id: up.id }] })).ok).toBe(true);
    expect((await as(USERS.carol).del(`/api/ws/${wsId}/conv/${priv.id}/messages/${m.seq}`)).ok).toBe(true);
    // The file is now shared only where the guests cannot read. Its uploader may still download it (and could attach it again); another guest may not.
    expect((await as(USERS.carol).get(`/api/ws/${wsId}/files/${up.id}`)).status).toBe(200);
    const again = (await as(USERS.carol).post(`/api/ws/${wsId}/conv/${priv.id}/messages`, { text: 'again', attachments: [{ id: up.id }] })).data.message;
    expect((await as(USERS.dave).get(`/api/ws/${wsId}/files/${up.id}`)).status).toBe(200); // shared in their channel again by carol's new message
    expect((await as(USERS.carol).del(`/api/ws/${wsId}/conv/${priv.id}/messages/${again.seq}`)).ok).toBe(true);
    expect((await as(USERS.dave).get(`/api/ws/${wsId}/files/${up.id}`)).status).toBe(404);
    expect((await as(USERS.carol).get(`/api/ws/${wsId}/files/${up.id}`)).status).toBe(200);
  });
});

describe('an import page with an entry that is no message', () => {
  it('admits the messages around it rather than failing the import with a server error', async () => {
    const header = { format: 'teamchat-export', version: 1, workspace: { id: 'abcdef1234', name: 'Acme' }, channels: { chan000001: { name: 'general', def: true } }, members: {}, memberDocs: {} };
    const created = await as(alice).post('/api/workspaces/import', { header, profile: { name: 'Alice' } });
    expect(created.ok).toBe(true);
    const copy = created.data.workspace.id;
    // A messages.json edited by hand, or repaired after a cut: a null and a bare number where messages were.
    const page = await as(alice).post(`/api/ws/${copy}/import`, { conv: 'chan000001', seq: 3, messages: [{ seq: 1, user: alice.uuid, text: 'one', ts: 1 }, null, 7, { seq: 3, user: alice.uuid, text: 'three', ts: 3 }] });
    expect([page.status, page.data.ok]).toEqual([200, true]);
    expect((await as(alice).post(`/api/ws/${copy}/import/finish`)).ok).toBe(true);
    const read = await as(alice).get(`/api/ws/${copy}/conv/chan000001/messages`);
    expect(read.data.messages.map((m) => [m.seq, m.text])).toEqual([[1, 'one'], [3, 'three']]);
  });
});
