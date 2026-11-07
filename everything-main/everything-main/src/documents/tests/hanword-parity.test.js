import { beforeAll, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { parseHwp5 } from '../src/lib/hwp/hwp5.js';
import { parseHwpx } from '../src/lib/hwp/hwpx.js';
import { modelToDocx } from '../src/lib/hwp/docx.js';
import { concat, hwp, hwpx, cfb, paragraph, record, u16, u32, controlText, string, utf16, PARA_NS } from './helpers/hwp-fixtures.js';
import { png, bmp, wmf } from './helpers/image-fixtures.js';
import { oleImage } from '../src/lib/hwp/ole.js';
import { imageFormat, imageResource } from '../src/lib/hwp/image.js';
import { flattenInlineDrawings } from '../src/lib/hwp/prepare-images.js';
import { formatNumber, levelLabel, advanceCounters, docxNumberFormat } from '../src/lib/hwp/numbering.js';
import { numberFormats, namedNumberFormats } from '../src/lib/hwp/formatting.js';

beforeAll(() => { globalThis.DOMParser = new JSDOM('').window.DOMParser; });
const files = (model) => Object.fromEntries(Object.entries(unzipSync(modelToDocx(model))).filter(([name]) => /\.(xml|rels)$/.test(name)).map(([name, bytes]) => [name, strFromU8(bytes)]));
const parse = (text) => new JSDOM(text, { contentType: 'text/xml' }).window.document;
const elements = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const attr = (node, name) => node?.getAttribute(`w:${name}`);
const control = (id, data, level = 1) => record(71, level, concat(Buffer.from(id).reverse(), data));
const UNIT_NS = 'http://www.hancom.co.kr/hwpml/2016/HwpUnitChar';
// The fixture header declares only hh:, so switch elements and case attributes declare hp: locally.
const SWITCH = `<hp:switch xmlns:hp="${PARA_NS}">`;
const HEADER = '<hh:charPr id="0" height="1000"/><hh:paraPr id="0" tabPrIDRef="0"/><hh:style id="0" name="본문" paraPrIDRef="0" charPrIDRef="0"/>';
const run = (inner, char = 0) => `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="${char}">${inner}</hp:run></hp:p>`;
const ptext = (text) => run(`<hp:t>${text}</hp:t>`);
const cell = (contents, border = 0) => `<hp:tbl rowCnt="1" colCnt="1"><hp:tr><hp:tc borderFillIDRef="${border}"><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="12000" height="2000"/><hp:subList>${contents}</hp:subList></hp:tc></hp:tr></hp:tbl>`;
// A binary table whose single cell uses border-fill definition `border`.
const tableBinary = (contents, border) => concat(control('tbl ', new Uint8Array(20)),
  record(77, 2, concat(u32(0), u16(1), u16(1), new Uint8Array(10), u16(1), u16(0))),
  record(72, 2, concat(u32(1), u32(0), u16(0), u16(0), u16(1), u16(1), u32(7200), u32(3600), new Uint8Array(8), u16(border))), contents);
const side = (type, color = 0) => concat([type, 0], u32(color));

describe('Hanword tab units', () => {
  it('reads HWPX tab positions from the HWPUNIT branch and halves legacy values', () => {
    const header = `<hh:tabPr id="0">${SWITCH}<hp:case hp:required-namespace="${UNIT_NS}"><hh:tabItem pos="4032" type="LEFT" leader="NONE" unit="HWPUNIT"/></hp:case><hp:default><hh:tabItem pos="8064" type="LEFT" leader="NONE"/></hp:default></hp:switch><hh:tabItem pos="12000" type="RIGHT" leader="DOT"/></hh:tabPr>${HEADER}`;
    const model = parseHwpx(hwpx({ header, sections: [run('<hp:secPr tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT"/><hp:t>탭</hp:t>'), run('<hp:secPr tabStop="8000"/><hp:t>탭</hp:t>')] }));
    expect(model.sections).toHaveLength(2);
    expect(model.paras[0].tabs.map((t) => t.pos)).toEqual([4032, 6000]);
    expect(model.sections.map((s) => s.defaultTab)).toEqual([4000, 4000]);
    const out = files(model);
    expect(elements(parse(out['word/document.xml']), 'tab').map((t) => attr(t, 'pos'))).toEqual(['806', '1200', '806', '1200']);
    expect(attr(elements(parse(out['word/settings.xml']), 'defaultTabStop')[0], 'val')).toBe('800');
    expect([...model.warnings].some((w) => w.includes('Tab stops'))).toBe(false);
  });
  it('halves binary tab positions and the section default tab', () => {
    const tabs = record(22, 1, concat(u32(0), u32(2), u32(8000), [1, 0], u16(0), u32(65754), [0, 0], u16(0)));
    const secd = control('secd', concat(u32(0), new Uint8Array(6), u32(8000), u16(0), u16(0), u16(0)));
    const model = parseHwp5(hwp({ infoExtra: [tabs], sections: [paragraph(concat(controlText(2, 'secd'), utf16('제목'), controlText(9, 'tab '), utf16('끝\r')), { children: [secd] })] }));
    expect(model.paras[0].tabs).toEqual([{ pos: 4000, align: 'right', leader: 'none' }, { pos: 32877, align: 'left', leader: 'none' }]);
    expect(model.sections[0].defaultTab).toBe(4000);
    const out = files(model);
    expect(elements(parse(out['word/document.xml']), 'tab').filter((t) => attr(t, 'pos')).map((t) => attr(t, 'pos'))).toEqual(['800', '6575']);
    expect(attr(elements(parse(out['word/settings.xml']), 'defaultTabStop')[0], 'val')).toBe('800');
  });
  it('falls back to the default branch for charts and other unreadable switch cases', () => {
    const model = parseHwpx(hwpx({ sections: [run('<hp:switch><hp:case hp:required-namespace="http://www.hancom.co.kr/hwpml/2016/ooxmlchart"><hp:chart chartIDRef="Chart/chart1.xml"/></hp:case><hp:default><hp:rect id="1"><hp:sz width="1200" height="600"/><hp:lineShape color="#000000" width="33"/></hp:rect></hp:default></hp:switch>')] }));
    expect(model.sections[0].blocks[0].runs.map((r) => r.kind)).toEqual(['shape']);
  });
});

describe('Hanword border styles', () => {
  it('maps every HWPX line type to a WordprocessingML border and draws cell diagonals', () => {
    const header = `<hh:borderFill id="1"><hh:slash type="CENTER"/><hh:backSlash type="NONE"/><hh:leftBorder type="SLIM_THICK" width="0.5 mm" color="#FF0000"/><hh:rightBorder type="LONG_DASH" width="0.12 mm" color="#000000"/><hh:topBorder type="THICK_3D" width="0.12 mm" color="#000000"/><hh:bottomBorder type="DOUBLE_WAVE" width="0.12 mm" color="#000000"/><hh:diagonal type="SOLID" width="0.12 mm" color="#0000FF"/></hh:borderFill>${HEADER.replace('<hh:paraPr id="0" tabPrIDRef="0"/>', '<hh:paraPr id="0"><hh:border borderFillIDRef="1"/></hh:paraPr>')}`;
    const doc = parse(files(parseHwpx(hwpx({ header, sections: [run(cell(ptext('cell'), 1))] })))['word/document.xml']);
    const borders = (tag) => Object.fromEntries([...elements(doc, tag)[0].children].map((c) => [c.localName, attr(c, 'val')]));
    expect(borders('tcBorders')).toEqual({ top: 'threeDEmboss', left: 'thinThickSmallGap', bottom: 'doubleWave', right: 'dashed', tr2bl: 'single' });
    expect(attr(elements(doc, 'tr2bl')[0], 'color')).toBe('0000FF');
    expect(Object.keys(borders('pBdr'))).toEqual(['top', 'left', 'bottom', 'right']);
    // DOCX readers refuse unknown border names; every emitted value must be one the schema defines.
    const valid = new Set(['nil', 'single', 'dashed', 'dotted', 'dotDash', 'dotDotDash', 'double', 'thinThickSmallGap', 'thickThinSmallGap', 'thinThickThinSmallGap', 'wave', 'doubleWave', 'threeDEmboss', 'threeDEngrave', 'inset', 'outset']);
    for (const element of elements(doc, 'tcBorders').flatMap((b) => [...b.children])) expect(valid.has(attr(element, 'val'))).toBe(true);
  });
  it('reads binary long-dash, 3D and diagonal lines from border-fill records', () => {
    // Flags select a slash and a backslash; the diagonal line follows the four sides.
    const border = record(20, 1, concat(u16((1 << 2) | (1 << 5)), side(6), side(14), side(16), side(17), side(1, 0xff0000), u32(0)));
    const model = parseHwp5(hwp({ infoExtra: [border], sections: [paragraph(concat(controlText(11, 'tbl '), utf16('\r')), { children: [tableBinary(paragraph('cell', { level: 2 }), 1)] })] }));
    expect(model.chars.length).toBeGreaterThan(0);
    const b = model.sections[0].blocks[0].runs[0].cells[0].border;
    expect([b.left.style, b.right.style, b.top.style, b.bottom.style]).toEqual(['dashed', 'threeDEmboss', 'inset', 'outset']);
    expect(b.tr2bl).toEqual({ style: 'single', size: 2, color: '0000ff' });
    expect(b.tl2br).toBe(b.tr2bl);
    const doc = parse(files(model)['word/document.xml']);
    expect([...elements(doc, 'tcBorders')[0].children].map((c) => c.localName)).toEqual(['top', 'left', 'bottom', 'right', 'tl2br', 'tr2bl']);
  });
});

describe('Hanword fields and annotations', () => {
  const clickHere = (inner, id = '7') => `<hp:ctrl><hp:fieldBegin id="${id}" type="CLICK_HERE" name="필드"><hp:parameters cnt="3"><hp:integerParam name="Prop">9</hp:integerParam><hp:stringParam name="Command">Clickhere:set:43:Direction:wstring:5:입력하세요 HelpState:wstring:0:  </hp:stringParam><hp:stringParam name="Direction">입력하세요</hp:stringParam></hp:parameters></hp:fieldBegin></hp:ctrl>${inner}<hp:ctrl><hp:fieldEnd beginIDRef="${id}"/></hp:ctrl>`;
  it('shows the guide text of an empty HWPX click-here field in gray and leaves filled fields alone', () => {
    const model = parseHwpx(hwpx({ sections: [run(clickHere('')) + run(clickHere('<hp:t>값</hp:t>', '8'))] }));
    expect(model.sections[0].blocks[0].runs.map((r) => r.kind)).toEqual(['fieldStart', 'text', 'fieldEnd']);
    expect(model.sections[0].blocks[0].runs[1]).toMatchObject({ text: '입력하세요', props: { color: '808080' } });
    expect(model.sections[0].blocks[1].runs.filter((r) => r.kind === 'text').map((r) => r.text)).toEqual(['값']);
    expect([...model.warnings].some((w) => w.includes('plain text'))).toBe(false);
    const doc = parse(files(model)['word/document.xml']);
    expect(elements(doc, 'color').map((c) => attr(c, 'val'))).toEqual(['808080', '000000']);
  });
  it('shows the guide text of an empty binary click-here field', () => {
    const field = control('%clk', concat(new Uint8Array(5), string('Clickhere:set:43:Direction:wstring:5:입력하세요 HelpState:wstring:0:  ')));
    const model = parseHwp5(hwp({ sections: [paragraph(concat(controlText(3, '%clk'), controlText(4, '%clk'), utf16(' 본문\r')), { children: [field] })] }));
    expect(model.sections[0].blocks[0].runs.map((r) => r.kind === 'text' ? r.text : r.kind)).toEqual(['fieldStart', '입력하세요', 'fieldEnd', ' 본문']);
    expect(model.sections[0].blocks[0].runs[1].props).toEqual({ color: '808080' });
    expect([...model.warnings].some((w) => w.includes('plain text'))).toBe(false);
  });
  it('keeps formula results and names other displayed-text fields specifically', () => {
    const formula = '<hp:ctrl><hp:fieldBegin id="1" type="FORMULA"><hp:parameters><hp:stringParam name="Formula">=SUM(RIGHT)</hp:stringParam></hp:parameters></hp:fieldBegin></hp:ctrl><hp:t>186</hp:t><hp:ctrl><hp:fieldEnd beginIDRef="1"/></hp:ctrl>';
    const date = '<hp:ctrl><hp:fieldBegin id="2" type="DATE"/></hp:ctrl><hp:t>2026-09-13</hp:t><hp:ctrl><hp:fieldEnd beginIDRef="2"/></hp:ctrl>';
    const model = parseHwpx(hwpx({ sections: [run(formula + date)] }));
    expect(model.sections[0].blocks[0].runs.filter((r) => r.kind === 'text').map((r) => r.text)).toEqual(['186', '2026-09-13']);
    expect([...model.warnings]).toEqual(['Table formulas are imported as their last calculated values.', 'Date, path, cross-reference and similar fields are imported as their displayed text.']);
    const binary = parseHwp5(hwp({ sections: [paragraph(concat(controlText(3, '%fmu'), utf16('186'), controlText(4, '%fmu'), utf16('\r')), { children: [control('%fmu', concat(new Uint8Array(5), string('=SUM(RIGHT)')))] })] }));
    expect([...binary.warnings]).toEqual(['Table formulas are imported as their last calculated values.']);
  });
  it('imports hidden comments as comments and drops empty ones silently', () => {
    const hidden = (inner) => `<hp:ctrl><hp:hiddenComment><hp:subList>${inner}</hp:subList></hp:hiddenComment></hp:ctrl>`;
    const model = parseHwpx(hwpx({ sections: [run(hidden(ptext('참고 사항')) + '<hp:t>공고</hp:t>') + run(hidden(run('')) + '<hp:t>빈 설명</hp:t>')] }));
    expect(model.sections[0].blocks[1].runs.map((r) => r.kind)).toEqual(['text']);
    const out = files(model);
    expect(out['word/comments.xml']).toContain('참고 사항');
    expect(elements(parse(out['word/document.xml']), 'commentReference')).toHaveLength(1);
    expect([...model.warnings]).toEqual(['Hidden comments are imported as comments.']);
    const binary = parseHwp5(hwp({ sections: [concat(
      paragraph(concat(controlText(11, 'tcmt'), utf16('공고\r')), { children: [concat(control('tcmt', new Uint8Array(0)), record(72, 2, concat(u32(1), u32(0))), paragraph('참고 사항', { level: 2 }))] }),
      paragraph(concat(controlText(11, 'tcmt'), utf16('빈 설명\r')), { children: [concat(control('tcmt', new Uint8Array(0)), record(72, 2, concat(u32(1), u32(0))), paragraph('', { level: 2 }))] }),
    )] }));
    expect(binary.sections[0].blocks.map((p) => p.runs.map((r) => r.kind))).toEqual([['fieldStart', 'fieldEnd', 'text'], ['text']]);
    expect(files(binary)['word/comments.xml']).toContain('참고 사항');
    expect([...binary.warnings]).toEqual(['Hidden comments are imported as comments.']);
  });
  it('imports command buttons like the other form controls and skips contents markers', () => {
    const model = parseHwpx(hwpx({ sections: [run('<hp:btn caption="명령 단추1" value="UNCHECKED"><hp:sz width="7087" height="1984"/></hp:btn>') + run('<hp:t><hp:titleMark ignore="1"/>제목<hp:hyphen/>줄</hp:t>')] }));
    expect(model.sections[0].blocks.map((p) => p.runs.map((r) => r.text).join(''))).toEqual(['명령 단추1', '제목\u00ad줄']);
    expect([...model.warnings]).toEqual(['Form controls are imported as their visible text and selection state.']);
  });
});

describe('Hanword highlighter', () => {
  it('writes WordprocessingML highlight names for standard colors and run shading for others', () => {
    const model = parseHwpx(hwpx({ sections: [run('<hp:markpenBegin color="#FFFF00"/><hp:t>노랑</hp:t><hp:markpenEnd/><hp:t>보통</hp:t><hp:markpenBegin color="#FFCC99"/><hp:t>살구</hp:t>') + run('<hp:t>다음 문단</hp:t>')] }));
    const runs = model.sections[0].blocks[0].runs;
    expect(runs.map((r) => [r.text, r.highlight])).toEqual([['노랑', 'FFFF00'], ['보통', undefined], ['살구', 'FFCC99']]);
    expect(model.sections[0].blocks[1].runs[0].highlight).toBeUndefined();
    const doc = parse(files(model)['word/document.xml']), properties = elements(doc, 'rPr').filter((p) => p.parentNode.localName === 'r');
    expect(properties.map((p) => [attr(elements(p, 'highlight')[0], 'val'), attr(elements(p, 'shd')[0], 'fill')])).toEqual([['yellow', 'auto'], [undefined, 'auto'], [undefined, 'FFCC99'], [undefined, 'auto']]);
    // Schema order: highlight precedes the underline and shading elements.
    const names = [...properties[0].children].map((c) => c.localName);
    expect(names.indexOf('highlight')).toBeGreaterThan(names.indexOf('szCs'));
    expect(names.indexOf('highlight')).toBeLessThan(names.indexOf('u'));
  });
  it('highlights the text of a table wrapped by a highlighter mark, including marks inside text elements', () => {
    const model = parseHwpx(hwpx({ sections: [run(`<hp:markpenBegin color="#00FF00"/>${cell(ptext('셀'))}<hp:markpenEnd/><hp:t><hp:markpenBegin color="#FF0000"/>안<hp:markpenEnd/>밖</hp:t>`)] }));
    const runs = model.sections[0].blocks[0].runs;
    expect(runs[0].cells[0].blocks[0].runs[0].highlight).toBe('00FF00');
    expect(runs.slice(1).map((r) => [r.text, r.highlight])).toEqual([['안', 'FF0000'], ['밖', undefined]]);
    expect([...model.warnings]).toEqual([]);
  });
});

describe('Hanword drawing captions', () => {
  it('reports a binary drawing caption as a caption rather than a text box', () => {
    const component = concat(Buffer.from('$rec').reverse(), u32(0), u32(0), u16(0), u16(1), u32(6000), u32(2400), u32(6000), u32(2400), u32(0), u16(0), new Uint8Array(8), u16(0), new Uint8Array(48),
      u32(0), u32(32), u32(1), [0], u32(1), u32(0xf7eee6), u32(0), u32(0xffffffff));
    const drawing = concat(control('gso ', concat(u32(1), new Uint8Array(8), u32(6000), u32(2400))),
      record(72, 2, concat(u32(1), u32(0), u32(2), u32(8504), u16(850), u32(20000))), paragraph('그림 1 캡션', { level: 2 }),
      record(76, 2, component), record(72, 3, concat(u32(1), u32(32), u16(100), u16(100), u16(50), u16(50), u32(1200))), paragraph('글상자', { level: 3 }), record(79, 3, concat([0], new Uint8Array(32))));
    const model = parseHwp5(hwp({ compressed: false, sections: [paragraph(controlText(11, 'gso '), { children: [drawing] })] }));
    const runs = model.sections[0].blocks[0].runs;
    // The caption list header names the top side, so the caption precedes the drawing.
    expect(runs.map((r) => r.kind)).toEqual(['blocks', 'shape']);
    expect(runs[1].blocks[0].runs[0].text).toBe('글상자');
    expect(runs[0].blocks[0].runs[0].text).toBe('그림 1 캡션');
    expect([...model.warnings]).toEqual([]);
  });
});

describe('Hanword drawing objects', () => {
  const shapeOf = (model) => model.sections[0].blocks[0].runs.find((r) => r.kind !== 'text');
  const docOf = (model) => parse(files(model)['word/document.xml']);
  const object = (name, attrs, inner, w = 12450, h = 11225) => `<hp:${name} ${attrs}><hp:offset x="0" y="0"/><hp:orgSz width="${w}" height="${h}"/><hp:curSz width="0" height="0"/><hp:lineShape color="#000000" width="33" style="SOLID"/>${inner}</hp:${name}>`;
  it('draws HWPX arcs as quarter-ellipse paths and leaves open arcs unfilled', () => {
    const arc = (type) => object('arc', `id="1" type="${type}"`, '<hp:fillBrush><hp:winBrush faceColor="#F1CB7E"/></hp:fillBrush><hp:center x="0" y="0"/><hp:ax1 x="0" y="11225"/><hp:ax2 x="12450" y="0"/>');
    const pie = shapeOf(parseHwpx(hwpx({ sections: [run(arc('PIE'))] })));
    expect(pie).toMatchObject({ kind: 'shape', shape: 'custom', fill: 'F1CB7E', coordWidth: 12450, coordHeight: 11225 });
    expect(pie.path.map((c) => c.kind)).toEqual(['move', 'line', 'cubic', 'close']);
    expect(pie.path[2]).toMatchObject({ x: 12450, y: 0 });
    expect(Math.round(pie.path[2].x1)).toBe(6876); // control points bow toward the far axis
    const doc = docOf(parseHwpx(hwpx({ sections: [run(arc('PIE'))] })));
    expect(elements(doc, 'cubicBezTo')).toHaveLength(1);
    expect(elements(doc, 'path')[0].getAttribute('fill')).toBeNull();
    expect(elements(doc, 'solidFill')).toHaveLength(2);
    const open = parseHwpx(hwpx({ sections: [run(arc('NORMAL'))] })), openDoc = docOf(open);
    expect(shapeOf(open).fill).toBeNull();
    expect(elements(openDoc, 'path')[0].getAttribute('fill')).toBe('none');
    expect(elements(openDoc, 'spPr')[0].getElementsByTagNameNS('*', 'noFill')).toHaveLength(1);
    expect([...open.warnings]).toEqual([]);
  });
  it('smooths HWPX curves through their points and closes curves that return to their start', () => {
    const seg = (x1, y1, x2, y2, type = 'CURVE') => `<hp:seg type="${type}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    const closed = object('curve', 'id="1"', `<hp:fillBrush><hp:winBrush faceColor="#FFFFFF"/></hp:fillBrush>${seg(450, 6140, 8000, 11215)}${seg(8000, 11215, 2500, 19340)}${seg(2500, 19340, 450, 6140)}`, 16636, 21360);
    const model = parseHwpx(hwpx({ sections: [run(closed)] })), shape = shapeOf(model);
    expect(shape.path.map((c) => c.kind)).toEqual(['move', 'cubic', 'cubic', 'cubic', 'close']);
    expect(shape.fill).toBe('FFFFFF');
    expect(shape.path[1]).toMatchObject({ x: 8000, y: 11215 });
    expect([...model.warnings]).toEqual(['Curves are smoothed through their points; Hanword’s exact curvature can differ.']);
    const open = shapeOf(parseHwpx(hwpx({ sections: [run(object('curve', 'id="2"', `<hp:fillBrush><hp:winBrush faceColor="#FFFFFF"/></hp:fillBrush>${seg(0, 0, 100, 0, 'LINE')}${seg(100, 0, 100, 100)}`, 100, 100))] })));
    expect(open.path.map((c) => c.kind)).toEqual(['move', 'line', 'cubic']);
    expect(open.fill).toBeNull();
  });
  it('draws connectors as lines, including grouped connectors scaled to zero width', () => {
    const connector = object('connectLine', 'id="1" type="STRAIGHT_ONEWAY"', '<hp:startPt x="0" y="0"/><hp:endPt x="100" y="100"/>', 100, 100);
    const plain = shapeOf(parseHwpx(hwpx({ sections: [run(connector)] })));
    expect(plain).toMatchObject({ shape: 'custom', fill: null, path: [{ kind: 'move', x: 0, y: 0 }, { kind: 'line', x: 100, y: 100 }] });
    const grouped = `<hp:container id="9"><hp:offset x="0" y="0"/><hp:orgSz width="9083" height="4813"/><hp:curSz width="0" height="0"/><hp:renderingInfo><hp:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>`
      + connector.replace('<hp:curSz width="0" height="0"/>', '<hp:curSz width="0" height="0"/><hp:renderingInfo><hp:transMatrix e1="1" e2="0" e3="29" e4="0" e5="1" e6="2441"/><hp:scaMatrix e1="0" e2="0" e3="0" e4="0" e5="23.72" e6="0"/></hp:renderingInfo>') + '</hp:container>';
    const model = parseHwpx(hwpx({ sections: [run(grouped)] })), group = shapeOf(model);
    expect(group.kind).toBe('group');
    expect(group.children[0]).toMatchObject({ shape: 'custom', width: 0, x: 29, y: 2441 });
    expect(Math.round(group.children[0].height)).toBe(2372);
    expect(() => files(model)).not.toThrow();
  });
  it('imports HWPX text art as a text box with its font, color and lines', () => {
    const art = `<hp:textart id="1" text="hwpx 라이브러리␍␊neolord"><hp:offset x="0" y="0"/><hp:orgSz width="14173" height="14173"/><hp:curSz width="40500" height="16000"/><hp:lineShape color="#000000" width="0" style="NONE"/><hp:fillBrush><hp:winBrush faceColor="#0000FF"/></hp:fillBrush><hp:textartPr fontName="함초롬바탕" fontStyle="진하게" textShape="THIN_CURVE_DOWN1" lineSpacing="120" charSpacing="100" align="LEFT"/></hp:textart>`;
    const model = parseHwpx(hwpx({ sections: [run(art)] })), shape = shapeOf(model);
    expect(shape).toMatchObject({ kind: 'shape', shape: 'rect', width: 40500, height: 16000, fill: null });
    expect(shape.blocks.map((p) => p.runs[0].text)).toEqual(['hwpx 라이브러리', 'neolord']);
    expect(shape.blocks[0].props.align).toBe('left');
    // The first line is limited by the box width (7.5 em of 40500), the second by its share of the height.
    expect(shape.blocks.map((p) => p.runs[0].props.size)).toEqual([5400, 6667]);
    expect(shape.blocks[0].runs[0].props).toMatchObject({ font: '함초롬바탕', bold: true, italic: false, color: '0000FF' });
    expect([...model.warnings]).toEqual(['Text art is imported as text in a box; its curved outline is not reproduced.']);
    const doc = docOf(model);
    expect(elements(doc, 'txbxContent')).toHaveLength(1);
    expect(elements(doc, 'rFonts')[0].getAttribute('w:eastAsia')).toBe('함초롬바탕');
  });
});

describe('Hanword embedded objects, videos and fills', () => {
  const shapeOf = (model) => model.sections[0].blocks[0].runs.find((r) => r.kind !== 'text');
  const docOf = (model) => parse(files(model)['word/document.xml']);
  const withItems = (section, extra, manifest) => {
    const archive = unzipSync(hwpx({ sections: [section] }));
    Object.assign(archive, extra);
    archive['Contents/content.hpf'] = strToU8(strFromU8(archive['Contents/content.hpf']).replace('</manifest>', manifest + '</manifest>'));
    return zipSync(archive);
  };
  // An OLE compound file whose native stream is a bitmap, behind Hanword's 4-byte length prefix.
  const oleBytes = () => { const inner = cfb({ '\x01Ole10Native': concat(u32(bmp().length), bmp()), '\x01CompObj': new Uint8Array(20) }); return concat(u32(inner.length), inner); };
  const presentationOle = () => {
    const wmfBytes = wmf(), pres = concat(u32(0xffffffff), u32(3), u32(4), u32(1), u32(0xffffffff), u32(2), u32(0), u32(5001), u32(5001), u32(wmfBytes.length), wmfBytes);
    return cfb({ '\x02OlePres000': pres, '\x01Ole': new Uint8Array(20) });
  };
  it('extracts the picture an OLE object displays from its native or presentation stream', () => {
    expect(imageFormat(oleImage(oleBytes()))).toBe('bmp');
    expect(imageFormat(oleImage(presentationOle()))).toBe('wmf');
    expect(oleImage(cfb({ '\x01Ole': new Uint8Array(20) }))).toBeNull();
    expect(oleImage(new Uint8Array(3))).toBeNull();
  });
  it('imports HWPX OLE objects as pictures and names objects without one', () => {
    const ole = (id) => `<hp:ole id="1" binaryItemIDRef="${id}" objectType="EMBEDDED"><hp:offset x="0" y="0"/><hp:orgSz width="14176" height="14176"/><hp:curSz width="0" height="0"/><hp:sz width="14176" height="14176"/><hp:shapeComment>OLE 개체입니다.\n개체 형식은 Bitmap Image입니다.</hp:shapeComment></hp:ole>`;
    const model = parseHwpx(withItems(run(ole('ole1')), { 'BinData/ole1.ole': oleBytes() }, '<item id="ole1" href="../BinData/ole1.ole" media-type="application/ole"/>'));
    const picture = shapeOf(model);
    expect(picture).toMatchObject({ kind: 'image', width: 14176, height: 14176, alt: 'OLE 개체입니다.\n개체 형식은 Bitmap Image입니다.' });
    expect(picture.image.ext).toBe('bmp');
    expect([...model.warnings]).toEqual(['Embedded objects are imported as the pictures they display.']);
    const missing = parseHwpx(hwpx({ sections: [run(ole('nothing'))] }));
    expect(missing.sections[0].blocks[0].runs[0]).toMatchObject({ kind: 'text', text: '[Embedded object: OLE 개체입니다.]' });
    const chart = parseHwpx(hwpx({ sections: [run('<hp:chart id="2" chartIDRef="Chart/chart1.xml"><hp:sz width="32250" height="18750"/></hp:chart>')] }));
    expect(chart.sections[0].blocks[0].runs[0].text).toBe('[Chart]');
  });
  it('imports videos as their poster pictures', () => {
    const video = (image) => `<hp:video id="1" videotype="Local" fileIDRef="file1" imageIDRef="${image}"><hp:offset x="0" y="0"/><hp:orgSz width="22500" height="15000"/><hp:curSz width="0" height="0"/><hp:sz width="22500" height="15000"/><hp:shapeComment>동영상입니다.</hp:shapeComment></hp:video>`;
    const model = parseHwpx(withItems(run(video('image2')), { 'BinData/image2.png': png() }, '<item id="file1" href="C:\\clip.avi" media-type="image/avi" isEmbeded="0"/><item id="image2" href="../BinData/image2.png" media-type="image/png"/>'));
    expect(shapeOf(model)).toMatchObject({ kind: 'image', width: 22500, height: 15000, alt: 'Video: 동영상입니다.' });
    expect([...model.warnings]).toEqual(['Videos are imported as their poster pictures.']);
    const missing = parseHwpx(hwpx({ sections: [run(video('none'))] }));
    expect(missing.sections[0].blocks[0].runs[0].text).toBe('[Video: 동영상입니다.]');
  });
  it('fills HWPX shapes with pictures, rasterized radial gradients, native linear gradients and blended hatches', () => {
    const rect = (fill, attrs = '') => `<hp:rect id="1" ${attrs}><hp:offset x="0" y="0"/><hp:orgSz width="6000" height="3000"/><hp:curSz width="6000" height="3000"/><hp:lineShape color="#000000" width="33" style="SOLID"/><hp:fillBrush>${fill}</hp:fillBrush><hp:shadow type="PARELLEL_RIGHTTOP" color="#A0BEE0" offsetX="283" offsetY="283" alpha="10"/></hp:rect>`;
    const pictureModel = parseHwpx(withItems(run(rect('<hp:winBrush faceColor="#A0BEE0"/><hp:imgBrush mode="TOTAL"><hp:img binaryItemIDRef="image1"/></hp:imgBrush>', 'ratio="20"')), { 'BinData/image1.png': png() }, '<item id="image1" href="../BinData/image1.png" media-type="image/png"/>'));
    const shape = shapeOf(pictureModel);
    expect(shape.pictureFill).toMatchObject({ kind: 'image', width: 6000, height: 3000 });
    expect(shape).toMatchObject({ shape: 'roundRect', roundness: 20, shadow: { color: 'A0BEE0', x: 283, y: 283 } });
    const out = files(pictureModel), doc = parse(out['word/document.xml']);
    expect(elements(doc, 'blipFill')).toHaveLength(1);
    expect(out['word/_rels/document.xml.rels']).toContain('media/image1.png');
    expect(elements(doc, 'gd')[0].getAttribute('fmla')).toBe('val 10000');
    // The shadow becomes a shadow-colored copy behind the shape, grouped with it, offset by 283 units.
    expect(elements(doc, 'outerShdw')).toHaveLength(0);
    expect(elements(doc, 'wgp')).toHaveLength(1);
    const members = elements(doc, 'wsp');
    expect(members).toHaveLength(2);
    expect(elements(members[0], 'srgbClr')[0].getAttribute('val')).toBe('A0BEE0');
    expect(elements(members[0], 'off')[0].getAttribute('x')).toBe(String(283 * 127));
    expect(elements(members[0], 'alpha')[0].getAttribute('val')).toBe('90000');
    expect(elements(doc, 'extent')[0].getAttribute('cx')).toBe(String((6000 + 283) * 127));
    expect([...pictureModel.warnings]).toEqual(['Drop shadows are drawn as a shadow-colored copy behind the object, grouped with it.']);
    const radial = parseHwpx(hwpx({ sections: [run(rect('<hp:gradation type="RADIAL" angle="0" centerX="50" centerY="50" step="100" stepCenter="50"><hp:color value="#FFFFFF"/><hp:color value="#002448"/></hp:gradation>'))] }));
    const radialFiles = files(radial);
    expect(elements(parse(radialFiles['word/document.xml']), 'blipFill')).toHaveLength(1);
    expect(Object.keys(unzipSync(modelToDocx(radial))).some((name) => name.startsWith('word/media/'))).toBe(true);
    const linear = docOf(parseHwpx(hwpx({ sections: [run(rect('<hp:gradation type="LINEAR" angle="90"><hp:color value="#FFFFFF"/><hp:color value="#4B87CB"/></hp:gradation>'))] })));
    expect(elements(linear, 'gradFill')).toHaveLength(1);
    expect(elements(linear, 'lin')[0].getAttribute('ang')).toBe('5400000');
    const hatched = parseHwpx(hwpx({ sections: [run(rect('<hp:winBrush faceColor="#FFFF00" hatchColor="#000000" hatchStyle="HORIZONTAL"/>'))] }));
    expect(elements(docOf(hatched), 'srgbClr').map((c) => c.getAttribute('val'))).toContain('bfbf00');
    expect([...hatched.warnings].sort()).toEqual(['Drop shadows are drawn as a shadow-colored copy behind the object, grouped with it.', 'Hatched fills are approximated with a blended solid color.']);
  });
  it('shows a picture-filled empty cell as its picture and keeps the base color under text', () => {
    const header = `<hh:borderFill id="1"><hh:fillBrush><hh:winBrush faceColor="#DDDDDD"/><hh:imgBrush mode="TOTAL"><hh:img binaryItemIDRef="image1"/></hh:imgBrush></hh:fillBrush></hh:borderFill>${HEADER}`;
    const table = (contents) => `<hp:tbl rowCnt="1" colCnt="1"><hp:tr><hp:tc borderFillIDRef="1"><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="12000" height="4000"/><hp:subList>${contents}</hp:subList></hp:tc></hp:tr></hp:tbl>`;
    const build = (contents) => { const archive = unzipSync(hwpx({ header, sections: [run(table(contents))] })); archive['BinData/image1.png'] = png(); archive['Contents/content.hpf'] = strToU8(strFromU8(archive['Contents/content.hpf']).replace('</manifest>', '<item id="image1" href="../BinData/image1.png" media-type="image/png"/></manifest>')); return parseHwpx(zipSync(archive)); };
    const empty = build(ptext('')), doc = docOf(empty);
    expect(elements(doc, 'drawing')).toHaveLength(1);
    expect(elements(doc, 'extent')[0].getAttribute('cx')).toBe(String(12000 * 127));
    expect([...empty.warnings]).toEqual([]);
    const text = build(ptext('내용'));
    expect(elements(docOf(text), 'drawing')).toHaveLength(0);
    expect(elements(docOf(text), 'shd')[0].getAttribute('w:fill')).toBe('DDDDDD');
    expect([...text.warnings]).toEqual(['Picture fills behind text in paragraph and table backgrounds retain their base color.']);
  });
});

describe('Hanword binary drawing objects', () => {
  const component = (id, tail, { width = 6000, height = 2400 } = {}) => concat(Buffer.from(id).reverse(), u32(0), u32(0), u16(0), u16(1), u32(width), u32(height), u32(width), u32(height), u32(0), u16(0), new Uint8Array(8), u16(0), new Uint8Array(48), tail);
  const line = concat(u32(0), u32(32), u32(1), [0]);
  const solid = (color, hatch = 0xffffffff) => concat(u32(1), u32(color), u32(0), u32(hatch));
  const drawing = (records, { width = 6000, height = 2400, extra = {} } = {}) => hwp({ compressed: false, ...extra, sections: [paragraph(controlText(11, 'gso '), { children: [concat(control('gso ', concat(u32(1), new Uint8Array(8), u32(width), u32(height))), records)] })] });
  const first = (model) => model.sections[0].blocks[0].runs[0];
  it('reads arcs, curves and rounded corners from binary components', () => {
    const arc = record(81, 3, concat([1], u32(0), u32(0), u32(0), u32(2400), u32(6000), u32(0)));
    const pie = first(parseHwp5(drawing(concat(record(76, 2, component('$arc', concat(line, solid(0xf1cb7e)))), arc))));
    expect(pie).toMatchObject({ kind: 'shape', shape: 'custom', fill: '7ecbf1', coordWidth: 6000, coordHeight: 2400 });
    expect(pie.path.map((c) => c.kind)).toEqual(['move', 'line', 'cubic', 'close']);
    const points = [[0, 0], [3000, 1200], [6000, 0]];
    const curve = record(83, 3, concat(u32(3), ...points.flatMap(([x, y]) => [u32(x), u32(y)]), [0, 1], u32(0)));
    const open = first(parseHwp5(drawing(concat(record(76, 2, component('$cur', concat(line, solid(0xffffff)))), curve))));
    expect(open.path.map((c) => c.kind)).toEqual(['move', 'line', 'cubic']);
    expect(open.fill).toBeNull();
    const rounded = first(parseHwp5(drawing(concat(record(76, 2, component('$rec', concat(line, solid(0x0000ff)))), record(79, 3, concat([8], new Uint8Array(32)))))));
    expect(rounded).toMatchObject({ shape: 'roundRect', roundness: 8, fill: 'ff0000' });
  });
  it('reads gradient, picture and hatch fills of binary shapes', () => {
    const gradient = concat(u32(4), [1], u32(90), u32(0), u32(0), u32(51), u32(2), u32(0xffffff), u32(0x111111), u32(1), [52]);
    const gradientModel = parseHwp5(drawing(concat(record(76, 2, component('$rec', concat(line, gradient))), record(79, 3, new Uint8Array(33)))));
    expect(first(gradientModel).gradient).toMatchObject({ type: 'LINEAR', angle: 90, colors: ['ffffff', '111111'], center: 52 });
    expect([...gradientModel.warnings]).toEqual([]);
    const picture = concat(u32(3), u32(0xff7f3f), u32(0), u32(0xffffffff), [5, 0, 0, 0], u16(1), u32(0), [0]);
    const pictureModel = parseHwp5(drawing(concat(record(76, 2, component('$rec', concat(line, picture))), record(79, 3, new Uint8Array(33))), { extra: { infoExtra: [record(18, 1, concat(u16(1), u16(1), string('bmp')))], streams: { 'BinData/BIN0001.bmp': bmp() } } }));
    expect(first(pictureModel).pictureFill).toMatchObject({ kind: 'image', width: 6000, height: 2400, alt: 'Picture fill' });
    expect(elements(parse(files(pictureModel)['word/document.xml']), 'blipFill')).toHaveLength(1);
    const hatched = parseHwp5(drawing(concat(record(76, 2, component('$rec', concat(line, solid(0x00ffff, 3)))), record(79, 3, new Uint8Array(33)))));
    expect(first(hatched).hatch).toEqual({ color: '000000' });
  });
  it('imports binary OLE objects and text art', () => {
    const inner = cfb({ '\x01Ole10Native': concat(u32(bmp().length), bmp()) }), ole = concat(u32(inner.length), inner);
    const model = parseHwp5(drawing(concat(record(76, 2, component('$ole', new Uint8Array(0))), record(84, 3, concat(u32(0), u32(6000), u32(2400), u16(1), u32(0), u32(0), u32(0)))), { extra: { infoExtra: [record(18, 1, concat(u16(2), u16(1)))], streams: { 'BinData/BIN0001.OLE': ole } } }));
    expect(first(model)).toMatchObject({ kind: 'image', alt: 'Embedded object', width: 6000, height: 2400 });
    expect(first(model).image.ext).toBe('bmp');
    expect([...model.warnings]).toEqual(['Embedded objects are imported as the pictures they display.']);
    const art = record(90, 3, concat(string('글맵시␍␊둘째 줄'), new Uint8Array(32), string('함초롬돋움'), string('진하게 기울임'), string('TTF'), u32(0), u32(120), u32(100), u32(1)));
    const artModel = parseHwp5(drawing(concat(record(76, 2, component('$tar', concat(line, solid(0x0000ff)), { height: 4800 })), art), { height: 4800 }));
    const box = first(artModel);
    expect(box).toMatchObject({ kind: 'shape', shape: 'rect', fill: null });
    expect(box.blocks.map((p) => p.runs[0].text)).toEqual(['글맵시', '둘째 줄']);
    expect(box.blocks[0].props.align).toBe('center');
    expect(box.blocks[0].runs[0].props).toMatchObject({ font: '함초롬돋움', bold: true, italic: true, color: 'ff0000', size: 2000 });
    expect(box.blocks[1].runs[0].props.size).toBe(1818);
  });
});

describe('Hanword character, paragraph and section formatting', () => {
  it('writes emphasis marks, character borders and shading from HWPX character properties', () => {
    const header = `<hh:borderFill id="1"><hh:leftBorder type="SOLID" width="0.12 mm" color="#FF0000"/><hh:rightBorder type="SOLID" width="0.12 mm" color="#FF0000"/><hh:topBorder type="SOLID" width="0.12 mm" color="#FF0000"/><hh:bottomBorder type="SOLID" width="0.12 mm" color="#FF0000"/><hh:fillBrush><hh:winBrush faceColor="#EEEEEE"/></hh:fillBrush></hh:borderFill><hh:borderFill id="2"><hh:leftBorder type="NONE"/></hh:borderFill>`
      + '<hh:charPr id="0" height="1000" symMark="DOT_ABOVE" borderFillIDRef="1"/><hh:charPr id="1" height="1000" symMark="RING_ABOVE" borderFillIDRef="2"/><hh:charPr id="2" height="1000" symMark="NONE" borderFillIDRef="2"/><hh:paraPr id="0"/><hh:style id="0" name="본문" paraPrIDRef="0" charPrIDRef="0"/>';
    const model = parseHwpx(hwpx({ header, sections: [run('<hp:t>테두리</hp:t>', 0) + run('<hp:t>동그라미</hp:t>', 1) + run('<hp:t>보통</hp:t>', 2)] }));
    expect(model.chars.map((c) => c.emphasis)).toEqual(['dot', 'circle', null]);
    const doc = parse(files(model)['word/document.xml']), properties = elements(doc, 'rPr').filter((p) => p.parentNode.localName === 'r');
    // The border fill's line becomes the DOCX run border and its fill the run shading; the editor paints the shading.
    expect(properties.map((p) => [attr(elements(p, 'em')[0], 'val'), attr(elements(p, 'bdr')[0], 'val'), attr(elements(p, 'shd')[0], 'fill')])).toEqual([['dot', 'single', 'EEEEEE'], ['circle', undefined, 'auto'], [undefined, undefined, 'auto']]);
    const names = [...properties[0].children].map((c) => c.localName);
    expect(names.indexOf('bdr')).toBeGreaterThan(names.indexOf('u'));
    expect(names.indexOf('em')).toBeGreaterThan(names.indexOf('vertAlign'));
  });
  it('reads binary emphasis marks and character border fills', () => {
    const border = record(20, 1, concat(u16(0), side(1, 0xff0000), side(1), side(1), side(1), side(0), u32(1), u32(0xeeeeee), u32(0), u32(0xffffffff)));
    // A character shape with a dotted emphasis (attribute bits 21-24 = 1) and border fill 1 after its shadow color.
    const char = concat(new Uint8Array(14), new Uint8Array(7).fill(100), new Uint8Array(7), new Uint8Array(7).fill(100), new Uint8Array(7), u32(1200), u32(1 << 21), [0, 0], u32(0), u32(0), u32(0xffffffff), u32(0), u16(1), u32(0xffffffff));
    const model = parseHwp5(hwp({ infoExtra: [border, record(21, 1, char)] }));
    const shape = model.chars.at(-1);
    expect(shape.emphasis).toBe('dot');
    expect(shape.border.left).toEqual({ style: 'single', size: 2, color: '0000ff' });
    expect(shape.border.fill).toBe('eeeeee');
  });
  it('carries automatic spacing, grid snapping, line-number suppression and border spacing of paragraphs', () => {
    const header = '<hh:borderFill id="1"><hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/><hh:rightBorder type="SOLID" width="0.12 mm" color="#000000"/><hh:topBorder type="SOLID" width="0.12 mm" color="#000000"/><hh:bottomBorder type="SOLID" width="0.12 mm" color="#000000"/></hh:borderFill>'
      + '<hh:charPr id="0" height="1000"/><hh:paraPr id="0" snapToGrid="1" suppressLineNumbers="1"><hh:autoSpacing eAsianEng="1" eAsianNum="0"/><hh:border borderFillIDRef="1" offsetLeft="500" offsetRight="0" offsetTop="200" offsetBottom="9000"/></hh:paraPr><hh:style id="0" name="본문" paraPrIDRef="0" charPrIDRef="0"/>';
    const model = parseHwpx(hwpx({ header, sections: [ptext('문단')] }));
    expect(model.paras[0]).toMatchObject({ autoSpaceLatin: true, autoSpaceNumber: false, snapToGrid: true, suppressLineNumbers: true, borderOffset: { left: 500, right: 0, top: 200, bottom: 9000 } });
    const doc = parse(files(model)['word/document.xml']), pPr = elements(doc, 'pPr')[0], names = [...pPr.children].map((c) => c.localName);
    expect(names.slice(names.indexOf('numPr'), names.indexOf('spacing') + 1)).toEqual(['numPr', 'suppressLineNumbers', 'pBdr', 'autoSpaceDE', 'autoSpaceDN', 'snapToGrid', 'spacing']);
    expect([...elements(pPr, 'pBdr')[0].children].map((c) => [c.localName, attr(c, 'space')])).toEqual([['top', '2'], ['left', '5'], ['bottom', '31'], ['right', '0']]);
    expect(attr(elements(pPr, 'autoSpaceDE')[0], 'val')).toBe('1');
    expect(attr(elements(pPr, 'autoSpaceDN')[0], 'val')).toBe('0');
    // Binary paragraph shapes carry the same in their attribute words and border spacing.
    const para = record(25, 1, concat(u32(4 | 256), new Uint8Array(20), u32(160), u16(0), u16(0), u16(0), u16(300), u16(0), u16(100), u16(0), u32(16), u32(0), u32(0)));
    const binary = parseHwp5(hwp({ infoExtra: [para] }));
    expect(binary.paras[1]).toMatchObject({ snapToGrid: true, autoSpaceLatin: true, autoSpaceNumber: false, borderOffset: { left: 300, right: 0, top: 100, bottom: 0 } });
  });
  it('writes page borders and line numbering for the section', () => {
    const header = `<hh:borderFill id="3"><hh:leftBorder type="SOLID" width="0.1 mm" color="#D17373"/><hh:rightBorder type="SOLID" width="0.1 mm" color="#D17373"/><hh:topBorder type="SOLID" width="0.1 mm" color="#D17373"/><hh:bottomBorder type="SOLID" width="0.1 mm" color="#D17373"/></hh:borderFill>${HEADER}`;
    const secPr = '<hp:secPr><hp:visibility showLineNumber="1"/><hp:lineNumberShape restartType="3" countBy="1" distance="1417" startNumber="1"/><hp:pageBorderFill type="BOTH" borderFillIDRef="3" textBorder="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill></hp:secPr>';
    const lines = '<hp:linesegarray><hp:lineseg vertpos="0" vertsize="1000" spacing="600"/><hp:lineseg vertpos="1600" vertsize="1000" spacing="600"/><hp:lineseg vertpos="3200" vertsize="1000" spacing="600"/></hp:linesegarray>';
    const model = parseHwpx(hwpx({ header, sections: [`<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${secPr}<hp:t>본문</hp:t></hp:run>${lines}</hp:p>`] }));
    expect(model.sections[0].lineNumbers).toEqual({ restart: 'newSection', countBy: 1, distance: 1417, start: 1 });
    expect(model.sections[0].pageBorder).toMatchObject({ fromText: false, offset: { left: 1417 } });
    const document = parse(files(model)['word/document.xml']), sect = elements(document, 'sectPr')[0], names = [...sect.children].map((c) => c.localName);
    // Line numbers are drawn as margin boxes at the recorded line positions; DOCX line numbering would double them.
    expect(names.slice(names.indexOf('pgMar'), names.indexOf('cols') + 1)).toEqual(['pgMar', 'pgBorders', 'cols']);
    const numbers = elements(document, 'body')[0] && elements(elements(document, 'body')[0], 'anchor');
    expect(numbers.map((a) => elements(a, 't')[0].textContent)).toEqual(['1', '2', '3']);
    expect(numbers.map((a) => elements(a, 'positionV')[0].textContent)).toEqual(['0', String(1600 * 127), String(3200 * 127)]);
    expect(elements(numbers[0], 'positionH')[0].getAttribute('relativeFrom')).toBe('margin');
    expect(Number(elements(numbers[0], 'positionH')[0].textContent)).toBeLessThan(0);
    const borders = elements(sect, 'pgBorders')[0];
    expect(attr(borders, 'offsetFrom')).toBe('page');
    expect([...borders.children].map((c) => [c.localName, attr(c, 'color'), attr(c, 'space')])).toEqual([['top', 'D17373', '14'], ['left', 'D17373', '14'], ['bottom', 'D17373', '14'], ['right', 'D17373', '14']]);
    // Binary page border records name their border fill after four offsets.
    const border = record(20, 1, concat(u16(0), side(1, 0x7373d1), side(1, 0x7373d1), side(1, 0x7373d1), side(1, 0x7373d1), side(0), u32(0)));
    const secd = concat(control('secd', concat(u32(0), new Uint8Array(6), u32(8000), u16(0), u16(0), u16(0))), record(75, 2, concat(u32(1), u16(1417), u16(1417), u16(1417), u16(1417), u16(1))));
    const binary = parseHwp5(hwp({ infoExtra: [border], sections: [paragraph(concat(controlText(2, 'secd'), utf16('본문\r')), { children: [secd] })] }));
    expect(binary.sections[0].pageBorder).toMatchObject({ fromText: false, offset: { left: 1417, bottom: 1417 } });
    expect(binary.sections[0].pageBorder.border.top.color).toBe('d17373');
    expect(elements(parse(files(binary)['word/document.xml']), 'pgBorders')).toHaveLength(1);
  });
  it('places anchored master-page drawings in the page header and leaves its text out', () => {
    const shape = '<hp:rect id="1"><hp:sz width="6000" height="3000"/><hp:pos treatAsChar="0" vertRelTo="PAPER" horzRelTo="PAPER" vertOffset="1000" horzOffset="2000"/><hp:lineShape color="#000000" width="33"/><hp:fillBrush><hp:winBrush faceColor="#DDEEFF"/></hp:fillBrush></hp:rect>';
    const master = (type) => strToU8(`<masterPage xmlns:hp="${PARA_NS}" id="masterpage0" type="${type}"><hp:subList><hp:p><hp:run><hp:t>배경 글</hp:t>${shape}</hp:run></hp:p></hp:subList></masterPage>`);
    const build = (type) => { const archive = unzipSync(hwpx({ sections: [run('<hp:secPr><hp:masterPage idRef="masterpage0"/></hp:secPr><hp:t>본문</hp:t>')] })); archive['Contents/masterpage0.xml'] = master(type); archive['Contents/content.hpf'] = strToU8(strFromU8(archive['Contents/content.hpf']).replace('</manifest>', '<item id="masterpage0" href="Contents/masterpage0.xml" media-type="application/xml"/></manifest>')); return parseHwpx(zipSync(archive)); };
    const model = build('BOTH'), section = model.sections[0];
    expect(section.headers).toHaveLength(1);
    expect(section.headers[0].type).toBe('default');
    expect(section.headers[0].blocks[0].runs.map((r) => [r.kind, r.layout.v, r.layout.y])).toEqual([['shape', 'page', 1000]]);
    expect([...model.warnings]).toEqual(['Master-page text and inline objects are not preserved; only its anchored pictures and shapes are.', 'Master-page backgrounds are placed in the page header as anchored drawings.']);
    const out = files(model);
    expect(out['word/header1.xml']).toContain('<wp:anchor');
    expect(out['word/header1.xml']).not.toContain('배경 글');
    expect(out['word/document.xml']).toContain('headerReference');
    const even = build('EVEN');
    expect(even.sections[0].headers.map((h) => h.type)).toEqual(['even']);
    expect(build('OPTIONAL_PAGE').sections[0].headers).toHaveLength(0);
  });
});

describe('Hanword list numbers the editor cannot paint', () => {
  it('formats Korean, circled and ideographic numbers', () => {
    expect([1, 2, 14, 15, 29].map((n) => formatNumber('ganada', n))).toEqual(['가', '나', '하', '거', '고']);
    expect([1, 14, 15].map((n) => formatNumber('chosung', n))).toEqual(['ㄱ', 'ㅎ', 'ㄱㄱ']);
    expect([1, 20, 21, 35, 36, 50, 51].map((n) => formatNumber('decimalEnclosedCircle', n))).toEqual(['①', '⑳', '㉑', '㉟', '㊱', '㊿', '(51)']);
    expect([1, 10, 11, 20, 21, 99, 100].map((n) => formatNumber('koreanCounting', n))).toEqual(['일', '십', '십일', '이십', '이십일', '구십구', '100']);
    expect([1, 10, 12, 30].map((n) => formatNumber('ideographTraditional', n))).toEqual(['一', '十', '十二', '三十']);
    expect([1, 3, 10, 11].map((n) => formatNumber('heavenlyStems', n))).toEqual(['갑', '병', '계', '갑갑']);
    expect([formatNumber('circledGanada', 1), formatNumber('circledChosung', 2), formatNumber('circledUpperLetter', 3), formatNumber('circledLowerLetter', 26), formatNumber('circledIdeograph', 10), formatNumber('heavenlyStemsHanja', 2)]).toEqual(['㉮', '㉡', 'Ⓒ', 'ⓩ', '㊉', '乙']);
    expect([formatNumber('upperRoman', 14), formatNumber('lowerLetter', 27), formatNumber('decimal', 7)]).toEqual(['XIV', 'aa', '7']);
    // A start value a file can carry (up to 2^32) must not become a string of that many letters.
    expect(formatNumber('chosung', 14 * 20)).toBe('ㅎ'.repeat(20));
    expect(formatNumber('chosung', 14 * 20 + 1)).toBe('281');
    expect(formatNumber('upperLetter', 4294967295)).toBe('4294967295');
    expect(formatNumber('ganada', 4294967295).length).toBeLessThan(12);
  });
  it('fills level patterns with counters and restarts deeper levels', () => {
    const levels = [{ level: 0, format: 'decimal', text: '^1.', start: 1 }, { level: 1, format: 'ganada', text: '^1.^2', start: 1 }, { level: 2, format: 'decimalEnclosedCircle', text: '^n', start: 3 }];
    const counters = [];
    advanceCounters(counters, levels, 0); advanceCounters(counters, levels, 1); advanceCounters(counters, levels, 1);
    expect(levelLabel(levels, 1, counters)).toBe('1.나');
    advanceCounters(counters, levels, 2);
    expect(levelLabel(levels, 2, counters)).toBe('1.나.③');
    advanceCounters(counters, levels, 0); advanceCounters(counters, levels, 1);
    expect(levelLabel(levels, 1, counters)).toBe('2.가');
  });
  it('writes HWPX Korean list numbers as text and keeps decimal levels as DOCX lists', () => {
    const header = '<hh:charPr id="0" height="1000"/><hh:charPr id="5" height="1000" textColor="#FF0000"/><hh:numbering id="1" start="1"><hh:paraHead start="1" level="1" numFormat="DIGIT" charPrIDRef="0">^1.</hh:paraHead><hh:paraHead start="1" level="2" numFormat="HANGUL_SYLLABLE" charPrIDRef="5">^2.</hh:paraHead><hh:paraHead start="1" level="3" numFormat="CIRCLED_DIGIT">^3</hh:paraHead></hh:numbering>'
      + '<hh:paraPr id="0"/><hh:paraPr id="1"><hh:heading type="NUMBER" idRef="1" level="0"/></hh:paraPr><hh:paraPr id="2"><hh:heading type="NUMBER" idRef="1" level="1"/></hh:paraPr><hh:paraPr id="3"><hh:heading type="NUMBER" idRef="1" level="2"/></hh:paraPr><hh:style id="0" name="본문" paraPrIDRef="0" charPrIDRef="0"/>';
    const p = (para, text) => `<hp:p paraPrIDRef="${para}"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p>`;
    const model = parseHwpx(hwpx({ header, sections: [p(1, '개요') + p(2, '첫째') + p(2, '둘째') + p(3, '세부') + p(1, '본론') + p(2, '다시')] }));
    expect(model.listDefinitions.n1.map((l) => l.format)).toEqual(['decimal', 'ganada', 'decimalEnclosedCircle']);
    const out = files(model), doc = parse(out['word/document.xml']), paragraphs = elements(doc, 'p').filter((n) => n.parentNode.localName === 'body');
    const marker = (node) => { const run = elements(node, 'r')[0]; return [attr(elements(node, 'numId')[0], 'val'), elements(run, 't')[0]?.textContent, attr(elements(run, 'color')[0], 'val')]; };
    expect(paragraphs.map(marker)).toEqual([['1', '개요', 'auto'], ['0', '가. ', 'FF0000'], ['0', '나. ', 'FF0000'], ['0', '① ', 'auto'], ['1', '본론', 'auto'], ['0', '가. ', 'FF0000']]);
    expect(out['word/numbering.xml']).toContain('w:numFmt w:val="ganada"');
    expect([...model.warnings]).toEqual(['Korean, circled and ideographic list numbers are written as text so the editor can show them.']);
  });
  it('writes the levels under a Korean text level as text too, so they restart under each item', () => {
    const header = '<hh:charPr id="0" height="1000"/><hh:numbering id="1" start="1"><hh:paraHead start="1" level="1" numFormat="DIGIT">^1.</hh:paraHead><hh:paraHead start="1" level="2" numFormat="HANGUL_SYLLABLE">^2.</hh:paraHead><hh:paraHead start="1" level="3" numFormat="DIGIT">^3)</hh:paraHead></hh:numbering>'
      + '<hh:paraPr id="0"/><hh:paraPr id="1"><hh:heading type="NUMBER" idRef="1" level="0"/></hh:paraPr><hh:paraPr id="2"><hh:heading type="NUMBER" idRef="1" level="1"/></hh:paraPr><hh:paraPr id="3"><hh:heading type="NUMBER" idRef="1" level="2"/></hh:paraPr><hh:style id="0" name="본문" paraPrIDRef="0" charPrIDRef="0"/>';
    const p = (para, text) => `<hp:p paraPrIDRef="${para}"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p>`;
    const model = parseHwpx(hwpx({ header, sections: [p(1, '개요') + p(2, '첫째') + p(3, 'a') + p(3, 'b') + p(2, '둘째') + p(3, 'c')] }));
    const out = files(model), doc = parse(out['word/document.xml']), paragraphs = elements(doc, 'p').filter((n) => n.parentNode.localName === 'body');
    const marker = (node) => [attr(elements(node, 'numId')[0], 'val'), elements(elements(node, 'r')[0], 't')[0]?.textContent];
    expect(paragraphs.map(marker)).toEqual([['1', '개요'], ['0', '가. '], ['0', '1) '], ['0', '2) '], ['0', '나. '], ['0', '1) ']]);
  });
  it('maps every binary and HWPX Hanword number format to a name the writer understands', () => {
    const known = new Set(['decimal', 'decimalEnclosedCircle', 'upperRoman', 'lowerRoman', 'upperLetter', 'lowerLetter', 'ganada', 'chosung', 'koreanCounting', 'ideographTraditional', 'ideographEnclosedCircle', 'bullet']);
    for (const format of [...numberFormats, ...Object.values(namedNumberFormats)]) expect(known.has(docxNumberFormat(format))).toBe(true);
    expect(numberFormats[15]).toBe('heavenlyStems');
    expect(namedNumberFormats.CIRCLED_HANGUL_JAMO).toBe('circledChosung');
  });
});

describe('Hanword HWPX line heights', () => {
  it('keeps the recorded line height of text-only paragraphs with percentage spacing', () => {
    const header = '<hh:charPr id="0" height="1000"/><hh:paraPr id="0"><hh:lineSpacing type="PERCENT" value="160"/></hh:paraPr><hh:paraPr id="1"><hh:lineSpacing type="FIXED" value="2000"/></hh:paraPr><hh:style id="0" name="본문" paraPrIDRef="0" charPrIDRef="0"/>';
    const lines = '<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000" baseline="850" spacing="600"/><hp:lineseg textpos="10" vertpos="1600" vertsize="1200" textheight="1200" baseline="1020" spacing="600"/></hp:linesegarray>';
    const model = parseHwpx(hwpx({ header, sections: [[
      `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>두 줄 문단</hp:t></hp:run>${lines}</hp:p>`,
      `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>그림</hp:t><hp:rect id="1"><hp:sz width="1200" height="600"/><hp:lineShape color="#000000" width="33"/></hp:rect></hp:run>${lines}</hp:p>`,
      `<hp:p paraPrIDRef="1"><hp:run charPrIDRef="0"><hp:t>고정 간격</hp:t></hp:run>${lines}</hp:p>`,
    ].join('')] }));
    expect(model.sections[0].blocks.map((p) => p.lineHeight)).toEqual([1800, undefined, undefined]);
    const doc = parse(files(model)['word/document.xml']), spacing = elements(doc, 'spacing').filter((s) => s.parentNode.localName === 'pPr');
    expect(spacing.map((s) => [attr(s, 'line'), attr(s, 'lineRule')])).toEqual([['360', 'exact'], ['384', 'auto'], ['400', 'exact']]);
  });
});

describe('Hanword caption numbers', () => {
  it('writes figure, table and equation numbers as sequence fields in their number format', () => {
    const caption = (type, format = 'DIGIT', prefix = '', suffix = '') => `<hp:ctrl><hp:autoNum num="3" numType="${type}"><hp:autoNumFormat type="${format}" prefixChar="${prefix}" suffixChar="${suffix}"/></hp:autoNum></hp:ctrl>`;
    const model = parseHwpx(hwpx({ sections: [run(`<hp:t>그림 </hp:t>${caption('PICTURE')}<hp:t> 표 </hp:t>${caption('TABLE', 'CIRCLED_DIGIT')}<hp:t> 식 </hp:t>${caption('EQUATION', 'HANGUL_SYLLABLE', '(', ')')}`)] }));
    expect(model.sections[0].blocks[0].runs.filter((r) => r.kind === 'field').map((r) => [r.instruction, r.text])).toEqual([['SEQ Figure \\* ARABIC', '3'], ['SEQ Table \\* ARABIC', '③'], ['SEQ Equation \\* ARABIC', '(다)']]);
    expect([...model.warnings]).toEqual([]);
    const doc = parse(files(model)['word/document.xml']);
    expect(elements(doc, 'fldSimple').map((f) => [attr(f, 'instr'), f.textContent])).toEqual([['SEQ Figure \\* ARABIC', '3'], ['SEQ Table \\* ARABIC', '③'], ['SEQ Equation \\* ARABIC', '(다)']]);
    // Binary: type 4 (table) with circled digits (format 1 in bits 4-11), prefix '[' and suffix ']'.
    const binary = parseHwp5(hwp({ sections: [paragraph(concat(utf16('표 '), controlText(18, 'atno'), utf16('\r')), { children: [control('atno', concat(u32(4 | (1 << 4)), u16(12), u16(0), u16('['.charCodeAt(0)), u16(']'.charCodeAt(0))))] })] }));
    expect(binary.sections[0].blocks[0].runs.find((r) => r.kind === 'field')).toEqual({ kind: 'field', instruction: 'SEQ Table \\* ARABIC', text: '[⑫]' });
    expect([...binary.warnings]).toEqual([]);
  });
});

describe('Hanword caption sides', () => {
  it('places HWPX captions above or below their object as recorded and notes side captions', () => {
    const caption = (side) => `<hp:caption side="${side}"><hp:subList>${ptext('캡션 ' + side)}</hp:subList></hp:caption>`;
    const table = (side) => `<hp:tbl rowCnt="1" colCnt="1"><hp:tr><hp:tc><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="12000" height="2000"/><hp:subList>${ptext('셀')}</hp:subList></hp:tc></hp:tr>${caption(side)}</hp:tbl>`;
    const pic = (side) => `<hp:rect id="1"><hp:sz width="1200" height="600"/><hp:lineShape color="#000000" width="33"/>${caption(side)}</hp:rect>`;
    const model = parseHwpx(hwpx({ sections: [run(table('TOP')) + run(table('BOTTOM')) + run(pic('TOP') + '<hp:t>뒤</hp:t>') + run(pic('LEFT'))] }));
    const [top, bottom, drawing, side] = model.sections[0].blocks;
    expect([top.runs[0].captionSide, bottom.runs[0].captionSide]).toEqual(['TOP', 'BOTTOM']);
    expect(drawing.runs.map((r) => r.kind)).toEqual(['blocks', 'shape', 'text']);
    expect(side.runs.map((r) => r.kind)).toEqual(['blocks', 'shape']);
    expect([...model.warnings]).toEqual(['Captions beside an object are placed above or below it.']);
    const doc = parse(files(model)['word/document.xml']), body = elements(doc, 'body')[0];
    const order = [...body.children].map((c) => c.localName === 'tbl' ? 'tbl' : c.textContent.trim().slice(0, 12));
    // A paragraph of no height keeps the two tables apart, which DOCX readers would otherwise join.
    expect(order.slice(0, 5)).toEqual(['캡션 TOP', 'tbl', '', 'tbl', '캡션 BOTTOM']);
  });
  it('reads the side of binary table captions from the caption list header', () => {
    const table = (side) => concat(control('tbl ', new Uint8Array(20)), record(72, 2, concat(u32(1), u32(0), u32(side), u32(8504), u16(850), u32(20000))), paragraph('표 캡션', { level: 2 }),
      record(77, 2, concat(u32(0), u16(1), u16(1), new Uint8Array(10), u16(1), u16(0))),
      record(72, 2, concat(u32(1), u32(0), u16(0), u16(0), u16(1), u16(1), u32(7200), u32(3600), new Uint8Array(8), u16(0))), paragraph('셀', { level: 2 }));
    const model = parseHwp5(hwp({ sections: [concat(paragraph(concat(controlText(11, 'tbl '), utf16('\r')), { children: [table(2)] }), paragraph(concat(controlText(11, 'tbl '), utf16('\r')), { children: [table(3)] }))] }));
    expect(model.sections[0].blocks.map((p) => p.runs[0].captionSide)).toEqual(['TOP', 'BOTTOM']);
    expect([...model.warnings]).toEqual([]);
    const body = elements(parse(files(model)['word/document.xml']), 'body')[0], order = [...body.children].map((c) => c.localName === 'tbl' ? 'tbl' : c.textContent.trim().slice(0, 8));
    expect(order.filter((o) => o)).toEqual(['표 캡션', 'tbl', 'tbl', '표 캡션']);
  });
});

describe('Hanword features the editor paints only through emulation', () => {
  it('draws page borders as a rectangle anchored in every page header', () => {
    const header = `<hh:borderFill id="3"><hh:leftBorder type="DASH" width="0.5 mm" color="#D17373"/><hh:rightBorder type="DASH" width="0.5 mm" color="#D17373"/><hh:topBorder type="DASH" width="0.5 mm" color="#D17373"/><hh:bottomBorder type="DASH" width="0.5 mm" color="#D17373"/></hh:borderFill>${HEADER}`;
    const secPr = '<hp:secPr><hp:pagePr width="59528" height="84188"><hp:margin left="8504" right="8504" top="5668" bottom="4252" header="4252" footer="4252"/></hp:pagePr><hp:visibility hideFirstHeader="1"/><hp:pageBorderFill type="BOTH" borderFillIDRef="3" textBorder="PAPER"><hp:offset left="1417" right="1417" top="1000" bottom="2000"/></hp:pageBorderFill></hp:secPr>';
    const model = parseHwpx(hwpx({ header, sections: [run(secPr + '<hp:t>본문</hp:t>')] }));
    const out = files(model), headers = Object.keys(out).filter((name) => /^word\/header\d+\.xml$/.test(name));
    expect(headers.length).toBeGreaterThanOrEqual(2); // a default header and the hidden first-page header both carry the frame
    for (const name of headers) {
      const doc = parse(out[name]), anchor = elements(doc, 'anchor')[0];
      expect(anchor.getAttribute('behindDoc')).toBe('1');
      expect(elements(anchor, 'positionH')[0].getAttribute('relativeFrom')).toBe('page');
      expect(elements(anchor, 'posOffset').map((p) => p.textContent)).toEqual([String(1417 * 127), String(1000 * 127)]);
      expect(elements(anchor, 'extent')[0].getAttribute('cx')).toBe(String((59528 - 2 * 1417) * 127));
      expect(elements(anchor, 'extent')[0].getAttribute('cy')).toBe(String((84188 - 3000) * 127));
      expect(elements(anchor, 'prstDash')[0].getAttribute('val')).toBe('dash');
      expect(elements(anchor, 'noFill')).toHaveLength(1);
    }
    expect([...model.warnings]).toContain('Page borders are drawn as a rectangle anchored in the page header.');
  });
  it('draws diagonal cell borders as lines anchored in the cell', () => {
    const header = `<hh:borderFill id="1"><hh:slash type="CENTER"/><hh:backSlash type="CENTER"/><hh:leftBorder type="SOLID" width="0.12 mm" color="#000000"/><hh:diagonal type="SOLID" width="0.12 mm" color="#0000FF"/></hh:borderFill>${HEADER}`;
    const table = `<hp:tbl rowCnt="1" colCnt="1"><hp:inMargin left="141" right="141" top="141" bottom="141"/><hp:tr><hp:tc borderFillIDRef="1"><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="12000" height="4000"/><hp:subList>${ptext('셀')}</hp:subList></hp:tc></hp:tr></hp:tbl>`;
    const model = parseHwpx(hwpx({ header, sections: [run(table)] })), doc = parse(files(model)['word/document.xml']);
    const anchors = elements(doc, 'anchor');
    expect(anchors).toHaveLength(2);
    expect(anchors.map((a) => elements(a, 'xfrm')[0].getAttribute('flipV'))).toEqual(['0', '1']);
    expect(anchors.map((a) => elements(a, 'prstGeom')[0].getAttribute('prst'))).toEqual(['line', 'line']);
    expect(elements(anchors[0], 'extent')[0].getAttribute('cx')).toBe(String(12000 * 127));
    expect(elements(anchors[0], 'posOffset').map((p) => p.textContent)).toEqual([String(-141 * 127), String(-141 * 127)]);
    expect(anchors[0].getAttribute('layoutInCell')).toBe('1');
    expect(elements(doc, 'tl2br')).toHaveLength(1); // the WordprocessingML border stays alongside the drawn line
    expect(elements(doc, 't').map((t) => t.textContent)).toContain('셀');
    expect([...model.warnings]).toContain('Diagonal cell borders are drawn as lines anchored in the cell.');
  });
  it('gives a grouped child with a shadow a shadow-colored sibling', () => {
    const child = '<hp:rect id="2"><hp:offset x="100" y="200"/><hp:orgSz width="1200" height="600"/><hp:curSz width="1200" height="600"/><hp:lineShape color="#000000" width="33"/><hp:fillBrush><hp:winBrush faceColor="#FFFFFF"/></hp:fillBrush><hp:shadow type="PARELLEL_RIGHTTOP" color="#404040" offsetX="50" offsetY="50" alpha="0"/></hp:rect>';
    const group = `<hp:container id="1"><hp:offset x="0" y="0"/><hp:orgSz width="2000" height="1000"/><hp:curSz width="2000" height="1000"/>${child}</hp:container>`;
    const doc = parse(files(parseHwpx(hwpx({ sections: [run(group)] })))['word/document.xml']), members = elements(doc, 'wsp');
    expect(members).toHaveLength(2);
    expect(elements(members[0], 'off')[0].getAttribute('x')).toBe(String(150 * 127));
    expect(elements(members[0], 'srgbClr')[0].getAttribute('val')).toBe('404040');
    expect(elements(members[1], 'off')[0].getAttribute('x')).toBe(String(100 * 127));
  });
});

describe('Hanword binary memos and tracked changes', () => {
  const field = (id, data = new Uint8Array(0)) => control(id, concat(new Uint8Array(5), string(''), data));
  it('imports memo fields as comments over their range', () => {
    // As hwplib reads it: the field marks the range; the memo list (memo shape index), its list header
    // (paragraph count, properties, text width and height) and paragraphs follow the paragraph itself.
    const memo = concat(record(93, 1, u32(0)), record(72, 2, concat(u32(1), u32(0), u32(8000), u32(3000))), paragraph('검토 의견', { level: 2 }));
    const model = parseHwp5(hwp({ sections: [paragraph(concat(utf16('앞 '), controlText(3, '%%me'), utf16('대상'), controlText(4, '%%me'), utf16(' 뒤\r')), { children: [field('%%me'), memo] })] }));
    const runs = model.sections[0].blocks[0].runs;
    expect(runs.map((r) => r.kind === 'text' ? r.text : r.kind)).toEqual(['앞 ', 'fieldStart', '대상', 'fieldEnd', ' 뒤']);
    expect(runs[1].comment.blocks[0].runs[0].text).toBe('검토 의견');
    const out = files(model);
    expect(out['word/comments.xml']).toContain('검토 의견');
    const doc = parse(out['word/document.xml']);
    expect(elements(doc, 'commentRangeStart')).toHaveLength(1);
    expect([...model.warnings]).toEqual(['Memos are imported as comments without their author and date.']);
    // A footnote met before the field reads its own (empty) memo list and must not take this paragraph's.
    const note = concat(control('fn  ', new Uint8Array(0)), record(72, 2, concat(u32(1), u32(0))), paragraph('각주', { level: 2 }));
    const nested = parseHwp5(hwp({ sections: [paragraph(concat(utf16('앞'), controlText(17, 'fn  '), controlText(3, '%%me'), utf16('대상'), controlText(4, '%%me'), utf16('\r')), { children: [note, field('%%me'), memo] })] }));
    const nestedRuns = nested.sections[0].blocks[0].runs;
    expect(nestedRuns.map((r) => r.kind)).toEqual(['text', 'note', 'fieldStart', 'text', 'fieldEnd']);
    expect(nestedRuns[2].comment.blocks[0].runs[0].text).toBe('검토 의견');
    expect([...nested.warnings]).not.toContain('A memo without readable content was left out.');
    // A memo whose list holds no text leaves the range as plain text.
    const empty = parseHwp5(hwp({ sections: [paragraph(concat(controlText(3, '%%me'), utf16('대상'), controlText(4, '%%me'), utf16('\r')), { children: [field('%%me'), record(93, 1, u32(0)), record(72, 2, concat(u32(1), u32(0), u32(8000), u32(3000))), paragraph('', { level: 2 })] })] }));
    expect(files(empty)['word/comments.xml']).toBeUndefined();
    expect([...empty.warnings]).toEqual(['A memo without readable content was left out.']);
  });
  it('imports inserted and deleted ranges as tracked changes', () => {
    const text = concat(controlText(3, '%%*e'), utf16('추가'), controlText(4, '%%*e'), utf16(' 그대로 '), controlText(3, '%%*d'), utf16('삭제'), controlText(4, '%%*d'), utf16('\r'));
    const model = parseHwp5(hwp({ sections: [paragraph(text, { children: [field('%%*e'), field('%%*d')] })] }));
    const runs = model.sections[0].blocks[0].runs;
    expect(runs.map((r) => r.kind === 'text' ? r.text : r.kind + (r.revision ? ':' + r.revision.type : ''))).toEqual(['revisionStart:ins', '추가', 'revisionEnd', ' 그대로 ', 'revisionStart:del', '삭제', 'revisionEnd']);
    const doc = parse(files(model)['word/document.xml']);
    expect(elements(doc, 'ins').map((i) => i.textContent)).toEqual(['추가']);
    expect(elements(doc, 'del').map((d) => d.textContent)).toEqual(['삭제']);
    expect(elements(doc, 'delText')).toHaveLength(1);
    expect([...model.warnings]).toEqual(['Tracked insertions and deletions are imported without their author and date.']);
  });
});

describe('Hanword binary highlighter, overlapping letters and bookmarks', () => {
  it('reads highlighter range tags as run highlights over their text positions', () => {
    // Kind 2 in the high byte, a COLORREF (blue, green, red) in the low bytes; positions count UTF-16 units.
    const tags = record(70, 1, concat(u32(2), u32(4), u32(0x020000ff), u32(6), u32(8), u32(0x02a171ad)));
    const model = parseHwp5(hwp({ sections: [paragraph('가나다라ABCD', { children: [tags] })] }));
    expect(model.sections[0].blocks[0].runs.map((r) => [r.text, r.highlight])).toEqual([['가나', undefined], ['다라', 'ff0000'], ['AB', undefined], ['CD', 'ad71a1']]);
    const doc = parse(files(model)['word/document.xml']);
    expect(elements(doc, 'highlight').map((h) => attr(h, 'val'))).toEqual(['red']);
    expect(elements(doc, 'shd').map((s) => attr(s, 'fill'))).toContain('ad71a1');
  });
  it('reads overlapping letters, index marks and real bookmark parameter sets', () => {
    const overlap = control('tcps', concat(u16(2), u16('4'.charCodeAt(0)), u16('0'.charCodeAt(0)), [1, 0xfd, 0], u32(5), u32(0xffffffff)));
    const bookmark = concat(control('bokm', new Uint8Array(0)), record(87, 2, concat(u16(0x21b), u16(1), u16(0), u16(0x4000), u16(1), string('abc123'))));
    const index = control('idxm', concat(string('색인'), string('')));
    const model = parseHwp5(hwp({ sections: [paragraph(concat(controlText(11, 'tcps'), utf16(' 뒤 '), controlText(11, 'bokm'), controlText(11, 'idxm'), utf16('끝\r')), { children: [overlap, bookmark, index] })] }));
    expect(model.sections[0].blocks[0].runs.map((r) => r.kind === 'text' ? r.text : r.kind + ':' + r.name)).toEqual(['40 뒤 ', 'bookmark:abc123', '끝']);
    expect([...model.warnings]).toEqual(['Overlapping characters are imported as text.']);
  });
});

describe('Hanword page boundaries and inline drawings', () => {
  it('starts each page recorded in the Hanword file on a new page', () => {
    const line = (y) => `<hp:linesegarray><hp:lineseg vertpos="${y}" vertsize="1000" spacing="600"/></hp:linesegarray>`;
    const p = (text, y) => `<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run>${line(y)}</hp:p>`;
    const secPr = '<hp:secPr><hp:pagePr width="59528" height="84188"><hp:margin left="8504" right="8504" top="5668" bottom="4252" header="4252" footer="4252"/></hp:pagePr></hp:secPr>';
    const model = parseHwpx(hwpx({ sections: [`<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0">${secPr}<hp:t>첫 쪽</hp:t></hp:run>${line(0)}</hp:p>` + p('첫 쪽 둘째 문단', 1600) + p('둘째 쪽', 0) + p('둘째 쪽 마지막 줄', 64000) + p('셋째 쪽', 0)] }));
    // The first page ended after two lines (early), so its follower starts a page; the second ran full, so its follower flows.
    expect(model.sections[0].blocks.map((b) => !!b.pageBreak)).toEqual([false, false, true, false, false]);
    const doc = parse(files(model)['word/document.xml']);
    expect(elements(doc, 'pageBreakBefore').map((b) => attr(b, 'val'))).toEqual(['0', '0', '1', '0', '0']);
    expect([...model.warnings]).toEqual(['Page breaks follow the pages recorded in the Hanword file where a page ended early.']);
    // Two columns make a vertical reset ambiguous; nothing is forced there.
    const columns = parseHwpx(hwpx({ sections: [`<hp:p paraPrIDRef="0"><hp:run charPrIDRef="0"><hp:ctrl><hp:colPr colCount="2"/></hp:ctrl><hp:t>왼쪽</hp:t></hp:run>${line(0)}</hp:p>` + p('오른쪽', 0)] }));
    expect(columns.sections[0].blocks.map((b) => !!b.pageBreak)).toEqual([false, false]);
  });
  it('rasterizes text-free inline drawings that share a line with text, and only those', () => {
    const rect = (extra = '') => `<hp:rect id="1"><hp:sz width="1200" height="600"/><hp:pos treatAsChar="1"/><hp:lineShape color="#000000" width="33"/><hp:fillBrush><hp:winBrush faceColor="#FF0000"/></hp:fillBrush>${extra}</hp:rect>`;
    const withText = rect(`<hp:drawText><hp:subList>${ptext('글')}</hp:subList></hp:drawText>`);
    const anchored = '<hp:rect id="2"><hp:sz width="1200" height="600"/><hp:pos treatAsChar="0" vertRelTo="PARA" horzRelTo="COLUMN"/><hp:lineShape color="#000000" width="33"/></hp:rect>';
    const model = parseHwpx(hwpx({ sections: [run(`<hp:t>앞 </hp:t>${rect()}<hp:t> 뒤</hp:t>`) + run(rect()) + run(`<hp:t>앞 </hp:t>${withText}`) + run(`<hp:t>앞 </hp:t>${anchored}`)] }));
    const calls = [];
    expect(flattenInlineDrawings(model, (drawing) => { calls.push(drawing.shape); return imageResource(png(), 'png'); })).toBe(true);
    expect(calls).toEqual(['rect']);
    expect(model.sections[0].blocks.map((b) => b.runs.map((r) => r.kind))).toEqual([['text', 'image', 'text'], ['shape'], ['text', 'shape'], ['text', 'shape']]);
    expect(model.sections[0].blocks[0].runs[1]).toMatchObject({ width: 1200, height: 600, alt: 'Drawing' });
    expect([...model.warnings]).toEqual(['Drawings treated as characters inside text are converted to pictures so they keep their place in the line.']);
  });
});

describe('Hanword sizes that a file can break', () => {
  it('keeps HWPX border widths within the range DOCX borders allow', () => {
    const header = '<hh:borderFill id="1"><hh:leftBorder type="SOLID" width="1e999" color="#000000"/><hh:rightBorder type="SOLID" width="99999999 mm" color="#000000"/><hh:topBorder type="SOLID" width="abc" color="#000000"/><hh:bottomBorder type="SOLID" width="0.5 mm" color="#000000"/></hh:borderFill>'
      + HEADER.replace('<hh:paraPr id="0" tabPrIDRef="0"/>', '<hh:paraPr id="0"><hh:border borderFillIDRef="1"/></hh:paraPr>');
    const doc = parse(files(parseHwpx(hwpx({ header, sections: [run(ptext('bordered'))] })))['word/document.xml']);
    const sizes = Object.fromEntries([...elements(doc, 'pBdr')[0].children].map((c) => [c.localName, attr(c, 'sz')]));
    // A kilometre-wide line stops at the 12-point DOCX maximum; a width that is not a finite number is the thin default.
    expect(sizes).toEqual({ top: '2', left: '2', bottom: '11', right: '96' });
  });
  it('keeps text box insets and wrap distances within their XML types', () => {
    const rect = `<hp:rect textWrap="SQUARE"><hp:sz width="6000" height="2400"/><hp:pos treatAsChar="0" horzRelTo="COLUMN" vertRelTo="PARA" horzOffset="0" vertOffset="0"/><hp:outMargin left="4294967295" right="4294967295" top="0" bottom="0"/><hp:drawText><hp:textMargin left="4294967295" right="0" top="0" bottom="0"/><hp:subList>${ptext('box')}</hp:subList></hp:drawText></hp:rect>`;
    const doc = parse(files(parseHwpx(hwpx({ sections: [run(rect)] })))['word/document.xml']);
    const anchor = elements(doc, 'anchor')[0], body = elements(doc, 'bodyPr')[0];
    expect(Number(anchor.getAttribute('distL'))).toBeLessThanOrEqual(4294967295);
    expect(Number(anchor.getAttribute('distL'))).toBeGreaterThan(0);
    expect(Number(body.getAttribute('lIns'))).toBe(2147483647);
  });
  it('gives thousands of alike bookmark names their suffixes without slowing down', () => {
    // Names that agree on their first 32 characters all share one sanitized base.
    const model = parseHwp5(hwp({ sections: [paragraph('책갈피')] }));
    const first = model.sections[0].blocks[0];
    model.sections[0].blocks = Array.from({ length: 5000 }, (_, i) => ({ ...first, runs: [{ kind: 'bookmark', name: `${'x'.repeat(32)}${i}` }, { kind: 'text', text: 'x', char: 0 }] }));
    const started = performance.now();
    const document = files(model)['word/document.xml'];
    // Every name used to be tried against every earlier suffix: 5,000 of them took seconds.
    expect(performance.now() - started).toBeLessThan(3000);
    const names = [...document.matchAll(/<w:bookmarkStart [^>]*w:name="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(5000);
    expect(names.slice(0, 3)).toEqual(['x'.repeat(32), `${'x'.repeat(32)}_1`, `${'x'.repeat(32)}_2`]);
  }, 15000);
});
