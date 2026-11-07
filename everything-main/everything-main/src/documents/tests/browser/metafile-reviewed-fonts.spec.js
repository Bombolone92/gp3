import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {createHash} from 'node:crypto';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='tests/fixtures/metafile-reviewed-fonts/control.docx';
test.setTimeout(180000);
test('reviewed picture fonts match explicitly supplied faces and survive editing and exact undo',async({browser},info)=>{
 const ref=JSON.parse(readFileSync('tests/fixtures/metafile-reviewed-fonts/source-hashes.json'));
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(ref['control.docx']);
 const reference=await browser.newPage(),page=await browser.newPage();
 try{
  for(const p of [reference,page])await p.goto('/playground.html');
  const bytes=['Karla-Regular.ttf','Karla-Bold.ttf'].map(n=>[...readFileSync('public/fonts/'+n)]);
  await reference.evaluate(async fonts=>{const{loadFontFile}=await import('/src/engine/file-fonts.js');for(const f of fonts)await loadFontFile(new File([Uint8Array.from(f)],'Karla.ttf'));},bytes);
  const inspect=async p=>p.evaluate(async bytes=>{const{openCanvasDocument}=await import('/src/engine/open-document.js');const{pkg,images}=await openCanvasDocument(Uint8Array.from(bytes));try{return{missing:pkg.missingPictureFonts,decoded:images.size,assets:Object.keys(pkg.assets).length,readOnly:!!pkg.readOnly};}finally{for(const image of images.values())image.close();}},[...readFileSync(source)]);
  const automatic=await inspect(page),supplied=await inspect(reference);expect(automatic).toEqual(supplied);expect(automatic.missing).toEqual([]);expect(automatic.decoded).toBeGreaterThan(0);expect(automatic.readOnly).toBe(false);
  for(const p of [reference,page])await p.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Shape defaults controls/);await expect(input).toHaveJSProperty('readOnly',false);
  await expect(reference.getByRole('textbox',{name:'Document text'})).toHaveValue(await input.inputValue());
  const pixels=async p=>{await p.getByRole('textbox',{name:'Document text'}).evaluate(e=>e.blur());return p.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL()));};
  const pixelHashes=async p=>(await pixels(p)).map(data=>createHash('sha256').update(data).digest('hex'));
  expect(await pixelHashes(page)).toEqual(await pixelHashes(reference));
  writeFileSync(info.outputPath('reviewed-picture-fonts.png'),Buffer.from((await pixels(page))[0].split(',')[1],'base64'));
  const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
  const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const edited=await save('edited'),changed=unzipSync(readFileSync(edited));for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name]).toEqual(parts[name]);
  await input.press('ControlOrMeta+z');expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);expect(await pixelHashes(page)).toEqual(await pixelHashes(reference));
  await reopenDocx(page,input,edited,'Edited '+original);expect((await inspect(page)).missing).toEqual([]);await expect(page.locator('#playground-error')).toBeEmpty();
 }finally{await reference.close();await page.close();}
});

test('automatic reviewed picture fonts retain native reference ink bounds',async({page},info)=>{
 const native=JSON.parse(readFileSync('tests/fixtures/metafile-reviewed-fonts/reference.json'));
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(native.sourceSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveValue(/^Shape defaults controls/);
 const boxes=native.cases.map(c=>({name:c.name,...c.ink}));
 const ink=await page.locator('canvas.canvas-page').evaluate((canvas,boxes)=>{
  const ctx=canvas.getContext('2d'),scale=canvas.width/612;
  return boxes.map(b=>{let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
   for(let y=Math.floor((b.top-4)*scale);y<Math.ceil((b.bottom+4)*scale);y++)for(let x=Math.floor((b.left-4)*scale);x<Math.ceil((b.right+4)*scale);x++){
    const p=ctx.getImageData(x,y,1,1).data;if(p[2]>p[0]+20&&p[0]<180){left=Math.min(left,x/scale);right=Math.max(right,(x+1)/scale);top=Math.min(top,y/scale);bottom=Math.max(bottom,(y+1)/scale);}
   }return{left,right,top,bottom};});
 },boxes);
 writeFileSync(info.outputPath('native-bounds.json'),JSON.stringify({boxes,ink},null,2));
 for(let i=0;i<boxes.length;i++)for(const key of ['left','right','top','bottom'])expect(Math.abs(ink[i][key]-boxes[i][key]),`${boxes[i].name}/${key}`).toBeLessThan(1.6);
});

test('requested corpus source retains unavailable font notices and editing',async({page},info)=>{
 const path=process.env.DOCX_PICTURE_FONT_REVIEW_SOURCE;test.skip(!path,'Supply a private source path for corpus review.');
 await page.goto('/playground.html');
 const report=await page.evaluate(async bytes=>{const{openCanvasDocument}=await import('/src/engine/open-document.js');const{pkg,images}=await openCanvasDocument(Uint8Array.from(bytes));try{return{missing:pkg.missingPictureFonts,decoded:images.size,assets:Object.keys(pkg.assets).length,readOnly:!!pkg.readOnly};}finally{for(const image of images.values())image.close();}},[...readFileSync(path)]);
 expect(report.missing).toEqual((process.env.DOCX_PICTURE_FONT_EXPECT_MISSING||'').split(';').filter(Boolean));expect(report.decoded).toBe(report.assets);expect(report.readOnly).toBe(false);
 await page.getByLabel('Open DOCX file').setInputFiles(path);const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveJSProperty('readOnly',false);
 const original=await input.inputValue(),parts=unzipSync(readFileSync(path));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const output=info.outputPath(name+'.docx');await(await pending).saveAs(output);return output;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const edited=await save('edited'),changed=unzipSync(readFileSync(edited));for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name]).toEqual(parts[name]);
 await input.press('ControlOrMeta+z');expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await reopenDocx(page,input,edited,'Edited '+original);
 await input.evaluate(e=>e.blur());writeFileSync(info.outputPath('corpus-page.png'),Buffer.from((await page.locator('canvas.canvas-page').first().evaluate(c=>c.toDataURL())).split(',')[1],'base64'));
 writeFileSync(info.outputPath('corpus-report.json'),JSON.stringify({...report,pages:await page.locator('canvas.canvas-page').count(),sha256:createHash('sha256').update(readFileSync(path)).digest('hex')},null,2));
 await expect(page.locator('#playground-error')).toBeEmpty();
});
