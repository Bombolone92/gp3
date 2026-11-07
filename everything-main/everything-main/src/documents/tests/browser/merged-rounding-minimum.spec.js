import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
test('keeps merged content minima through grid rounding and editing', async ({page},info) => {
  const source='tests/fixtures/merged-rounding-minimum/control.docx';
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'}), canvases=page.locator('canvas.canvas-page');
  await expect(input).toHaveValue(/^Merged rounding 1/); await expect(input).toBeEditable(); await expect(canvases).toHaveCount(1);
  const native=JSON.parse(readFileSync('tests/fixtures/merged-rounding-minimum/native-widths.json','utf8').replace(/^\uFEFF/,''));
  const cases=JSON.parse(readFileSync('tests/fixtures/merged-rounding-minimum/cases.json','utf8'));
  const actual=await page.evaluate(async ({bytes,cases})=>{
    const {DocxPackage}=await import('/src/engine/docx.js');
    const {layoutDocument}=await import('/src/engine/layout.js');
    const {pageGeometry}=await import('/src/engine/page-settings.js');
    const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
    const d=await DocxPackage.open(Uint8Array.from(bytes));await loadCanvasFonts(d);
    const ctx=document.createElement('canvas').getContext('2d');
    const layout=layoutDocument(d.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(d.pageSettings),d.numbering,d.tables);
    return d.tables.map((t,i)=>({widths:t.rows[0].cells.map(c=>layout.cells.find(p=>p.id===c.id).width*15),merged:layout.cells.find(p=>p.id===t.rows[1].cells[cases[i].spanStart].id).width*15}));
  },{bytes:[...readFileSync(source)],cases});
  expect(actual).toHaveLength(native.widthsBeforePdf.length);
  actual.forEach((row,i)=>{
    expect(row.merged).toBeGreaterThanOrEqual(cases[i].imageWidthTwips+2-1e-6);
    expect(row.widths.reduce((a,b)=>a+b,0)).toBeCloseTo(1000,6);
    row.widths.forEach((width,j)=>expect(Math.abs(width/20-native.widthsBeforePdf[i][j])).toBeLessThan(.2));
  });
  const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
  const original=await input.inputValue(),parts=unzipSync(readFileSync(source)); expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');
  const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
  for(const [name,bytes] of Object.entries(parts))if(name!=='word/document.xml')expect(changed[name]).toEqual(bytes);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,'EDIT '+original);await expect(page.locator('#playground-error')).toBeEmpty();
});
