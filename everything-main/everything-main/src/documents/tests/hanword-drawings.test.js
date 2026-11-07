import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { JSDOM } from 'jsdom';
import { Reader } from '../src/lib/hwp/binary.js';
import { polygonPoints, drawingMatrix, groupPlacement } from '../src/lib/hwp/drawing.js';
import { parseHwp5 } from '../src/lib/hwp/hwp5.js';
import { parseHwpx } from '../src/lib/hwp/hwpx.js';
import { modelToDocx } from '../src/lib/hwp/docx.js';
import { prepareHanwordImages } from '../src/lib/hwp/prepare-images.js';
import { hwp, hwpx, paragraph, concat, record, u16, u32, controlText, string } from './helpers/hwp-fixtures.js';
import { bmp, imageHwpx, picture, png } from './helpers/image-fixtures.js';

const matrix = (values = [1, 0, 0, 0, 1, 0]) => {
  const bytes = Buffer.alloc(48); values.forEach((value, i) => bytes.writeDoubleLE(value, i * 8)); return bytes;
};
beforeAll(() => { globalThis.DOMParser = new JSDOM('').window.DOMParser; });
const component = (id, { x = 0, y = 0, width = 1200, height = 600, root = false, scale = 1, lineFlags = 1 } = {}) => concat(
  Buffer.from(id).reverse(), root ? Buffer.from(id).reverse() : [], u32(x), u32(y), u16(root ? 0 : 1), u16(1),
  u32(width), u32(height), u32(width * scale), u32(height * scale), u32(0), u16(0), new Uint8Array(8), u16(1),
  matrix([1, 0, x, 0, 1, y]), matrix([scale, 0, 0, 0, scale, 0]), matrix(),
  id === '$con' || id === '$pic' ? [] : concat(u32(0), u32(32), u32(lineFlags), [0], u32(1), u32(0xf7eee6), u32(0), u32(0xffffffff)),
);
const polygons = (word = false) => concat(word ? u16(3) : u32(3), u32(0), u32(4), u32(1200), u32(0), u32(600), u32(600), u32(0));
const groupFile = () => hwp({ compressed: false, sections: [paragraph(controlText(11, 'gso '), { children: [concat(
  record(71, 1, concat(Buffer.from('gso ').reverse(), u32(1), new Uint8Array(8), u32(6000), u32(2400))),
  record(76, 2, component('$con', { root: true, width: 6000, height: 2400 })),
  record(76, 3, component('$pol', { x: 100, y: 200, scale: 2 })), record(82, 4, polygons()),
  record(76, 3, component('$pic', { x: 2500, y: 200 })),
  record(85, 4, concat(new Uint8Array(71), u16(1))),
  record(76, 3, component('$rec', { x: 100, y: 1500 })),
  record(72, 4, concat(u32(1), u32(32), u16(100), u16(100), u16(50), u16(50), u32(1200))),
  paragraph('목차', { level: 4 }), record(79, 4, concat([0], new Uint8Array(32))),
)] })], infoExtra: [record(18, 1, concat(u16(1), u16(1), string('bmp')))], streams: { 'BinData/BIN0001.bmp': bmp() } });
const xml = (model) => {
  const files = unzipSync(modelToDocx(model));
  return { files, document: new JSDOM(strFromU8(files['word/document.xml']), { contentType: 'text/xml' }).window.document };
};
const elements = (node, name) => [...node.getElementsByTagNameNS('*', name)];

