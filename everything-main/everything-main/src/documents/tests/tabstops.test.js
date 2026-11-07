import { describe, it, expect } from 'vitest';
import { parseTabPosition, formatTabPosition, describeTabStop, parseTabStops, paragraphPropertiesXml, readParagraphProperties, readDocumentXml, readTabStops, addTabStop, removeTabStop, clearTabStops } from '../src/lib/tabstops.js';

const XML = '<w:document><w:body>'
  + '<w:p w14:paraId="AAA1" w14:textId="1"><w:pPr><w:tabs><w:tab w:val="right" w:pos="5760" w:leader="dot"/><w:tab w:val="clear" w:pos="720"/><w:tab w:val="start" w:pos="1440"/><w:tab w:val="center" w:pos="2880" w:leader="middleDot"/></w:tabs></w:pPr><w:r><w:t>a</w:t></w:r></w:p>'
  + '<w:p w14:paraId="BBB2"><w:pPr><w:jc w:val="center"/></w:pPr></w:p>'
  + '</w:body></w:document>';

/** A zip with one entry, stored or deflated, the way a .docx carries document.xml. */
async function zipWith(name, text, { deflate = false } = {}) {
  const enc = new TextEncoder();
  const raw = enc.encode(text);
  const data = deflate ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()) : raw;
  const nameBytes = enc.encode(name);
  const head = new Uint8Array(30);
  const dv = new DataView(head.buffer);
  dv.setUint32(0, 0x04034b50, true);
  dv.setUint16(8, deflate ? 8 : 0, true);
  dv.setUint32(18, data.length, true);
  dv.setUint32(22, raw.length, true);
  dv.setUint16(26, nameBytes.length, true);
  return new Blob([head, nameBytes, data, new Uint8Array([0x50, 0x4b, 0x01, 0x02])]);
}

describe('tab stop values', () => {
  it('converts typed positions to twips within the page', () => {
    expect(parseTabPosition('1', 'in')).toBe(1440);
    expect(parseTabPosition('2.54', 'cm')).toBe(1440);
    expect(parseTabPosition('0', 'in')).toBeNull();
    expect(parseTabPosition('-1', 'in')).toBeNull();
    expect(parseTabPosition('30', 'in')).toBeNull();
    expect(parseTabPosition('abc', 'in')).toBeNull();
    expect(formatTabPosition(1440, 'in')).toBe('1 in');
    expect(formatTabPosition(1440, 'cm')).toBe('2.54 cm');
  });

  it('describes a stop for the list', () => {
    expect(describeTabStop({ position: 2880, alignment: 'right', leader: 'dot' }, 'in')).toBe('2 in · Right · Dots');
    expect(describeTabStop({ position: 720, alignment: 'left', leader: 'none' }, 'in')).toBe('0.5 in · Left');
  });
});

