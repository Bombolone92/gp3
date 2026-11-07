import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root='tests/fixtures/shadow-raster-sampling/';
const ref=JSON.parse(readFileSync(root+'reference.json','utf8'));
async function samples(page){
  expect(createHash('sha256').update(readFileSync(root+'source.docx')).digest('hex')).toBe(ref.hashes['source.docx']);
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+'source.docx');
  await page.waitForFunction(()=>document.querySelectorAll('canvas.canvas-page').length===20);
  await expect(page.getByRole('textbox',{name:'Document text'})).toHaveValue(/^square-36-blur-18/);
  await expect(page.getByRole('textbox',{name:'Document text'})).toBeEditable();
  await expect(page.locator('canvas.canvas-page')).toHaveCount(20);
  return page.locator('canvas.canvas-page').evaluateAll((cs,refs)=>refs.map(r=>{
    const c=cs[r.page-1],scale=c.width/612;
    return [...c.getContext('2d').getImageData(Math.round(r.pdfPointPt[0]*scale),Math.round(r.pdfPointPt[1]*scale),1,1).data].slice(0,3);
  }),ref.metafileComparisons);
}
test('opaque and nonwhite translucent shadows agree with native metafile colors',async({page})=>{
  const actual=await samples(page);
  expect(ref.metafileComparisons).toHaveLength(8);
  for(let i=0;i<8;i++)if(i!==3)expect(actual[i]).toEqual(ref.metafileComparisons[i].gdiRgb);
  expect(actual[1]).not.toEqual(ref.metafileComparisons[1].pdfRgb);
});
test('partial-opacity white shadow matches the native metafile composite',async({page})=>{
  const actual=await samples(page);
  test.fail(true,'A one-level white-shadow difference remains: native GDI+ 254, browser 255; PDF 253 is a separate reference.');
  expect(actual[3]).toEqual(ref.metafileComparisons[3].gdiRgb);
});
