import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/cell-decimal-tabs';
for(const mode of [12,15])test(`mode${mode}: explicit decimal AutoFit widths and editing`,async({page},info)=>{
 const name=`mode${mode}-auto`,source=readFileSync(`${folder}/${name}.docx`),ref=JSON.parse(readFileSync(`${folder}/${name}-cell-widths.json`));
 expect(createHash('sha256').update(source).digest('hex')).toBe(ref.sha256);
 expect(createHash('sha256').update(readFileSync(`${folder}/${ref.pdf}`)).digest('hex')).toBe(ref.pdfSha256);
 await page.goto('/playground.html');
 const widths=async bytes=>page.evaluate(async bytes=>{
 const{DocxPackage}=await import('/src/engine/docx.js');const{layoutDocument}=await import('/src/engine/layout.js');const{pageGeometry}=await import('/src/engine/page-settings.js');const{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
 await new FontFace('Native check','local("Arial")').load();const p=await DocxPackage.open(Uint8Array.from(bytes));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
 return p.tables.map(t=>l.cells.find(c=>c.id===t.rows[0].cells[0].id).width*.75);
 },[...bytes]);
 const originalWidths=await widths(source);
 for(const i of [14,15,16,17,18,19,20,21])expect(Math.abs(originalWidths[i]-ref.tables[i][0].width),`case ${i+1}`).toBeLessThan(.01);
 await page.getByLabel('Open DOCX file').setInputFiles(`${folder}/${name}.docx`);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Case 1/);await expect(input).toHaveJSProperty('readOnly',false);const original=await input.inputValue();
 const download=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(suffix+'.docx');await(await pending).saveAs(path);return path;};
 const before=unzipSync(source),check=(bytes,edited=false)=>{const after=unzipSync(bytes);expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());for(const n of Object.keys(before))if(!edited||n!=='word/document.xml')expect(Buffer.from(after[n]).equals(Buffer.from(before[n])),n).toBe(true);};
 check(readFileSync(await download('noedit')));
 await input.focus();await input.evaluate(el=>{const at=el.value.indexOf('12.3',el.value.indexOf('Case 18'))+4;if(at<4)throw Error('case 18 missing');el.setSelectionRange(at,at);});await page.keyboard.insertText('0');
 const editedText=await input.inputValue(),edited=await download('edited'),bytes=readFileSync(edited);check(bytes,true);const changed=await widths(bytes);expect(changed[17]-originalWidths[17]).toBeGreaterThan(6);expect(changed.filter((_,i)=>i!==17)).toEqual(originalWidths.filter((_,i)=>i!==17));
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);check(readFileSync(await download('undo')));
 await reopenDocx(page,input,edited,editedText);await expect(page.locator('#playground-error')).toBeEmpty();
 writeFileSync(info.outputPath('widths.json'),JSON.stringify({originalWidths,changed},null,2));
});