describe('reading tab stops from the document', () => {
  it('parses the paragraph\'s stops, sorted, skipping cleared ones and mapping old spellings', () => {
    expect(parseTabStops(XML, 'AAA1')).toEqual([
      { position: 1440, alignment: 'left', leader: 'none' },
      { position: 2880, alignment: 'center', leader: 'dot' },
      { position: 5760, alignment: 'right', leader: 'dot' },
    ]);
    expect(parseTabStops(XML, 'BBB2')).toEqual([]);
    expect(parseTabStops(XML, 'nope')).toEqual([]);
    expect(parseTabStops(null, 'AAA1')).toEqual([]);
  });

  it('finds document.xml in stored and deflated zips', async () => {
    expect(await readDocumentXml(await zipWith('word/document.xml', XML))).toBe(XML);
    expect(await readDocumentXml(await zipWith('word/document.xml', XML, { deflate: true }))).toBe(XML);
    expect(await readDocumentXml(await zipWith('word/styles.xml', XML))).toBeNull();
    expect(await readTabStops(await zipWith('word/document.xml', XML, { deflate: true }), 'AAA1')).toHaveLength(3);
    expect(await readTabStops(new Blob(['not a zip']), 'AAA1')).toEqual([]);
  });

  it('reads entries whose sizes follow the data in a descriptor, as the export normalizer writes them', async () => {
    const { ZipWriter, BlobWriter, TextReader } = await import('@zip.js/zip.js');
    const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
    await writer.add('[Content_Types].xml', new TextReader('<Types/>'));
    await writer.add('word/document.xml', new TextReader(XML));
    await writer.add('word/styles.xml', new TextReader('<w:styles/>'));
    const blob = await writer.close(new TextEncoder().encode('a comment after the directory'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // The local headers carry the data-descriptor flag and no sizes, so only the directory knows them.
    expect(new DataView(bytes.buffer).getUint16(6, true) & 0x8).toBeTruthy();
    expect(new DataView(bytes.buffer).getUint32(18, true)).toBe(0);
    expect(await readDocumentXml(blob)).toBe(XML);
    expect(await readTabStops(blob, 'AAA1')).toHaveLength(3);
  });
});

describe('writing tab stops', () => {
  const fake = () => {
    const calls = [];
    const api = { format: { paragraph: {
      setTabStop: async (i) => { calls.push(['set', i]); return { success: true }; },
      clearTabStop: async (i) => { calls.push(['clear', i]); return { success: true }; },
      clearAllTabStops: async (i) => { calls.push(['clearAll', i]); return { success: false, failure: { code: 'NO_OP' } }; },
    } } };
    return { api, calls };
  };

  it('sets, removes, and clears stops on every paragraph', async () => {
    const { api, calls } = fake();
    expect(await addTabStop(api, ['p1', 'p2'], { position: 1440, alignment: 'right', leader: 'dot' })).toBe(2);
    expect(calls[0]).toEqual(['set', { target: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' }, position: 1440, alignment: 'right', leader: 'dot' }]);
    await addTabStop(api, ['p1'], { position: 720, alignment: 'left', leader: 'none' });
    expect(calls[2][1].leader).toBeUndefined();
    await removeTabStop(api, ['p1'], 1440);
    expect(calls[3]).toEqual(['clear', { target: { kind: 'block', nodeType: 'paragraph', nodeId: 'p1' }, position: 1440 }]);
    expect(await clearTabStops(api, ['p1', 'p2'])).toBe(2);
    expect(calls.filter((c) => c[0] === 'clearAll')).toHaveLength(2);
  });

  it('throws on a rejected mutation', async () => {
    const api = { format: { paragraph: { setTabStop: async () => ({ success: false, failure: { message: 'nope' } }) } } };
    await expect(addTabStop(api, ['p1'], { position: 1440, alignment: 'left' })).rejects.toThrow('nope');
  });
});

describe('the default tab interval', () => {
  it('reads the document\'s own default and falls back to half an inch', async () => {
    const { readDefaultTabStop } = await import('../src/lib/tabstops.js');
    const { zipSync, unzipSync, strToU8 } = await import('fflate');
    const { docxWithParagraphs } = await import('./helpers/docx.js');
    const files = unzipSync(docxWithParagraphs([{ text: 'Tabbed' }]));
    expect(await readDefaultTabStop(new Blob([zipSync(files)]))).toBe(720);
    files['word/settings.xml'] = strToU8('<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="709"/></w:settings>');
    expect(await readDefaultTabStop(new Blob([zipSync(files)]))).toBe(709);
    files['word/settings.xml'] = strToU8('<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="0"/></w:settings>');
    expect(await readDefaultTabStop(new Blob([zipSync(files)]))).toBe(720);
  });
});

describe('reading a paragraph\'s properties', () => {
  it('returns the current properties of the paragraph, without a tracked earlier version', () => {
    expect(paragraphPropertiesXml(XML, 'BBB2')).toBe('<w:jc w:val="center"/>');
    expect(paragraphPropertiesXml(XML, 'AAA1')).toContain('<w:tabs>');
    expect(paragraphPropertiesXml(XML, 'CCC3')).toBeNull();
    expect(paragraphPropertiesXml('<w:p w14:paraId="D4"><w:pPr><w:keepNext/><w:pPrChange w:id="1"><w:pPr><w:pageBreakBefore/></w:pPr></w:pPrChange></w:pPr></w:p>', 'D4')).toBe('<w:keepNext/>');
    expect(paragraphPropertiesXml('<w:p w14:paraId="E5"><w:r><w:t>no properties</w:t></w:r></w:p>', 'E5')).toBeNull();
  });

  it('reads them from the document body and from a header part', async () => {
    expect(await readParagraphProperties(await zipWith('word/document.xml', XML), 'BBB2')).toBe('<w:jc w:val="center"/>');
    // A header is read through the browser's XML parser; this test runs without one.
    const { JSDOM } = await import('jsdom');
    const { window } = new JSDOM('');
    const had = { DOMParser: globalThis.DOMParser, XMLSerializer: globalThis.XMLSerializer };
    globalThis.DOMParser = window.DOMParser; globalThis.XMLSerializer = window.XMLSerializer;
    try {
    const header = '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">'
      + '<w:p w14:paraId="H1"><w:pPr><w:keepNext/><w:pPrChange w:id="2"><w:pPr/></w:pPrChange></w:pPr><w:r><w:t>h</w:t></w:r></w:p></w:hdr>';
    const rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>';
    const { zipSync, strToU8 } = await import('fflate');
    const blob = new Blob([zipSync({ 'word/document.xml': strToU8(XML), 'word/_rels/document.xml.rels': strToU8(rels), 'word/header1.xml': strToU8(header) })]);
    const properties = await readParagraphProperties(blob, 'H1', { story: { storyType: 'headerFooterPart', refId: 'rId7' } });
    expect(properties).toContain('keepNext');
    expect(properties).not.toContain('pPrChange');
    expect(await readParagraphProperties(blob, 'H9', { story: { storyType: 'headerFooterPart', refId: 'rId7' } })).toBeNull();
    } finally { globalThis.DOMParser = had.DOMParser; globalThis.XMLSerializer = had.XMLSerializer; }
  });
});
