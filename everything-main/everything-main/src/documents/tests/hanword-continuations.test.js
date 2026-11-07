import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { parseHwp5 } from '../src/lib/hwp/hwp5.js';
import { modelToDocx } from '../src/lib/hwp/docx.js';
import { hwp, paragraph } from './helpers/hwp-fixtures.js';

const documentXml = (model) => strFromU8(unzipSync(modelToDocx(model))['word/document.xml']);
const paragraphs = (xml) => [...xml.matchAll(/<w:p>.*?<\/w:p>/gs)].map((m) => m[0]);

describe('the Hanword writer and deleted runs', () => {
  it('writes ruby text and a field inside a deletion as deleted text', () => {
    const model = parseHwp5(hwp({ sections: [paragraph('Before')] }));
    const block = model.sections[0].blocks[0];
    block.runs = [
      { kind: 'revisionStart', id: 7, revision: { type: 'del', author: 'Reviewer' } },
      { kind: 'ruby', text: '漢字', ruby: 'かんじ', char: 0 },
      { kind: 'field', instruction: 'PAGE', text: '3', char: 0 },
      { kind: 'revisionEnd', id: 7 },
      { kind: 'text', text: ' kept', char: 0 },
    ];
    const xml = documentXml(model);
    const deleted = [...xml.matchAll(/<w:del [^>]*>(.*?)<\/w:del>/gs)].map((m) => m[1]);
    expect(deleted).toHaveLength(2);
    // An equation the writer can express in math markup is deleted along with its neighbours.
    const withMath = parseHwp5(hwp({ sections: [paragraph('Before')] }));
    withMath.sections[0].blocks[0].runs = [{ kind: 'revisionStart', id: 3, revision: { type: 'del', author: 'R' } }, { kind: 'equation', text: 'a + b', char: 0 }, { kind: 'revisionEnd', id: 3 }];
    const mathXml = documentXml(withMath);
    expect(mathXml).toMatch(/<w:del [^>]*>\s*<m:oMath/);
    for (const inner of deleted) {
      expect(inner).toContain('<w:delText xml:space="preserve">');
      expect(inner).not.toContain('<w:t ');
    }
    expect(deleted[0]).toContain('>漢字</w:delText>');
    expect(deleted[0]).toContain('>かんじ</w:delText>');
    expect(deleted[1]).toContain('<w:fldSimple w:instr="PAGE">');
    expect(xml).toContain('<w:t xml:space="preserve"> kept</w:t>');
  });
});

describe('the Hanword writer and paragraphs split around inline objects', () => {
  it('numbers a list paragraph once, not again after the table inside it', () => {
    const model = parseHwp5(hwp({ sections: [paragraph('Before')] }));
    // A numbered (heading) paragraph whose text continues after nested blocks in the middle of it.
    model.paras[0].heading = 1;
    model.paras[0].numbering = 1;
    const block = model.sections[0].blocks[0];
    block.runs = [{ kind: 'text', text: 'Before', char: 0 }, { kind: 'blocks', blocks: [{ kind: 'p', runs: [{ kind: 'text', text: 'Inner', char: 0 }] }] }, { kind: 'text', text: 'After', char: 0 }];
    const parts = paragraphs(documentXml(model)).filter((p) => /<w:t[^>]*>(?:Before|After)</.test(p));
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
    expect(parts[0]).toContain('<w:outlineLvl w:val="0"/>');
    // The continuation keeps the list's indentation but is neither numbered nor a heading of its own.
    expect(parts[1]).toContain('<w:numId w:val="0"/>');
    expect(parts[1]).not.toContain('<w:numId w:val="1"/>');
    expect(parts[1]).toContain('<w:outlineLvl w:val="9"/>');
  });
});

