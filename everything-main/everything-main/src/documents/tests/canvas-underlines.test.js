import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx, W } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { fontMetrics } from '../src/engine/font-metrics.js';
import { UNDERLINE_STYLES, underlineInk } from '../src/engine/underlines.js';
let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/underlines.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const measure = (text, style) => ({ ...fontMetrics(style), width: [...text].length * style.fontSize * 2 / 3 });
const layout = doc => layoutDocument(doc.paragraphs, measure, pageGeometry(doc.pageSettings), doc.numbering, doc.tables);
const select = (doc, text) => { const at = doc.text.indexOf(text); expect(at).toBeGreaterThanOrEqual(0); doc.select(at, at + text.length); };
const run = (doc, text) => doc.paragraphs.flatMap(p => p.runs).find(r => r.text === text);
const geometry = result => ({ pages: result.pageCount, lines: [...result.lines, ...result.repeatedLines].map(l => [l.start,l.end,l.page,l.y,l.height,l.baseline,l.stops,l.fragments.map(f => [f.text,f.x,f.width])]), cells: result.cells.map(c => [c.page,c.x,c.y,c.width,c.height]) });
function sameParts(actual, expected, except = []) { expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort()); for (const name of Object.keys(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(expected[name])), name).toBe(true); }
function revise(part, change, bytes = source) { const parts = unzipSync(bytes), xml = new DOMParser().parseFromString(strFromU8(parts[part]), 'application/xml'); change(xml); parts[part] = strToU8(new XMLSerializer().serializeToString(xml)); return zipSync(parts); }
const node = (xml, tag, val) => { const n = xml.createElementNS(W, 'w:' + tag); if (val !== undefined) n.setAttributeNS(W,'w:val',val); return n; };
const namedStyle = (xml,id) => [...xml.getElementsByTagNameNS(W,'style')].find(s => s.getAttributeNS(W,'styleId') === id);

it('imports every pattern and independently inherited attributes with byte-exact no-edit preservation', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  for (const pattern of Object.keys(UNDERLINE_STYLES)) expect(run(doc, `${pattern}: Alpha beta 123`)).toMatchObject({ underline: pattern !== 'none', underlineStyle: pattern });
  for (const [text,pattern,color] of [['Inherited double red','double','A00000'],['Child double blue','double','0000A0'],['Character wave blue','wave','0000A0'],['Direct pattern inherits blue','dash','0000A0'],['Direct color inherits double','double','008800'],['Empty property inherits double','double','A00000'],['Empty property has no underline','none','auto'],['Character none','none','A00000'],['Pattern header','dottedHeavy','008800'],['Wave header','wavyDouble','008800']]) expect(run(doc,text),text).toMatchObject({underlineStyle:pattern,underlineColor:color});
  sameParts(unzipSync(await save(pkg,doc)),pkg.parts);
});

it('edits direct patterns/colors, clears with the boolean shortcut and preserves geometry and exact undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), before = doc.snapshot(), original = layout(doc); select(doc,'double: Alpha beta 123'); doc.setRunFormat({underlineStyle:'wavyDouble',underlineColor:'008800'});
  expect(geometry(layout(doc))).toEqual(geometry(original)); const bytes = await save(pkg,doc), out = model(await DocxPackage.open(bytes)); expect(run(out,'double: Alpha beta 123')).toMatchObject({underlineStyle:'wavyDouble',underlineColor:'008800'}); sameParts(unzipSync(bytes),pkg.parts,['word/document.xml']);
  doc.toggleUnderline(); expect(run(doc,'double: Alpha beta 123').underlineStyle).toBe('none'); doc.toggleUnderline(); expect(run(doc,'double: Alpha beta 123')).toMatchObject({underlineStyle:'single',underlineColor:'auto'});
  doc.undo(); doc.undo(); doc.undo(); expect(doc.paragraphs).toEqual(before.paragraphs); expect(layout(doc)).toEqual(original); sameParts(unzipSync(await save(pkg,doc)),pkg.parts); doc.redo(); expect(run(doc,'double: Alpha beta 123').underlineStyle).toBe('wavyDouble');
});

