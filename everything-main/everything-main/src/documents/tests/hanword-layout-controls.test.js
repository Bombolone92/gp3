import { beforeAll, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { unzipSync, strFromU8, unzlibSync } from 'fflate';
import { parseHwp5 } from '../src/lib/hwp/hwp5.js';
import { parseHwpx } from '../src/lib/hwp/hwpx.js';
import { modelToDocx } from '../src/lib/hwp/docx.js';
import { gradientPixels } from '../src/lib/hwp/fill.js';
import { concat, hwp, hwpx, paragraph, record, u16, u32 } from './helpers/hwp-fixtures.js';

beforeAll(() => { globalThis.DOMParser = new JSDOM('').window.DOMParser; });
const control = (id, data, level = 1) => record(71, level, concat(Buffer.from(id).reverse(), data));
const atPage = (p) => { const copy = p.slice(); copy[15] |= 4; return copy; };
const line = (y) => record(69, 1, concat(u32(0), u32(y), u32(1200), u32(1200), u32(1000), u32(600), new Uint8Array(12)));
const xml = (model) => Object.fromEntries(Object.entries(unzipSync(modelToDocx(model))).filter(([name]) => name.endsWith('.xml') || name.endsWith('.rels')).map(([name, bytes]) => [name, strFromU8(bytes)]));
const pxml = (text, controls = '', pageBreak = false, y) => `<hp:p pageBreak="${pageBreak ? 1 : 0}"><hp:run>${controls}<hp:t>${text}</hp:t></hp:run>${y === undefined ? '' : `<hp:linesegarray><hp:lineseg vertpos="${y}"/></hp:linesegarray>`}</hp:p>`;
const hiding = '<hp:ctrl><hp:pageHiding hidePageNum="1"/></hp:ctrl>';

function tableBinary(contents, border = 0) {
  return concat(control('tbl ', new Uint8Array(20)),
    record(77, 2, concat(u32(0), u16(1), u16(1), new Uint8Array(10), u16(1), u16(0))),
    record(72, 2, concat(u32(1), u32(0), u16(0), u16(0), u16(1), u16(1), u32(46209), u32(779), new Uint8Array(8), u16(border))), contents);
}
const tableXml = (contents, border = 0) => `<hp:tbl rowCnt="1" colCnt="1"><hp:tr><hp:tc borderFillIDRef="${border}"><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="46209" height="779"/><hp:subList>${contents}</hp:subList></hp:tc></hp:tr></hp:tbl>`;

describe('page-local Hanword hiding controls', () => {
  it.each(['HWP', 'HWPX'])('hides the cover and contents page numbers in %s, including a control inside a table', (format) => {
    const model = format === 'HWP'
      ? parseHwp5(hwp({ sections: [concat(
        paragraph('Cover', { children: [control('pgnp', concat(u32(5 << 8), new Uint8Array(6)))] }),
        paragraph('Cover end', { children: [control('pghd', u32(32))] }),
        atPage(paragraph('', { children: [tableBinary(paragraph('Contents', { level: 2, children: [control('pghd', u32(32), 3)] }))] })),
        atPage(paragraph('Body')),
      )] }))
      : parseHwpx(hwpx({ sections: [pxml('Cover', '<hp:ctrl><hp:pageNum pos="BOTTOM_CENTER"/></hp:ctrl>') + pxml('Cover end', hiding) + pxml('', tableXml(pxml('Contents', hiding)), true) + pxml('Body', '', true)] }));
    expect(model.sections.map((s) => [s.blocks.length, s.hideFirstPageNum])).toEqual([[2, true], [2, true]]);
    expect(model.sections[1]).toMatchObject({ pageStart: 0, breakType: 'nextPage' });
    expect(model.sections[1].blocks[0].pageBreak).toBe(false);
    expect(model.sections[1].blocks[1].pageBreak).toBe(true);
    const parts = xml(model), doc = new DOMParser().parseFromString(parts['word/document.xml'], 'application/xml');
    expect(doc.getElementsByTagNameNS('*', 'titlePg')).toHaveLength(2);
    expect(doc.getElementsByTagNameNS('*', 'sectPr')).toHaveLength(2);
    const targets = new Map([...new DOMParser().parseFromString(parts['word/_rels/document.xml.rels'], 'application/xml').querySelectorAll('Relationship')].map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
    for (const ref of doc.getElementsByTagNameNS('*', 'footerReference')) {
      const footer = parts['word/' + targets.get(ref.getAttribute('r:id'))];
      expect(footer.includes('w:instr="PAGE"')).toBe(ref.getAttribute('w:type') === 'default');
    }
    expect([...model.warnings]).toEqual([]);
  });

  it.each(['HWP', 'HWPX'])('uses recorded automatic page boundaries to keep a later %s hiding control off the cover', (format) => {
    const model = format === 'HWP'
      ? parseHwp5(hwp({ sections: [concat(paragraph('First', { children: [line(5000)] }), paragraph('Second', { children: [line(0)] }), paragraph('End', { children: [line(2500), control('pghd', u32(32))] }))] }))
      : parseHwpx(hwpx({ sections: [pxml('First', '', false, 5000) + pxml('Second', '', false, 0) + pxml('End', hiding, false, 2500)] }));
    expect(model.sections.map((s) => s.blocks.map((p) => p.runs[0].text))).toEqual([['First'], ['Second', 'End']]);
    expect(model.sections[0].hideFirstPageNum).toBeFalsy();
    expect(model.sections[1].hideFirstPageNum).toBe(true);
  });

  it('does not apply a footnote hiding control to the body page', () => {
    const model = parseHwpx(hwpx({ sections: [pxml('Body', `<hp:ctrl><hp:footNote><hp:subList>${pxml('Note', hiding)}</hp:subList></hp:footNote></hp:ctrl>`)] }));
    expect(model.sections[0].hideFirstPageNum).toBeFalsy();
    expect(xml(model)['word/document.xml']).not.toContain('w:titlePg');
  });
});

describe('nested Hanword columns', () => {
  it.each(['HWP', 'HWPX'])('accepts single-column %s table controls and still reports multiple columns', (format) => {
    for (const count of [1, 2]) {
      const model = format === 'HWP'
        ? parseHwp5(hwp({ sections: [paragraph('', { children: [tableBinary(paragraph('Cell', { level: 2, children: [control('cold', concat(u16(count << 2 | 4096), u16(0)), 3)] }))] })] }))
        : parseHwpx(hwpx({ sections: [pxml('', tableXml(pxml('Cell', `<hp:ctrl><hp:colPr colCount="${count}" sameSz="1"/></hp:ctrl>`)))] }));
      expect([...model.warnings].includes('Columns inside tables or text boxes are simplified.')).toBe(count > 1);
      expect(model.sections[0].columns || 1).toBe(1);
      expect(xml(model)['word/document.xml']).toContain('Cell');
    }
  });
});

describe('Hanword decorative gradient cells', () => {
  const border = record(20, 1, concat(new Uint8Array(32), u32(4), [2], u32(0), u32(0), u32(0), u32(50), u32(2), u32(0xc08000), u32(0xffbf3c), u32(1), [50]));
  const header = '<hh:borderFill id="1"><hh:gradation type="RADIAL" angle="0" centerX="0" centerY="0" step="50" stepCenter="50"><hh:color value="#0080c0"/><hh:color value="#3cbfff"/></hh:gradation></hh:borderFill>';
  function model(format, text = '') {
    return format === 'HWP' ? parseHwp5(hwp({ infoExtra: [border], sections: [paragraph('', { children: [tableBinary(paragraph(text, { level: 2 }), 1)] })] }))
      : parseHwpx(hwpx({ header, sections: [pxml('', tableXml(pxml(text), 1))] }));
  }
  it.each(['HWP', 'HWPX'])('preserves the %s cover rule colors and dimensions in a portable image', (format) => {
    const m = model(format), cell = m.sections[0].blocks[0].runs[0].cells[0];
    expect(cell.border.gradient).toMatchObject({ type: 'RADIAL', colors: ['0080c0', '3cbfff'], centerX: 0, centerY: 0, center: 50 });
    const parts = unzipSync(modelToDocx(m)), doc = strFromU8(parts['word/document.xml']);
    expect(doc).toContain('descr="Gradient fill"');
    expect(doc).toContain('<wp:extent cx="5868543" cy="98933"/>');
    const png = Object.entries(parts).find(([name]) => name.startsWith('word/media/'))[1];
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength), width = view.getUint32(16), height = view.getUint32(20), chunks = [];
    for (let pos = 8; pos < png.length;) { const size = view.getUint32(pos); if (strFromU8(png.subarray(pos + 4, pos + 8)) === 'IDAT') chunks.push(png.subarray(pos + 8, pos + 8 + size)); pos += size + 12; }
    const pixels = unzlibSync(concat(...chunks));
    expect([width, height]).toEqual([1232, 21]);
    expect([...pixels.slice(1, 5)]).toEqual([0, 128, 192, 255]);
    expect([...pixels.slice(1 + 4 * Math.floor(width / 2), 5 + 4 * Math.floor(width / 2))]).toEqual([31, 160, 224, 255]);
    expect([...pixels.slice(-4)]).toEqual([60, 191, 255, 255]);
    expect([...m.warnings]).toEqual([]);
  });
  it.each(['HWP', 'HWPX'])('keeps a specific note when a %s gradient behind text is still approximated', (format) => {
    const m = model(format, 'Keep editable text');
    expect(xml(m)['word/document.xml']).toContain('Keep editable text');
    expect([...m.warnings]).toEqual(['Gradient fills behind text or in complex tables retain their base color.']);
  });
  it('does not warn for unused gradient or picture-fill definitions', () => {
    const m = parseHwpx(hwpx({ header: header + '<hh:borderFill id="2"><hh:imgBrush/></hh:borderFill>', sections: [pxml('Plain')] }));
    xml(m); expect([...m.warnings]).toEqual([]);
  });
  it('rejects truncated gradient colors', () => {
    const truncated = record(20, 1, concat(new Uint8Array(32), u32(4), [2], new Uint8Array(16), u32(3), u32(0)));
    expect(() => parseHwp5(hwp({ infoExtra: [truncated] }))).toThrow();
  });
  it('bounds gradient raster sizes and rejects unordered stops', () => {
    const g = { type: 'LINEAR', colors: ['000000', 'ffffff'], angle: 0 };
    expect(gradientPixels(g, 1e8, 100).width).toBe(2048);
    expect(() => gradientPixels({ ...g, positions: [100, 0] }, 100, 100)).toThrow(/stops/);
  });
});
