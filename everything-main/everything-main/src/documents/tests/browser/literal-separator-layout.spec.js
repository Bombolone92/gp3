import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

test('selected separator glyph survives real DOCX layout without rewriting source text',async({page})=>{
 await page.context().grantPermissions(['local-fonts']);await page.goto('/playground.html');
 const bytes=readFileSync('tests/fixtures/line-separator-fonts/control.docx').toString('base64');
 const ink=JSON.parse(readFileSync('tests/fixtures/line-separator-fonts/separator-ink.json'));
 expect(createHash('sha256').update(readFileSync('tests/fixtures/line-separator-fonts/native.pdf')).digest('hex')).toBe(ink.pdfSha256);
 const native=JSON.parse(readFileSync('tests/fixtures/line-separator-fonts/reference.json'));
 for(const [name,hash]of Object.entries(native.sha256))expect(createHash('sha256').update(readFileSync('tests/fixtures/line-separator-fonts/'+name)).digest('hex')).toBe(hash);
 const result=await page.evaluate(async({encoded,ink})=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {layoutDocument}=await import('/src/engine/layout.js');
  const {pageGeometry}=await import('/src/engine/page-settings.js');
  const {loadCanvasFonts,measureCanvasText,setCanvasTextStyle}=await import('/src/engine/canvas-text.js');
  const {paintText}=await import('/src/engine/canvas-paint-text.js');
  const {localFamilyFontData}=await import('/src/engine/local-fonts.js');
  const {literalSeparatorFont,LITERAL_SEPARATOR_ALIAS}=await import('/src/engine/literal-separator-font.js');
  const {syntheticAdvanceFont}=await import('/src/engine/synthetic-advance-font.js');
  const {parse}=await import('/src/vendor/opentype/opentype.mjs');
  const pkg=await DocxPackage.open(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));
  await loadCanvasFonts(pkg);
  const source=(await localFamilyFontData('Times New Roman')).find(f=>f.metadata.weight===400&&!f.metadata.italic&&f.metadata.widthClass===5);
  if(!source)throw new Error('Native reference requires installed Times New Roman');
  const mapped=literalSeparatorFont(source.buffer);if(!mapped)throw new Error('Cannot map selected separator glyph');
  const face=await new FontFace('Original Separator Layout Probe',mapped).load();document.fonts.add(face);
  try{
   const ctx=document.createElement('canvas').getContext('2d'),before=JSON.stringify(pkg.paragraphs);
   const measure=(mappedGlyph)=>(text,style)=>measureCanvasText(ctx,
    mappedGlyph&&style.fontFamily==='Times New Roman'?text.replaceAll('\u2028',LITERAL_SEPARATOR_ALIAS):text,
    mappedGlyph&&style.fontFamily==='Times New Roman'?{...style,fontFamily:face.family}:style);
   const layout=fn=>layoutDocument(pkg.paragraphs,fn,pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
   const base=layout(measure(false)),candidate=layout(measure(true));
   const lines=l=>l.lines.filter(v=>v.page===5).map(v=>({text:v.fragments.map(f=>f.text||'').join(''),baseline:v.baseline*.75,
    fragments:v.fragments.map(f=>({text:f.text,x:f.x*.75,width:f.width*.75}))}));
   const synthetic=syntheticAdvanceFont(source.buffer),left=literalSeparatorFont(synthetic),right=syntheticAdvanceFont(mapped);
   const a=parse(left),b=parse(right),original=parse(source.buffer);
   const sourceExport=new Uint8Array(await pkg.export().arrayBuffer());
   const reopened=await DocxPackage.open(sourceExport);
   const row=lines(candidate).find(l=>l.fragments.some(f=>f.text==='\u2028'));
   const glyph=row.fragments.find(f=>f.text==='\u2028');
   const canvas=document.createElement('canvas');canvas.width=ink.box[2]-ink.box[0];canvas.height=ink.box[3]-ink.box[1];
   const paint=canvas.getContext('2d');paint.fillStyle='white';paint.fillRect(0,0,canvas.width,canvas.height);
   paint.setTransform(3,0,0,3,-ink.box[0],-ink.box[1]);
   const productionLine=base.lines.find(l=>l.page===5&&l.fragments.some(f=>f.text==='\u2028'));
   const productionGlyph=productionLine.fragments.find(f=>f.text==='\u2028');
   setCanvasTextStyle(paint,productionGlyph);paint.fillStyle='black';paintText(paint,productionGlyph,productionLine.baseline);
   const pixels=paint.getImageData(0,0,canvas.width,canvas.height).data,points=[];
   for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels[(y*canvas.width+x)*4]<ink.threshold)points.push([x,y]);
   return {base:lines(base),candidate:lines(candidate),basePages:base.pageCount,pages:candidate.pageCount,
    paragraphsUnchanged:before===JSON.stringify(pkg.paragraphs),
    packageUnchanged:Object.keys(pkg.parts).length===Object.keys(reopened.parts).length&&Object.entries(pkg.parts).every(([name,bytes])=>reopened.parts[name]?.length===bytes.length&&bytes.every((v,i)=>v===reopened.parts[name][i])),
    reopenedText:reopened.paragraphs.flatMap(p=>p.runs.map(r=>r.text)).join(''),
    expectedAdvance:original.charToGlyph('\u2028').advanceWidth/original.unitsPerEm*9,
    composedAdvances:[a.charToGlyph(LITERAL_SEPARATOR_ALIAS).advanceWidth,b.charToGlyph(LITERAL_SEPARATOR_ALIAS).advanceWidth],
    points,composedOutlinesEqual:JSON.stringify(a.charToGlyph(LITERAL_SEPARATOR_ALIAS).path.commands)===JSON.stringify(b.charToGlyph(LITERAL_SEPARATOR_ALIAS).path.commands)};
  }finally{document.fonts.delete(face);}
 },{encoded:bytes,ink});
 expect(result.pages).toBe(8);expect(result.pages).toBe(result.basePages);expect(result.paragraphsUnchanged).toBe(true);expect(result.packageUnchanged).toBe(true);
 expect(result.reopenedText).toContain('\u2028');expect(result.reopenedText).not.toContain('\uffff');
 const glyph=result.candidate.flatMap(l=>l.fragments).find(f=>f.text==='\u2028');
 expect(glyph).toBeDefined();expect(glyph.width).toBeCloseTo(result.expectedAdvance,4);
 expect(result.base).toEqual(result.candidate);
 for(const [i,line]of result.candidate.entries())expect(Math.abs(line.baseline-native.rows[5].baselines[i])).toBeLessThan(.2);
 expect(result.points.length).toBeGreaterThan(0);
 for(const [actual,expected]of [[result.points,ink.points],[ink.points,result.points]]){
  const misses=actual.filter(([x,y])=>!expected.some(([a,b])=>Math.abs(a-x)<=1&&Math.abs(b-y)<=1));
  expect(misses,'native/derived glyph ink must agree within one raster pixel in both directions').toEqual([]);
 }
 expect(result.composedAdvances[0]).toBe(result.composedAdvances[1]);expect(result.composedOutlinesEqual).toBe(true);
});