it('edits shared pattern and color independently, removes either attribute, and preserves direct declarations', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), before = doc.snapshot();
  doc.editParagraphStyle('UnderlineBase',{run:{underlineStyle:'dash'}}); expect(run(doc,'Inherited double red')).toMatchObject({underlineStyle:'dash',underlineColor:'A00000'}); expect(run(doc,'Child double blue').underlineStyle).toBe('dash');
  doc.editParagraphStyle('UnderlineChild',{run:{underlineColor:null}}); expect(run(doc,'Character wave blue')).toMatchObject({underlineStyle:'wave',underlineColor:'A00000'});
  doc.editCharacterStyle('UnderlineCharacter',{run:{underlineColor:'008800'}}); doc.editCharacterStyle('UnderlineCharacter',{run:{underlineStyle:null}}); expect(run(doc,'Character wave blue')).toMatchObject({underlineStyle:'dash',underlineColor:'008800'}); expect(run(doc,'Direct pattern inherits blue').underlineStyle).toBe('dash');
  const bytes = await save(pkg,doc), out = model(await DocxPackage.open(bytes)); for (const text of ['Inherited double red','Child double blue','Character wave blue']) expect(run(out,text)).toMatchObject({underlineStyle:run(doc,text).underlineStyle,underlineColor:run(doc,text).underlineColor}); sameParts(unzipSync(bytes),pkg.parts,['word/document.xml','word/styles.xml']);
  doc.undo(); doc.undo(); doc.undo(); doc.undo(); expect(doc.paragraphs).toEqual(before.paragraphs); sameParts(unzipSync(await save(pkg,doc)),pkg.parts);
});

it('preserves inherited patterns for direct color-only edits through reopen and subsequent shared-style changes', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg); select(doc,'Inherited double red'); doc.setRunFormat({underlineColor:'ABCDEF'}); select(doc,'Direct color inherits double'); doc.setRunFormat({bold:true}); const out = model(await DocxPackage.open(await save(pkg,doc)));
  expect(run(out,'Inherited double red')).toMatchObject({underlineStyle:'double',underlineColor:'ABCDEF'}); expect(run(out,'Direct color inherits double')).toMatchObject({underlineStyle:'double',underlineColor:'008800'}); expect(run(out,'Direct color inherits double').properties).not.toMatch(/<w:u[^>]+w:val=/); expect(run(out,'Inherited double red').properties).not.toMatch(/<w:u[^>]+w:val=/);
  out.editParagraphStyle('UnderlineBase',{run:{underlineStyle:'thick'}}); expect(run(out,'Inherited double red')).toMatchObject({underlineStyle:'thick',underlineColor:'ABCDEF'}); expect(run(out,'Direct color inherits double')).toMatchObject({underlineStyle:'thick',underlineColor:'008800'});
});

it('inherits omitted pattern and color from document defaults and treats underline as an ordinary style value', async () => {
  const bytes = revise('word/styles.xml',xml => { const rpr = xml.getElementsByTagNameNS(W,'rPrDefault')[0].firstElementChild, u = node(xml,'u','thick'); u.setAttributeNS(W,'w:color','008800'); rpr.append(u); }); const pkg = await DocxPackage.open(bytes), doc = model(pkg);
  expect(run(doc,'Empty property has no underline')).toMatchObject({underlineStyle:'thick',underlineColor:'008800'}); expect(run(doc,'Character wave blue')).toMatchObject({underlineStyle:'wave',underlineColor:'0000A0'});
  doc.editCharacterStyle('UnderlineCharacter',{run:{underlineStyle:'double'}}); expect(run(doc,'Character wave blue').underlineStyle).toBe('double'); expect(run(model(await DocxPackage.open(await save(pkg,doc))),'Character wave blue').underlineStyle).toBe('double');
});

it('leaves shaping, source stops, selections, AutoFit and pagination unchanged across all pattern edits', async () => {
  const doc = model(await DocxPackage.open(source)), before = layout(doc); select(doc,'Words a b'); const at = doc.range[0]+2, caret = caretRect(before,at), rects = selectionRects(before,at,at+3);
  for (const underlineStyle of Object.keys(UNDERLINE_STYLES)) { doc.setRunFormat({underlineStyle}); const after = layout(doc); expect(geometry(after)).toEqual(geometry(before)); expect(after.tableWidths).toEqual(before.tableWidths); expect(caretRect(after,at)).toEqual(caret); expect(selectionRects(after,at,at+3)).toEqual(rects); expect(hitTest(after,caret.page,caret.x,caret.y+caret.height/2)).toBe(at); }
  const line = layoutDocument([paragraph('',{runs:[{text:'a',underlineStyle:'double'},{text:'vatar',underlineStyle:'wave'}]})],measure).lines[0]; expect(line.fragments).toHaveLength(1); expect(line.underlines.map(u=>u.pattern)).toEqual(['double','wave']);
});