describe('HWP grouped artwork', () => {
  it.each([false, true])('decodes interleaved polygon coordinates with a %s legacy count', (legacy) => {
    expect(polygonPoints(new Reader(polygons(legacy)))).toEqual([{ x: 0, y: 4 }, { x: 1200, y: 0 }, { x: 600, y: 600 }]);
  });
  it('rejects truncated polygons and nonfinite transforms', () => {
    expect(() => polygonPoints(new Reader(concat(u32(3), u32(0))))).toThrow();
    expect(() => drawingMatrix(new Reader(matrix([NaN, 0, 0, 0, 1, 0])), 0)).toThrow();
  });
  it('composes the translation and scale sequence once, retaining rotation', () => {
    const m = drawingMatrix(new Reader(concat(matrix([1, 0, 100, 0, 1, 200]), matrix([2, 0, 0, 0, 3, 0]), matrix())), 1);
    expect(groupPlacement(m, 1200, 600, new Set())).toEqual({ x: 100, y: 200, width: 2400, height: 1800, rotation: 0, flipH: false, flipV: false });
    expect(groupPlacement([0, -1, 600, 1, 0, 0], 1200, 600, new Set())).toMatchObject({ rotation: 90, width: 1200, height: 600, x: -300, y: 300 });
  });
  it('keeps polygons, pictures and text together in source paint order', async () => {
    const model = parseHwp5(groupFile()), group = model.sections[0].blocks[0].runs[0];
    expect(group.kind).toBe('group');
    expect(group.children.map((child) => child.kind === 'shape' ? child.shape : child.kind)).toEqual(['polygon', 'image', 'rect']);
    expect(group.children[0]).toMatchObject({ x: 100, y: 200, width: 2400, height: 1200, points: [{ x: 0, y: 4 }, { x: 1200, y: 0 }, { x: 600, y: 600 }] });
    expect(group.children[2]).toMatchObject({ textAlign: 'center', padding: { left: 100, right: 100, top: 50, bottom: 50 } });
    await prepareHanwordImages(model);
    const { files, document } = xml(model), drawing = elements(document, 'wgp')[0];
    expect(elements(document, 'inline')).toHaveLength(1);
    expect([...drawing.children].map((n) => n.localName)).toEqual(['cNvGrpSpPr', 'grpSpPr', 'wsp', 'pic', 'wsp']);
    expect(elements(drawing, 't').map((n) => n.textContent)).toEqual(['목차']);
    expect(elements(drawing, 'lnTo')[0].textContent).toBe('');
    expect(elements(elements(drawing, 'wsp')[0], 'off')[0].getAttribute('x')).toBe('12700');
    expect(Object.keys(files).filter((name) => name.startsWith('word/media/'))).toEqual(['word/media/image1.png']);
    expect(strFromU8(files['word/_rels/document.xml.rels'])).toContain('Target="media/image1.png"');
  });
  it('retains a failed grouped picture description without invalid group markup', async () => {
    const model = parseHwp5(groupFile()), picture = model.sections[0].blocks[0].runs[0].children[1];
    picture.image.bytes = new Uint8Array([1, 2]); picture.alt = 'Diagram';
    await prepareHanwordImages(model);
    const { document } = xml(model), group = elements(document, 'wgp')[0];
    expect(group.textContent).toContain('[Picture unavailable: Diagram]');
    expect([...group.children].some((n) => n.localName === 'r')).toBe(false);
  });
  it('retains the paragraph mark formatting on blank paragraphs', () => {
    const model = parseHwp5(hwp({ sections: [paragraph('', { char: 1 })] }));
    model.chars[1].size = 2400;
    const { document } = xml(model), properties = elements(document, 'pPr')[0];
    expect(elements(properties, 'sz')[0].getAttribute('w:val')).toBe('48');
    expect(elements(properties, 'b')[0].getAttribute('w:val')).toBe('1');
  });
  it('does not repeat a partial vertical merge or count merged artwork height twice', () => {
    const model = parseHwp5(groupFile()), group = model.sections[0].blocks[0].runs[0];
    const p = (runs = []) => ({ kind: 'p', runs });
    const cell = (row, col, rowSpan, blocks) => ({ row, col, rowSpan, colSpan: 1, width: 6000, height: rowSpan * 1200, blocks });
    model.sections[0].blocks = [{ kind: 'p', pageBreak: true, runs: [{ kind: 'table', rows: 3, cols: 2, repeatHeader: true, cells: [
      cell(0, 0, 2, [p([group])]), cell(0, 1, 1, [p()]), cell(1, 1, 1, [p()]),
      cell(2, 0, 1, [p([{ kind: 'text', text: 'Body' }])]), cell(2, 1, 1, [p()]),
    ] }] }];
    const { document } = xml(model);
    expect(elements(document, 'tblHeader')).toHaveLength(0);
    expect(elements(document, 'trHeight').map((n) => n.getAttribute('w:hRule'))).toEqual(['exact', 'exact', 'atLeast']);
    const breakParagraph = elements(document, 'p')[0];
    expect(elements(breakParagraph, 'pageBreakBefore')).toHaveLength(1);
    expect(elements(breakParagraph, 'spacing')[0].getAttribute('w:line')).toBe('1');
  });
});

