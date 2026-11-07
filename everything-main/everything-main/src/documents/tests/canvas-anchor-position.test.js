import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage, createDocx } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { layoutDocument, imageAtPoint } from '../src/engine/layout.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const source = (legacy=false) => readFileSync(`public/fixtures/anchor-position${legacy?'-legacy':''}.docx`);
const model = p => new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const measure = (text,style) => ({width:text.length*style.fontSize*.6,ascent:style.fontSize,descent:style.fontSize/3});
const layout = d => layoutDocument(d.paragraphs,measure,pageGeometry(d.pageSettings),d.numbering,d.tables);
const save = async (p,d) => unzipSync(new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer()));
function changed(edit,legacy=false) {
  const parts=unzipSync(source(legacy));edit(parts);return zipSync(parts);
}
const xml = (parts,from,to) => {const text=strFromU8(parts['word/document.xml']);expect(text).toContain(from);parts['word/document.xml']=strToU8(text.replace(from,to));};

it('retains inherited and direct spacing on anchors without changing their geometry through edits and undo', async () => {
  const pkg=await DocxPackage.open(readFileSync('public/fixtures/anchor-spacing.docx')),doc=model(pkg);
  const anchors=()=>doc.paragraphs.flatMap(p=>p.runs).filter(r=>r.image);
  expect(anchors().map(r=>r.characterSpacing)).toEqual([2,-1,2,-1,2,-1,2,-1]);
  const frames=()=>layout(doc).floatingObjects.map(f=>[f.page,f.x,f.y,f.width,f.height]);
  const before=frames();
  doc.select(0,doc.text.length);doc.setRunFormat({characterSpacing:3});
  expect(anchors().every(r=>r.characterSpacing===3)).toBe(true);expect(frames()).toEqual(before);
  const out=await save(pkg,doc),again=model(await DocxPackage.open(zipSync(out)));
  expect(again.paragraphs.flatMap(p=>p.runs).filter(r=>r.image).map(r=>r.characterSpacing)).toEqual(Array(8).fill(3));
  for(const name of Object.keys(pkg.parts)) if(name!=='word/document.xml') expect(out[name]).toEqual(pkg.parts[name]);
  doc.undo();expect(frames()).toEqual(before);expect(await save(pkg,doc)).toEqual(pkg.parts);
});

it.each([false,true])('matches independent native reference page/margin coordinates (legacy=%s), hit testing and no-op preservation',async legacy=>{
  const pkg=await DocxPackage.open(source(legacy)),doc=model(pkg),placed=layout(doc);
  expect(placed.pageCount).toBe(8);expect(placed.floatingObjects).toHaveLength(8);
  const points=[[0,0],[252,342],[legacy?468:504,684],[72,54],[234,324],[396,594],[72,36],[144,90]];
  placed.floatingObjects.forEach((f,i)=>{
    expect(f.page).toBe(i);expect(f.x).toBeCloseTo(points[i][0]*4/3);expect(f.y).toBeCloseTo(points[i][1]*4/3);
    expect(f.width).toBe(96);expect(f.height).toBe(48);
    expect(imageAtPoint(placed,i,f.x+20,f.y+20)?.image.id).toBe(f.image.id);
    const inline=placed.lines.flatMap(l=>l.fragments).find(x=>x.image?.id===f.image.id);
    expect(inline.width).toBe(0);
  });
  expect(await save(pkg,doc)).toEqual(unzipSync(source(legacy)));
});

it('keeps positions fixed through text edits, resizes from the alignment edge, and restores the entire package with undo',async()=>{
  const pkg=await DocxPackage.open(source()),doc=model(pkg),initial=layout(doc);
  doc.select(0);doc.replace('Edited ');
  expect(layout(doc).floatingObjects.map(f=>[f.x,f.y])).toEqual(initial.floatingObjects.map(f=>[f.x,f.y]));
  const at=doc.text.indexOf('\ufffc',doc.text.indexOf('\ufffc')+1);doc.select(at,at+1);
  doc.setImageProperties({width:1828800,height:457200});
  expect(layout(doc).floatingObjects[1].x).toBe(288);
  const parts=await save(pkg,doc),reopened=model(await DocxPackage.open(zipSync(parts)));
  expect(layout(reopened).floatingObjects[1].x).toBe(288);
  for(const key of Object.keys(pkg.parts))if(key!=='word/document.xml')expect(parts[key]).toEqual(pkg.parts[key]);
  doc.undo();doc.undo();expect(await save(pkg,doc)).toEqual(pkg.parts);
});