it('words-only skips breaking and nonbreaking spaces, tabs, and combining sequences based on a space', () => {
  const text = 'a b\u00a0c\u202fd\u2007e\tem\u2003f \u0301g', line = layoutDocument([paragraph('',{runs:[{text,underlineStyle:'words'}]})],measure).lines[0];
  expect(line.underlines).toHaveLength(8); expect(line.underlines.map(u=>u.width)).toEqual([8,8,8,8,8,16,8,8]);
  for (const index of [1,3,5,7,9,12,14]) { const a=line.stops.find(s=>s.offset===index)?.x,b=line.stops.find(s=>s.offset===index+1)?.x; if(a!==undefined&&b!==undefined) expect(line.underlines.some(u=>u.x < b-1e-6&&u.x+u.width > a+1e-6)).toBe(false); }
});

it('uses original font metrics for all thicknesses, doubles, dashes and wave curves after script transforms', () => {
  const make = pattern => layoutDocument([paragraph('',{runs:[{text:'Abcd',underlineStyle:pattern,fontSize:24,verticalAlign:'superscript',baselineShift:3,textScale:150} ]})],measure).lines[0].underlines[0];
  const span = make('single'), t=32*.05*.6; expect(span.thickness).toBeCloseTo(t); expect(span.offset).toBeCloseTo(32*.1*.6-32*.35-4);
  expect(underlineInk(make('double')).rects.map(r=>r.y)).toEqual([span.offset,span.offset+2*t]); expect(underlineInk(make('thick')).rects[0].height).toBeCloseTo(2*t);
  expect(underlineInk(make('dotDash')).rects.slice(0,3).map(r=>r.width)).toEqual([4*t,t,4*t]);
  for(const pattern of ['wave','wavyHeavy','wavyDouble']) { const ink=underlineInk(make(pattern)); expect(ink.rects).toHaveLength(0); expect(ink.waves).toHaveLength(pattern==='wavyDouble'?2:1); expect(ink.waves[0].thickness).toBeCloseTo(t*(pattern==='wavyHeavy'?2:1)); expect(ink.waves[0].curve.flat().every(Number.isFinite)).toBe(true); }
});

it('keeps dash and wave phase continuous across color-only boundaries and clips partial periods to each span', () => {
  for(const pattern of ['dash','wave']) { const line=layoutDocument([paragraph('',{runs:[{text:'abc',underlineStyle:pattern,color:'FF0000'},{text:'de',underlineStyle:pattern,color:'0000FF'}]})],measure).lines[0]; expect(line.fragments).toHaveLength(1); expect(line.underlines[1].phase).toBe(line.underlines[0].width); const ink=underlineInk(line.underlines[1]); for(const r of ink.rects) { expect(r.x).toBeGreaterThanOrEqual(line.underlines[1].x); expect(r.x+r.width).toBeLessThanOrEqual(line.underlines[1].x+line.underlines[1].width+1e-6); } }
});

it('applies trailing-space compatibility to every pattern and words-only still skips trailing spaces', () => {
  for(const pattern of Object.keys(UNDERLINE_STYLES).filter(p=>p!=='none')) { const p=paragraph('',{runs:[{text:'AB'+' '.repeat(100),underlineStyle:pattern}]}), normal=layoutDocument([p],measure), enabled=layoutDocument([p],measure,{width:816,height:1056,margin:96,ulTrailSpace:true}); expect(normal.lines[0].underlines[0].width).toBe(16); expect(enabled.lines[0].underlines[0].width).toBe(pattern==='words'?16:624); }
});

it('retains repeated-header patterns, source hit targets and numbering word gaps', async () => {
  const doc=model(await DocxPackage.open(source)), result=layout(doc), repeat=result.repeatedLines.find(l=>l.end-l.start>3), c=caretRect(result,repeat.start+2,'forward',repeat.page); expect(repeat.underlines.length).toBeGreaterThan(0); expect(hitTest(result,repeat.page,c.x,c.y+c.height/2)).toBe(repeat.start+2);
  const marker=result.lines.find(l=>l.marker).marker; expect(marker.underlines).toHaveLength(2); expect(marker.underlines[1].x).toBeGreaterThan(marker.underlines[0].width); expect(marker.underlines.every(u=>u.pattern==='words')).toBe(true);
});

