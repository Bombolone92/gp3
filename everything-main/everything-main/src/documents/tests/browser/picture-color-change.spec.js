import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const source='tests/fixtures/picture-color-change/control.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/picture-color-change/reference.json'));
test('matches native color-change matching, alpha and effect-order colors and retains original media through edit, reopen and undo',async({page},info)=>{
 test.setTimeout(120000);
 for(const[file,hash]of[[source,reference.sourceSha256],['tests/fixtures/picture-color-change/native.pdf',reference.pdfSha256]])expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash);
 await page.goto('/playground.html');
 const positions=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(p);
  const ctx=document.createElement('canvas').getContext('2d'),layout=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return layout.lines.flatMap(l=>l.fragments.filter(f=>f.image).map(f=>({page:l.page,x:f.x,y:l.baseline-f.ascent,width:f.width,height:f.ascent})));
 },readFileSync(source).toString('base64'));
 expect(positions).toHaveLength(reference.cases.length);
 await page.getByLabel('Open DOCX file').setInputFiles(source);const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^Color change controls/,{timeout:45000});await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const colors=await page.evaluate(positions=>positions.map(p=>{
   const canvas=document.querySelectorAll('canvas.canvas-page')[p.page],ctx=canvas.getContext('2d'),scale=canvas.width/816;
   return Array.from({length:32},(_,j)=>[...ctx.getImageData(Math.floor((p.x+p.width*(j+.5)/32)*scale),Math.floor((p.y+p.height/2)*scale),1,1).data].slice(0,3));
  }),positions);
  for(const[i,c]of reference.cases.entries())for(let j=0;j<32;j++)for(let k=0;k<3;k++)expect(Math.abs(colors[i][j][k]-c.colors[j][k]),`${c.id} swatch ${j}: ${colors[i][j]} vs ${c.colors[j]}`).toBeLessThanOrEqual(5);
 };
 await check();writeFileSync(info.outputPath('picture-color-change.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`picture-color-change-${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await save('edited'),a=unzipSync(readFileSync(source)),b=unzipSync(readFileSync(edited));for(const name of Object.keys(a))if(name!=='word/document.xml')expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();const undo=unzipSync(readFileSync(await save('undo')));for(const name of Object.keys(a))expect(Buffer.from(a[name]).equals(Buffer.from(undo[name])),name).toBe(true);
 const previous=await input.elementHandle();page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited);await expect.poll(()=>previous.evaluate(el=>el.isConnected),{timeout:45000}).toBe(false);await previous.dispose();await expect(input).toHaveValue('Edited '+original);await check();
});
