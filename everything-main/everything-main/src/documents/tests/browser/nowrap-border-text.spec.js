import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
for(const name of ['bordered','thin','thick']){
const folder='nowrap-cell-margins',source=name+'.docx',root=`tests/fixtures/${folder}/`,ref=JSON.parse(readFileSync(root+name+'-text-reference.json'));
for(const layout of [...new Set(ref.cases.map(c=>c.layout))])test(`${folder}/${source}: compares native bordered noWrap text origins through editing`,async({page},info)=>{
 for(const [file,hash]of Object.entries(ref.hashes))expect(createHash('sha256').update(readFileSync(root+file)).digest('hex'),file).toBe(hash);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 await page.getByLabel('Open DOCX file').setInputFiles(root+source);
 await expect(page.getByRole('textbox',{name:'Document text'})).toBeEditable();await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.cases.length);
 const actual=await page.evaluate(async({bytes,cases})=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
  const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');const {fontAvailable}=await import('/src/engine/font-availability.js');
  const d=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(d);if(!fontAvailable('Arial'))throw Error('Arial required for native geometry comparison');
  const ctx=document.createElement('canvas').getContext('2d');const l=layoutDocument(d.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(d.pageSettings),d.numbering,d.tables);
  return cases.map((_,i)=>l.lines.filter(line=>line.page===i&&['A0','B0','C0'].includes(line.fragments.map(f=>f.text||'').join(''))).slice(0,4).map(line=>({x:line.fragments[0].x*.75,baseline:line.baseline*.75,page:line.page})));
 },{bytes:[...readFileSync(root+source)],cases:ref.cases});
 expect(errors).toEqual([]);expect(actual).toHaveLength(ref.cases.length);for(const [i,row]of actual.entries()){expect(row).toHaveLength(ref.cases[i].grid.length);for(const c of row)expect(c.page).toBe(i);}
 for(const [i,row]of actual.entries())for(const [j,c]of row.entries())expect(Math.abs(c.baseline-ref.pages[i][j].baseline),`case ${i+1} cell ${j+1} baseline`).toBeLessThan(.2);
 const differences=[];for(const [i,row]of actual.entries())for(const [j,c]of row.entries())for(const key of ['x'])if(ref.cases[i].layout===layout&&Math.abs(c[key]-ref.pages[i][j][key])>.2)differences.push({case:i+1,column:j+1,key,actual:c[key],native:ref.pages[i][j][key]});
 writeFileSync(info.outputPath('geometry.json'),JSON.stringify({actual,reference:ref.pages,differences},null,2));
 if(name==='thin')for(const index of [7,9])writeFileSync(info.outputPath(`page${index+1}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(index).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const input=page.getByRole('textbox',{name:'Document text'}),text=await input.inputValue(),parts=unzipSync(readFileSync(root+source));
 const save=async name=>{const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await wait).saveAs(path);return path;};
 const preserved=(path,edited=false)=>{const out=unzipSync(readFileSync(path));expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const[n,b]of Object.entries(parts))if(!edited||n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 preserved(await save('noedit'));await input.press('ControlOrMeta+End');await page.keyboard.insertText(' EDIT');const edited=await save('edited');preserved(edited,true);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);preserved(await save('undo'));
 await reopenDocx(page,input,edited,text+' EDIT');await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.cases.length);expect(errors).toEqual([]);
 expect(differences).toEqual([]);
});
}
