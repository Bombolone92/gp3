import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/merged-shape-widths/';
const ref=JSON.parse(readFileSync(folder+'merged-shape-width-reference.json'));
test('matches native merged-column distribution and retains editing, export and undo',async({page},info)=>{
 test.setTimeout(120000);
 const source=folder+'merged-shape-width-control.docx',bytes=readFileSync(source),parts=unzipSync(bytes),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');
 const widths=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return Object.values(l.tableWidths).map(w=>w.map(x=>x*.75));
 },[...bytes]);
 expect(widths).toHaveLength(6);
 for(let i=0;i<6;i++)for(let j=0;j<3;j++)expect(Math.abs(widths[i][j]-ref.pages[i].widthsPt[j])).toBeLessThan(.1);
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^30 point rectangle/,{timeout:45000});await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{await expect(page.locator('canvas.canvas-page')).toHaveCount(6);await expect(page.locator('#playground-error')).toBeEmpty();};
 await check();
 for(let i=0;i<6;i++)writeFileSync(info.outputPath(`page-${i}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue();
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const equal=(path,edited=false)=>{const actual=unzipSync(readFileSync(path));expect(Object.keys(actual).sort()).toEqual(Object.keys(parts).sort());for(const name of Object.keys(parts))if(!edited||name!=='word/document.xml')expect(Buffer.from(actual[name]).equals(Buffer.from(parts[name])),name).toBe(true);};
 equal(await save('noedit'));
 // Edit the merged heading that contributes the width constraint.
 const at=original.indexOf('_'.repeat(30));expect(at).toBeGreaterThan(0);
 await input.evaluate((el,at)=>{el.focus();el.setSelectionRange(at,at+30);el.dispatchEvent(new Event('select',{bubbles:true}));},at);
 await page.keyboard.insertText('Edited heading');await expect(input).toHaveValue(original.slice(0,at)+'Edited heading'+original.slice(at+30));
 const edited=await save('edited');equal(edited,true);await check();
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);equal(await save('undo'));await check();
 await reopenDocx(page,input,edited,original.slice(0,at)+'Edited heading'+original.slice(at+30));await check();expect(errors).toEqual([]);
});
