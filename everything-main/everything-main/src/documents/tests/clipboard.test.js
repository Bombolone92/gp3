import { describe, it, expect } from 'vitest';
import { isStandardType, clipboardTypeFor, payloadTypeFor, clipboardEntries, payloadText, writePayload, readPayload, isPermissionError, withTimeout, clipboardReadWait, execClipboardCommand } from '../src/lib/clipboard.js';

const FRAGMENT = 'application/json';

describe('clipboard types', () => {
  it('writes standard types as-is and prefixes custom ones', () => {
    expect(isStandardType('text/html')).toBe(true);
    expect(isStandardType(FRAGMENT)).toBe(false);
    expect(clipboardTypeFor('text/plain')).toBe('text/plain');
    expect(clipboardTypeFor(FRAGMENT)).toBe(`web ${FRAGMENT}`);
    expect(payloadTypeFor(`web ${FRAGMENT}`)).toBe(FRAGMENT);
    expect(payloadTypeFor('text/html')).toBe('text/html');
  });

  it('builds clipboard entries with or without custom formats', async () => {
    const items = [
      { type: 'text/plain', kind: 'string', data: 'hi' },
      { type: 'text/html', kind: 'string', data: '<p>hi</p>' },
      { type: FRAGMENT, kind: 'string', data: '{"kind":"fragment"}' },
      { type: 'text/plain', kind: 'string', data: 'dup' },
      { type: 'broken' },
    ];
    const full = clipboardEntries(items);
    expect(Object.keys(full)).toEqual(['text/plain', 'text/html', `web ${FRAGMENT}`]);
    expect(await full['text/plain'].text()).toBe('hi');
    expect(full['text/html'].type).toBe('text/html');
    expect(full[`web ${FRAGMENT}`].type).toBe('application/octet-stream');
    expect(Object.keys(clipboardEntries(items, { custom: false }))).toEqual(['text/plain', 'text/html']);
    expect(payloadText({ items })).toBe('hi');
    expect(payloadText({ items: [] })).toBe('');
  });
});

describe('writePayload', () => {
  const payload = { items: [{ type: 'text/plain', kind: 'string', data: 'hi' }, { type: FRAGMENT, kind: 'string', data: '{}' }] };
  class FakeItem { constructor(entries) { this.entries = entries; } }

  it('writes every type when the browser accepts custom formats', async () => {
    const written = [];
    const clipboard = { write: async (items) => { written.push(items); }, writeText: async () => { throw new Error('unused'); } };
    await writePayload(payload, { clipboard, ItemCtor: FakeItem });
    expect(Object.keys(written[0][0].entries)).toEqual(['text/plain', `web ${FRAGMENT}`]);
  });

  it('falls back to standard types, then to plain text', async () => {
    const written = [];
    let texts = [];
    const clipboard = {
      write: async (items) => { if (Object.keys(items[0].entries).some((k) => k.startsWith('web '))) throw new Error('custom formats unsupported'); written.push(items); },
      writeText: async (t) => { texts.push(t); },
    };
    await writePayload(payload, { clipboard, ItemCtor: FakeItem });
    expect(Object.keys(written[0][0].entries)).toEqual(['text/plain']);
    expect(texts).toEqual([]);

    const textOnly = { writeText: async (t) => { texts.push(t); } };
    await writePayload(payload, { clipboard: textOnly, ItemCtor: null });
    expect(texts).toEqual(['hi']);
    await expect(writePayload({ items: [] }, { clipboard: textOnly, ItemCtor: null })).rejects.toThrow('Nothing to copy');
    await expect(writePayload(payload, { clipboard: null })).rejects.toThrow('not available');
  });
});