const xmlParagraph = (body) => `<hp:p><hp:run>${body}</hp:run></hp:p>`;
const xmlLine = (width, height, attrs = '') => `<hp:line><hp:sz width="${width}" height="${height}"/><hp:lineShape width="33" style="SOLID" ${attrs}/><hp:startPt x="0" y="0"/><hp:endPt x="${width}" y="${height}"/></hp:line>`;
const xmlMatrices = (x, y, scale = 1) => `<hp:renderingInfo><hp:transMatrix e1="1" e2="0" e3="${x}" e4="0" e5="1" e6="${y}"/><hp:scaMatrix e1="${scale}" e2="0" e3="0" e4="0" e5="${scale}" e6="0"/><hp:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>`;
const xmlGroup = () => `<hp:container><hp:sz width="6000" height="2400"/><hp:pos treatAsChar="1"/>
  <hp:rect><hp:orgSz width="1200" height="600"/>${xmlMatrices(100, 200, 2)}<hp:drawText><hp:subList>${xmlParagraph('<hp:t>Grouped label</hp:t>')}</hp:subList></hp:drawText></hp:rect>
  <hp:container>${xmlMatrices(900, 900, 3)}<hp:line><hp:orgSz width="1200" height="0"/><hp:curSz width="0" height="0"/>${xmlMatrices(2500, 200)}<hp:startPt x="1200" y="0"/><hp:endPt x="0" y="0"/></hp:line></hp:container>
  <hp:pic><hp:orgSz width="1200" height="600"/>${xmlMatrices(100, 1500)}<hp:img binaryItemIDRef="missing"/><hp:shapeComment>Logo</hp:shapeComment></hp:pic>
</hp:container>`;

