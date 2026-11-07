import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const reference=JSON.parse(readFileSync('tests/fixtures/continuous-geometry/reference.json','utf8'));
for(const name of Object.keys(reference))test(`continuous ${name} geometry matches the native reference and remains editable`,async({page},info)=>{
 const source=`tests/fixtures/continuous-geometry/${name}.docx`;
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^S0 R00/);await expect(input).toBeEditable();
 await expect(page.locator('canvas.canvas-page')).toHaveCount(reference[name].pages.length);
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await validateCanvasLayout(p);
  const c=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(c,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories,{styles:p.styles});
  return l.lines.filter(r=>!r.virtual).map(r=>({text:r.fragments.map(f=>f.text||'').join(''),x:r.stops[0].x*.75,baseline:r.baseline*.75,page:r.page}));
 },readFileSync(source).toString('base64'));
 const expected=reference[name].pages.flatMap((p,page)=>p.runs.map(r=>({...r,page})));
 expect(actual).toHaveLength(expected.length);
 for(let i=0;i<actual.length;i++){
  expect(actual[i].text).toBe(expected[i].text);expect(actual[i].page).toBe(expected[i].page);
  for(const key of ['x','baseline'])expect(Math.abs(actual[i][key]-expected[i][key])).toBeLessThan(.2);
 }
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
 for(const [name,bytes]of Object.entries(parts))if(name!=='word/document.xml')expect(changed[name]).toEqual(bytes);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'EDIT '+original);await expect(page.locator('#playground-error')).toBeEmpty();
});
