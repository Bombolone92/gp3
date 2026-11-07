import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
test('matches native zero-margin noWrap widths and preserves editing', async ({page},info) => {
  const source='tests/fixtures/nowrap-edge-allowance/control.docx';
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'}), canvases=page.locator('canvas.canvas-page');
  await expect(input).toHaveValue(/^Two-column 1/); await expect(input).toBeEditable(); await expect(canvases).toHaveCount(24);
  const native=JSON.parse(readFileSync('tests/fixtures/nowrap-edge-allowance/native-widths.json','utf8').replace(/^\uFEFF/,''));
  const actual=await page.evaluate(async bytes=>{
    const {DocxPackage}=await import('/src/engine/docx.js');
    const {layoutDocument}=await import('/src/engine/layout.js');
    const {pageGeometry}=await import('/src/engine/page-settings.js');
    const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
    const d=await DocxPackage.open(Uint8Array.from(bytes));await loadCanvasFonts(d);
    const ctx=document.createElement('canvas').getContext('2d');
    const layout=layoutDocument(d.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(d.pageSettings),d.numbering,d.tables);
    return d.tables.map(t=>t.rows[0].cells.map(c=>layout.cells.find(p=>p.id===c.id).width*15));
  },[...readFileSync(source)]);
  expect(actual).toHaveLength(native.widthsBeforePdf.length);
  actual.forEach((row,i)=>row.forEach((width,j)=>{
    expect(Math.abs(width-Math.round(native.widthsBeforePdf[i][j]*20))).toBeLessThanOrEqual(.000001);
  }));
  const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
  const original=await input.inputValue(),parts=unzipSync(readFileSync(source)); expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');
  const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
  for(const [name,bytes] of Object.entries(parts))if(name!=='word/document.xml')expect(changed[name]).toEqual(bytes);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,'EDIT '+original);await expect(page.locator('#playground-error')).toBeEmpty();
  expect(actual.map(row=>row.map(Math.round))).toEqual(native.widthsBeforePdf.map(row=>row.map(width=>Math.round(width*20))));
});
