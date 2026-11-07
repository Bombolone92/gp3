import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutDocument,caretRect,selectionRects} from '../src/engine/layout.js';
import {TextDocument,paragraphText} from '../src/engine/model.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const fixture = name => readFileSync(`public/fixtures/row-geometry/${name}`);
const reference = name => JSON.parse(readFileSync(`tests/fixtures/row-geometry/${name}`, 'utf8'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
for(const kind of ['row-padding','row-merge-padding','row-mixed-border','row-exact-border','row-border-width','row-column-border'])it(`matches independently measured native reference baselines: ${kind}`,async()=>{
  const pkg=await DocxPackage.open(fixture(`${kind}-probe.docx`));
  const original=JSON.stringify(pkg.tables);
  const result=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
  const expected=reference(`${kind}-native-measurements.json`);
  for(const [index,table] of pkg.tables.entries()){
    const cells=new Set(table.rows.flatMap(row=>row.cells.map(cell=>cell.id)));
    const line=label=>{const p=pkg.paragraphs.find(p=>cells.has(p.cellId)&&paragraphText(p)===label);return result.lines.find(line=>line.paragraphId===p.id);};
    const first=line('Probe first'),second=line('Probe second');
    const delta=(second.baseline-first.baseline)*.75;
    expect.soft(Math.abs(delta-expected[index].heightPoints),`${expected[index].case}: ${delta} versus ${expected[index].heightPoints}`).toBeLessThan(.13);
    const heading=pkg.paragraphs.find(p=>paragraphText(p)===expected[index].case);
    const headingLine=result.lines.find(line=>line.paragraphId===heading.id);
    const firstDelta=(first.baseline-headingLine.baseline)*.75;
    expect.soft(Math.abs(firstDelta-expected[index].firstBaselineDeltaPoints),`${expected[index].case} initial inset: ${firstDelta} versus ${expected[index].firstBaselineDeltaPoints}`).toBeLessThan(.13);
    const after=pkg.paragraphs.find(p=>paragraphText(p)===expected[index].case+' after');
    const afterLine=result.lines.find(line=>line.paragraphId===after.id);
    const afterDelta=(afterLine.baseline-second.baseline)*.75;
    expect.soft(Math.abs(afterDelta-expected[index].followingParagraphDeltaPoints),`${expected[index].case} following gap: ${afterDelta} versus ${expected[index].followingParagraphDeltaPoints}`).toBeLessThan(.13);
  }
  expect(JSON.stringify(pkg.tables)).toBe(original);
});
for(const kind of ['row-page-edge','row-auto-page-edge'])it(`matches the native reference page-edge placement with border ink: ${kind}`,async()=>{
  const pkg=await DocxPackage.open(fixture(`${kind}-probe.docx`));
  const result=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
  const expected=reference(`${kind}-native-pages.json`);
  for(const p of pkg.paragraphs){const text=paragraphText(p);if(!text)continue;const page=expected.find(page=>page.text.split('\n').map(line=>line.trim()).includes(text));expect(page,text).toBeDefined();expect.soft(result.lines.find(line=>line.paragraphId===p.id).page+1,text).toBe(page.page);}
});
it('matches the native reference repeated-header pages and baseline spacing for minimum and exact headers',async()=>{
  const pkg=await DocxPackage.open(fixture('row-repeated-header-probe.docx'));
  const result=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
  const expected=reference('row-repeated-header-native-lines.json');
  const labels=new Map(pkg.paragraphs.map(p=>[p.id,paragraphText(p)]));
  expect(result.pageCount).toBe(expected.length);
  for(const page of expected){
    const actual=[...result.lines,...result.repeatedLines].filter(l=>l.page===page.page-1&&!l.virtual&&labels.get(l.paragraphId)).sort((a,b)=>a.baseline-b.baseline);
    expect(actual.map(l=>labels.get(l.paragraphId))).toEqual(page.lines.map(l=>l.text));
    for(let i=0;i<actual.length;i++){
      const delta=(actual[i].baseline-actual[0].baseline)*.75,word=page.lines[0].y-page.lines[i].y;
      // Quarter-point tolerance for PDF baseline quantization across a full page;
      // page membership and every repeated/source label must still match exactly.
      expect.soft(Math.abs(delta-word),`${page.page} ${page.lines[i].text}: ${delta} versus ${word}`).toBeLessThan(.25);
    }
  }
});
it('clips exact-row text to the independently extracted native reference PDF content rectangles',async()=>{
  const pkg=await DocxPackage.open(fixture('row-clipping-border-probe.docx'));
  const result=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
  const expected=reference('row-clipping-native-measurements.json');
  for(const [index,table] of pkg.tables.entries()){
    const line=result.lines.find(line=>line.cellId===table.rows[0].cells[0].id),clip=line.cellClip;
    expect(clip).toBeDefined();expect(line.page+1).toBe(expected[index].page);
    expect.soft(Math.abs(clip.top*.75-expected[index].topPoints),`page${index+1} clip top`).toBeLessThan(.13);
    expect.soft(Math.abs(clip.bottom*.75-expected[index].bottomPoints),`page${index+1} clip bottom`).toBeLessThan(.13);
  }
});
for(const mode of ['','-modern'])it(`matches the native reference oversized-row and following-paragraph pages${mode}`,async()=>{
  const pkg=await DocxPackage.open(fixture(`row-oversized${mode}-probe.docx`));
  const result=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
  const expected=reference(`row-oversized${mode}-native-lines.json`);
  expect.soft(result.pageCount).toBe(expected.length);
  for(const p of pkg.paragraphs){
    const text=paragraphText(p);
    if(!text||(/ line /.test(text)&&!text.endsWith('line 000')))continue;
    const page=expected.find(page=>page.lines.some(l=>l.text===text));
    expect(page,text).toBeDefined();
    expect.soft(result.lines.find(l=>l.paragraphId===p.id).page+1,text).toBe(page.page);
  }
});
it('places oversized plain rows on fresh pages and keeps their declared physical extents',async()=>{
  for(const kind of ['row-oversized','row-oversized-modern','row-oversized-short-modern']){
    const pkg=await DocxPackage.open(fixture(`${kind}-probe.docx`));
    const result=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
    const line=text=>result.lines.find(l=>l.paragraphId===pkg.paragraphs.find(p=>paragraphText(p)===text).id);
    for(const name of ['exact-plain','minimum-plain']){
      const heading=line(name),first=line(name+' line 000'),after=line(name+' after');
      expect(first.page-heading.page,kind+' '+name).toBe(1);
      expect(after.page-heading.page,kind+' '+name+' after').toBe(name==='minimum-plain'&&!kind.includes('short')?3:2);
      const boxes=result.cells.filter(c=>c.id===first.cellId);
      expect(boxes.length,kind+' '+name+' fragments').toBe(name==='minimum-plain'&&!kind.includes('short')?2:1);
      // Layout clips oversized minimum allocation to the writing area; exact
      // allocation keeps its declared extent beyond the physical page.
      for(const box of boxes)expect(box.height,kind+' '+name+' extent').toBeCloseTo(name==='exact-plain'?1200:860);
    }
  }
});
for(const mode of [14,15])it(`matches per-row oversized header repetition in compatibility mode ${mode}`,async()=>{
 const pkg=await DocxPackage.open(fixture(`row-oversized-headers-${mode}-probe.docx`));
 const result=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 const expected=reference(`row-oversized-headers-${mode}-native-lines.json`);
 const labels=new Map(pkg.paragraphs.map(p=>[p.id,paragraphText(p)]));
 expect.soft(result.pageCount).toBe(expected.length);
 for(const page of expected){
  const significant=text=>text&&!text.includes(' line ')||text?.endsWith('line 000');
  const actual=[...result.lines,...result.repeatedLines].filter(l=>l.page===page.page-1&&significant(labels.get(l.paragraphId))).sort((a,b)=>a.y-b.y).map(l=>labels.get(l.paragraphId));
  expect.soft(actual,`mode${mode} page${page.page}`).toEqual(page.lines.map(l=>l.text).filter(significant));
 }
});
it('matches the native reference minimum-row border bounds at the writing-area edges',async()=>{
 const pkg=await DocxPackage.open(fixture('row-oversized-headers-15-probe.docx'));
 const result=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 const expected=reference('row-oversized-border-rectangles.json').filter(p=>p.kind==='row-oversized-headers-15');
 const pages=reference('row-oversized-headers-15-native-lines.json').filter(p=>p.lines.some(l=>l.text.startsWith('atLeast-')&&l.text.includes(' line ')));
 for(const page of pages){
  const borders=result.tableBorders.filter(b=>b.page===page.page-1&&b.horizontal&&!b.guide).sort((a,b)=>a.y-b.y);
  const reference=expected.find(p=>p.page===page.page).horizontals;
  expect(borders,`page${page.page}`).toHaveLength(reference.length);
  for(let i=0;i<borders.length;i++){
   expect.soft(Math.abs(borders[i].y*.75-reference[i].top),`page${page.page} border${i} top`).toBeLessThan(.13);
   expect.soft(Math.abs((borders[i].y+borders[i].height)*.75-reference[i].bottom),`page${page.page} border${i} bottom`).toBeLessThan(.13);
  }
 }
});
it('allows tall body lines on modern pages where oversized rows omit the header',async()=>{
 const pkg=await DocxPackage.open(fixture('row-header-clearance-probe.docx'));
 const result=layoutDocument(pkg.paragraphs,(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 const expected=reference('row-header-clearance-native-pages.json');
 expect(result.pageCount).toBe(4);
 for(const p of pkg.paragraphs){const text=paragraphText(p);if(!text)continue;const reference=expected.find(p=>p.text.trim()===text);expect(reference,text).toBeDefined();expect(result.lines.find(l=>l.paragraphId===p.id).page+1,text).toBe(reference.page);}
});

it('preserves stored row and cell properties through layout, editing, export and undo',async()=>{
 const pkg=await DocxPackage.open(fixture('row-oversized-headers-15-probe.docx'));
 const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 const original=JSON.stringify(doc.tables),text=doc.text;
 const measure=(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12});
 const layout=model=>layoutDocument(model.paragraphs,measure,pageGeometry(model.pageSettings),model.numbering,model.tables);
 expect(layout(doc).pageCount).toBe(32);expect(JSON.stringify(doc.tables)).toBe(original);
 const label='exact-prior0-header24 line 000';doc.select(doc.text.indexOf(label)+label.length);doc.replace('X');
 const bytes=new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
 const reopened=await DocxPackage.open(bytes);
 expect(layout(reopened).pageCount).toBe(32);expect(reopened.paragraphs.map(paragraphText)).toEqual(doc.paragraphs.map(paragraphText));
 const props=tables=>tables.map(table=>table.rows.map(row=>({height:row.minHeight,rule:row.heightRule,cells:row.cells.map(cell=>({margins:cell.margins,borders:cell.borders}))})));
 expect(props(reopened.tables)).toEqual(props(doc.tables));expect(JSON.stringify(doc.tables)).toBe(original);
 doc.undo();expect(doc.text).toBe(text);expect(JSON.stringify(doc.tables)).toBe(original);
 const restored=unzipSync(new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer()));
 const source=unzipSync(fixture('row-oversized-headers-15-probe.docx'));
 expect(Object.keys(restored).sort()).toEqual(Object.keys(source).sort());
 for(const [name,bytes] of Object.entries(source))expect(Buffer.from(restored[name]).equals(Buffer.from(bytes)),name).toBe(true);
});
it('keeps editing geometry on the physical page for hidden oversized exact-row text',async()=>{
 const pkg=await DocxPackage.open(fixture('row-oversized-headers-15-probe.docx'));
 const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 const result=layoutDocument(doc.paragraphs,(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(doc.pageSettings),doc.numbering,doc.tables);
 const at=doc.text.indexOf('exact-prior0-header24 line 084');expect(at).toBeGreaterThan(0);
 const caret=caretRect(result,at);expect(caret.y+caret.height).toBeLessThanOrEqual(result.page.height);
 for(const rect of selectionRects(result,at,at+5))expect(rect.y+rect.height).toBeLessThanOrEqual(result.page.height);
});
