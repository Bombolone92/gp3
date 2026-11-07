import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { paintText } from '../src/engine/canvas-paint-text.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { resolveEmptyTextFills } from '../src/engine/text-fill.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('tests/fixtures/text-fill/controls.docx');
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p,d) => new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const targets = d => d.paragraphs.flatMap(p => p.runs).filter(r => r.text === 'Abcdef');
const equal = (a,b,except=[]) => { expect(Object.keys(a)).toEqual(Object.keys(b)); for (const n in a) if (!except.includes(n)) expect(Buffer.from(a[n]).equals(Buffer.from(b[n])),n).toBe(true); };
const measure = t => ({ width: (t.length - (t.match(/AV/g)?.length || 0) / 3) * 8, ascent: 12, descent: 4, underlineOffset: 2, underlineThickness: 1, strikeOffset: -5, strikeThickness: 1 });

it('imports no-fill, solid, empty and inherited declarations without replacing ordinary color', async () => {
  const p = await DocxPackage.open(source), d = model(p);
  expect(targets(d).map(r => r.textFill)).toEqual([null,'none','208020','empty','none','none','none','none','none','none','none','none','2040C0','none','none','208020']);
  expect(targets(d)[11].color).toBe('2040C0'); expect(targets(d)[7].textOutline.color).toBe('008080');
  equal(unzipSync(await save(p,d)),p.parts);
});

it('preserves fills through text insertion, ordinary foreground edits, export and exact undo', async () => {
  const p = await DocxPackage.open(source), d = model(p), at = d.text.indexOf('02 | ') + 5;
  d.select(at,at+6); d.setRunFormat({color:'112233'}); d.select(at+3,at+3); d.replace('new');
  const bytes = await save(p,d), out = model(await DocxPackage.open(bytes));
  expect(out.text).toContain('02 | Abcnewdef'); expect(out.paragraphs[1].runs.find(r => r.text.includes('new')).textFill).toBe('none');
  expectBodyEditParts(unzipSync(bytes),p.parts); d.undo();d.undo();equal(unzipSync(await save(p,d)),p.parts);
});

it('authors fill changes and removes style declarations without silently changing inheritance', async () => {
  const p = await DocxPackage.open(source), d = model(p), at = d.text.indexOf('11 | ') + 5;
  d.select(at,at+6); d.setRunFormat({textFill:'abcdef'}); d.editCharacterStyle('NoFill',{run:{textFill:null}});
  const out = model(await DocxPackage.open(await save(p,d)));
  expect(targets(out)[10].textFill).toBe('ABCDEF'); expect(targets(out)[11].textFill).toBeNull();
  expect(() => d.setRunFormat({textFill:null})).toThrow('Clear Formatting');
  const fresh = createDocx([paragraph('Fill')]), m = model(fresh); m.select(0,4);m.setRunFormat({textFill:'none'});
  const bytes = await save(fresh,m);expect(strFromU8(unzipSync(bytes)['word/document.xml'])).toContain('mc:Ignorable="w14"');
  expect(model(await DocxPackage.open(bytes)).paragraphs[0].runs[0].textFill).toBe('none');
});

it('keeps no-fill advances, kerning and caret positions while separating paint spans', () => {
  const d = new TextDocument([paragraph('AVAV')]), layout = () => layoutDocument(d.paragraphs,measure,pageGeometry(d.pageSettings),d.numbering,d.tables);
  const before = layout(); d.select(1,3);d.setRunFormat({textFill:'none'});const after = layout();
  expect(after.lines[0].stops).toEqual(before.lines[0].stops);expect(after.lines[0].fragments).toHaveLength(1);
  expect(after.lines[0].fragments[0].width).toBe(before.lines[0].fragments[0].width);
  expect(after.lines[0].fragments[0].colors.map(c => c.textFill)).toEqual([null,'none',null]);
});

it('suppresses automatic decorations but retains an explicit underline and hollow outline', async () => {
  const p = await DocxPackage.open(source), d = model(p), layout = layoutDocument(d.paragraphs,measure,pageGeometry(d.pageSettings),d.numbering,d.tables);
  const line = prefix => layout.lines.find(l => l.fragments.map(f => f.text).join('').startsWith(prefix));
  expect(line('05 |').underlines).toEqual([]);expect(line('06 |').underlines[0].color).toBe('C02020');expect(line('07 |').strikes).toEqual([]);
  const calls=[],ctx={fillText:()=>calls.push('fill'),strokeText:()=>calls.push('stroke'),save(){},restore(){},setLineDash(){},measureText:()=>({width:1})};
  paintText(ctx,{text:'Abcdef',x:0,textFill:'none',textOutline:targets(d)[7].textOutline},20); expect(calls).toEqual(['stroke']);
  calls.length=0;paintText(ctx,{text:'Abcdef',x:0,textFill:'none',bold:true,fontSize:18},20);expect(calls).toEqual([]);
});

it('resolves native empty-fill color carry on layout copies and responds to earlier edits', async () => {
  const p = await DocxPackage.open(readFileSync('tests/fixtures/text-fill/empty-order.docx')),d=model(p);
  const resolved=resolveEmptyTextFills(d.paragraphs);
  expect(targets({paragraphs:resolved}).map(r=>r.textFill)).toEqual(['000000','2040C0','2040C0',null,'2040C0','none','2040C0','208020','208020']);
  expect(targets(d)[0].textFill).toBe('empty');const at=d.text.indexOf('02 | ')+5;d.select(at,at+6);d.setRunFormat({textFill:'AABBCC'});
  expect(targets({paragraphs:resolveEmptyTextFills(d.paragraphs)})[2].textFill).toBe('AABBCC');
  expect(targets(model(await DocxPackage.open(await save(p,d))))[2].textFill).toBe('empty');
});

it('rejects unsupported gradients, transforms and malformed fill nodes', async () => {
  for (const replacement of ['<w14:gradFill/>','<w14:noFill w14:unexpected="1"/>','<w14:noFill/><w14:solidFill/>','<w14:solidFill><w14:srgbClr w14:val="208020"><w14:tint w14:val="50000"/></w14:srgbClr></w14:solidFill>','<w14:solidFill><w14:srgbClr w14:val="none"/></w14:solidFill>']) {
    const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<w14:noFill/>',replacement));
    await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
  }
});
