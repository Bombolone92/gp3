import { test,expect } from '@playwright/test';
import { readFileSync,writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const root='tests/fixtures/section-keep/';
const refs=JSON.parse(readFileSync(root+'reference.json','utf8')).cases;
for(const c of refs)test('keeps native section-boundary placement: '+c.name,async({page},info)=>{
 test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+c.name+'.docx');
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^INTRO\n/,{timeout:60000});await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(c.pageCount);
 // Independent browser measurement exercises the same native-font layout used
 // by the editor. Page assignment alone would miss the continuous-section bug.
 const positions=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {validateCanvasLayout,measureCanvasText,setCanvasFontAlternatives}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js');
  const {pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),v=>v.charCodeAt(0)));await validateCanvasLayout(p);
  const ctx=document.createElement('canvas').getContext('2d');setCanvasFontAlternatives(ctx,p.styles.fontAlternatives);
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories,{styles:p.styles});
  return l.lines.filter(l=>l.fragments.some(f=>f.text)).map(l=>({text:l.fragments.map(f=>f.text).join(''),page:l.page,x:l.fragments[0].x*.75,y:l.baseline*.75}));
 },readFileSync(root+c.name+'.docx').toString('base64'));
 expect(positions.map(({text,page})=>({text,page}))).toEqual(c.runs.map(({text,page})=>({text,page})));
 positions.forEach((p,i)=>{expect(Math.abs(p.x-c.runs[i].x)).toBeLessThan(.2);expect(Math.abs(p.y-c.runs[i].y)).toBeLessThan(.6);});
 await page.getByRole('button',{name:'Download .docx',exact:true}).focus();
 for(let i=0;i<c.pageCount;i++){
  const canvas=page.locator('canvas.canvas-page').nth(i);await canvas.scrollIntoViewIfNeeded();
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  writeFileSync(info.outputPath('page'+(i+1)+'.png'),Buffer.from(await canvas.evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 }
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const parts=unzipSync(readFileSync(root+c.name+'.docx'));expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const edited=await save('edited'),editedParts=unzipSync(readFileSync(edited));
 for(const [name,data] of Object.entries(parts))if(name!=='word/document.xml')expect(editedParts[name]).toEqual(data);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(c.pageCount);expect(errors).toEqual([]);
});

test('boundary typing restores the keep chain and undo restores two pages',async({page},info)=>{
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+'empty-keep.docx');
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue('INTRO\nTARGET\n\nAFTER');await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
 await input.focus();await input.evaluate(el=>{const at=el.value.indexOf('\nAFTER');el.setSelectionRange(at,at);el.dispatchEvent(new Event('select',{bubbles:true}));});
 await page.keyboard.insertText('BOUNDARY');await expect(input).toHaveValue('INTRO\nTARGET\nBOUNDARY\nAFTER');
 await expect(page.locator('canvas.canvas-page')).toHaveCount(3);
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
 const edited=info.outputPath('boundary-edited.docx');await(await pending).saveAs(edited);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue('INTRO\nTARGET\n\nAFTER');await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
 await reopenDocx(page,input,edited,'INTRO\nTARGET\nBOUNDARY\nAFTER');await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(3);
});
