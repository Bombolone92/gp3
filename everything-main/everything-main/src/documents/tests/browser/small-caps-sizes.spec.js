import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const ref = JSON.parse(readFileSync('tests/fixtures/small-caps-sizes/reference.json', 'utf8'));
test('paints native small-cap sizes and preserves editing, source text and exact undo', async ({ page }, info) => {
  await page.addInitScript(() => {
    window.smallCapsPaint = {}; const current = new WeakMap(), paint = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text,x,y,...args) {
      if (this.canvas.classList.contains('canvas-page')) {
        if (/^K\d{3}\s*$/.test(text)) { const id = text.trim(); current.set(this.canvas,id); window.smallCapsPaint[id] = []; }
        else if (current.has(this.canvas)) { const size = Number(/([\d.]+)px/.exec(this.font)[1]) * .75; window.smallCapsPaint[current.get(this.canvas)].push(...[...text].map(c => [c,size])); }
      }
      return paint.call(this,text,x,y,...args);
    };
  });
  const path = 'public/fixtures/small-caps-sizes.docx', bytes = readFileSync(path);
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(path);
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^K001 AaBbéΣσЖж9/); await expect(input).toBeEditable();
  const original = await input.inputValue(); await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
  const painted = await page.evaluate(() => window.smallCapsPaint);
  expect(Object.keys(painted)).toHaveLength(ref.cases.length);
  for (const row of ref.cases) {
    expect(painted[row.id].map(g => g[0]), row.id).toEqual(row.glyphs.map(g => g[0]));
    row.glyphs.forEach(([,size],i) => expect(Math.abs(painted[row.id][i][1] - size), `${row.id} glyph ${i}`).toBeLessThan(.061));
  }
  const download = async name => { const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const file = info.outputPath('small-caps-sizes-'+name+'.docx'); await (await pending).saveAs(file); return file; };
  const parts = unzipSync(bytes), unchanged = (file, except=[]) => { const out = unzipSync(readFileSync(file)); expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort()); for (const [n,b] of Object.entries(parts)) if (!except.includes(n)) expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true); };
  unchanged(await download('original'));
  await input.evaluate(el => { el.focus(); const at=el.value.indexOf('AaBbé'); el.setSelectionRange(at+1,at+2); el.dispatchEvent(new Event('select',{bubbles:true})); });
  await page.keyboard.insertText('z'); const edited=await input.inputValue(),saved=await download('edited'); unchanged(saved,['word/document.xml']);
  await page.getByRole('button',{name:'Undo',exact:true}).click(); await expect(input).toHaveValue(original); unchanged(await download('undo'));
  await reopenDocx(page,input,saved,edited);
});
