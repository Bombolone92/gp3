import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {reviewedFamilyOrigins} from './helpers/reviewed-family-origins.js';
const folder='tests/fixtures/gpos-only-kerning/';
const reference=JSON.parse(readFileSync(folder+'reference.json'));
for(const enabled of [false,true])test(`font-version diagnostic uses the editor's ${enabled?'modern':'legacy'} style context`,async({page})=>{
 const sample=reference.cases.find(c=>c.file===`gpos-style-${enabled?'True':'False'}-none.pdf`);
 expect(sample).toBeTruthy();
 const bytes=readFileSync(folder+sample.file.replace('.pdf','.docx'));
 await page.goto('/playground.html');
 await page.getByRole('textbox',{name:'Document text'}).waitFor();
 const result=await page.evaluate(async encoded=>{
  const {recordFontVersionTypography}=await import('/tools/font-version-typography.js');
  const before={inputs:document.querySelectorAll('.canvas-input').length,children:document.body.children.length};
  const actual=await recordFontVersionTypography(encoded);
  return {actual,remainingInputs:document.querySelectorAll('.canvas-input').length-before.inputs,remainingChildren:document.body.children.length-before.children};
 },bytes.toString('base64'));
 expect(result.remainingInputs).toBe(0);expect(result.remainingChildren).toBe(0);
 const before=await page.evaluate(()=>({inputs:document.querySelectorAll('.canvas-input').length,children:document.body.children.length}));
 const shared=await reviewedFamilyOrigins(page,bytes.toString('base64'));
 expect(await page.evaluate(()=>({inputs:document.querySelectorAll('.canvas-input').length,children:document.body.children.length}))).toEqual(before);
 const lines=result.actual.lines.filter(l=>l.fragments.length);
 expect(lines).toHaveLength(sample.lines.length);
 for(const [i,line] of lines.entries()){
  const native=sample.lines[i];
  expect(line.fragments.map(f=>f.text).join('')).toBe(native.text);
  expect(Math.abs(line.baseline*.75-native.baseline)).toBeLessThan(.2);
  for(const f of line.fragments){expect(f.legacyKerning).toBe(!enabled);expect(f.advanceError).toBeLessThan(.02);}
  const glyphs=line.fragments.flatMap(f=>f.glyphs||[]);
  expect(shared.pages[line.page][i].glyphs).toEqual(glyphs);
  expect(shared.pages[line.page][i].baseline).toBe(line.baseline*.75);
  expect(glyphs).toHaveLength(native.glyphs.length);
  for(const [j,x] of glyphs.entries())expect(Math.abs(x-native.glyphs[j]),`${i}/${j}`).toBeLessThan(.2);
 }
});