it('preserves Unicode input, mixed selections, pending formatting, split/merge and round trips', async () => {
  const pkg=createDocx(),doc=model(pkg); doc.setRunFormat({underlineStyle:'double'}); doc.replace('á😀'); doc.insertParagraph(); doc.setRunFormat({underlineStyle:'wave'}); doc.replace('Tail'); doc.select(0,doc.text.length); expect(doc.runFormatting.underline).toBe(true); expect(doc.runFormatting.underlineStyle).toBeNull(); doc.select(4,5); doc.replace(''); expect(doc.text).toBe('á😀Tail'); const out=model(await DocxPackage.open(await save(pkg,doc))); expect(out.paragraphs[0].runs.map(r=>r.underlineStyle)).toEqual(['double','wave']); doc.undo(); expect(doc.paragraphs).toHaveLength(2);
});

it.each(['auto','','DOUBLE','zigzag'])('rejects invalid active underline pattern %s before attaching an editor', async value => {
  await expect(DocxPackage.open(revise('word/document.xml',xml=>xml.getElementsByTagNameNS(W,'u')[0].setAttributeNS(W,'w:val',value)))).rejects.toThrow(/invalid underline pattern/);
});

it('rejects duplicate, nested and unknown underline content, keeps unused invalid styles and rejects exposure atomically', async () => {
  for(const change of [u=>u.after(u.cloneNode(true)),u=>u.append(node(u.ownerDocument,'b')),u=>u.setAttributeNS(W,'w:extra','1')]) await expect(DocxPackage.open(revise('word/document.xml',xml=>change(xml.getElementsByTagNameNS(W,'u')[0])))).rejects.toThrow();
  const pkg=await DocxPackage.open(revise('word/styles.xml',xml=>{const s=namedStyle(xml,'UnderlineCharacter').cloneNode(true);s.setAttributeNS(W,'w:styleId','UnusedBad');s.getElementsByTagNameNS(W,'u')[0].setAttributeNS(W,'w:val','auto');xml.documentElement.append(s);})),doc=model(pkg),before=doc.snapshot();expect(()=>doc.setCharacterStyle('UnusedBad')).toThrow(/invalid underline/);expect(doc.snapshot()).toEqual(before);sameParts(unzipSync(await save(pkg,doc)),pkg.parts);
});

it('serializes generated numbering patterns and partial color declarations in schema order', async () => {
  const pkg=createDocx([paragraph('Item')]),doc=model(pkg);doc.toggleList('number');const level=Object.values(doc.numbering.abstracts)[0].levels[0];level.markerStyle={underlineStyle:'wavyDouble',underlineColor:'008800'};let out=model(await DocxPackage.open(await save(pkg,doc)));expect(layout(out).lines[0].marker.underlines[0].pattern).toBe('wavyDouble');
  level.markerStyle={underlineColor:'A00000'};doc.select(0,doc.text.length);doc.replace('');doc.setRunFormat({underlineStyle:'double'});doc.replace('Item');out=model(await DocxPackage.open(await save(pkg,doc)));expect(layout(out).lines[0].marker.underlineColor).toBe('A00000');expect(layout(out).lines[0].marker.underlines[0].pattern).toBe('double');
});

it('rejects invalid mutation enums and contradictory boolean aliases without changing history', () => {
  const doc=model(createDocx([paragraph('Text')]));doc.select(0,4);const before=doc.snapshot(),count=doc.history.length;
  for(const underlineStyle of [true,0,null,'auto',{},'DOUBLE'])expect(()=>doc.setRunFormat({underlineStyle})).toThrow();
  expect(()=>doc.setRunFormat({underline:true,underlineStyle:'none'})).toThrow(/disagree/);expect(doc.snapshot()).toEqual(before);expect(doc.history).toHaveLength(count);
});

it('preserves inherited colors through pattern-only edits, reopening and later style changes', async () => {
  const pkg=await DocxPackage.open(source),doc=model(pkg);select(doc,'Inherited double red');doc.setRunFormat({underlineStyle:'wave'});expect(run(doc,'Inherited double red')).toMatchObject({underlineStyle:'wave',underlineColor:'A00000'});
  const out=model(await DocxPackage.open(await save(pkg,doc)));expect(run(out,'Inherited double red').properties).not.toContain('w:color');out.editParagraphStyle('UnderlineBase',{run:{underlineColor:'0000FF'}});expect(run(out,'Inherited double red')).toMatchObject({underlineStyle:'wave',underlineColor:'0000FF'});
});