describe('readPayload', () => {
  it('reads text types as strings and the rest as bytes, dropping the web prefix', async () => {
    const blob = (s, type) => new Blob([s], { type });
    const item = { types: ['text/plain', 'text/html', `web ${FRAGMENT}`, 'image/png'], getType: async (t) => ({ 'text/plain': blob('hi'), 'text/html': blob('<b>hi</b>'), [`web ${FRAGMENT}`]: blob('{"x":1}'), 'image/png': blob('PNG') })[t] };
    const payload = await readPayload({ clipboard: { read: async () => [item] } });
    expect(payload.source).toBe('browser');
    expect(payload.items.map((i) => [i.type, i.kind])).toEqual([['text/plain', 'string'], ['text/html', 'string'], [FRAGMENT, 'string'], ['image/png', 'bytes']]);
    expect(payload.items[2].data).toBe('{"x":1}');
    expect(payload.items[3].data).toBeInstanceOf(Uint8Array);
  });

  it('uses readText when read() is missing and rejects an empty clipboard', async () => {
    const p = await readPayload({ clipboard: { readText: async () => 'plain' } });
    expect(p.items).toEqual([{ type: 'text/plain', kind: 'string', data: 'plain' }]);
    await expect(readPayload({ clipboard: { readText: async () => '' } })).rejects.toThrow('empty');
    await expect(readPayload({ clipboard: { read: async () => [] } })).rejects.toThrow('empty');
  });

  it('recognizes permission failures', () => {
    expect(isPermissionError(Object.assign(new Error('Read permission denied.'), { name: 'NotAllowedError' }))).toBe(true);
    expect(isPermissionError(new Error('Document is not focused'))).toBe(false);
  });

  it('waits longer for a read while the browser still has to ask the user', async () => {
    const query = (state) => ({ query: async ({ name }) => { expect(name).toBe('clipboard-read'); return { state }; } });
    expect(await clipboardReadWait({ permissions: query('granted') })).toBe(4000);
    expect(await clipboardReadWait({ permissions: query('prompt') })).toBe(60000);
    expect(await clipboardReadWait({ permissions: query('denied') })).toBe(60000);
    expect(await clipboardReadWait({ permissions: { query: async () => { throw new TypeError('unsupported'); } } })).toBe(60000);
    expect(await clipboardReadWait({ permissions: undefined, asking: 9 })).toBe(9);
  });

  it('gives up on a clipboard that never answers', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok');
    await expect(withTimeout(new Promise(() => {}), 10, 'stuck')).rejects.toMatchObject({ name: 'TimeoutError', message: 'stuck' });
  });

  it('runs the browser copy command when there is one', () => {
    expect(execClipboardCommand('copy', { execCommand: (k) => k === 'copy' })).toBe(true);
    expect(execClipboardCommand('cut', { execCommand: () => false })).toBe(false);
    expect(execClipboardCommand('copy', {})).toBe(false);
    expect(execClipboardCommand('copy', { execCommand: () => { throw new Error('nope'); } })).toBe(false);
  });
});

describe('caretAfterPaste', () => {
  const story = { kind: 'story', storyType: 'body' };
  const inserted = (blockId, start, end) => ({ kind: 'insertedText', target: { kind: 'text', blockId, range: { start, end }, story },
    selectionTarget: { kind: 'selection', start: { kind: 'text', blockId, offset: start, story }, end: { kind: 'text', blockId, offset: end, story }, story } });

  it('collapses to the end of the last inserted text', async () => {
    const { caretAfterPaste } = await import('../src/lib/clipboard.js');
    const result = { ok: true, receipt: { success: true, effects: { insertedText: [inserted('p1', 6, 14), inserted('p2', 0, 8)] } } };
    expect(caretAfterPaste(result)).toEqual({ kind: 'selection', start: { kind: 'text', blockId: 'p2', offset: 8, story }, end: { kind: 'text', blockId: 'p2', offset: 8, story }, story });
  });

  it('returns null when the receipt does not report inserted text', async () => {
    const { caretAfterPaste } = await import('../src/lib/clipboard.js');
    expect(caretAfterPaste({ ok: true })).toBeNull();
    expect(caretAfterPaste({ ok: true, receipt: { effects: { insertedText: [] } } })).toBeNull();
    expect(caretAfterPaste({ ok: true, receipt: { effects: { insertedText: [{ kind: 'insertedText' }] } } })).toBeNull();
    expect(caretAfterPaste({ ok: true, receipt: { effects: { insertedText: [{ selectionTarget: { end: { blockId: 'p1', offset: -1 } } }] } } })).toBeNull();
    expect(caretAfterPaste(null)).toBeNull();
  });
});
