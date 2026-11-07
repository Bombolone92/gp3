import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {reviewedFamilyOrigins} from './helpers/reviewed-family-origins.js';
const directory=process.env.DOCX_TEST_OPEN_SANS_110_DIR;
const source='tests/fixtures/legacy-continuation/source.docx';
const hashes=JSON.parse(readFileSync('tests/fixtures/empty-gpos-kerning/diagnostic-fonts.json'));
const reference=JSON.parse(readFileSync('tests/fixtures/legacy-continuation/reference.json'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('legacy continuation drift is unchanged when the text starts a paragraph',async({page},info)=>{
 test.skip(!directory,'Set DOCX_TEST_OPEN_SANS_110_DIR to the documented reference fonts.');
 for(const[file,expected]of Object.entries(reference.hashes))expect(hash(readFileSync(file))).toBe(expected);
 const faces=[['Regular','400','normal'],['Bold','700','normal'],['Italic','400','italic'],['BoldItalic','700','italic']].map(([name,weight,style])=>{
  const file=`OpenSans-1.10-${name}.ttf`,bytes=readFileSync(resolve(directory,file));expect(hash(bytes)).toBe(hashes.sha256[file]);
  return {fullName:'Open Sans '+name,weight,style,encoded:bytes.toString('base64')};
 });
await page.goto('/playground.html');
 await page.evaluate(async faces=>{for(const face of faces)document.fonts.add(await new FontFace('Open Sans',Uint8Array.from(atob(face.encoded),c=>c.charCodeAt(0)),{weight:face.weight,style:face.style}).load());},faces);

 await page.evaluate(async faces=>{
  const local=faces.map(f=>({...f,buffer:Uint8Array.from(atob(f.encoded),c=>c.charCodeAt(0)).buffer}));
  Object.defineProperty(window,'queryLocalFonts',{configurable:true,value:async()=>local.map(face=>({family:'Open Sans',fullName:face.fullName,postscriptName:face.fullName.replaceAll(' ',''),blob:async()=>new Blob([face.buffer])}))});
  const {browseLocalFonts}=await import('/tools/reviewed-family-modules.js');await browseLocalFonts();
 },faces);

 const actual=await reviewedFamilyOrigins(page,readFileSync(source).toString('base64'));
 expect(actual.pages).toHaveLength(1);expect(actual.pages[0]).toHaveLength(6);
 const rows=actual.pages[0];
 for(const [a,b]of [[1,2],[4,5]]){
  expect(rows[a].text).toBe(rows[b].text);expect(rows[a].glyphs).toEqual(rows[b].glyphs);
  for(const row of [rows[a],rows[b]])for(const error of row.advanceErrors)expect(error).toBeLessThan(.02);
 }
 writeFileSync(info.outputPath('origins.json'),JSON.stringify(actual,null,2));
});
