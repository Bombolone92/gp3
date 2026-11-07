import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const root='tests/fixtures/cell-breaks/';
const reference=JSON.parse(readFileSync(root+'reference.json'));
for(const name of ['line','page','column','empty-page'])test(`native cell break layout and editing: ${name}`,async({page},info)=>{
 const source=root+name+'.docx',bytes=readFileSync(source),r=reference.cases.find(c=>c.source===name+'.docx'),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/After table/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{await expect(page.locator('canvas.canvas-page')).toHaveCount(1);await expect(page.locator('#playground-error')).toBeEmpty();};
 await check();
 const actual=await page.evaluate(async({b,labels})=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument,caretRect}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{paragraphText}=await import('/src/engine/model.js');
  const pkg=await DocxPackage.open(Uint8Array.from(atob(b),c=>c.charCodeAt(0)));await loadCanvasFonts(pkg);
  const ctx=document.createElement('canvas').getContext('2d'),layout=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
  const text=pkg.paragraphs.map(paragraphText).join('\n');
  return labels.map(label=>{const pos=text.indexOf(label),line=layout.lines.find(l=>l.start<=pos&&l.end>pos);return {text:label,page:line.page,x:caretRect(layout,pos).x*.75,baseline:line.baseline*.75};});
 },{b:bytes.toString('base64'),labels:r.pages[0].labels.map(l=>l.text)});
 writeFileSync(info.outputPath('actual.json'),JSON.stringify(actual,null,2));
 for(const a of actual){const native=r.pages[0].labels.find(l=>l.text===a.text);expect(a.page).toBe(0);expect(Math.abs(a.x-native.x),a.text+' x').toBeLessThan(.2);expect(Math.abs(a.baseline-native.baseline),a.text+' baseline').toBeLessThan(.2);}
 writeFileSync(info.outputPath('page.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 // Edit next to the preserved control inside the table, then export and undo.
 const pos=original.indexOf('Before')+6;
 await input.focus();await input.evaluate((el,p)=>{el.setSelectionRange(p,p);el.dispatchEvent(new Event('select',{bubbles:true}));},pos);
 await page.keyboard.insertText('X');await expect(input).toHaveValue(original.slice(0,pos)+'X'+original.slice(pos));await check();
 const edited=await save('edited'),out=unzipSync(readFileSync(edited));
 for(const n of Object.keys(parts))if(n!=='word/document.xml')expect(out[n],n).toEqual(parts[n]);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,original.slice(0,pos)+'X'+original.slice(pos));await check();expect(errors).toEqual([]);
});
