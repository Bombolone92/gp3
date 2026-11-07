import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {onTab} from './helpers/editor-tools.js';
test.use({deviceScaleFactor:4});
const ref=JSON.parse(readFileSync('tests/fixtures/synthetic-bold-ink/reference.json','utf8'));
test('matches native synthetic-bold ink and preserves edit/export/undo',async({page},info)=>{
 test.setTimeout(120000);
 const source='public/fixtures/synthetic-bold-ink.docx',bytes=readFileSync(source),parts=unzipSync(bytes),errors=[];
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync('tests/fixtures/synthetic-bold-ink/native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/Source Sans Pro Light 24 bold$/);await expect(input).toHaveJSProperty('readOnly',false);
 // The native PDF contains glyph ink only. Automatic spelling marks on font
 // names must not become part of the typography measurement.
 await onTab(page,'review');await page.getByRole('button',{name:'Spelling options'}).click();
 await page.getByRole('menuitemcheckbox',{name:'Check Spelling as You Type'}).click();
 await expect(page.locator('.ed-proofing')).toHaveAttribute('aria-label','Spelling check is off');
 await onTab(page,'home');
 const verify=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const measured=await page.evaluate(async encoded=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{measureCanvasText}=await import('/src/engine/canvas-text.js'),{fontAvailable}=await import('/src/engine/font-availability.js');
   const p=await DocxPackage.open(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))),ctx=document.createElement('canvas').getContext('2d');
   const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
   return l.lines.map(line=>({text:line.fragments.map(f=>f.text).join(''),baseline:line.baseline*.75,available:fontAvailable(line.fragments[0]?.fontFamily)}));
  },bytes.toString('base64'));
  const samples=ref.lines.filter(l=>l.text.endsWith('bold')).flatMap(l=>{const m=measured.find(m=>m.text===l.text);expect(m).toBeTruthy();if(!m.available)return [];return [{...l,dy:Math.round((m.baseline-l.baseline)*16/3)}];});
  expect(samples.filter(l=>l.text.startsWith('Source Sans Pro Light'))).toHaveLength(3);
  const ratios=await page.locator('canvas.canvas-page').evaluate((canvas,lines)=>{
   if(canvas.width!==3264||canvas.height!==4224)throw Error('Expected 384dpi reference geometry');
   const ctx=canvas.getContext('2d');return lines.filter(l=>l.text.endsWith('bold')).map(l=>{
    const [x,y,r,b]=l.box,p=ctx.getImageData(x,y+l.dy,r-x,b-y).data;let ink=0,coloredInk=0;
    for(let i=0;i<p.length;i+=4){const coverage=1-(p[i]+p[i+1]+p[i+2])/765;ink+=coverage;if(p[i]!==p[i+1]||p[i+1]!==p[i+2])coloredInk+=coverage;}
    return {text:l.text,ratio:ink/l.ink,coloredInk};
   });
  },samples);
  writeFileSync(info.outputPath('ink-ratios.json'),JSON.stringify(ratios,null,2));
  expect(ratios.length).toBeGreaterThanOrEqual(3);
  for(const {text,ratio,coloredInk} of ratios){expect(coloredInk,text).toBe(0);expect(ratio,text).toBeGreaterThan(.95);expect(ratio,text).toBeLessThan(1.05);}
 };await verify();
 const original=await input.inputValue();
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited'),after=unzipSync(readFileSync(edited));
 for(const [n,b]of Object.entries(parts))if(n!=='word/document.xml')expect(after[n]).toEqual(b);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await verify();
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(1);expect(errors).toEqual([]);
});
test('distinguishes real, synthesized and already-bold faces without changing ordinary paint',async({page})=>{
 await page.goto('/playground.html');
 const result=await page.evaluate(async()=>{
  const {prepareCanvasFont,fontAvailable}=await import('/src/engine/font-availability.js'),{usesSyntheticBold}=await import('/src/engine/synthetic-bold.js'),{setCanvasTextStyle,canvasSyntheticBold,measureCanvasText}=await import('/src/engine/canvas-text.js'),{paintText}=await import('/src/engine/canvas-paint-text.js');
  const names=['Calibri Light','Arial','Calibri','Arial Bold','Arial Black','Arial Italic','Calibri Light Italic','Source Sans Pro Light','Franklin Gothic Book'];
  for(const name of names)await prepareCanvasFont(name);
  const detected=Object.fromEntries(names.map(name=>[name,usesSyntheticBold({bold:true},name)]));
  const images=(family,bold,engine)=>{
   const c=document.createElement('canvas');c.width=700;c.height=100;const ctx=c.getContext('2d'),style={fontFamily:family,fontSize:24,bold};
   setCanvasTextStyle(ctx,style);ctx.fillStyle='#124578';const font=ctx.font,width=measureCanvasText(ctx,'Hamburgefonts',style).width;
   if(engine)paintText(ctx,{...style,text:'Hamburgefonts',x:5},60);else ctx.fillText('Hamburgefonts',5,60);
   return {png:c.toDataURL(),sameFont:ctx.font===font,width,afterWidth:measureCanvasText(ctx,'Hamburgefonts',style).width};
  };
  const unchanged=[];for(const [family,bold]of [['Arial',true],['Arial Bold',true],['Arial Black',true],['Calibri Light',false]]){
   const a=images(family,bold,true),b=images(family,bold,false);unchanged.push(a.png===b.png&&a.sameFont&&a.width===a.afterWidth);
  }
  const synth=images('Source Sans Pro Light',true,true),native=images('Source Sans Pro Light',true,false);
  const ctx=document.createElement('canvas').getContext('2d');
  return {available:Object.fromEntries(names.map(n=>[n,fontAvailable(n)])),detected,unchanged,syntheticChanged:synth.png!==native.png,advancePreserved:synth.width===native.width&&synth.sameFont,
   outlineUnchanged:!canvasSyntheticBold(ctx,{fontFamily:'Calibri Light',bold:true,textOutline:{width:12700}}),
   temporaryFaces:[...document.fonts].filter(f=>f.family.includes('Canvas synthesis probe')).length};
 });
 for(const [name,expected]of Object.entries({'Calibri Light':true,Arial:false,Calibri:false,'Arial Bold':false,'Arial Black':false,'Arial Italic':true,'Calibri Light Italic':true,'Source Sans Pro Light':true,'Franklin Gothic Book':true}))if(result.available[name])expect(result.detected[name],name).toBe(expected);
 expect(result.detected['Source Sans Pro Light']).toBe(true);
 expect(result.unchanged).toEqual([true,true,true,true]);expect(result.syntheticChanged).toBe(true);expect(result.advancePreserved).toBe(true);expect(result.outlineUnchanged).toBe(true);expect(result.temporaryFaces).toBe(0);
});