describe('the Hanword writer and notes inside notes and comments', () => {
  it('writes a footnote referenced from an endnote or a comment, so no reference dangles', () => {
    const model = parseHwp5(hwp({ sections: [paragraph('Body')] }));
    const foot = (text) => ({ kind: 'note', end: false, blocks: [{ kind: 'p', runs: [{ kind: 'text', text, char: 0 }] }] });
    model.sections[0].blocks[0].runs = [
      { kind: 'text', text: 'Body', char: 0 },
      { kind: 'note', end: true, blocks: [{ kind: 'p', runs: [{ kind: 'text', text: 'end says', char: 0 }, foot('foot in end')] }] },
      { kind: 'fieldStart', id: 'c1', comment: { author: 'A', blocks: [{ kind: 'p', runs: [{ kind: 'text', text: 'note this', char: 0 }, foot('foot in comment')] }] } },
      { kind: 'text', text: 'commented', char: 0 },
      { kind: 'fieldEnd', id: 'c1' },
    ];
    const files = Object.fromEntries(Object.entries(unzipSync(modelToDocx(model))).map(([name, bytes]) => [name, name.endsWith('.xml') || name.endsWith('.rels') ? strFromU8(bytes) : bytes]));
    expect(files['word/footnotes.xml']).toContain('foot in end');
    expect(files['word/footnotes.xml']).toContain('foot in comment');
    expect(files['word/endnotes.xml']).toContain('<w:footnoteReference w:id="');
    expect(files['word/comments.xml']).toContain('<w:footnoteReference w:id="');
    // Every part the document's relationships name is in the package.
    for (const target of [...files['word/_rels/document.xml.rels'].matchAll(/Target="([^"]+)"/g)].map((m) => m[1]).filter((t) => !/^https?:/.test(t))) {
      expect(files[`word/${target}`], target).toBeDefined();
    }
  });
});

describe('the Hanword writer and values outside their range', () => {
  it('writes a usable path for a shape whose recorded size is missing or negative, and clamps a negative list level', () => {
    const model = parseHwp5(hwp({ sections: [paragraph('Shape')] }));
    model.paras[0].heading = 1;
    model.paras[0].numbering = 1;
    model.paras[0].level = -1;
    model.sections[0].blocks[0].runs = [
      { kind: 'shape', shape: 'polygon', width: 1200, height: 600, coordWidth: undefined, coordHeight: -5, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 50 }], fill: null, line: { style: 'SOLID', width: 1, color: '000000' }, blocks: [] },
      { kind: 'text', text: 'Shape', char: 0 },
    ];
    const xml = documentXml(model);
    expect(xml).not.toContain('NaN');
    expect(xml).toMatch(/<a:path w="1200" h="600"/);
    expect(xml).toContain('<w:ilvl w:val="0"/>');
    expect(xml).toContain('<w:outlineLvl w:val="0"/>');
  });
});

