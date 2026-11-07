import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const folder='tests/fixtures/nested-shape-tables', source=folder+'/control.docx';
const reference=JSON.parse(readFileSync(folder+'/reference.json'));
test('matches native nested table origins and widths in paired body and text-box stories', async ({page}) => {
  test.setTimeout(120000);
  for(const [name,hash] of Object.entries(reference.hashes)) expect(createHash('sha256').update(readFileSync(folder+'/'+name)).digest('hex')).toBe(hash);
  await page.goto('/playground.html');
  const result=await page.evaluate(async bytes=>{
    const {DocxPackage}=await import('/src/engine/docx.js');
    const {validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js');
    const {checkFontAvailability,fontAvailable}=await import('/src/engine/font-availability.js');
    const {layoutDocument}=await import('/src/engine/layout.js');
    const {layoutShapeText}=await import('/src/engine/shape-text-layout.js');
    const {pageGeometry}=await import('/src/engine/page-settings.js');
    await checkFontAvailability('Arial'); if(!fontAvailable('Arial')) return {missingFont:true};
    const pkg=await DocxPackage.open(new Uint8Array(bytes)); await validateCanvasLayout(pkg);
    const context=new OffscreenCanvas(1,1).getContext('2d'), measure=(t,s)=>measureCanvasText(context,t,s);
    const layout=layoutDocument(pkg.paragraphs,measure,pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
    const lines=[];
    const add=(row,page,x=0,y=0)=>{
      const fs=row.fragments.filter(f=>!f.image), text=fs.map(f=>f.text).join('').trim();
      if(/^[BS] (?:outer|A|B)$/.test(text)) lines.push({page,text,x:(x+fs[0].x)*.75,y:(y+row.baseline)*.75});
    };
    for(const row of layout.lines) {
      add(row,row.page);
      for(const f of row.fragments) if(f.image) {
        const a=pkg.assets[f.image.assetId], node=a.scene;
        const text=layoutShapeText(node,measure,{x:a.width*9525/node.width,y:a.height*9525/node.height});
        for(const inner of text.layout.lines) add(inner,row.page,f.x+text.left,row.baseline-f.ascent+text.top+text.shift);
      }
    }
    return {lines,pages:layout.pageCount};
  }, [...readFileSync(source)]);
  test.skip(result.missingFont,'Native reference coordinates require installed Arial.');
  expect(result.pages).toBe(16); expect(result.lines).toHaveLength(96);
  for(const native of reference.lines) {
    const actual=result.lines.find(l=>l.page===native.page&&l.text===native.text);
    expect(actual).toBeTruthy(); expect(Math.abs(actual.x-native.x),`${native.page+1} ${native.text} X`).toBeLessThan(.2);
    expect(Math.abs(actual.y-native.y),`${native.page+1} ${native.text} Y`).toBeLessThan(.3);
  }
});
test('keeps nested drawing tables and body tables intact through editing and reopening', async ({page},info)=>{
  test.setTimeout(120000);
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'}); await expect(input).toHaveValue(/^Nested table control/); await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(16);
  const original=await input.inputValue(), parts=unzipSync(readFileSync(source));
  const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const edited=await save('edited'), out=unzipSync(readFileSync(edited));expectBodyEditParts(out, parts);
  await input.press('ControlOrMeta+z'); expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,'Edited '+original); await expect(page.locator('canvas.canvas-page')).toHaveCount(16); await expect(page.locator('#playground-error')).toBeEmpty();
});
