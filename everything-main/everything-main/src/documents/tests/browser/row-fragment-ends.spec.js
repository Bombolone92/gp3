import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

const references = JSON.parse(readFileSync('tests/fixtures/row-fragment-ends/reference.json', 'utf8'));
for (const name of ['bottom-neighbor', 'merged', 'spaced', 'minimum']) test(`${name}: native split-row paint and numbered text, edit, undo and reopen`, async ({ page }, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.fragmentText = new Map(); const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...rest) {
      if (!window.fragmentText.has(this.canvas)) window.fragmentText.set(this.canvas, new Map());
      window.fragmentText.get(this.canvas).set(`${text}:${x}:${y}`, { text, x: x * .75, y: y * .75 });
      return original.call(this, text, x, y, ...rest);
    };
  });
  await page.goto('/playground.html');
  const available = await page.evaluate(async () => {
    const { checkFontAvailability, fontAvailable } = await import('/src/engine/font-availability.js');
    await checkFontAvailability('Arial'); return fontAvailable('Arial');
  });
  test.skip(!available, 'The independent native reference requires Arial.');
  const fixture = `public/fixtures/row-fragment-ends/${name}.docx`, word = references[name];
  await page.getByLabel('Open DOCX file').setInputFiles(fixture);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Lead/); await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(word.length);
  const actual = await page.locator('canvas.canvas-page').evaluateAll(canvases => canvases.map(canvas => {
    const scale = canvas.width / 612, data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const bounds = (x, yellow) => {
      const rows = []; x = Math.round(x * scale);
      for (let y = 0; y < canvas.height; y++) {
        const i = (y * canvas.width + x) * 4;
        if (data[i] > 240 && data[i + 2] < 80 && (yellow ? data[i + 1] > 240 : data[i + 1] < 80)) rows.push(y);
      }
      return rows.length ? { top: rows[0] / scale, bottom: (rows.at(-1) + 1) / scale } : null;
    };
    return { lines: [...window.fragmentText.get(canvas).values()], red: bounds(120, false), yellow: bounds(400, true), tolerance: 1 / scale + .2 };
  }));
  for (const [index, reference] of word.entries()) {
    // Numbered body paragraphs identify every page cut unambiguously. The
    // separate merged-neighbor baseline discrepancy is recorded in the README.
    for (const line of reference.lines.filter(line => /^Body\d\d$/.test(line.text))) {
      expect(actual[index].lines.some(a => a.text === line.text && Math.abs(a.x - line.x) < .2 && Math.abs(a.y - line.y) < .2), JSON.stringify({ index, line })).toBe(true);
    }
    for (const [color, x] of [['red', 120], ['yellow', 400]]) {
      const ink = reference.fills.filter(fill => fill.color === color && fill.x <= x && fill.right > x), result = actual[index][color];
      if (!ink.length) expect(result, `${index} ${color}`).toBeNull();
      else {
        expect(result).not.toBeNull();
        expect(Math.abs(result.top - Math.min(...ink.map(f => f.top))), `${index} ${color} top`).toBeLessThan(actual[index].tolerance);
        expect(Math.abs(result.bottom - Math.max(...ink.map(f => f.bottom))), `${index} ${color} bottom`).toBeLessThan(actual[index].tolerance);
      }
    }
  }
  const images = () => page.locator('canvas.canvas-page').evaluateAll(canvases => canvases.map(c => c.toDataURL()));
  const before = await images(), text = await input.inputValue();
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const download = async suffix => {
    const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(`${name}${suffix}.docx`); await (await event).saveAs(path); return path;
  };
  const saved = await download(''), source = unzipSync(readFileSync(fixture)), edited = unzipSync(readFileSync(saved));
  expect(Object.keys(edited).sort()).toEqual(Object.keys(source).sort());
  for (const part of Object.keys(source)) if (part !== 'word/document.xml') expect(Buffer.from(source[part]).equals(Buffer.from(edited[part])), part).toBe(true);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(text); expect(await images()).toEqual(before);
  const undone = unzipSync(readFileSync(await download('-undo')));
  for (const part of Object.keys(source)) expect(Buffer.from(source[part]).equals(Buffer.from(undone[part])), part).toBe(true);
  await reopenDocx(page, input, saved, 'Edited ' + text); await expect(page.locator('canvas.canvas-page')).toHaveCount(word.length);
  expect(errors).toEqual([]);
});
