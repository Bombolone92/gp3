import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='public/fixtures/first-row-table-inset.docx',folder='tests/fixtures/first-row-table-inset/';
const reference=JSON.parse(readFileSync(folder+'reference.json','utf8'));
const expected=Object.fromEntries(reference.pages.flat().flatMap(line=>[...line.text.matchAll(/C\dR\dX\d/g)].map(match=>[match[0],line.glyphs[match.index]])));
test('matches native first-row table alignment through editing, undo and reopening',async({page},info)=>{
 test.setTimeout(90000);
 expect(Object.keys(expected)).toHaveLength(32);
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync(folder+'native.pdf')).digest('hex')).toBe(reference.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^Case 0:/);await expect(input).toHaveJSProperty('readOnly',false);
 const check=async file=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);await expect(page.locator('#playground-error')).toBeEmpty();
  const actual=await page.evaluate(async bytes=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
   const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
   const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
   return {lines:Object.fromEntries(l.lines.flatMap(l=>l.fragments.filter(f=>/^C\dR\dX\d$/.test(f.text)).map(f=>[f.text,f.x*.75]))),
    borders:l.tableBorders.filter(b=>!b.guide&&b.border.color==='008000').sort((a,b)=>a.y-b.y||a.x-b.x).map(b=>({x:b.x*.75,width:b.width*.75}))};
  },readFileSync(file).toString('base64'));
  expect(Object.keys(actual.lines).sort()).toEqual(Object.keys(expected).sort());
  // The reference export's origins/edges vary by up to 0.13 pt from the exact OOXML
  // coordinates. Check both text and independent border vectors within 0.15 pt;
  // the former all-row inset differs by 1.5–3 pt in these controls.
  for(const [text,x]of Object.entries(expected))expect(Math.abs(actual.lines[text]-x),text).toBeLessThan(.15);
  expect(actual.borders).toHaveLength(reference.borders.length);
  for(const [i,b]of reference.borders.entries()){
   expect(Math.abs(actual.borders[i].x-b.x),`border ${i} position`).toBeLessThan(.15);
   expect(Math.abs(actual.borders[i].width-b.width),`border ${i} width`).toBeLessThan(.001);
  }
 };
 await check(source);
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const file=info.outputPath(name+'.docx');await(await pending).saveAs(file);return file;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+End');await page.keyboard.insertText(' ');const edited=await save('edited');
 const changed=unzipSync(readFileSync(edited));for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(parts[name]);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);const undo=await save('undo');expect(unzipSync(readFileSync(undo))).toEqual(parts);await check(undo);
 await reopenDocx(page,input,edited,original+' ');await check(edited);
});
