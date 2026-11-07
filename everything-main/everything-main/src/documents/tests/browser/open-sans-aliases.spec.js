import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const root='tests/fixtures/open-sans-aliases/', source=root+'control.docx';
const ref=JSON.parse(readFileSync(root+'reference.json','utf8'));
test.use({deviceScaleFactor:4});
test('named Open Sans faces retain native layout and document declarations',async({page},info)=>{
  test.setTimeout(90000);
  for(const[name,hash]of Object.entries(ref.sha256))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
  const requests=[];page.on('request',r=>{if(/\/fonts\/OpenSans-/.test(r.url()))requests.push(r.url());});
  await page.goto('/playground.html');await expect(page.getByRole('textbox',{name:'Document text'})).toBeVisible();expect(requests).toEqual([]);
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Open Sans Light 12 regular/);await expect(input).toHaveJSProperty('readOnly',false);
  const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
  const actual=await page.evaluate(async bytes=>{
    const {DocxPackage}=await import('/src/engine/docx.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{fontAvailable,canvasFontSources}=await import('/tools/font-availability-modules.js');
    const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
    return {fonts:['Open Sans Light','Open Sans SemiBold'].map(name=>({name,available:fontAvailable(name),sources:canvasFontSources(name)})),lines:layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables).lines.map(l=>({text:l.fragments.map(f=>f.text).join(''),page:l.page,baseline:l.baseline*.75,x:l.fragments[0].x*.75}))};
  },[...readFileSync(source)]);
  expect(actual.fonts.every(f=>f.available)).toBe(true);expect(actual.lines).toHaveLength(ref.rows.length);await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
  const lines=ref.rows.map((r,i)=>{const a=actual.lines[i];expect(a.text).toBe(r.text);expect(a.page).toBe(r.page);return {...r,dy:Math.round((a.baseline-r.baseline)*16/3),baselineError:a.baseline-r.baseline};});
  const ink=await page.locator('canvas.canvas-page').evaluate((canvas,lines)=>{
    const ctx=canvas.getContext('2d');return lines.map(l=>{const[x,y,r,b]=l.box,p=ctx.getImageData(x,y+l.dy,r-x,b-y).data;let total=0;for(let i=0;i<p.length;i+=4)total+=1-(p[i]+p[i+1]+p[i+2])/765;return {text:l.text,baselineError:l.baselineError,ratio:total/l.ink};});
  },lines);
  writeFileSync(info.outputPath('metrics.json'),JSON.stringify({actual,ink},null,2));
  for(const row of ink){expect(Math.abs(row.baselineError),row.text).toBeLessThan(.2);expect(row.ratio,row.text).toBeGreaterThan(.95);expect(row.ratio,row.text).toBeLessThan(1.05);}
  expect(new Set(requests).size).toBe(4);const preparedRequests=requests.length;
  const png=await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL());writeFileSync(info.outputPath('page.png'),Buffer.from(png.split(',')[1],'base64'));
  const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');const edited=await save('edited');
  for(const[name,data]of Object.entries(parts))if(name!=='word/document.xml')expect(unzipSync(readFileSync(edited))[name]).toEqual(data);
  await input.focus();await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,'EDIT '+original);expect(requests.length).toBe(preparedRequests);
});
