import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const source = 'public/fixtures/retained-story-controls.docx';
const reference = JSON.parse(readFileSync('tests/fixtures/retained-story-controls/reference.json', 'utf8'));

test('retains locked story controls while rendering native page fields and editing the body', async ({ page }, info) => {
  test.setTimeout(90000);
  expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
  await page.addInitScript(() => {
    window.storyPaint = []; const paint = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...args) {
      window.storyPaint.push({ text, x, y, color: this.fillStyle, canvas: this.canvas });
      return paint.call(this, text, x, y, ...args);
    };
  });
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue('First body page.\nSecond body page.'); await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
  const printed = () => page.evaluate(() => [...document.querySelectorAll('canvas.canvas-page')].map(canvas => {
    const positions = new Map(); for (const p of window.storyPaint) if (p.canvas === canvas) positions.set(`${p.x},${p.y}`, p);
    const lines = [];
    for (const p of [...positions.values()].sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (!lines.length || Math.abs(lines.at(-1).y - p.y) > .5) lines.push({ text: '', x: p.x * .75, y: p.y, colors: [] });
      lines.at(-1).text += p.text; lines.at(-1).colors.push(p.color);
    }
    return lines;
  }));
  await expect.poll(async () => (await printed()).map(lines => lines.map(l => l.text.trimEnd()))).toEqual(reference.pages.map(lines => lines.map(l => l.text)));
  for (const [i, lines] of (await printed()).entries()) for (const [j, line] of lines.entries()) {
    expect(Math.abs(line.x - reference.pages[i][j].x)).toBeLessThan(.2);
    expect(line.colors).not.toContain('#ff0000');
  }
  const original = await input.inputValue(), parts = unzipSync(readFileSync(source));
  const save = async name => { const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const path = info.outputPath(name + '.docx'); await (await pending).saveAs(path); return path; };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  const prefix = 'Added paragraph words '.repeat(100);
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText(prefix);
  await expect.poll(() => page.locator('canvas.canvas-page').count()).toBeGreaterThan(2);
  const edited = await save('edited'), changed = unzipSync(readFileSync(edited));
  for (const name of Object.keys(parts)) if (name !== 'word/document.xml') expect(changed[name], name).toEqual(parts[name]);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page, input, edited, prefix + original);
  await expect.poll(() => page.locator('canvas.canvas-page').count()).toBeGreaterThan(2);
  await expect(page.locator('#playground-error')).toBeEmpty();
});
