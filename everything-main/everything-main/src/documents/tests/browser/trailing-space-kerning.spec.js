import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
const sameParts = (actual, expected, except = []) => {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [name, bytes] of Object.entries(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(bytes)), name).toBe(true);
};
for (const folder of ['trailing-space-kerning', 'native-fit-boundary']) {
const root = `tests/fixtures/${folder}/`;
const ref = JSON.parse(readFileSync(root + 'reference.json'));
test(`matches native following-space boundaries with editing and undo: ${folder}`, async ({page}, info) => {
  for (const [name, hash] of Object.entries(ref.sha256)) expect(createHash('sha256').update(readFileSync(root + name)).digest('hex'), name).toBe(hash);
  const errors=[];page.on('pageerror', e=>errors.push(e.message));
  await page.goto('/playground.html');
  const fonts = folder === 'native-fit-boundary' ? ['Arial'] : ['Arial', 'Courier New', 'Times New Roman', 'Calibri'];
  const nativeFonts = await page.evaluate(async fonts => {
    const { checkFontAvailability, fontAvailable } = await import('/src/engine/font-availability.js');
    await Promise.all(fonts.map(checkFontAvailability));return fonts.every(fontAvailable);
  }, fonts);
  test.skip(!nativeFonts, 'Native reference metrics require the original installed fonts; no font binaries are redistributed.');
  await page.getByLabel('Open DOCX file').setInputFiles(root+'control.docx');
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Case 1:/);await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
  const check=async bytes=>{
    const rows=await page.evaluate(async bytes=>{
      const {DocxPackage}=await import('/src/engine/docx.js');
      const {layoutDocument}=await import('/src/engine/layout.js');
      const {pageGeometry}=await import('/src/engine/page-settings.js');
      const {validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js');
      const p=await DocxPackage.open(new Uint8Array(bytes));await validateCanvasLayout(p);
      const ctx=document.createElement('canvas').getContext('2d');
      const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
      return p.tables.map(t=>{const id=t.rows[0].cells[0].id;return {widthTwips:l.cells.find(c=>c.id===id).width*15,lines:l.lines.filter(x=>x.cellId===id).map(x=>x.fragments.map(f=>f.text).join('').replace(/\s/g,''))};});
    },[...bytes]);
    expect(rows).toHaveLength(ref.rows.length);
    for(const [i,row] of rows.entries()) {expect(row.lines,`case ${i+1}`).toEqual(ref.rows[i].lines.map(t=>t.replace(/\s/g,'')));expect(row.widthTwips,`case ${i+1} width`).toBeCloseTo(ref.rows[i].widthTwips,0);}
  };
  const source=readFileSync(root+'control.docx'),parts=unzipSync(source),text=await input.inputValue();await check(source);
  const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await event).saveAs(path);return {path,bytes:readFileSync(path)};};
  sameParts(unzipSync((await save('noedit')).bytes),parts);
  await input.focus();await input.evaluate(e=>{e.setSelectionRange(0,0);e.dispatchEvent(new Event('select',{bubbles:true}));});await page.keyboard.insertText('Edited ');
  const edited=await save('edited');sameParts(unzipSync(edited.bytes),parts,['word/document.xml']);await check(edited.bytes);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);sameParts(unzipSync((await save('undo')).bytes),parts);
  page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited.path);await expect(input).toHaveValue('Edited '+text);await expect(input).toHaveJSProperty('readOnly',false);expect(errors).toEqual([]);
});
}
