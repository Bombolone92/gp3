import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openReadOnlyPreview } from './helpers/preview.js';
const folder = 'tests/fixtures/page-border-recovery/';
test('a rejected border side retains all other rich page content and supported borders', async ({page}) => {
  test.setTimeout(240000);
  await page.goto('/playground.html', {waitUntil:'domcontentloaded'});
  const names = ['top','left','bottom','right','combined'];
  const inputs = Object.fromEntries(names.flatMap(n => [n,`${n}-omitted`]).map(n => [n,[...readFileSync(`${folder}${n}.docx`)]]));
  const results = await page.evaluate(async inputs => {
    const {openCanvasDocument} = await import('/src/engine/open-document.js');
    const {CanvasEditor} = await import('/src/engine/canvas-editor.js');
    const rendered = {};
    for (const [name,bytes] of Object.entries(inputs)) {
      const {pkg,images} = await openCanvasDocument(Uint8Array.from(bytes));
      const host = document.createElement('div');document.body.append(host);
      const editor = new CanvasEditor(host,{...pkg,images});
      rendered[name] = {readonly:!!pkg.readOnly, images:images.size, tables:pkg.tables.length,
        pixels:editor.canvases.map(c => c.toDataURL()),
        lines:editor.layout.lines.map(l => ({page:l.page,baseline:l.baseline,fragments:l.fragments.map(f => ({text:f.text,x:f.x,width:f.width}))}))};
      editor.destroy();host.remove();
    }
    return Object.keys(rendered).filter(n => !n.endsWith('-omitted')).map(n => ({name:n,
      readonly:rendered[n].readonly, controlEditable:!rendered[n+'-omitted'].readonly,
      images:rendered[n].images,tables:rendered[n].tables,pages:rendered[n].pixels.length,
      samePixels:JSON.stringify(rendered[n].pixels)===JSON.stringify(rendered[n+'-omitted'].pixels),
      sameLines:JSON.stringify(rendered[n].lines)===JSON.stringify(rendered[n+'-omitted'].lines)}));
  },inputs);
  for (const r of results) {
    expect(r.readonly,r.name).toBe(true);expect(r.controlEditable,r.name).toBe(true);
    expect(r.images,r.name).toBe(2);expect(r.tables,r.name).toBe(1);expect(r.pages,r.name).toBeGreaterThanOrEqual(2);
    expect(r.sameLines,r.name).toBe(true);expect(r.samePixels,r.name).toBe(true);
  }
});
test('border recovery reports each rejected side and downloads original bytes', async ({page},info) => {
  await page.goto('/playground.html',{waitUntil:'domcontentloaded'});
  await openReadOnlyPreview(page,`${folder}combined.docx`);
  await expect(page.getByRole('textbox',{name:'Document text'})).toHaveValue(/Retained table cell/);
  await page.getByText('Unsupported features detected (2)',{exact:true}).click();
  await expect(page.getByText(/page border top omitted from preview/i).first()).toBeVisible();
  await expect(page.getByText(/page border right omitted from preview/i).first()).toBeVisible();
  const canvases = page.locator('canvas.canvas-page');
  for(let i=0;i<await canvases.count();i++) await canvases.nth(i).screenshot({path:info.outputPath(`page-border-recovery-${i+1}.png`)});
});
