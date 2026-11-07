import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { ZipReader, ZipWriter, BlobReader, BlobWriter, Uint8ArrayWriter, TextReader } from '@zip.js/zip.js';
import { normalizeDocx, exportDocx } from '../src/lib/export-docx.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STRICT = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const paragraph = '<w:p><w:pPr><w:jc w:val="justify"/></w:pPr><w:r><w:t>justify &amp; both</w:t></w:r></w:p>';
const xml = body => `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
const types = (names = ['word/document.xml']) => `<Types xmlns="${CT}">${names.map(name => `<Override PartName="/${name}" ContentType="${MIME}.main+xml"/>`).join('')}</Types>`;
function archive(document, extra = {}) {
  return new Blob([zipSync({ '[Content_Types].xml': strToU8(types()), 'word/document.xml': strToU8(document), ...extra })], { type: MIME });
}
const contents = async blob => unzipSync(new Uint8Array(await blob.arrayBuffer()));
beforeAll(() => {
  const window = new JSDOM('').window;
  vi.stubGlobal('DOMParser', window.DOMParser); vi.stubGlobal('XMLSerializer', window.XMLSerializer);
});
afterAll(() => vi.unstubAllGlobals());

it('repairs paragraph justification without changing user text or unrelated elements', async () => {
  const body = paragraph + '<w:tblPr><w:jc w:val="justify"/></w:tblPr><w:pPr><w:jc xmlns:w="urn:custom" w:val="justify"/></w:pPr><w:pPr><w:jc xmlns:x="urn:custom" x:val="justify"/></w:pPr><!-- justify -->';
  const result = strFromU8((await contents(await normalizeDocx(archive(xml(body)))))['word/document.xml']);
  expect(result).toBe(xml(body.replace('<w:jc w:val="justify"/>', '<w:jc w:val="both"/>')));
});
it.each(['left', 'right', 'center', 'both', 'distribute', 'start', 'end'])('returns an unchanged archive for %s alignment', async alignment => {
  const original = archive(xml(paragraph.replace('w:val="justify"', `w:val="${alignment}"`)));
  expect(await normalizeDocx(original)).toBe(original);
});
it.each([W, STRICT])('resolves WordprocessingML namespaces independently of prefixes: %s', async namespace => {
  const source = `<document xmlns="${namespace}" xmlns:a="${namespace}"><p><pPr><jc a:val="justify"/></pPr></p></document>`;
  const result = strFromU8((await contents(await normalizeDocx(archive(source))))['word/document.xml']);
  expect(result).toContain('a:val="both"');
});
it('repairs declared WordprocessingML story and style parts, preserving custom XML and binary parts', async () => {
  const names = ['word/document.xml', 'word/styles.xml', 'word/footnotes.xml', 'word/header1.xml', 'word/footer1.xml', 'word/glossary/document.xml', 'word/other story.xml'];
  const files = Object.fromEntries(names.map(name => [name, strToU8(xml(paragraph))]));
  files['[Content_Types].xml'] = strToU8(types(names.map(encodeURI)));
  files['customXml/item1.xml'] = strToU8(xml(paragraph));
  files['word/media/image.bin'] = new Uint8Array([0, 255, 128, 13, 10, 42]);
  const result = await contents(await normalizeDocx(new Blob([zipSync(files)])));
  for (const name of names) expect(strFromU8(result[name])).toContain('w:val="both"');
  for (const name of ['customXml/item1.xml', 'word/media/image.bin', '[Content_Types].xml']) expect(result[name]).toEqual(files[name]);
});
it.each(['le', 'be'])('rewrites changed UTF-16%s XML as valid UTF-8 and preserves unchanged encoded parts', async endian => {
  const encode = text => {
    const bytes = new Uint8Array(Buffer.from('\ufeff' + text, 'utf16le'));
    if (endian === 'be') for (let i = 0; i < bytes.length; i += 2) [bytes[i], bytes[i + 1]] = [bytes[i + 1], bytes[i]];
    return bytes;
  };
  const source = '<?xml version="1.0" encoding="UTF-16"?>' + xml(paragraph.replace('justify &amp; both', '中文 😀'));
  const files = { '[Content_Types].xml': encode(types(['word/document.xml', 'word/styles.xml'])), 'word/document.xml': encode(source), 'word/styles.xml': encode(xml('<w:p/>')) };
  const result = await contents(await normalizeDocx(new Blob([zipSync(files)])));
  const changed = new TextDecoder('utf-8', { fatal: true }).decode(result['word/document.xml']);
  expect(changed).toContain('w:val="both"'); expect(changed).toContain('中文 😀');
  expect(changed).not.toContain('encoding="UTF-16"');
  expect(result['word/styles.xml']).toEqual(files['word/styles.xml']);
  expect(result['[Content_Types].xml']).toEqual(files['[Content_Types].xml']);
});
it('preserves ZIP64 archive comments, entry metadata, and raw compressed media', async () => {
  const writer = new ZipWriter(new BlobWriter(MIME), { useWebWorkers: false, zip64: true });
  const date = new Date('2020-02-03T04:05:06Z');
  await writer.add('[Content_Types].xml', new TextReader(types()));
  await writer.add('word/document.xml', new TextReader(xml(paragraph)), { comment: 'document comment', lastModDate: date });
  await writer.add('word/media/', null, { directory: true, comment: 'folder' });
  await writer.add('word/media/图片.bin', new TextReader('opaque media '.repeat(10000)), { comment: 'asset comment', lastModDate: date, externalFileAttributes: 0o100640 << 16, versionMadeBy: 0x314, extraField: new Map([[0xbeef, new Uint8Array([1, 2, 3])]]) });
  const original = await writer.close(strToU8('archive comment'));
  const result = await normalizeDocx(original);
  expect(result.type).toBe(MIME);
  const readers = [original, result].map(blob => new ZipReader(new BlobReader(blob), { useWebWorkers: false }));
  try {
    const [before, after] = await Promise.all(readers.map(reader => reader.getEntries()));
    expect(readers[1].comment).toEqual(readers[0].comment);
    expect(after.map(entry => entry.filename)).toEqual(before.map(entry => entry.filename));
    for (let i = 0; i < before.length; i++) {
      for (const key of ['comment', 'lastModDate', 'externalFileAttributes', 'directory']) expect(after[i][key]).toEqual(before[i][key]);
      if (before[i].filename !== 'word/document.xml' && !before[i].directory) {
        expect(await after[i].getData(new Uint8ArrayWriter(), { passThrough: true })).toEqual(await before[i].getData(new Uint8ArrayWriter(), { passThrough: true }));
      }
    }
    expect(after[3].extraField.get(0xbeef)).toEqual(before[3].extraField.get(0xbeef));
  } finally { await Promise.all(readers.map(reader => reader.close())); }
});
it.each([undefined, 'adapter result', new Blob(['plain text']), new Blob([])])('preserves non-ZIP adapters: %s', async original => {
  expect(await normalizeDocx(original)).toBe(original);
});
it('preserves ZIP exports without a WordprocessingML content-type catalog', async () => {
  const original = new Blob([zipSync({ 'file.txt': strToU8('justify') })]);
  expect(await normalizeDocx(original)).toBe(original);
});
it('rejects malformed affected XML before delivering the exported file', async () => {
  await expect(normalizeDocx(archive('<w:p><w:pPr><w:jc w:val="justify"/></w:pPr>'))).rejects.toThrow('invalid XML');
});
it('rejects corrupt WordprocessingML XML rather than saving an archive with invalid checksums', async () => {
  const bytes = zipSync({ '[Content_Types].xml': strToU8(types()), 'word/document.xml': strToU8(xml(paragraph)) }, { level: 0 });
  const offset = Buffer.from(bytes).indexOf(Buffer.from('justify'));
  expect(offset).toBeGreaterThan(0);
  bytes[offset] = 'J'.charCodeAt(0);
  await expect(normalizeDocx(new Blob([bytes]))).rejects.toThrow();
});
it('propagates export failures and forwards export options once', async () => {
  const engine = { export: vi.fn().mockRejectedValue(new Error('export failed')) };
  const options = { exportType: ['docx'], triggerDownload: false, exportedName: 'Document' };
  await expect(exportDocx(engine, options)).rejects.toThrow('export failed');
  expect(engine.export).toHaveBeenCalledExactlyOnceWith(options);
});

it('leaves a document alone whose text merely says "justify"', async () => {
  const blob = archive(xml('<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>Nothing here can justify the budget.</w:t></w:r></w:p>'));
  // The same blob comes back: no part was parsed and re-zipped on this autosave.
  expect(await normalizeDocx(blob)).toBe(blob);
  const justified = archive(xml('<w:p><w:pPr><w:jc w:val="justify"/></w:pPr><w:r><w:t>Justified.</w:t></w:r></w:p>'));
  expect(strFromU8((await contents(await normalizeDocx(justified)))['word/document.xml'])).toContain('<w:jc w:val="both"/>');
});

it('exports through the Document API, which leaves editing on, instead of the engine save that turns it off', async () => {
  const bytes = zipSync({ '[Content_Types].xml': strToU8(types()), 'word/document.xml': strToU8(xml(paragraph)) });
  const toDocx = vi.fn().mockResolvedValue({ mode: 'tracked', byteLength: bytes.length, contentBase64: Buffer.from(bytes).toString('base64'), report: { warnings: [] } });
  const engine = { export: vi.fn(), activeEditor: { doc: { export: { toDocx } } } };
  const blob = await exportDocx(engine, { exportType: ['docx'], triggerDownload: false });
  expect(toDocx).toHaveBeenCalledExactlyOnceWith({});
  // The engine's save blurs the text input for the whole export: keystrokes typed meanwhile were lost.
  expect(engine.export).not.toHaveBeenCalled();
  expect(blob.type).toBe(MIME);
  const parts = await contents(blob);
  expect(strFromU8(parts['[Content_Types].xml'])).toBe(types());
  // The bytes still go through the same DOCX-compatibility pass as before.
  expect(strFromU8(parts['word/document.xml'])).toContain('<w:jc w:val="both"/>');
});
it('falls back to the engine save when the Document API has no bytes to give', async () => {
  const blob = archive(xml(paragraph));
  const engine = { export: vi.fn().mockResolvedValue(blob), activeEditor: { doc: { export: { toDocx: vi.fn().mockResolvedValue({ report: { warnings: [] } }) } } } };
  const options = { exportType: ['docx'], triggerDownload: false };
  expect(strFromU8((await contents(await exportDocx(engine, options)))['word/document.xml'])).toContain('<w:jc w:val="both"/>');
  expect(engine.export).toHaveBeenCalledExactlyOnceWith(options);
});
