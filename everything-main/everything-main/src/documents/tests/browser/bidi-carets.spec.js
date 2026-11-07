import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {requireNativeWordFonts} from './helpers/native-fonts.js';

const root='tests/fixtures/bidi-layout/';
const cases=JSON.parse(readFileSync(root+'cases.json','utf8'));
const reference=JSON.parse(readFileSync(root+'native-carets.json','utf8'));
test('places interior Hebrew and joined Arabic carets using complete shaping',async({page},info)=>{
  test.setTimeout(120000);
  expect(createHash('sha256').update(readFileSync(root+'control.docx')).digest('hex')).toBe(reference.sourceSha256);
  await page.goto('/playground.html');
  await requireNativeWordFonts(page,['Arial']);
  const result=await page.evaluate(async cases=>{
    const {bidiControlParagraphs}=await import('/tests/helpers/bidi-controls.js');
    const {prepareCanvasFont}=await import('/src/engine/font-availability.js');
    const {measureCanvasText}=await import('/src/engine/canvas-text.js');
    const {layoutDocument,caretRect,selectionRects,hitTest}=await import('/src/engine/layout.js');
    const {pageGeometry}=await import('/src/engine/page-settings.js');
    await prepareCanvasFont('Arial');
    const paragraphs=bidiControlParagraphs(cases),ctx=document.createElement('canvas').getContext('2d');
    const before=document.body.childElementCount;
    const layout=layoutDocument(paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry({compatibilityMode:15}));
    const samples=[];
    for(const index of [7,9,17]){
      const line=layout.lines.find(l=>l.paragraphId===paragraphs[index*2+1].id),start=line.start+7;
      const stops=[];
      for(let i=1;i<cases[index].text.length;i++){
        const caret=caretRect(layout,start+i);
        stops.push({offset:7+i,x:caret.x*.75,hit:hitTest(layout,caret.page,caret.x,caret.y+caret.height/2),expected:start+i});
      }
      samples.push({index,stops,firstSelection:selectionRects(layout,start,start+1).map(r=>({x:r.x*.75,width:r.width*.75})),fragment:line.fragments.find(f=>f.bidiDirection==='rtl').caretStops});
    }
    return {samples,leakedNodes:document.body.childElementCount-before};
  },cases);
  writeFileSync(info.outputPath('carets.json'),JSON.stringify(result,null,2));
  expect(result.leakedNodes).toBe(0);
  for(const sample of result.samples){
    const native=reference.cases.find(c=>c.index===sample.index);
    for(const stop of sample.stops){
      // Reference automation API positions round to screen pixels (.75pt here).
      expect(Math.abs(stop.x-native.stops.find(s=>s.offset===stop.offset).x),`case ${sample.index+1}, offset ${stop.offset}`).toBeLessThan(.5);
      expect(stop.hit).toBe(stop.expected);
    }
  }
  // The first lam-alef ligature gives both logical characters a share of
  // its advance. Prefix measurement incorrectly allocated almost all to lam.
  const lam=result.samples.find(s=>s.index===17),stops=lam.fragment;
  const a=stops[0].x-stops[1].x,b=stops[1].x-stops[2].x;
  expect(Math.abs(a-b)).toBeLessThan(.05);
  expect(lam.firstSelection[0].width).toBeCloseTo(a*.75,5);
});

test('keeps portable bidi order, caret hits and source text with the bundled family',async({page})=>{
  await page.goto('/playground.html');
  const actual=await page.evaluate(async()=>{
    const {paragraph}=await import('/src/engine/model.js');
    const {RUN_FORMAT}=await import('/src/engine/formatting.js');
    const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
    const {layoutDocument,caretRect,hitTest,selectionRects}=await import('/src/engine/layout.js');
    await loadCanvasFonts();
    const p=paragraph(''),source='אבג 012';p.runs=[{...RUN_FORMAT,rtl:true,text:source}];
    const ctx=document.createElement('canvas').getContext('2d'),layout=layoutDocument([p],(t,s)=>measureCanvasText(ctx,t,s));
    const caret=caretRect(layout,1);
    return {first:layout.lines[0].fragments[0].text,source:p.runs[0].text,hit:hitTest(layout,caret.page,caret.x,caret.y+caret.height/2),selection:selectionRects(layout,0,1)};
  });
  expect(actual.first).toBe('012');expect(actual.source).toBe('אבג 012');expect(actual.hit).toBe(1);
  expect(actual.selection).toHaveLength(1);expect(actual.selection[0].width).toBeGreaterThan(0);
});
