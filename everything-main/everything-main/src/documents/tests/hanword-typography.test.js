import { afterEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { JSDOM } from 'jsdom';
import { compoundFile, records } from '../src/lib/hwp/binary.js';
import { parseHwp5 } from '../src/lib/hwp/hwp5.js';
import { parseHwpx } from '../src/lib/hwp/hwpx.js';
import { modelToDocx } from '../src/lib/hwp/docx.js';
import { prepareHanwordFonts } from '../src/lib/hwp/prepare-fonts.js';
import { hwp, hwpx, paragraph, concat, record, u16, u32, string } from './helpers/hwp-fixtures.js';

afterEach(() => vi.unstubAllGlobals());
const line = (start, height, gap) => concat(u32(start), u32(0), u32(height), u32(height), u32(0), u32(gap), new Uint8Array(12));
const paraShape = (attr, border = 0) => record(25, 1, concat(u32(attr), new Uint8Array(20), u32(160), u16(0), u16(0), u16(border), new Uint8Array(12)));
const useSecondShape = (bytes) => { bytes[12] = 1; return bytes; };

describe('Hanword typography interoperability', () => {
  it('preserves recorded baseline spacing and source wrapping in centered headings', () => {
    const model = parseHwp5(hwp({ infoExtra: [paraShape(12)], sections: [useSecondShape(paragraph('첫째줄 둘째줄', {
      children: [record(69, 1, concat(line(0, 3400, 2040), line(4, 3400, 2040)))],
    }))] }));
    const p = model.sections[0].blocks[0];
    expect(p.runs[0].text).toBe('첫째줄 \n둘째줄');
    expect(p.lineHeight).toBe(5440);
    const xml = strFromU8(unzipSync(modelToDocx(model))['word/document.xml']);
    expect(xml).toContain('w:line="1088" w:lineRule="exact"');
    expect(xml).toContain('<w:br/>');
  });
  it('keeps body paragraphs reflowable while retaining their baseline spacing', () => {
    const model = parseHwp5(hwp({ sections: [paragraph('첫째줄 둘째줄', { children: [record(69, 1, concat(line(0, 1200, 720), line(4, 1200, 720)))] })] }));
    expect(model.sections[0].blocks[0]).toMatchObject({ lineHeight: 1920, runs: [{ text: '첫째줄 둘째줄' }] });
  });
  it('maps known private-use arrows without rewriting unrelated private-use characters', () => {
    const model = parseHwp5(hwp({ sections: [paragraph('\uf0ef\uf0f0\uf0f1\uf0f2\ue001')] }));
    expect(model.sections[0].blocks[0].runs[0].text).toBe('⇦⇨⇧⇩\ue001');
    expect([...model.warnings]).toEqual([]);
  });
  it('also normalizes private-use list bullets', () => {
    const model = parseHwp5(hwp({ infoExtra: [record(24, 1, concat(new Uint8Array(8), u32(0xffffffff), u16(0xf09f)))] }));
    expect(model.listDefinitions.b1.every((level) => level.text === '•')).toBe(true);
  });
  it('normalizes HWPX arrow glyphs and bullets, including text inside drawings', () => {
    vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
    const model = parseHwpx(hwpx({ header: '<hh:charPr id="0" height="1200"/><hh:bullet id="1" char="&#xf09f;"/>', sections: [
      '<hp:p><hp:run><hp:t>&#xf0f0;&#xe001;</hp:t><hp:rect><hp:sz width="1200" height="600"/><hp:drawText><hp:subList><hp:p><hp:run><hp:t>&#xf0ef;</hp:t></hp:run></hp:p></hp:subList></hp:drawText></hp:rect></hp:run></hp:p>',
    ] }));
    expect(model.sections[0].blocks[0].runs[0].text).toBe('⇨\ue001');
    expect(model.sections[0].blocks[0].runs[1].blocks[0].runs[0].text).toBe('⇦');
    expect(model.listDefinitions.b1[0].text).toBe('•');
  });
  it('keeps a visible base color for gradient-filled rules and cells', () => {
    const border = record(20, 1, concat(new Uint8Array(32), u32(4), [2], new Uint8Array(12), u32(50), u32(2), u32(0xc08000), u32(0xffbf3c)));
    const model = parseHwp5(hwp({ infoExtra: [border, paraShape(4, 1)], sections: [useSecondShape(paragraph('Blue rule'))] }));
    expect(model.paras[1].border.fill).toBe('0080c0');
    expect(strFromU8(unzipSync(modelToDocx(model))['word/document.xml'])).toContain('w:fill="0080c0"');
  });
  it('preserves installed fonts and uses only local probes for unavailable families', async () => {
    const probes = [], installed = new Set(['맑은 고딕', 'Arial', 'AppleMyungjo']);
    vi.stubGlobal('FontFace', class {
      constructor(_family, source) { probes.push(source); this.name = JSON.parse(source.slice(6, -1)); }
      load() { return installed.has(this.name) ? Promise.resolve(this) : Promise.reject(new Error('Unavailable')); }
    });
    const model = { chars: [{ font: '맑은 고딕', eastAsia: '맑은 고딕' }, { font: 'HY헤드라인M', eastAsia: 'HY헤드라인M' }, { font: '휴먼명조' }], warnings: new Set() };
    await prepareHanwordFonts(model);
    expect(model.chars).toEqual([{ font: '맑은 고딕', eastAsia: '맑은 고딕' }, { font: '맑은 고딕', eastAsia: '맑은 고딕' }, { font: 'AppleMyungjo' }]);
    expect(probes.every((source) => source.startsWith('local('))).toBe(true);
    expect(probes.filter((source) => source === 'local("HY헤드라인M")')).toHaveLength(1);
    expect([...model.warnings][0]).toContain('HY헤드라인M → 맑은 고딕');
  });
  it('leaves source font names intact if the browser cannot resolve local fonts', async () => {
    vi.stubGlobal('FontFace', class { constructor() { throw new Error('Unsupported'); } });
    const model = { chars: [{ font: 'Original' }], warnings: new Set() };
    await prepareHanwordFonts(model);
    expect(model.chars[0].font).toBe('Original');
  });
  it('resolves localized names to the same installed face before trying replacements', async () => {
    vi.stubGlobal('FontFace', class {
      constructor(_family, source) { this.name = JSON.parse(source.slice(6, -1)); }
      load() { return ['Batang', 'Arial'].includes(this.name) ? Promise.resolve(this) : Promise.reject(new Error('Unavailable')); }
    });
    const model = { chars: [{ font: '바탕', eastAsia: '바탕' }], fontFallbacks: new Map([['바탕', ['Arial']]]), warnings: new Set() };
    await prepareHanwordFonts(model);
    expect(model.chars[0]).toEqual({ font: 'Batang', eastAsia: 'Batang' });
  });
  it.each(['HWP', 'HWPX'])('honors the document-declared fallback from %s before a generic family', async (format) => {
    vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
    vi.stubGlobal('FontFace', class {
      constructor(_family, source) { this.name = JSON.parse(source.slice(6, -1)); }
      load() { return ['Custom substitute', 'Arial', 'Apple SD Gothic Neo'].includes(this.name) ? Promise.resolve(this) : Promise.reject(new Error('Unavailable')); }
    });
    let model;
    if (format === 'HWP') {
      const base = hwp({ compressed: false }), info = records(compoundFile(base).read('DocInfo'));
      const encode = (nodes, level = 0) => concat(...nodes.map((n) => concat(record(n.tag, level, n.tag === 19
        ? concat([0xe0], string('Original'), [1], string('Custom substitute'), new Uint8Array(10), string('Arial')) : n.data), encode(n.children, level + 1))));
      model = parseHwp5(hwp({ compressed: false, streams: { DocInfo: encode(info) } }));
      expect(model.fontFallbacks.get('Original')).toEqual(['Custom substitute', 'Arial']);
    } else {
      model = parseHwpx(hwpx({ header: `<hh:fontface lang="HANGUL"><hh:font id="0" face="Original"><hh:substFont face="Custom substitute"/></hh:font></hh:fontface>
        <hh:charPr id="0" height="1200"><hh:fontRef hangul="0"/></hh:charPr>` }));
      expect(model.fontFallbacks.get('Original')).toEqual(['Custom substitute']);
    }
    await prepareHanwordFonts(model);
    expect(model.chars[0].eastAsia).toBe('Custom substitute');
    expect([...model.warnings].some((w) => w.includes('Original → Custom substitute'))).toBe(true);
  });

  it('turns a carriage return written as a character reference into a line break', () => {
    vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
    const model = parseHwpx(hwpx({ sections: ['<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>a&#13;b&#13;&#10;c</hp:t></hp:run></hp:p>'] }));
    expect(model.sections[0].blocks[0].runs[0].text).toBe('a\nb\nc');
    const xml = strFromU8(unzipSync(modelToDocx(model))['word/document.xml']);
    expect(xml).not.toContain('&#13;');
    expect(xml.match(/<w:br\/>/g)).toHaveLength(2);
  });

  it('reports an HWPX part in an unreadable encoding as a damaged file, not as a script error', () => {
    vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
    const latin1 = new Uint8Array([0x3c, 0x68, 0x73, 0x3a, 0x73, 0x65, 0x63, 0x3e, 0xe9, 0xe8, 0x3c, 0x2f, 0x68, 0x73, 0x3a, 0x73, 0x65, 0x63, 0x3e]);
    expect(() => parseHwpx(hwpx({ extra: { 'Contents/section0.xml': latin1 } }))).toThrow(/not in a readable encoding/);
  });
});
