import {test,expect} from '@playwright/test';
test('authorized local metadata identifies an ordinary exact face without emboldening heavy faces',async({page,context})=>{
 await context.grantPermissions(['local-fonts']);await page.goto('/playground.html');
 const result=await page.evaluate(async()=>{
  const {prepareCanvasFont,fontAvailable}=await import('/src/engine/font-availability.js'),{usesSyntheticBold}=await import('/src/engine/synthetic-bold.js'),{localSourceMetadata}=await import('/src/engine/local-fonts.js');
  const result={};for(const name of ['Franklin Gothic Demi','Franklin Gothic Book','Arial Black','Arial Bold','Arial','Segoe UI Semibold','Dubai Medium']){
   await prepareCanvasFont(name);result[name]={available:fontAvailable(name),bold:usesSyntheticBold({bold:true},name),metadata:await localSourceMetadata(`local("${name}")`)};
  }return result;
 });
 test.skip(!result['Franklin Gothic Demi'].available,'Native exact-face test requires Franklin Gothic Demi.');
 expect(result['Franklin Gothic Demi'].metadata).toMatchObject({weight:400,bold:false,unitsPerEm:2048});
 expect(result['Franklin Gothic Demi'].bold).toBe(true);expect(result['Franklin Gothic Book'].bold).toBe(true);
 for(const name of ['Arial Black','Arial Bold','Arial','Segoe UI Semibold'])if(result[name].available)expect(result[name].bold,name).toBe(false);
});
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
test('authorized metadata restores native Demi ink and preserves exact-face edits',async({browser},info)=>{
 const context=await browser.newContext({permissions:['local-fonts'],deviceScaleFactor:4}),page=await context.newPage();
 try {
  const source='public/fixtures/synthetic-bold.docx',bytes=readFileSync(source),ref=JSON.parse(readFileSync('tests/fixtures/synthetic-bold/metadata-ink.json'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
  expect(createHash('sha256').update(readFileSync('tests/fixtures/synthetic-bold/native.pdf')).digest('hex')).toBe(ref.pdfSha256);
  await page.goto('/playground.html');
  const available=await page.evaluate(async()=>{const f=await import('/src/engine/font-availability.js');await f.checkFontAvailability('Franklin Gothic Demi');return f.fontAvailable('Franklin Gothic Demi');});
  test.skip(!available,'Native ink comparison requires Franklin Gothic Demi.');
  await page.getByLabel('Open DOCX file').setInputFiles(source);const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^B00/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
  const actual=await page.evaluate(async bytes=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{measureCanvasText}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
   const p=await DocxPackage.open(new Uint8Array(bytes)),ctx=document.createElement('canvas').getContext('2d');
   return layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings)).lines.map(l=>({text:l.fragments.map(f=>f.text).join(''),baseline:l.baseline*.75}));
  },[...bytes]);
  const cases=ref.lines.filter(l=>/^B0[0-7] /.test(l.text)).map(l=>({...l,dy:Math.round((actual.find(a=>a.text===l.text).baseline-l.baseline)*16/3)}));
  const ratios=await page.locator('canvas.canvas-page').first().evaluate((canvas,cases)=>{
   const ctx=canvas.getContext('2d');return cases.map(l=>{const [x,y,r,b]=l.box,data=ctx.getImageData(x,y+l.dy,r-x,b-y).data;let ink=0;for(let i=0;i<data.length;i+=4)ink+=1-(data[i]+data[i+1]+data[i+2])/765;return {text:l.text,ratio:ink/l.ink};});
  },cases);
  writeFileSync(info.outputPath('ink-ratios.json'),JSON.stringify(ratios,null,2));
  for(const {text,ratio}of ratios){expect(ratio,text).toBeGreaterThan(.95);expect(ratio,text).toBeLessThan(1.05);}
  writeFileSync(info.outputPath('page.png'),Buffer.from(await page.locator('canvas.canvas-page').first().evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  const original=await input.inputValue(),parts=unzipSync(bytes);
  const same=(a,except=[])=>{expect(Object.keys(a).sort()).toEqual(Object.keys(parts).sort());for(const n of Object.keys(parts))if(!except.includes(n))expect(Buffer.from(a[n]).equals(Buffer.from(parts[n])),n).toBe(true);};
  const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
  same(unzipSync(readFileSync(await save('noedit'))));await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const edited=await save('edited');same(unzipSync(readFileSync(edited)),['word/document.xml']);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);same(unzipSync(readFileSync(await save('undo'))));
  await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);
 } finally {await context.close();}
});
test('granting font access through the picker refreshes an already prepared face',async({page,context})=>{
 await page.goto('/playground.html');
 const before=await page.evaluate(async()=>{const {prepareCanvasFont,fontAvailable}=await import('/src/engine/font-availability.js'),{usesSyntheticBold}=await import('/src/engine/synthetic-bold.js');await prepareCanvasFont('Franklin Gothic Demi');return {available:fontAvailable('Franklin Gothic Demi'),bold:usesSyntheticBold({bold:true},'Franklin Gothic Demi')};});
 test.skip(!before.available,'Requires Franklin Gothic Demi.');expect(before.bold).toBe(false);
 await context.grantPermissions(['local-fonts']);
 await page.getByRole('button',{name:'Latin font family',exact:true}).click();await page.getByRole('button',{name:'Browse installed fonts',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Font',exact:true}).getByRole('status')).toContainText('installed font families available');
 await page.getByRole('searchbox',{name:'Search fonts'}).fill('Franklin Gothic Demi');await page.getByRole('button',{name:'Use “Franklin Gothic Demi”',exact:true}).click();
 await expect(page.getByRole('button',{name:'Latin font family',exact:true})).toHaveText('Franklin Gothic Demi');
 expect(await page.evaluate(async()=>{const {usesSyntheticBold}=await import('/src/engine/synthetic-bold.js');return usesSyntheticBold({bold:true},'Franklin Gothic Demi');})).toBe(true);
});
test('matches native light, semilight, medium and semibold ink with authorized metadata',async({browser},info)=>{
 const context=await browser.newContext({permissions:['local-fonts'],deviceScaleFactor:4}),page=await context.newPage();
 try {
  const source='tests/fixtures/synthetic-bold/weights.docx',bytes=readFileSync(source),ref=JSON.parse(readFileSync('tests/fixtures/synthetic-bold/weights-ink.json'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
  expect(createHash('sha256').update(readFileSync('tests/fixtures/synthetic-bold/weights-native.pdf')).digest('hex')).toBe(ref.pdfSha256);
  await page.goto('/playground.html');
  const fonts=await page.evaluate(async()=>{
   const {prepareCanvasFont,fontAvailable}=await import('/src/engine/font-availability.js');
   const {usesSyntheticBold}=await import('/src/engine/synthetic-bold.js');
   return Promise.all(['Segoe UI Semibold','Segoe UI Semilight','Franklin Gothic Medium','Dubai Medium'].map(async name=>{await prepareCanvasFont(name);return {name,available:fontAvailable(name),stroke:usesSyntheticBold({bold:true},name)};}));
  });
  test.skip(fonts.some(f=>!f.available),'Requires all four installed native reference fonts.');
  for(const f of fonts)expect(f.stroke,f.name).toBe(f.name==='Franklin Gothic Medium');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/Dubai Medium bold$/);await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const measured=await page.evaluate(async bytes=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{measureCanvasText}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
   const p=await DocxPackage.open(new Uint8Array(bytes)),ctx=document.createElement('canvas').getContext('2d');
   return layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings)).lines.map(l=>({text:l.fragments.map(f=>f.text).join(''),baseline:l.baseline*.75}));
  },[...bytes]);
  const samples=ref.lines.map(l=>{const m=measured.find(m=>m.text===l.text);expect(m).toBeTruthy();return {...l,dy:Math.round((m.baseline-l.baseline)*16/3)};});
  expect(samples).toHaveLength(8);
  const ratios=await page.locator('canvas.canvas-page').evaluate((canvas,lines)=>{
   if(canvas.width!==3264||canvas.height!==4224)throw Error('Expected 384dpi reference geometry');
   const ctx=canvas.getContext('2d');return lines.map(l=>{const[x,y,r,b]=l.box,data=ctx.getImageData(x,y+l.dy,r-x,b-y).data;let ink=0;for(let i=0;i<data.length;i+=4)ink+=1-(data[i]+data[i+1]+data[i+2])/765;return {text:l.text,ratio:ink/l.ink};});
  },samples);
  writeFileSync(info.outputPath('weight-ink-ratios.json'),JSON.stringify(ratios,null,2));
  for(const r of ratios){expect(r.ratio,r.text).toBeGreaterThan(.95);expect(r.ratio,r.text).toBeLessThan(1.05);}
 } finally {await context.close();}
});
