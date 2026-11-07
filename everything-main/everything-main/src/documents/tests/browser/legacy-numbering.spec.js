import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
const reference=JSON.parse(readFileSync('tests/fixtures/legacy-numbering/reference.json','utf8'));
test('matches native legacy label/text positions and preserves edits and original numbering',async({page},testInfo)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');
 const source='public/fixtures/legacy-numbering.docx';
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/NegativeRight sample text/);await expect(input).not.toHaveAttribute('readonly');
 await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 const positions=await page.evaluate(async()=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const pkg=await DocxPackage.open(new Uint8Array(await(await fetch('/fixtures/legacy-numbering.docx')).arrayBuffer()));
  await loadCanvasFonts(pkg);const ctx=document.createElement('canvas').getContext('2d');
  return layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables).lines.map(l=>({name:l.fragments.map(f=>f.text).join('').split(' sample text')[0],markerX:l.marker?l.marker.x*.75:null,textX:l.stops[0].x*.75}));
 });
 expect(positions).toHaveLength(reference.rows.length);
 for(const row of reference.rows){const actual=positions.find(p=>p.name===row.name);expect(actual,row.name).toBeTruthy();expect(Math.abs(actual.textX-row.textX),row.name+' text').toBeLessThan(.2);if(row.markerX===null)expect(actual.markerX).toBeNull();else expect(Math.abs(actual.markerX-row.markerX),row.name+' marker').toBeLessThan(.2);}
 const original=await input.inputValue();await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=testInfo.outputPath('legacy-numbering-edited.docx');await(await pending).saveAs(path);
 const parts=unzipSync(readFileSync(path));for(const[name,data]of Object.entries(unzipSync(readFileSync(source))))if(name!=='word/document.xml')expect(parts[name]).toEqual(data);
 await input.focus();await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
 page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(path);await expect(input).toHaveValue('Edited '+original);await expect(input).not.toHaveAttribute('readonly');
 expect(errors).toEqual([]);
});
