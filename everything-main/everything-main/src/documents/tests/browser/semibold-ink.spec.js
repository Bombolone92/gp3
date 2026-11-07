import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
test.use({deviceScaleFactor:4});
const folder='tests/fixtures/semibold-ink/',source=folder+'control.docx';
const bytes=readFileSync(source),ref=JSON.parse(readFileSync(folder+'reference.json'));
for(const authorized of [false,true])for(const family of ['Franklin Gothic Demi','Arial Black','Arial Bold'])test(`native reference regular and bold ink: ${family}, local font access ${authorized?'granted':'ungranted'}`,async({page,context},info)=>{
 test.setTimeout(120000);
 if(authorized)await context.grantPermissions(['local-fonts']);
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(folder+'native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 await page.goto('/playground.html');
 const available=await page.evaluate(async name=>{try{await new FontFace('Reference check',`local("${name}")`).load();return true;}catch{return false;}},family);
 test.skip(!available,'Requires the installed reference font; no font files are redistributed.');
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/Arial Bold 24 bold$/);await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 const measured=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{measureCanvasText,loadCanvasFonts}=await import('/src/engine/canvas-text.js');
  const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
  return layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables).lines.map(l=>({text:l.fragments.map(f=>f.text).join(''),baseline:l.baseline*.75}));
 },[...bytes]);
 const samples=ref.lines.filter(l=>l.text.startsWith(family+' ')).map(l=>{
  const m=measured.find(m=>m.text===l.text);expect(m).toBeTruthy();return {...l,dy:Math.round((m.baseline-l.baseline)*16/3)};
 });
 expect(samples).toHaveLength(6);
 const ratios=await page.locator('canvas.canvas-page').evaluate((canvas,lines)=>{
  if(canvas.width!==3264||canvas.height!==4224)throw Error('Expected 384dpi canvas');
  const ctx=canvas.getContext('2d');return lines.map(l=>{const [x,y,r,b]=l.box,p=ctx.getImageData(x,y+l.dy,r-x,b-y).data;let ink=0;
   for(let i=0;i<p.length;i+=4)ink+=1-(p[i]+p[i+1]+p[i+2])/765;return {text:l.text,ratio:ink/l.ink};});
 },samples);
 for(const l of ratios.filter(l=>l.text.endsWith('regular')))expect(l.ratio,l.text).toBeGreaterThan(.95);
 for(const l of ratios.filter(l=>l.text.endsWith('regular')))expect(l.ratio,l.text).toBeLessThan(1.05);
 await info.attach('native-ink-ratios',{body:JSON.stringify(ratios,null,2),contentType:'application/json'});
 test.fail(!authorized&&family==='Franklin Gothic Demi','Without local font permission, the renderer cannot verify that this face needs additional bold ink.');
 for(const l of ratios.filter(l=>l.text.endsWith('bold'))){expect(l.ratio,l.text).toBeGreaterThan(.95);expect(l.ratio,l.text).toBeLessThan(1.05);}
});