describe('Hanword lines and HWPX groups', () => {
  it.each([[1200, 0], [0, 1200]])('retains a zero extent on a %s × %s HWPX line', (width, height) => {
    const model = parseHwpx(hwpx({ sections: [xmlParagraph(xmlLine(width, height))] }));
    expect(model.sections[0].blocks[0].runs[0]).toMatchObject({ width, height });
    const { document } = xml(model);
    const extent = elements(document, 'extent')[0], shapeExtent = elements(document, 'ext')[0];
    expect([extent.getAttribute('cx'), extent.getAttribute('cy')]).toEqual([String(Math.max(127, width * 127)), String(Math.max(127, height * 127))]);
    expect([shapeExtent.getAttribute('cx'), shapeExtent.getAttribute('cy')]).toEqual([extent.getAttribute('cx'), extent.getAttribute('cy')]);
  });
  it('retains binary arrow types, independent sizes, caps and horizontal geometry', () => {
    const flags = 1 | 1 << 6 | 1 << 10 | 2 << 16 | 2 << 22 | 6 << 26 | 1 << 30 | 1 << 31;
    const model = parseHwp5(hwp({ sections: [paragraph(controlText(11, 'gso '), { children: [concat(
      record(71, 1, concat(Buffer.from('gso ').reverse(), u32(1), new Uint8Array(8), u32(1200), u32(0))),
      record(76, 2, component('$lin', { root: true, height: 0, lineFlags: flags })),
      record(78, 3, concat(u32(1200), u32(0), u32(0), u32(0))),
    )] })] }));
    expect(model.sections[0].blocks[0].runs[0]).toMatchObject({ height: 0, flipH: true, line: { head: 'ARROW', tail: 'CONCAVE_ARROW' } });
    const { document } = xml(model);
    expect(elements(document, 'extent')[0].getAttribute('cy')).toBe('127');
    expect(elements(document, 'headEnd')[0].outerHTML).toContain('type="triangle" w="sm" len="lg"');
    expect(elements(document, 'tailEnd')[0].outerHTML).toContain('type="stealth" w="lg" len="sm"');
    expect(elements(document, 'ln')[0].getAttribute('cap')).toBe('flat');
  });
  it('imports HWPX spear arrows, end sizes and round line caps', () => {
    const model = parseHwpx(hwpx({ sections: [xmlParagraph(xmlLine(1200, 600, 'endCap="ROUND" headStyle="SPEAR" headSz="SMALL_LARGE" tailStyle="ARROW" tailSz="LARGE_SMALL" tailfill="1"'))] }));
    const { document } = xml(model);
    expect(elements(document, 'headEnd')[0].outerHTML).toContain('type="arrow" w="sm" len="lg"');
    expect(elements(document, 'tailEnd')[0].outerHTML).toContain('type="triangle" w="lg" len="sm"');
    expect(elements(document, 'ln')[0].getAttribute('cap')).toBe('rnd');
  });
  it('keeps nested HWPX artwork in one drawing with complete leaf transforms and source order', () => {
    const model = parseHwpx(hwpx({ sections: [xmlParagraph(xmlGroup())] }));
    const group = model.sections[0].blocks[0].runs[0];
    expect(group).toMatchObject({ kind: 'group', width: 6000, height: 2400 });
    expect(group.children).toHaveLength(3);
    expect(group.children[0]).toMatchObject({ x: 100, y: 200, width: 2400, height: 1200 });
    expect(group.children[1]).toMatchObject({ x: 2500, y: 200, width: 1200, height: 0, flipH: true });
    expect(group.children[2]).toMatchObject({ kind: 'text', x: 100, y: 1500, text: '[Missing picture: Logo]' });
    const { document } = xml(model);
    expect(elements(document, 'inline')).toHaveLength(1);
    expect(elements(document, 'wgp')).toHaveLength(1);
    expect(elements(document, 't').map((n) => n.textContent)).toEqual(['Grouped label', '[Missing picture: Logo]']);
    expect(elements(document, 'parsererror')).toHaveLength(0);
  });
  it('leaves out a grouped member with an invalid transform instead of writing NaN geometry or refusing the file', () => {
    // A scale that overflows to Infinity is invalid geometry too.
    for (const bad of ['NaN', '1e308']) {
      const model = parseHwpx(hwpx({ sections: [xmlParagraph(xmlGroup().replace('e1="2"', `e1="${bad}"`))] }));
      expect([...model.warnings]).toContain('A drawing with an invalid geometry was left out.');
      const { document } = xml(model);
      expect(elements(document, 'parsererror')).toHaveLength(0);
      expect(strFromU8(unzipSync(modelToDocx(model))['word/document.xml'])).not.toMatch(/NaN|Infinity/);
    }
  });
  it('bounds grouped child geometry to whole EMUs within the DOCX range', () => {
    // HWP 5 matrices are doubles: a scale of 1e200 places a child at a finite
    // but absurd size, which must not reach the XML as exponent notation.
    const placed = groupPlacement([1e200, 0, 0, 0, 1e200, 0], 1200, 600, new Set());
    expect(placed.width).toBe(1200 * 1e200);
    expect(() => groupPlacement([1e308, 0, 0, 0, 1e308, 0], 1200, 600, new Set())).toThrow(/invalid size/);
    const model = parseHwpx(hwpx({ sections: [xmlParagraph(xmlGroup())] }));
    Object.assign(model.sections[0].blocks[0].runs[0].children[0], { x: placed.x, y: placed.y, width: placed.width, height: placed.height });
    const { files, document } = xml(model);
    const source = strFromU8(files['word/document.xml']);
    expect(source).not.toMatch(/e\+|Infinity|NaN/);
    for (const node of [...elements(document, 'ext'), ...elements(document, 'off')]) {
      for (const name of ['cx', 'cy', 'x', 'y']) {
        const value = node.getAttribute(name);
        if (value != null) expect(Math.abs(Number(value))).toBeLessThanOrEqual(2147483647);
      }
    }
  });
  it('retains the actual SimpleContainer pictures and connecting line as one anchored drawing', async () => {
    const model = parseHwpx(readFileSync(new URL('./fixtures/hwpx/SimpleContainer.hwpx', import.meta.url)));
    const group = model.sections[0].blocks.flatMap((p) => p.runs).find((r) => r.kind === 'group');
    expect(group.children.map((c) => c.kind)).toEqual(['image', 'image', 'shape']);
    expect(group.children[0].width).toBeCloseTo(6225, 1);
    expect(group.children[1].width).toBeCloseTo(8722, 1);
    expect(group.children[1]).toMatchObject({ x: 8650, y: 300 });
    expect(group.children[2]).toMatchObject({ x: 3050, y: 1575, width: 10200, height: 200 });
    await prepareHanwordImages(model);
    const { files, document } = xml(model);
    expect(elements(document, 'anchor')).toHaveLength(1);
    expect(elements(document, 'pic')).toHaveLength(2);
    expect(elements(document, 'wgp')).toHaveLength(1);
    expect(Object.keys(files).filter((name) => name.startsWith('word/media/'))).toHaveLength(2);
    expect(elements(document, 't').map((n) => n.textContent).join('')).not.toContain('Missing picture');
  });
  it('keeps an empty polygon placeholder valid inside its group', () => {
    const model = parseHwpx(hwpx({ sections: [xmlParagraph('<hp:container><hp:sz width="1200" height="600"/><hp:polygon><hp:orgSz width="1200" height="600"/></hp:polygon></hp:container>')] }));
    const { document } = xml(model), group = elements(document, 'wgp')[0];
    expect([...group.children].map((n) => n.localName)).toEqual(['cNvGrpSpPr', 'grpSpPr', 'wsp']);
    expect(group.textContent).toContain('[Empty polygon]');
  });
});