describe('the Hanword writer and tables at the end of a story', () => {
  const table = (text) => ({ kind: 'table', rows: 1, cols: 1, cells: [{ row: 0, col: 0, rowSpan: 1, colSpan: 1, width: 6000, height: 1200, blocks: [{ kind: 'p', runs: [{ kind: 'text', text, char: 0 }] }] }] });
  const fresh = () => parseHwp5(hwp({ sections: [paragraph('Before')] }));

  it('keeps two tables in a row apart, since DOCX readers join tables written back to back', () => {
    const model = fresh();
    model.sections[0].blocks = [{ kind: 'p', runs: [table('first')] }, { kind: 'p', runs: [table('second')] }, { kind: 'p', runs: [{ kind: 'text', text: 'after', char: 0 }] }];
    const xml = documentXml(model);
    expect(xml.match(/<w:tbl>/g)).toHaveLength(2);
    expect(xml).not.toContain('</w:tbl><w:tbl>');
    // The paragraph between them has no height, so no blank line shows.
    expect(xml).toMatch(/<\/w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"\/>[^]*?<\/w:p><w:tbl>/);
  });

  it('ends a text box, a note and a comment whose last block is a table with a paragraph, as DOCX readers require', () => {
    const model = fresh();
    const block = model.sections[0].blocks[0];
    block.runs = [
      { kind: 'shape', shape: 'rect', width: 20000, height: 10000, line: { style: 'SOLID', width: 33, color: '000000' }, fill: null, padding: {}, textAlign: 'top', blocks: [{ kind: 'p', runs: [table('boxed')] }] },
      { kind: 'note', blocks: [{ kind: 'p', runs: [table('noted')] }] },
      { kind: 'fieldStart', id: 'c1', comment: { author: 'A', date: '', blocks: [{ kind: 'p', runs: [table('commented')] }] } }, { kind: 'text', text: 'on', char: 0 }, { kind: 'fieldEnd', id: 'c1' },
    ];
    const parts = unzipSync(modelToDocx(model));
    expect(strFromU8(parts['word/document.xml'])).toMatch(/<\/w:tbl><w:p\/><\/w:txbxContent>/);
    expect(strFromU8(parts['word/footnotes.xml'])).toMatch(/<\/w:tbl><w:p\/><\/w:footnote>/);
    expect(strFromU8(parts['word/comments.xml'])).toMatch(/<\/w:tbl><w:p\/><\/w:comment>/);
  });
});

describe('the Hanword writer and run properties', () => {
  it('writes kerning as the smallest kerned size, 0 for off', () => {
    const on = parseHwp5(hwp({ sections: [paragraph('Kerned')] }));
    on.chars[0].kerning = true;
    expect(documentXml(on)).toContain('<w:kern w:val="2"/>');
    const off = parseHwp5(hwp({ sections: [paragraph('Plain')] }));
    off.chars[0].kerning = false;
    expect(documentXml(off)).toContain('<w:kern w:val="0"/>');
  });

  it('writes no tab list when every stop lies past what DOCX readers accept', () => {
    const model = parseHwp5(hwp({ sections: [paragraph('Tabbed')] }));
    model.paras[0].tabs = [{ pos: 40000000, align: 'left' }];
    expect(documentXml(model)).not.toContain('<w:tabs>');
  });

  it('keeps a note reference inside the deletion that covers it', () => {
    const model = parseHwp5(hwp({ sections: [paragraph('Before')] }));
    model.sections[0].blocks[0].runs = [
      { kind: 'revisionStart', id: 5, revision: { type: 'del', author: 'Reviewer' } },
      { kind: 'note', blocks: [{ kind: 'p', runs: [{ kind: 'text', text: 'gone', char: 0 }] }] },
      { kind: 'revisionEnd', id: 5 },
    ];
    expect(documentXml(model)).toMatch(/<w:del [^>]*><w:r><w:footnoteReference w:id="1"\/><\/w:r><\/w:del>/);
  });
});

describe('the Hanword writer and the 22-inch DOCX page limit', () => {
  it('scales an oversized page down whole and replaces a page of no size, and bounds spacing, indents and table measures', () => {
    const poster = parseHwp5(hwp({ sections: [paragraph('Poster')] }));
    poster.sections[0].page = { width: 238390, height: 337040, left: 8504, right: 8504, top: 7200, bottom: 7200, header: 3600, footer: 3600, gutter: 0 };
    const xml = documentXml(poster);
    const size = /<w:pgSz w:w="(\d+)" w:h="(\d+)"/.exec(xml);
    expect(Number(size[2])).toBe(31680);
    expect(Number(size[1])).toBeGreaterThan(22000);
    expect(Number(size[1])).toBeLessThan(31680);
    expect([...poster.warnings]).toContain('A page larger than the 22-inch DOCX page-size limit was scaled down to fit it.');
    const tiny = parseHwp5(hwp({ sections: [paragraph('Tiny')] }));
    tiny.sections[0].page = { width: 1, height: 1, left: 0, right: 0, top: 0, bottom: 0, header: 0, footer: 0, gutter: 0 };
    expect(documentXml(tiny)).toContain('<w:pgSz w:w="12240" w:h="15840"/>');
    const spaced = parseHwp5(hwp({ sections: [paragraph('Spaced')] }));
    spaced.paras[0].before = 900000; spaced.paras[0].left = 900000; spaced.paras[0].indent = -900000;
    const spacedXml = documentXml(spaced);
    expect(spacedXml).toMatch(/<w:spacing w:before="31680"/);
    expect(spacedXml).toMatch(/w:hanging="31680"/);
  });
});

describe('the Hanword writer and line numbers', () => {
  it('stops emulating line numbers after five thousand, with a note, instead of swelling the file past its limit', () => {
    const model = parseHwp5(hwp({ sections: [paragraph('Numbered')] }));
    model.sections[0].lineNumbers = { restart: 'continuous', countBy: 1, distance: 1417, start: 1 };
    model.sections[0].blocks = Array.from({ length: 5010 }, (_, i) => ({ kind: 'p', para: 0, char: 0, runs: [{ kind: 'text', text: `Line ${i}`, char: 0 }], linePositions: [i * 1000] }));
    const xml = documentXml(model);
    expect((xml.match(/<wps:txbx>/g) || []).length).toBe(5000);
    expect([...model.warnings]).toContain('Line numbers beyond the first 5,000 numbered lines were left out.');
  });
});

describe('the Hanword writer and section changes', () => {
  const block = (text) => ({ kind: 'p', para: 0, char: 0, runs: [{ kind: 'text', text, char: 0 }] });
  const textBox = (text) => ({ kind: 'shape', shape: 'rect', width: 12000, height: 6000, fill: null, blocks: [block(text)], layout: { h: 'column', v: 'paragraph', x: 0, y: 0, hAlign: 'left', vAlign: 'top', wrap: 'none', overlap: false, zOrder: 0 } });
  const twoSections = (lastBlocks) => {
    const model = parseHwp5(hwp({ sections: [paragraph('One')] }));
    model.sections = [{ ...model.sections[0], blocks: lastBlocks, breakType: 'continuous' }, { ...model.sections[0], blocks: [block('Third')] }];
    return model;
  };
  it('puts a section\'s properties on its last paragraph instead of on a blank paragraph of their own', () => {
    const xml = documentXml(twoSections([block('First'), block('Second')]));
    // Three paragraphs of text, no fourth: the first section's properties ride on "Second".
    expect((xml.match(/<w:p>/g) || []).length).toBe(3);
    expect(xml.match(/<w:sectPr>/g)).toHaveLength(2);
    const second = xml.slice(xml.indexOf('<w:p>', xml.indexOf('First')), xml.indexOf('Second'));
    expect(second).toMatch(/^<w:p><w:pPr>.*<w:sectPr>.*<\/w:sectPr><\/w:pPr>/s);
    // The section properties close the paragraph properties, after the run properties of the mark.
    expect(second).not.toMatch(/<\/w:sectPr><\/w:pPr>.*<w:rPr>[^]*<\/w:pPr>/s);
  });
  it('finds the last top-level paragraph past the paragraphs inside a text box', () => {
    const xml = documentXml(twoSections([block('First'), { ...block('Second'), runs: [{ kind: 'text', text: 'Second ', char: 0 }, textBox('Boxed')] }]));
    expect(xml.match(/<w:sectPr>/g)).toHaveLength(2);
    expect(xml).toContain('<w:txbxContent>');
    const boxed = xml.slice(xml.indexOf('<w:txbxContent>'), xml.indexOf('</w:txbxContent>'));
    expect(boxed).not.toContain('<w:sectPr>');
    const second = xml.slice(xml.indexOf('<w:p>', xml.indexOf('First')), xml.indexOf('Second '));
    expect(second).toMatch(/^<w:p><w:pPr>.*<w:sectPr>/s);
  });
  it('keeps a paragraph of their own for a section that ends with a table', () => {
    const table = { kind: 'table', rows: 1, cols: 1, cells: [{ row: 0, col: 0, rowSpan: 1, colSpan: 1, width: 40000, height: 2000, blocks: [block('Cell')] }] };
    const xml = documentXml(twoSections([block('First'), table]));
    expect(xml).toMatch(/<\/w:tbl><w:p><w:pPr><w:sectPr>/);
  });
});
