import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/paragraph-between-distance/',source=folder+'control.docx';
const reference=JSON.parse(readFileSync(folder+'reference.json','utf8'));
test('honors native between-border distance in body and table paragraphs without changing package declarations',async({page},info)=>{
 test.setTimeout(120000);
 for(const [name,hash] of Object.entries(reference.sha256))expect(createHash('sha256').update(readFileSync(folder+name)).digest('hex')).toBe(hash);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^C00R0/);await expect(input).toBeEditable();
 await expect(page.locator('canvas.canvas-page')).toHaveCount(16);
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {validateCanvasLayout,measureCanvasText,setCanvasFontAlternatives}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await validateCanvasLayout(p);
  const c=document.createElement('canvas').getContext('2d');setCanvasFontAlternatives(c,p.styles.fontAlternatives);
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(c,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories,{styles:p.styles,drawingLayouts:p.drawingLayouts});
  return {lines:l.lines.map(r=>({text:r.fragments.map(f=>f.text||'').join(''),baseline:r.baseline*.75,page:r.page})),borders:l.paragraphBorders.filter(b=>b.side==='between').map(b=>({y:b.y*.75,height:b.height*.75,page:b.page,x:Math.max(b.x,b.cellClip?.left??-Infinity)*.75,right:Math.min(b.x+b.width,b.cellClip?.right??Infinity)*.75}))};
 },readFileSync(source).toString('base64'));
 for(const sample of reference.cases){
  const rows=actual.lines.filter(r=>r.text.startsWith('C'+String(sample.id).padStart(2,'0'))),borders=actual.borders.filter(b=>b.page===sample.id);
  expect(rows).toHaveLength(3);expect(borders).toHaveLength(2);
  for(const [j,row] of rows.entries()){expect(row.page).toBe(sample.id);expect(Math.abs(row.baseline-sample.baselines[j])).toBeLessThan(.2);}
  for(const [j,border] of borders.entries())for(const key of ['y','height','x','right'])expect(Math.abs(border[key]-sample.between[j][key]),`case ${sample.id} divider ${j} ${key}`).toBeLessThan(.15);
 }
 writeFileSync(info.outputPath('geometry.json'),JSON.stringify(actual,null,2));
 for(const i of [0,3,4,7,8,11,12,15])writeFileSync(info.outputPath('page'+i+'.png'),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const parts=unzipSync(readFileSync(source)),original=await input.inputValue();expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
 for(const [name,bytes] of Object.entries(parts))if(name!=='word/document.xml')expect(changed[name]).toEqual(bytes);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'EDIT '+original);expect(errors).toEqual([]);
});
