import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
for(const [folder,reference,row,tolerance=0]of [['mixed-pressure-partial','reference.json',1,2],['mixed-width-protection','reference.json',1],['mixed-width-rounding','reference.json',3],['mixed-rounding-flexible','reference.json',1],['mixed-cell-width-content','native-cell-widths.json',3]]){
 const root=`tests/fixtures/${folder}/`,source=root+'control.docx',bytes=readFileSync(source),ref=JSON.parse(readFileSync(root+reference));
 test(`${folder}: ${tolerance ? 'native boundaries within 0.1pt' : 'exact native grids'} survive editing and reopening`,async({page},info)=>{
  test.setTimeout(180000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toBeEditable();await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.rows.length);
  const compare=async bytes=>{
   const actual=await page.evaluate(async({encoded,row})=>{
    const {DocxPackage}=await import('/src/engine/docx.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
    const d=await DocxPackage.open(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));await loadCanvasFonts(d);const ctx=document.createElement('canvas').getContext('2d');const layout=layoutDocument(d.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(d.pageSettings),d.numbering,d.tables);
    return d.tables.map(t=>t.rows[row-1].cells.map(c=>layout.cells.find(p=>p.id===c.id).width*15));
   },{encoded:Buffer.from(bytes).toString('base64'),row});
   expect(actual).toHaveLength(ref.rows.length);for(const [i,widths]of actual.entries()){expect(widths).toHaveLength(ref.rows[i].widthTwips.length);let actualBoundary=0,nativeBoundary=0;for(const [j,width]of widths.entries()){
     const native=ref.rows[i].widthTwips[j];actualBoundary+=width;nativeBoundary+=native;
     if(!tolerance)expect(width,`case ${i+1}, column ${j+1}`).toBeCloseTo(native,6);
     else {expect(Math.abs(width-native),`case ${i+1}, width ${j+1}`).toBeLessThanOrEqual(tolerance+1e-6);expect(Math.abs(actualBoundary-nativeBoundary),`case ${i+1}, boundary ${j+1}`).toBeLessThanOrEqual(tolerance+1e-6);}
    }}
  };
  await compare(bytes);const original=await input.inputValue(),parts=unzipSync(bytes);
  const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);await input.focus();await input.press('ControlOrMeta+End');await page.keyboard.insertText(' EDIT');const edited=await save('edited'),out=unzipSync(readFileSync(edited));for(const[n,b]of Object.entries(parts))if(n!=='word/document.xml')expect(out[n],n).toEqual(b);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);const undo=readFileSync(await save('undo'));expect(unzipSync(undo)).toEqual(parts);await compare(undo);
  await reopenDocx(page,input,edited,original+' EDIT');await compare(readFileSync(edited));expect(errors).toEqual([]);
 });
}
