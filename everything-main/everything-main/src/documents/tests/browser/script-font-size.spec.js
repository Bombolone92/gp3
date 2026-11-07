import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strToU8} from 'fflate';
import {showAllTools} from './helpers/editor-tools.js';
import {reopenDocx} from './helpers/reopen-docx.js';
test.use({permissions:['local-fonts']});
test('uses the native face-dependent script sizes without changing the declared size',async({page})=>{
 test.setTimeout(120000);
 const folder='tests/fixtures/script-size/',source=readFileSync(folder+'control.docx');
 const reference=JSON.parse(readFileSync(folder+'reference.json'));
 expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync(folder+'native.pdf')).digest('hex')).toBe(reference.pdfSha256);
 await page.goto('/playground.html');
 const result=await page.evaluate(async data=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js');
  const {pageGeometry}=await import('/src/engine/page-settings.js');
  const {measureTextGeometry}=await import('/src/engine/text-geometry.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));
  await loadCanvasFonts(p);
  const ctx=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories,{styles:p.styles});
  const spacing=[];
  for(const fontSize of [8,12,20])for(const textScale of [80,100,150])for(const capitalization of ['normal','smallCaps']){
   const style={fontFamily:'Garamond',fontSize,textScale,capitalization,verticalAlign:'superscript'};
   const width=characterSpacing=>measureTextGeometry('Test',{...style,characterSpacing},(t,s)=>measureCanvasText(ctx,t,s)).width;
   spacing.push(width(1)-width(0));
  }
  return {spacing,rows:l.lines.flatMap(line=>line.fragments.filter(f=>f.text==='TEST').map(f=>({page:line.page,size:f.fontSize,script:f.verticalAlign,x:f.textTransform.scaleX,y:f.textTransform.scaleY})))};
 },source.toString('base64'));
 const {rows,spacing}=result;
 for(const advance of spacing)expect(advance).toBeCloseTo(4*4/3,1);
 expect(rows).toHaveLength(108);
 for(const [i,c]of reference.cases.entries())for(const expected of c.rows){
  const actual=rows.find(r=>r.page===i&&r.size===expected.size&&r.script===expected.script);
  expect(actual).toBeTruthy();expect(actual.x).toBe(actual.y);
  expect(Math.abs(actual.size*actual.x-expected.nativeSize),`${c.family} ${c.face} ${expected.size} ${expected.script}`).toBeLessThan(.061);
 }
});

test('prepares script metrics after a formatting command and retains export and undo',async({page},info)=>{
 test.setTimeout(120000);
 const parts=unzipSync(readFileSync('tests/fixtures/script-size/control.docx'));
 parts['word/document.xml']=strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="24"/></w:rPr><w:t>START TEST END</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>');
 const source=Buffer.from(zipSync(parts)),errors=[];page.on('pageerror',e=>errors.push(e.message));
 writeFileSync(info.outputPath('source.docx'),source);
 await page.addInitScript(()=>{
  window.scriptPaint=[];const fill=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){
   if(text==='TEST')window.scriptPaint.push(Number(/([\d.]+)px/.exec(this.font)?.[1])*Math.hypot(this.getTransform().a,this.getTransform().b)*.75/devicePixelRatio);
   return fill.call(this,text,...args);
  };
 });
 await page.goto('/playground.html');await showAllTools(page);
 await page.getByLabel('Open DOCX file').setInputFiles({name:'script-command.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:source});
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue('START TEST END');
 expect(await page.evaluate(async()=>{const {scriptFontSizeReady}=await import('/src/engine/script-font-size.js');return scriptFontSizeReady({fontFamily:'Garamond'});})).toBe(false);
 await input.evaluate(el=>{el.setSelectionRange(6,10);el.dispatchEvent(new Event('select',{bubbles:true}));});
 await page.getByRole('button',{name:'Superscript',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.scriptPaint.at(-1))).toBeCloseTo(7,1);
 const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const edited=await download('edited');
 for(const [name,bytes]of Object.entries(parts))if(name!=='word/document.xml')expect(unzipSync(readFileSync(edited))[name]).toEqual(bytes);
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 expect(unzipSync(readFileSync(await download('undo')))).toEqual(parts);
 await page.evaluate(()=>{window.scriptPaint=[];});
 await reopenDocx(page,input,edited,'START TEST END');
 await expect.poll(()=>page.evaluate(()=>window.scriptPaint.at(-1))).toBeCloseTo(7,1);
 expect(errors).toEqual([]);
});

test('retains the fallback without permission and refreshes sizing after an existing grant',async({page,context})=>{
 test.setTimeout(120000);
 await context.clearPermissions();
 await page.addInitScript(()=>{
  window.fontEnumerationCount=0;
  const enumerate=window.queryLocalFonts.bind(window);
  window.queryLocalFonts=(...args)=>{window.fontEnumerationCount++;return enumerate(...args);};
 });
 await page.goto('/playground.html');
 const source=readFileSync('tests/fixtures/script-size/control.docx').toString('base64');
 const sizing=()=>page.evaluate(async data=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {loadCanvasFonts}=await import('/src/engine/canvas-text.js');
  const {scriptGeometry}=await import('/src/engine/vertical-align.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));
  await loadCanvasFonts(p);
  return {count:window.fontEnumerationCount,geometry:scriptGeometry({fontFamily:'Garamond',fontSize:12,verticalAlign:'superscript'})};
 },source);
 const before=await sizing();
 expect(before.count).toBe(0);
 expect(before.geometry).toMatchObject({scaleX:.65,scaleY:.6});
 await context.grantPermissions(['local-fonts']);
 const after=await sizing();
 expect(after.count).toBe(1);
 expect(after.geometry.scaleX).toBeCloseTo(7/12,8);
 expect(after.geometry.scaleY).toBe(after.geometry.scaleX);
});
