import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { blockControlGroups, inlineEditAncestors } from '../src/engine/block-controls.js';
import { contentControlRanges } from '../src/engine/content-controls.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it('matches the native reference entry into an empty block placeholder using its input formatting',async()=>{
  const source=readFileSync('public/fixtures/block-control-empty.docx'),pkg=await DocxPackage.open(source),d=model(pkg);
  expect(d.text).toBe('Before block\n\nAfter block');
  d.select('Before block\n'.length);d.replace('Ada');
  expect(d.text).toBe('Before block\nAda\nAfter block');
  expect(d.paragraphs[1].runs[0]).toMatchObject({text:'Ada',bold:true,color:'2050C0'});
  expect(blockControlGroups(d.paragraphs)).toHaveLength(0);
  const reopened=model(await DocxPackage.open(await save(pkg,d)));
  expect(reopened.paragraphs[1].runs[0]).toMatchObject({text:'Ada',bold:true,color:'2050C0'});
  d.undo();expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(source));
});
it.each(['body','cell'])('uses inherited formatting for a missing %s placeholder character style',async location=>{
  const parts=unzipSync(readFileSync(`public/fixtures/block-control-${location}.docx`));
  parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<w:temporary/>','<w:temporary/><w:showingPlcHdr/><w:rPr><w:rStyle w:val="MissingInputStyle"/></w:rPr>'));
  const pkg=await DocxPackage.open(zipSync(parts)),d=model(pkg);
  d.select(d.text.indexOf('Control alpha')+2);d.replace('Ada');
  // These imported fixtures omit styles and font sizes; the engine falls back to 10pt.
  expect(d.paragraphs.find(p=>p.runs.some(r=>r.text==='Ada')).runs.find(r=>r.text==='Ada')).toMatchObject({fontSize:10,bold:false});
  expect(model(await DocxPackage.open(await save(pkg,d))).text).toBe(d.text);
});
it('preserves an empty control in a vertical merge continuation when the owning cell changes',async()=>{
  const source=readFileSync('public/fixtures/block-control-continuation.docx'),pkg=await DocxPackage.open(source),d=model(pkg);
  d.select(d.text.indexOf('Control alpha')+2);d.replace('X');
  const bytes=await save(pkg,d),xml=strFromU8(unzipSync(bytes)['word/document.xml']);
  expect(xml.match(/<w:sdt[ >]/g)).toHaveLength(1);
  expect(xml).toContain('w:val="41"');
  expect(model(await DocxPackage.open(bytes)).text).toBe(d.text);
  d.undo();expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(source));
});
for(const location of ['body','cell']) {
  it(`unwraps the ${location} block wrapper on a paragraph split and restores it on undo`,async()=>{
    const source=readFileSync(`public/fixtures/block-control-${location}.docx`),pkg=await DocxPackage.open(source),d=model(pkg),before=d.text;
    const at=d.text.indexOf('Control alpha')+2;d.select(at);d.replace('\n');
    expect(d.text).toBe(before.slice(0,at)+'\n'+before.slice(at));
    expect(blockControlGroups(d.paragraphs)).toHaveLength(0);
    expect(model(await DocxPackage.open(await save(pkg,d))).text).toBe(d.text);
    d.undo();expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(source));
  });
  it(`preserves ${location} block controls through unrelated and formatting edits; text edits unwrap all paragraphs`,async()=>{
    const source=readFileSync(`public/fixtures/block-control-${location}.docx`),pkg=await DocxPackage.open(source),d=model(pkg);
    expect(blockControlGroups(d.paragraphs)).toHaveLength(1);
    expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(source));
    d.select(0);d.replace('Before ');
    let reopened=model(await DocxPackage.open(await save(pkg,d)));
    expect(blockControlGroups(reopened.paragraphs)).toHaveLength(1);
    const at=d.text.indexOf('Control alpha');d.select(at,at+7);d.toggleBold();
    reopened=model(await DocxPackage.open(await save(pkg,d)));
    expect(blockControlGroups(reopened.paragraphs)).toHaveLength(1);
    expect(reopened.paragraphs.find(p=>p.runs[0]?.text==='Control').runs[0].bold).toBe(true);
    d.select(at+2);d.replace('X');expect(blockControlGroups(d.paragraphs)).toHaveLength(0);
    const bytes=await save(pkg,d);expect(strFromU8(unzipSync(bytes)['word/document.xml'])).not.toMatch(/<w:sdt[ >]/);
    expect(model(await DocxPackage.open(bytes)).text).toBe(d.text);
    while(d.history.length)d.undo();expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(source));
  });
}

