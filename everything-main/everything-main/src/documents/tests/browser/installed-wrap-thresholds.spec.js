import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';

const folder='tests/fixtures/installed-wrap-thresholds/',source=folder+'control.docx';
const reference=JSON.parse(readFileSync(folder+'reference.json'));
test.setTimeout(180000);

test('all one-twip wrap boundaries match independent native layout thresholds',async({page},info)=>{
 const bytes=readFileSync(source),sha=b=>createHash('sha256').update(b).digest('hex');
 expect(sha(bytes)).toBe(reference.sourceSha256);expect(sha(readFileSync(folder+'cases.json'))).toBe(reference.casesSha256);
 for(const c of reference.cases)expect(sha(readFileSync(folder+`page-${c.page+1}.emf`))).toBe(c.captureSha256);
 await page.goto('/playground.html');await page.getByRole('textbox',{name:'Document text'}).waitFor();
 const actual=await page.evaluate(async encoded=>{
  const{openCanvasDocument,CanvasEditor}=await import('/tools/reviewed-family-modules.js');
  const{pkg,images}=await openCanvasDocument(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));
  const host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
  try{
   return{readOnly:editor.readOnly,pages:editor.layout.pages.length,
    cases:editor.model.paragraphs.map(p=>editor.layout.lines.filter(l=>l.paragraphId===p.id).map(l=>({page:l.page,text:l.fragments.map(f=>f.text||'').join('')})))};
  }finally{editor.destroy();host.remove();}
 },bytes.toString('base64'));
 writeFileSync(info.outputPath('comparison.json'),JSON.stringify({reference,actual},null,2));
 expect(actual.readOnly).toBe(false);expect(actual.pages).toBe(6);expect(actual.cases).toHaveLength(102);
 reference.cases.forEach((c,i)=>{
  const lines=actual.cases[i];expect(lines[0].text).toBe(c.label);
  expect(lines.map(l=>l.page)).toEqual(lines.map(()=>c.page));
  expect(lines.slice(1).map(l=>l.text),`${c.family}/${c.size}/${c.widthTwips}`).toEqual(c.lines);
 });
 for(const t of reference.thresholds)expect(t.minimumWidthTwips).toBe(Math.ceil(t.designWidthPt*20));
});

test('width-boundary controls retain editable text, package parts, exact undo and reopen',async({page},info)=>{
 const bytes=readFileSync(source),parts=unzipSync(bytes);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^CASE 000/);
 await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(6);
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 const original=await input.inputValue(),start=original.indexOf('M'.repeat(16));expect(start).toBeGreaterThan(0);
 await input.focus();await input.evaluate((e,start)=>e.setSelectionRange(start,start+16),start);
 await page.keyboard.insertText('M'.repeat(15));
 const changed=original.slice(0,start)+'M'.repeat(15)+original.slice(start+16);await expect(input).toHaveValue(changed);
 const edited=await save('edited'),after=unzipSync(readFileSync(edited));
 for(const[n,b]of Object.entries(parts))if(n!=='word/document.xml')expect(after[n]).toEqual(b);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
 expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,changed);await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('.canvas-message-error')).toHaveCount(0);
});
