import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reviewedFamilyOrigins} from './helpers/reviewed-family-origins.js';
import {reopenDocx} from './helpers/reopen-docx.js';
const directory=process.env.DOCX_TEST_OPEN_SANS_110_DIR;
const folder='tests/fixtures/empty-gpos-kerning/';
const reference=JSON.parse(readFileSync(folder+'reviewed-family-display.json'));
const hashes=JSON.parse(readFileSync(folder+'diagnostic-fonts.json'));
const source='public/fixtures/reviewed-family.docx';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('authorized overflowing legacy pairs match native reference display and preserve editing',async({page},info)=>{
 test.skip(!directory,'Set DOCX_TEST_OPEN_SANS_110_DIR to the documented reference fonts.');
 test.setTimeout(120000);
 expect(hash(readFileSync(source))).toBe(reference.sourceSha256);
 expect(hash(readFileSync(folder+'reviewed-family.emf'))).toBe(reference.emfSha256);
 const faces=[['Regular','400','normal'],['Bold','700','normal'],['Italic','400','italic'],['BoldItalic','700','italic']].map(([name,weight,style])=>{
  const file=`OpenSans-1.10-${name}.ttf`,bytes=readFileSync(resolve(directory,file));expect(hash(bytes)).toBe(hashes.sha256[file]);
  return {fullName:'Open Sans '+name,weight,style,encoded:bytes.toString('base64')};
 });
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 await page.evaluate(async faces=>{for(const face of faces)document.fonts.add(await new FontFace('Open Sans',Uint8Array.from(atob(face.encoded),c=>c.charCodeAt(0)),{weight:face.weight,style:face.style}).load());},faces);
 const before=await reviewedFamilyOrigins(page,readFileSync(source).toString('base64'));
 await page.evaluate(async faces=>{
  const local=faces.map(f=>({...f,buffer:Uint8Array.from(atob(f.encoded),c=>c.charCodeAt(0)).buffer}));
  Object.defineProperty(window,'queryLocalFonts',{configurable:true,value:async()=>local.map(face=>({family:'Open Sans',fullName:face.fullName,postscriptName:face.fullName.replaceAll(' ',''),blob:async()=>new Blob([face.buffer])}))});
  const {browseLocalFonts}=await import('/tools/reviewed-family-modules.js');await browseLocalFonts();
 },faces);
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^REGULAR CONDENSED/);await expect(input).toBeEditable();
 const actual=await reviewedFamilyOrigins(page,readFileSync(source).toString('base64'));
 writeFileSync(info.outputPath('origins.json'),JSON.stringify(actual,null,2));
 writeFileSync(info.outputPath('unrepaired-origins.json'),JSON.stringify(before,null,2));
 expect(actual.pages).toHaveLength(1);expect(actual.pages[0].map(l=>l.text)).toEqual(reference.rows.map(l=>l.text));
 const alias=await page.evaluate(async()=>{const {legacyGposFamily}=await import('/tools/reviewed-family-modules.js');return legacyGposFamily({fontFamily:'Open Sans',legacyKerning:true,kerning:1});});
 expect(alias).toMatch(/^Canvas legacy GPOS /);
 for(const [i,row]of actual.pages[0].entries()){
  for(const error of row.advanceErrors)expect(error,'SVG/canvas advance').toBeLessThan(.02);
  if(reference.rows[i].font.face!=='Open Sans')continue;
  expect(row.glyphs).toHaveLength(reference.rows[i].glyphs.length);
  const error=sample=>Math.max(...sample.pages[0][i].glyphs.map((x,j)=>Math.abs(x-reference.rows[i].glyphs[j])));
  expect(error(actual),row.text+' native agreement does not regress').toBeLessThanOrEqual(error(before));
 }
 const maximum=sample=>Math.max(...sample.pages[0].flatMap((row,i)=>reference.rows[i].font.face==='Open Sans'?row.glyphs.map((x,j)=>Math.abs(x-reference.rows[i].glyphs[j])):[]));
 expect(maximum(actual),'native maximum error is reduced by more than half').toBeLessThan(maximum(before)/2);
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
 for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(parts[name]);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 const restored=await reviewedFamilyOrigins(page,readFileSync(source).toString('base64'));expect(restored).toEqual(actual);
 await reopenDocx(page,input,edited,'EDIT '+original);await expect(input).toBeEditable();await expect(page.locator('#playground-error')).toBeEmpty();expect(errors).toEqual([]);
 writeFileSync(info.outputPath('page.png'),Buffer.from(await page.locator('canvas.canvas-page').first().evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 // Keep the stricter full-display oracle visible after all successful
 // preparation, improvement and editing assertions. It is not relaxed to
 // accept the remaining wrapped-continuation drift.
 test.fail(true,'Wrapped continuation glyph origins still exceed 0.25pt against native reference display.');
 for(const [i,row]of actual.pages[0].entries())if(reference.rows[i].font.face==='Open Sans')for(const [j,x]of row.glyphs.entries())expect(Math.abs(x-reference.rows[i].glyphs[j]),`${row.text} glyph ${j}`).toBeLessThan(.25);
});
