import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const refs = JSON.parse(readFileSync('tests/fixtures/joined-border-spacing/reference.json'));
async function download(page, info, name) {
  const event = page.waitForEvent('download'); await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const path = info.outputPath(name); await (await event).saveAs(path); return path;
}
for (const ref of refs) test('paints native joined-border spacing and preserves edits: ' + ref.file, async ({page},info) => {
  await page.addInitScript(() => {
    window.joinedPaint = {};
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text,x,y,...rest) {
      if(this.canvas.matches?.('canvas.canvas-page')) window.joinedPaint[text] = this.getTransform().transformPoint({x,y}).y / devicePixelRatio;
      return fill.call(this,text,x,y,...rest);
    };
  });
  const errors = []; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/' + ref.file);
  const input = page.getByRole('textbox',{name:'Document text'}); await expect(input).toHaveValue(/^BodyJoined/); await expect(input).toBeEditable();
  await expect(page.locator('canvas.canvas-page')).toHaveCount(8);
  for (const lines of ref.pages) {
    await expect.poll(() => page.evaluate(text => window.joinedPaint[text],lines.at(-1).text)).toBeTruthy();
    const paint = await page.evaluate(() => window.joinedPaint);
    for (const line of lines) expect(Math.abs((paint[line.text]-paint[lines[0].text])*.75-line.baseline+lines[0].baseline),line.text).toBeLessThan(.35);
  }
  const parts = unzipSync(readFileSync('public/fixtures/' + ref.file));
  expect(unzipSync(readFileSync(await download(page,info,'unchanged.docx')))).toEqual(parts);
  const text = await input.inputValue();
  await input.evaluate(el => { el.focus();el.setSelectionRange(0,0);el.dispatchEvent(new Event('select',{bubbles:true})); });
  await input.press('!'); await expect(input).toHaveValue('!'+text);
  const saved = await download(page,info,'edited.docx'), edited = unzipSync(readFileSync(saved));
  for (const [name,data] of Object.entries(parts)) if (name !== 'word/document.xml') expect(edited[name]).toEqual(data);
  await page.getByRole('button',{name:'Undo',exact:true}).click(); await expect(input).toHaveValue(text);
  expect(unzipSync(readFileSync(await download(page,info,'undo.docx')))).toEqual(parts);
  await reopenDocx(page,input,saved,'!'+text); expect(errors).toEqual([]);
});
