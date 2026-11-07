import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
import {createHash} from 'node:crypto';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/column-count/';
const refs=JSON.parse(readFileSync(folder+'reference.json','utf8'));
for(const [name,ref] of Object.entries(refs).filter(([n])=>!n.endsWith('num3')))test(`${name} matches native column count and preserves declarations after editing`,async({page},info)=>{
 test.setTimeout(120000);const source=folder+name+'.docx',bytes=readFileSync(source);
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^FIRST/,{timeout:60000});await expect(input).toBeEditable();
 await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
 const actual=await page.evaluate(async b=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument,hitTest}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(b),c=>c.charCodeAt(0)));await validateCanvasLayout(p);
  const ctx=document.createElement('canvas').getContext('2d');const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return {pages:l.pageCount,rows:l.lines.filter(r=>r.fragments.some(f=>f.text)).map(r=>({text:r.fragments.map(f=>f.text||'').join(''),page:r.page+1,x:r.stops[0].x*.75,y:r.y*.75,start:r.start,hit:hitTest(l,r.page,r.stops[0].x,r.y+1)}))};
 },bytes.toString('base64'));
 expect(actual.pages).toBe(ref.pages);expect(actual.rows).toHaveLength(ref.rows.length);
 for(let i=0;i<ref.rows.length;i++){const a=actual.rows[i],r=ref.rows[i];expect(a.text).toBe(r.text);expect(a.page).toBe(r.page);expect(a.x).toBeCloseTo(r.x,1);expect(a.y).toBeCloseTo(r.y,1);expect(a.hit).toBe(a.start);}
 writeFileSync(info.outputPath('geometry.json'),JSON.stringify(actual,null,2));
 await page.locator('canvas.canvas-page').first().screenshot({path:info.outputPath('page1.png')});
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const dest=info.outputPath(name+'.docx');await(await pending).saveAs(dest);return dest;};
 const parts=unzipSync(bytes),original=await input.inputValue();expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
 const cols=strFromU8(parts['word/document.xml']).match(/<w:cols\b[\s\S]*?<\/w:cols>/)[0];expect(strFromU8(changed['word/document.xml'])).toContain(cols);
 for(const [n,b] of Object.entries(parts))if(n!=='word/document.xml')expect(changed[n]).toEqual(b);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'EDIT '+original);await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);await expect(page.locator('#playground-error')).toBeEmpty();
});
