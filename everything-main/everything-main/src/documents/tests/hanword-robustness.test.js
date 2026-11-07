import { beforeAll, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { parseHwpx } from '../src/lib/hwp/hwpx.js';
import { hwpx } from './helpers/hwp-fixtures.js';

const run = (inner) => `<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0">${inner}</hp:run></hp:p>`;
const box = '<hp:offset x="0" y="0"/><hp:orgSz width="3000" height="3000"/><hp:curSz width="3000" height="3000"/><hp:sz width="3000" height="3000"/><hp:pos treatAsChar="1"/>';
function withItems(section, files, items) {
  const archive = unzipSync(hwpx({ sections: [section] }));
  archive['Contents/content.hpf'] = strToU8(strFromU8(archive['Contents/content.hpf']).replace('</manifest>', `${items}</manifest>`));
  Object.assign(archive, files);
  return zipSync(archive);
}
const runs = (model) => model.sections[0].blocks[0].runs;
beforeAll(() => { globalThis.DOMParser = new JSDOM('').window.DOMParser; });
const indexOf = (bytes, needle) => { outer: for (let i = 0; i <= bytes.length - needle.length; i++) { for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer; return i; } return -1; };

describe('HWPX documents with one damaged or degenerate part', () => {
  it('leaves out an arc collapsed to a point and a curve without segments instead of refusing the document', () => {
    const arc = `<hp:arc id="1" type="NORMAL">${box}<hp:center x="0" y="0"/><hp:ax1 x="0" y="0"/><hp:ax2 x="0" y="0"/></hp:arc>`;
    const model = parseHwpx(hwpx({ sections: [run(`${arc}<hp:t>after</hp:t>`)] }));
    expect(runs(model).map((r) => r.kind)).toEqual(['text']);
    expect([...model.warnings]).toContain('A drawing with an invalid geometry was left out.');
    const curve = parseHwpx(hwpx({ sections: [run(`<hp:curve id="2">${box}</hp:curve><hp:t>kept</hp:t>`)] }));
    expect(runs(curve).map((r) => r.text)).toEqual(['kept']);
  });

  it('names an embedded object whose package entry is damaged instead of refusing the document', () => {
    const ole = `<hp:ole id="1" binaryItemIDRef="ole1" objectType="EMBEDDED">${box}<hp:shapeComment>Object</hp:shapeComment></hp:ole>`;
    // Bytes that do not compress, so the flips below land inside the entry's own data.
    const bytes = withItems(run(ole), { 'BinData/ole1.ole': new Uint8Array(64).map((_, i) => (i * 97 + 13) & 255) }, '<item id="ole1" href="../BinData/ole1.ole" media-type="application/ole"/>');
    // Flip the entry's stored bytes so the archive's checksum no longer matches.
    const name = new TextEncoder().encode('BinData/ole1.ole');
    const at = indexOf(bytes, name);
    expect(at).toBeGreaterThan(0);
    for (let i = 0; i < 8; i++) bytes[at + name.length + i] ^= 0xff;
    const model = parseHwpx(bytes);
    expect(runs(model)[0]).toMatchObject({ kind: 'text', text: '[Embedded object: Object]' });
    expect([...model.warnings]).toContain('An embedded object could not be read.');
  });

  it('treats a manifest item reaching above the package as a missing part, not a damaged file', () => {
    const picture = `<hp:pic id="3">${box}<hp:img binaryItemIDRef="up"/></hp:pic>`;
    const model = parseHwpx(withItems(run(`${picture}<hp:t>text</hp:t>`), {}, '<item id="up" href="../../../BinData/evil.png" media-type="image/png"/><item id="stray" href="..%2F..%2Fetc%2Fpasswd"/>'));
    expect(runs(model).at(-1)).toMatchObject({ kind: 'text', text: 'text' });
  });

  it('says that a reading order entry pointing outside the package is missing', () => {
    const archive = unzipSync(hwpx({}));
    archive['Contents/content.hpf'] = strToU8(strFromU8(archive['Contents/content.hpf']).replace('</manifest>', '<item id="web" href="https://example.com/s.xml"/></manifest>').replace('</spine>', '<itemref idref="web"/></spine>'));
    expect(() => parseHwpx(zipSync(archive))).toThrow('The HWPX reading order references a missing part.');
  });
});

describe('HWPX script parts', () => {
  const scripted = (header, source) => {
    const archive = unzipSync(hwpx({}));
    archive['Contents/content.hpf'] = strToU8(strFromU8(archive['Contents/content.hpf'])
      .replace('</manifest>', '<item id="hs" href="Scripts/headerScripts.js" media-type="text/javascript"/><item id="ss" href="Scripts/sourceScripts.js" media-type="text/javascript"/></manifest>')
      .replace('</spine>', '<itemref idref="hs"/><itemref idref="ss"/></spine>'));
    const utf16 = (text) => { const out = new Uint8Array(2 + text.length * 2); out[0] = 0xff; out[1] = 0xfe; for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); out[2 + i * 2] = c & 255; out[3 + i * 2] = c >> 8; } return out; };
    archive['Scripts/headerScripts.js'] = utf16(header);
    archive['Scripts/sourceScripts.js'] = utf16(source);
    return parseHwpx(zipSync(archive));
  };
  it('say nothing about the empty stubs Hanword writes into every file, and note real code', () => {
    const stubs = scripted('var Documents = XHwpDocuments;\r\nvar Document = Documents.Active_XHwpDocument;\r\n', '\r\nfunction OnDocument_New()\r\n{\r\n\t//todo : \r\n}\r\n');
    expect([...stubs.warnings]).not.toContain('Document scripts are not imported.');
    const real = scripted('var Documents = XHwpDocuments;\r\nvar Box = Document.XHwpFormComboBoxs.ItemFromName("ComboBox1");', 'function OnDocument_Open()\r\n{\r\n\tBox.InsertString("봄", 0);\r\n}');
    expect([...real.warnings]).toContain('Document scripts are not imported.');
  });
  it('decides about a script part in time proportional to its length, however it is shaped', () => {
    const started = performance.now();
    // Unfinished declarations, unclosed comments and a long part: each once cost a rescan per occurrence.
    for (const source of ['function a(', 'x /* open ', 'var x = y.'].map((s) => s.repeat(2000))) expect([...scripted('', source).warnings]).toContain('Document scripts are not imported.');
    expect([...scripted('', 'function a('.repeat(30000)).warnings]).toContain('Document scripts are not imported.');
    expect(performance.now() - started).toBeLessThan(2000);
    // The stubs Hanword writes, with a comment left open at the end, are still no code.
    expect([...scripted('var Documents = XHwpDocuments;', 'function OnDocument_New()\r\n{\r\n}\r\n/* end').warnings]).not.toContain('Document scripts are not imported.');
  });
});
