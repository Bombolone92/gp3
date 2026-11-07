import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {createHash} from 'node:crypto';
import {reopenDocx} from './helpers/reopen-docx.js';
const reference=JSON.parse(readFileSync('tests/fixtures/unequal-columns/reference.json','utf8'));
for(const name of Object.keys(reference))test(`unequal ${name} columns match native wrapping and separator rules`,async({page},info)=>{
 test.setTimeout(120000);
 const source=`tests/fixtures/unequal-columns/${name}.docx`,ref=reference[name];
 for(const [file,hash]of Object.entries(ref.sha256))expect(createHash('sha256').update(readFileSync('tests/fixtures/unequal-columns/'+file)).digest('hex')).toBe(hash);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^word00/);await expect(input).toBeEditable();
 await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument,hitTest}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await validateCanvasLayout(p);
  const c=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(c,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories,{styles:p.styles});
  return {rows:l.lines.filter(r=>!r.virtual&&!r.hardBreak).map(r=>({text:r.fragments.map(f=>f.text||'').join('').trim(),x:r.stops[0].x*.75,baseline:r.baseline*.75,page:r.page,start:r.start,hit:hitTest(l,r.page,r.stops[0].x,r.y+1)})),separators:l.columnSeparators.map(s=>({...s,x:s.x*.75,y:s.y*.75,width:s.width*.75,height:s.height*.75}))};
 },readFileSync(source).toString('base64'));
 writeFileSync(info.outputPath('geometry.json'),JSON.stringify(actual,null,2));
 expect(actual.rows).toHaveLength(ref.rows.length);
 for(let i=0;i<actual.rows.length;i++){
  expect(actual.rows[i].text,`line ${i}`).toBe(ref.rows[i].text);expect(actual.rows[i].page).toBe(ref.rows[i].page);
  for(const key of ['x','baseline'])expect(Math.abs(actual.rows[i][key]-ref.rows[i][key]),`line ${i} ${key}`).toBeLessThan(.2);
  expect(actual.rows[i].hit).toBe(actual.rows[i].start);
 }
 expect(actual.separators).toHaveLength(ref.separators.length);
 for(let i=0;i<actual.separators.length;i++)for(const key of ['x','y','width','height'])expect(Math.abs(actual.separators[i][key]-ref.separators[i][key]),`separator ${i} ${key}`).toBeLessThan(.2);
 for(const separator of actual.separators)await expect.poll(()=>page.locator('canvas.canvas-page').nth(separator.page).evaluate((c,s)=>{
  const scale=c.width/360;
  return Math.min(...c.getContext('2d').getImageData(Math.floor((s.x+s.width/2)*scale),Math.floor((s.y+s.height/2)*scale),1,1).data.slice(0,3));
 },separator)).toBeLessThan(180);
 for(let i=0;i<ref.pages;i++)writeFileSync(info.outputPath(`page${i}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
 for(const [name,bytes]of Object.entries(parts))if(name!=='word/document.xml')expect(changed[name]).toEqual(bytes);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'EDIT '+original);await expect(page.locator('#playground-error')).toBeEmpty();
});