it('uses legacy alignment when compatibilityMode is absent',async()=>{
  const bytes=changed(parts=>{parts['word/settings.xml']=strToU8(strFromU8(parts['word/settings.xml']).replace(/<w:compat>.*?<\/w:compat>/,''));});
  expect(layout(model(await DocxPackage.open(bytes))).floatingObjects[2].x).toBe(624);
});

it('resolves the same retained image against the destination document mode',async()=>{
  const pkg=await DocxPackage.open(source());
  const legacy=new TextDocument(pkg.paragraphs,{...pkg.pageSettings,compatibilityMode:12},pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
  expect(layout(legacy).floatingObjects[2].x).toBe(624);
  const modern=model(pkg);expect(layout(modern).floatingObjects[2].x).toBe(672);
  expect(()=>modern.setPageSettings({compatibilityMode:12})).toThrow(/compatibility settings/);
});

it.each([11,12,14,15])('authors and reopens document compatibility mode %s',async compatibilityMode=>{
  const pkg=createDocx([paragraph('Compatibility')],{compatibilityMode});
  const reopened=await DocxPackage.open(new Uint8Array(await pkg.export().arrayBuffer()));
  expect(reopened.pageSettings.compatibilityMode).toBe(compatibilityMode);
});

it.each([[720,914400,504],[2160,914400,468],[2880,914400,432],[2160,1828800,432],[720,228600,540]])('matches the native reference legacy clamp for right margin %s twips and width %s EMU',async(right,width,x)=>{
  const bytes=changed(parts=>{
    xml(parts,'w:right="2160"',`w:right="${right}"`);
    // Resize every independently authored frame, keeping both drawing extents consistent.
    parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replaceAll('cx="914400"',`cx="${width}"`));
  },true);
  expect(layout(model(await DocxPackage.open(bytes))).floatingObjects[2].x).toBeCloseTo(x*4/3);
});

it('honors mixed axes and signed offsets without reserving inline width',async()=>{
  const bytes=changed(parts=>{
    xml(parts,'<wp:positionH relativeFrom="page"><wp:align>left</wp:align></wp:positionH>','<wp:positionH relativeFrom="margin"><wp:posOffset>-457200</wp:posOffset></wp:positionH>');
    xml(parts,'<wp:positionV relativeFrom="page"><wp:align>top</wp:align></wp:positionV>','<wp:positionV relativeFrom="page"><wp:posOffset>228600</wp:posOffset></wp:positionV>');
  });
  const f=layout(model(await DocxPackage.open(bytes))).floatingObjects[0];expect([f.x,f.y]).toEqual([48,24]);
});

it('aligns to the column independently of paragraph indentation',async()=>{
  const bytes=changed(parts=>{
    xml(parts,'<w:p><w:r><w:t>Anchor 1','<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:t>Anchor 1');
    xml(parts,'<wp:positionH relativeFrom="page"><wp:align>left</wp:align></wp:positionH>','<wp:positionH relativeFrom="column"><wp:align>center</wp:align></wp:positionH>');
    xml(parts,'<wp:positionV relativeFrom="page"><wp:align>top</wp:align></wp:positionV>','<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>');
  });
  const f=layout(model(await DocxPackage.open(bytes))).floatingObjects[0];expect([f.x,f.y]).toEqual([312,72]);
});

it('uses the anchor section margins rather than the final section',async()=>{
  const bytes=changed(parts=>xml(parts,'<wp:positionH relativeFrom="page"><wp:align>left','<wp:positionH relativeFrom="margin"><wp:align>left'));
  const doc=model(await DocxPackage.open(bytes));
  doc.paragraphs[0].sectionEnd={...doc.pageSettings,left:2880,right:1440};
  expect(layout(doc).floatingObjects[0].x).toBe(192);
});

it.each([
  ['relativeFrom="page"','relativeFrom="character"'],
  ['<wp:align>left</wp:align>','<wp:align>diagonal</wp:align>'],
  ['<wp:align>left</wp:align>','<wp:align>left</wp:align><wp:posOffset>0</wp:posOffset>'],
  ['<wp:wrapNone/>','<wp:wrapNone/><wp:wrapTopAndBottom/>'],
  ['<wp:wrapNone/>','<wp:wrapTopAndBottom/>'],
])('rejects unsupported or ambiguous coordinates: %s -> %s',async(from,to)=>{
  await expect(DocxPackage.open(changed(parts=>xml(parts,from,to)))).rejects.toThrow(/floating pictures/);
});
