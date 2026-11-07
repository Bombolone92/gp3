import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
const root = 'tests/fixtures/paragraph-frames/';
for (const name of ['page', 'margin', 'style', 'grouped', 'different', 'around', 'not-beside', 'text-anchor', 'inline', 'auto-width', 'zero-width', 'aligned', 'aligned-relative']) test(`framePr placement is not normal paragraph flow: ${name}`, async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto('/playground.html');
  const source = readFileSync(root + name + '.docx');
  await page.getByLabel('Open DOCX file').setInputFiles(root + name + '.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Healthy before/); await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const output = info.outputPath('noedit.docx'); await (await pending).saveAs(output);
  expect(unzipSync(readFileSync(output))).toEqual(unzipSync(source));
  const geometry = await page.evaluate(async data => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js'), { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { pkg, images } = await openCanvasDocument(new Uint8Array(data)), host = document.createElement('div'); document.body.append(host);
    const editor = new CanvasEditor(host, { ...pkg, images });
    try { return {frames:editor.layout.paragraphFrames, lines:editor.layout.lines.map(l => ({ text: l.fragments.map(f => f.text).join(''), page: l.page, x: l.fragments[0]?.x * .75, y: (l.y+(l.wrapBefore||0)) * .75 }))}; }
    finally { editor.destroy(); host.remove(); }
  }, [...source]);
  writeFileSync(info.outputPath('geometry.json'), JSON.stringify(geometry, null, 2));
  await page.screenshot({ path: info.outputPath('baseline.png'), fullPage: true });
  const target = geometry.lines.find(l => l.text === 'Framed first line'); expect(target).toBeDefined();
  expect(target.x).toBeCloseTo(name === 'margin' ? 216 : name === 'aligned-relative' ? 234 : 144, 0);
  expect(geometry.frames).toHaveLength(name === 'different' ? 2 : 1);
  if (name === 'grouped') expect(geometry.lines.find(l=>l.text==='Framed second line').y).toBeGreaterThan(target.y);
  if (['around','not-beside','text-anchor','inline','auto-width','zero-width','aligned','aligned-relative'].includes(name)) {
    const native=JSON.parse(readFileSync(root+name+'-native.json','utf8').replace(/^\uFEFF/,''));
    for(const item of native.paragraphs.slice(0,3)) {
      const line=geometry.lines.find(l=>l.text===item.text.trim()); expect(line).toBeDefined();
      expect(Math.abs(line.x-item.x)).toBeLessThan(.5); expect(Math.abs(line.y-item.y)).toBeLessThan(1);
    }
  }
  await page.locator('canvas.canvas-page').evaluate((canvas,y)=>{
    let host=canvas.parentElement;
    while(host&&!['auto','scroll'].includes(getComputedStyle(host).overflowY))host=host.parentElement;
    if(host)host.scrollTop=Math.max(0,y-host.clientHeight/2);
  },target.y/.75);
  const canvas=await page.locator('canvas.canvas-page').boundingBox();
  await page.mouse.click(canvas.x+target.x/ .75+8,canvas.y+target.y/.75+8);
  const selection=await input.evaluate(e=>e.selectionStart);
  expect(selection).toBeGreaterThanOrEqual((await input.inputValue()).indexOf('Framed first line'));
  expect(selection).toBeLessThan((await input.inputValue()).indexOf('Healthy after'));
  const original=await input.inputValue(); await page.keyboard.insertText('Edited '); expect(await input.inputValue()).not.toBe(original);
  const editPending=page.waitForEvent('download'); await page.getByRole('button',{name:'Download .docx',exact:true}).click(); await(await editPending).saveAs(info.outputPath('edited.docx'));
  await input.press('ControlOrMeta+z'); expect(await input.inputValue()).toBe(original);
  await page.screenshot({path:info.outputPath('frame-editing.png'),fullPage:true});
});