it('retains a body wrapper around a table on table formatting, then unwraps on cell text editing',async()=>{
  const source=readFileSync('public/fixtures/block-control-table.docx'),pkg=await DocxPackage.open(source),d=model(pkg);
  expect(blockControlGroups(d.paragraphs)).toHaveLength(1);expect(d.tables[0].blockControls).toHaveLength(1);
  const at=d.text.indexOf('Control beta');d.select(at);d.setTableProperties({width:{type:'dxa',value:5000}});
  const reopened=model(await DocxPackage.open(await save(pkg,d)));
  expect(blockControlGroups(reopened.paragraphs)).toHaveLength(1);expect(reopened.tables[0].width.value).toBe(5000);
  d.replace('X');expect(blockControlGroups(d.paragraphs)).toHaveLength(0);expect(d.tables[0].blockControls).toBeUndefined();
  expect(model(await DocxPackage.open(await save(pkg,d))).text).toBe(d.text);
  while(d.history.length)d.undo();expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(source));
});

it.each(['table','cellonly'])('matches the native reference wrapper ownership on %s row insertion',async location=>{
  const source=readFileSync(`public/fixtures/block-control-${location}.docx`),pkg=await DocxPackage.open(source),d=model(pkg);
  d.select(d.text.indexOf(location==='table'?'Control beta':'Control alpha'));d.insertTableRow();
  expect(d.tables[0].rows).toHaveLength(2);
  expect(blockControlGroups(d.paragraphs)).toHaveLength(location==='table'?0:1);
  const addedId=d.tables[0].rows[1].cells[0].id;
  expect(d.paragraphs.find(p=>p.cellId===addedId).blockControls).toBeUndefined();
  const reopened=model(await DocxPackage.open(await save(pkg,d)));
  expect(reopened.text).toBe(d.text);expect(blockControlGroups(reopened.paragraphs)).toHaveLength(location==='table'?0:1);
  d.undo();expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(source));
});

it('resolves many disjoint replacement ranges without shielding controls touched outside their children',()=>{
  const paragraphs=[],edits=[],expected=[];let offset=0;
  for(let i=0;i<600;i++) {
    const block={id:`block${i}`},inner={id:`inline${i}`};
    paragraphs.push({id:`p${i}`,blockControls:[block],runs:[{text:'Before '},{text:'inside',contentControl:inner},{text:' after'}]});
    edits.push({start:offset+8,end:offset+10});
    if(i%2)edits.push({start:offset+15,end:offset+17});else expected.push(block.id);
    offset+=20;
  }
  expect([...inlineEditAncestors(paragraphs,edits)]).toEqual(expected);
});

it('preserves bookmark ranges across block wrappers and unwraps only the edited content',async()=>{
  const source=readFileSync('public/fixtures/block-control-body.docx'),pkg=await DocxPackage.open(source),d=model(pkg);
  const start=d.text.indexOf('Control alpha')+2,end=d.text.indexOf('After block')+3;
  d.select(start,end);d.addBookmark('AcrossBlock');
  let reopened=model(await DocxPackage.open(await save(pkg,d)));
  expect(blockControlGroups(reopened.paragraphs)).toHaveLength(1);
  expect(reopened.bookmarks[0]).toMatchObject({name:'AcrossBlock',start,end});
  d.select(start+1);d.replace('X');
  reopened=model(await DocxPackage.open(await save(pkg,d)));
  expect(blockControlGroups(reopened.paragraphs)).toHaveLength(0);
  expect(reopened.bookmarks[0]).toMatchObject({name:'AcrossBlock',start,end:end+1});
  d.undo();d.undo();expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(source));
});