describe('text boxes holding drawings', () => {
  const box = (inner, pos = 'treatAsChar="0" horzRelTo="PAPER" vertRelTo="PAPER" horzOffset="2500" vertOffset="3500"') => `<hp:rect><hp:sz width="12000" height="6000"/><hp:pos ${pos}/><hp:lineShape color="#112233" width="100" style="SOLID"/><hp:drawText><hp:textMargin left="300" right="300" top="150" bottom="150"/><hp:subList><hp:p><hp:run>${inner}<hp:t>inside</hp:t></hp:run></hp:p></hp:subList></hp:drawText></hp:rect>`;
  const floating = '<hp:rect><hp:sz width="1200" height="600"/><hp:pos treatAsChar="0" horzRelTo="COLUMN" vertRelTo="PARA" horzOffset="400" vertOffset="700"/><hp:lineShape color="#000000" width="33"/></hp:rect>';
  const offsets = (node) => elements(node, 'off').map((off) => [off.getAttribute('x'), off.getAttribute('y')]);

  it('lifts a shape drawn in a text box into a group beside the box, at its offset from the text corner', () => {
    const model = parseHwpx(hwpx({ sections: [`<hp:p><hp:run>${box(floating)}<hp:t>title</hp:t></hp:run></hp:p>`] }));
    const { document } = xml(model);
    expect(elements(document, 'drawing')).toHaveLength(1);
    const group = elements(document, 'wgp')[0], shapes = elements(group, 'wsp');
    expect(shapes).toHaveLength(2);
    expect(elements(shapes[0], 'txbxContent')[0].textContent).toBe('inside');
    expect(elements(shapes[0], 'drawing')).toHaveLength(0);
    // Text margin 300/150 plus the shape's own offset 400/700, in EMUs.
    expect(offsets(shapes[1])).toEqual([[String(700 * 127), String(850 * 127)]]);
    expect(elements(document, 'extent')[0].getAttribute('cx')).toBe(String(12000 * 127));
    expect(elements(document, 'positionH')[0].textContent).toBe(String(2500 * 127));
    expect([...model.warnings]).toContain('Drawings inside a text box are grouped beside the box, at their place in it.');
  });

  it('lifts a picture framed by a text box, keeping the box\'s text in the box', () => {
    const model = parseHwpx(imageHwpx(`${box(picture())}<hp:t>title</hp:t>`, { 'image.png': png() }));
    const { document } = xml(model);
    expect(elements(document, 'drawing')).toHaveLength(1);
    const group = elements(document, 'wgp')[0];
    expect(elements(group, 'pic')).toHaveLength(1);
    expect(elements(group, 'txbxContent')[0].textContent).toBe('inside');
    expect(elements(elements(group, 'txbxContent')[0], 'drawing')).toHaveLength(0);
    expect(offsets(elements(group, 'pic')[0])).toEqual([[String(300 * 127), String(150 * 127)]]);
  });

  it('lifts a group drawn in a text box as its members, beside the box', () => {
    const matrices = (x, y) => `<hp:renderingInfo><hp:transMatrix e1="1" e2="0" e3="${x}" e4="0" e5="1" e6="${y}"/><hp:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hp:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>`;
    const group = `<hp:container><hp:sz width="2000" height="1000"/><hp:pos treatAsChar="0" horzRelTo="COLUMN" vertRelTo="PARA" horzOffset="500" vertOffset="600"/>
      <hp:rect><hp:orgSz width="1000" height="1000"/>${matrices(0, 0)}<hp:lineShape color="#000000" width="33"/></hp:rect>
      <hp:ellipse><hp:orgSz width="1000" height="1000"/>${matrices(1000, 0)}<hp:lineShape color="#000000" width="33"/></hp:ellipse>
    </hp:container>`;
    const { document } = xml(parseHwpx(hwpx({ sections: [`<hp:p><hp:run>${box(group)}<hp:t>title</hp:t></hp:run></hp:p>`] })));
    expect(elements(document, 'wgp')).toHaveLength(1);
    const shapes = elements(document, 'wsp');
    expect(shapes).toHaveLength(3);
    expect(elements(document, 'prstGeom').map((g) => g.getAttribute('prst'))).toEqual(['rect', 'rect', 'ellipse']);
    // Text margin 300/150, the group's own 500/600, then each member's place in the group.
    expect(offsets(shapes[1])).toEqual([[String(800 * 127), String(750 * 127)]]);
    expect(offsets(shapes[2])).toEqual([[String(1800 * 127), String(750 * 127)]]);
  });

  it('writes no drawing into a text box for a table whose cells would draw one', () => {
    const header = '<hh:borderFill id="1"><hh:slash type="CENTER" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/><hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/><hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/><hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/><hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/><hh:diagonal type="SOLID" width="0.12 mm" color="#ff0000"/></hh:borderFill>'
      + '<hh:borderFill id="2"><hh:fillBrush><hh:gradation type="LINEAR" angle="90" centerX="0" centerY="0" step="50" colorNum="2" stepCenter="50" alpha="0"><hh:color value="#ff0000"/><hh:color value="#0000ff"/></hh:gradation></hh:fillBrush></hh:borderFill>';
    const cell = (col, fill, text) => `<hp:tc borderFillIDRef="${fill}"><hp:subList><hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="${col}" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="6000" height="2000"/></hp:tc>`;
    const table = `<hp:tbl rowCnt="1" colCnt="2"><hp:sz width="12000" height="2000"/><hp:pos treatAsChar="1"/><hp:tr>${cell(0, 1, 'slash')}${cell(1, 2, '')}</hp:tr></hp:tbl>`;
    const { document, files } = xml(parseHwpx(hwpx({ header, sections: [`<hp:p><hp:run>${box(table)}<hp:t>title</hp:t></hp:run></hp:p>`] })));
    const source = strFromU8(files['word/document.xml']);
    const inBox = source.slice(source.indexOf('<w:txbxContent>'), source.indexOf('</w:txbxContent>'));
    expect(inBox).toContain('<w:tbl>');
    expect(inBox).not.toContain('<w:drawing>');
    expect(elements(document, 'drawing')).toHaveLength(1);
  });

  it('keeps a horizontal rule lifted out of a text box flat', () => {
    const rule = '<hp:line><hp:sz width="6000" height="0"/><hp:pos treatAsChar="0" horzRelTo="COLUMN" vertRelTo="PARA" horzOffset="0" vertOffset="1000"/><hp:lineShape color="#000000" width="33"/></hp:line>';
    const { document } = xml(parseHwpx(hwpx({ sections: [`<hp:p><hp:run>${box(rule)}</hp:run></hp:p>`] })));
    const line = elements(document, 'wsp')[1];
    expect(elements(line, 'prstGeom')[0].getAttribute('prst')).toBe('line');
    expect(elements(line, 'ext')[0].getAttribute('cy')).toBe('127');
    expect(elements(document, 'extent')[0].getAttribute('cy')).toBe(String(6000 * 127));
  });

  it('grows the group around a drawing that reaches past the box and leaves a box without drawings alone', () => {
    const wide = floating.replace('width="1200"', 'width="20000"');
    const { document } = xml(parseHwpx(hwpx({ sections: [`<hp:p><hp:run>${box(wide)}</hp:run></hp:p>`] })));
    expect(elements(document, 'extent')[0].getAttribute('cx')).toBe(String((300 + 400 + 20000) * 127));
    const plain = xml(parseHwpx(hwpx({ sections: [`<hp:p><hp:run>${box('')}</hp:run></hp:p>`] }))).document;
    expect(elements(plain, 'wgp')).toHaveLength(0);
    expect(elements(plain, 'wsp')).toHaveLength(1);
  });

  it('keeps a grouped text box\'s drawings beside it inside the group', () => {
    const matrices = (x, y) => `<hp:renderingInfo><hp:transMatrix e1="1" e2="0" e3="${x}" e4="0" e5="1" e6="${y}"/><hp:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hp:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>`;
    const group = `<hp:container><hp:sz width="12000" height="6000"/><hp:pos treatAsChar="0" horzRelTo="PAPER" vertRelTo="PAPER" horzOffset="0" vertOffset="0"/>
      <hp:rect><hp:orgSz width="6000" height="6000"/>${matrices(1000, 0)}<hp:lineShape color="#112233" width="100"/><hp:drawText><hp:subList><hp:p><hp:run>${floating}<hp:t>inside</hp:t></hp:run></hp:p></hp:subList></hp:drawText></hp:rect>
      <hp:rect><hp:orgSz width="1200" height="600"/>${matrices(100, 100)}<hp:lineShape color="#000000" width="33"/></hp:rect>
    </hp:container>`;
    const { document } = xml(parseHwpx(hwpx({ sections: [`<hp:p><hp:run>${group}</hp:run></hp:p>`] })));
    expect(elements(document, 'wgp')).toHaveLength(1);
    const shapes = elements(document, 'wsp');
    expect(shapes).toHaveLength(3);
    expect(elements(shapes[0], 'txbxContent')).toHaveLength(1);
    expect(elements(shapes[0], 'drawing')).toHaveLength(0);
    // The box sits at 1000 in the group; the lifted shape adds its own 400/700 offset.
    expect(offsets(shapes[1])).toEqual([[String(1400 * 127), String(700 * 127)]]);
  });
});
