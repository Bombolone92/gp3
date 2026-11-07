import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
for(const [folder,source,reference] of [['mixed-cell-width-preferences','control.docx','reference.json'],['mixed-cell-width-preferences','nowrap.docx','nowrap-reference.json'],['mixed-cell-width-four','control.docx','reference.json'],['mixed-cell-width-content','control.docx','reference.json'],['nowrap-cell-margins','control.docx','reference.json']]){
const root=`tests/fixtures/${folder}/`,ref=JSON.parse(readFileSync(root+reference));
for(const layout of [...new Set(ref.cases.map(c=>c.layout))])test(`${folder}/${source}: matches native mixed ${layout} widths and merged preference constraints`,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 await page.getByLabel('Open DOCX file').setInputFiles(root+source);
 await expect(page.getByRole('textbox',{name:'Document text'})).toBeEditable();await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.cases.length);
 const actual=await page.evaluate(async({bytes,cases})=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
  const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');const {fontAvailable}=await import('/src/engine/font-availability.js');
  const d=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(d);if(!fontAvailable('Arial'))throw Error('Arial required for native geometry comparison');
  const ctx=document.createElement('canvas').getContext('2d');const l=layoutDocument(d.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(d.pageSettings),d.numbering,d.tables);
  return d.tables.map((t,i)=>t.rows[cases[i].header==='none'?0:2].cells.map(c=>{const p=l.cells.find(p=>p.id===c.id);return {x:p.x*.75,width:p.width*.75,page:p.page};}));
 },{bytes:[...readFileSync(root+source)],cases:ref.cases});
 expect(errors).toEqual([]);expect(actual).toHaveLength(ref.cases.length);for(const [i,row]of actual.entries()){expect(row).toHaveLength(ref.cases[i].grid.length);for(const c of row)expect(c.page).toBe(i);}
 const differences=[];for(const [i,row]of actual.entries())for(const [j,c]of row.entries())for(const key of ['x','width'])if(ref.cases[i].layout===layout&&Math.abs(c[key]-ref.pages[i][j][key])>.2)differences.push({case:i+1,column:j+1,key,actual:c[key],native:ref.pages[i][j][key]});
 writeFileSync(info.outputPath('geometry.json'),JSON.stringify({actual,reference:ref.pages,differences},null,2));
 const input=page.getByRole('textbox',{name:'Document text'}),text=await input.inputValue(),parts=unzipSync(readFileSync(root+source));
 const save=async name=>{const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await wait).saveAs(path);return path;};
 const preserved=(path,edited=false)=>{const out=unzipSync(readFileSync(path));expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const[n,b]of Object.entries(parts))if(!edited||n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 preserved(await save('noedit'));await input.press('ControlOrMeta+End');await page.keyboard.insertText(' EDIT');const edited=await save('edited');preserved(edited,true);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);preserved(await save('undo'));
 await reopenDocx(page,input,edited,text+' EDIT');await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.cases.length);expect(errors).toEqual([]);
 expect(differences).toEqual([]);
});

}