it.each(['typing','selection','search','paragraph split'])('preserves the outer block control for nested inline %s edits',async(mode)=>{
  const source=readFileSync('public/fixtures/block-control-mixed.docx'),pkg=await DocxPackage.open(source),d=model(pkg);
  const inner=contentControlRanges(d.paragraphs)[0];
  if(mode==='search')d.replaceMatches('beta','edited',{},true);
  else { d.select(inner.start+2,mode==='selection'?inner.end:inner.start+2);d.replace(mode==='paragraph split'?'\n':'X'); }
  expect(contentControlRanges(d.paragraphs)).toHaveLength(0);expect(blockControlGroups(d.paragraphs)).toHaveLength(1);
  const bytes=await save(pkg,d),xml=strFromU8(unzipSync(bytes)['word/document.xml']);
  expect(xml).toContain('w:val="41"');expect(xml).not.toContain('w:val="42"');
  expect(model(await DocxPackage.open(bytes)).text).toBe(d.text);
  d.undo();expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(source));
});

it('does not shield an outer wrapper from outside edits or a search spanning both levels',async()=>{
  const source=readFileSync('public/fixtures/block-control-mixed.docx'),pkg=await DocxPackage.open(source),d=model(pkg);
  const inner=contentControlRanges(d.paragraphs)[0];d.select(inner.end);d.replace('outside');
  expect(blockControlGroups(d.paragraphs)).toHaveLength(0);expect(contentControlRanges(d.paragraphs)).toHaveLength(1);
  expect(model(await DocxPackage.open(await save(pkg,d))).text).toBe(d.text);
  d.undo();d.replaceMatches('Control','Changed',{},true);
  expect(blockControlGroups(d.paragraphs)).toHaveLength(0);expect(contentControlRanges(d.paragraphs)).toHaveLength(0);
  expect(model(await DocxPackage.open(await save(pkg,d))).text).toBe(d.text);
  d.undo();expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(source));
});

for (const location of ['body','cell']) it(`replaces the whole ${location} block placeholder with input formatting in one undo step`,async()=>{
  const source=readFileSync(`public/fixtures/block-control-${location}.docx`),parts=unzipSync(source);
  parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<w:temporary/>','<w:temporary/><w:showingPlcHdr/><w:rPr><w:b/><w:color w:val="2050C0"/></w:rPr>'));
  const bytes=zipSync(parts),pkg=await DocxPackage.open(bytes),d=model(pkg),before=d.text;
  d.select(d.text.indexOf('Control alpha')+3);d.replace('Ada');
  expect(d.text).toBe(before.replace('Control alpha\nControl beta','Ada'));
  expect(blockControlGroups(d.paragraphs)).toHaveLength(0);expect(d.history).toHaveLength(1);
  const p=d.paragraphs.find(p=>p.runs.some(r=>r.text==='Ada'));expect(p.runs.find(r=>r.text==='Ada')).toMatchObject({bold:true,color:'2050C0'});
  expect(model(await DocxPackage.open(await save(pkg,d))).text).toBe(d.text);
  d.undo();expect(unzipSync(await save(pkg,d))).toEqual(parts);
});

it('unwraps only affected nesting levels and serializes the surviving inner wrapper once',async()=>{
  const source=readFileSync('public/fixtures/block-control-nested.docx'),pkg=await DocxPackage.open(source),d=model(pkg);
  expect(blockControlGroups(d.paragraphs)).toHaveLength(2);
  d.select(d.text.indexOf('Control gamma')+2);d.replace('X');expect(blockControlGroups(d.paragraphs)).toHaveLength(1);
  let bytes=await save(pkg,d);expect(model(await DocxPackage.open(bytes)).text).toBe(d.text);
  expect(strFromU8(unzipSync(bytes)['word/document.xml']).match(/<w:sdt[ >]/g)).toHaveLength(1);
  d.undo();d.select(d.text.indexOf('Control beta')+2);d.replace('X');expect(blockControlGroups(d.paragraphs)).toHaveLength(1);
  bytes=await save(pkg,d);expect(model(await DocxPackage.open(bytes)).text).toBe(d.text);
  const xml=strFromU8(unzipSync(bytes)['word/document.xml']);expect(xml).toContain('w:val="41"');expect(xml).not.toContain('w:val="42"');
  d.undo();expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(source));
});
