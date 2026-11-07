import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const reference = JSON.parse(readFileSync('tests/fixtures/rotated-group-lines/reference.json', 'utf8'));
test('paints reference-directed rotated line geometry, physical pens and dashes; edits and reopens', async ({ page }, info) => {
  await page.goto('/playground.html');
  const strokes = await page.evaluate(async () => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { decodeShape } = await import('/src/engine/canvas-shapes.js');
    const pkg = await DocxPackage.open(new Uint8Array(await (await fetch('/fixtures/rotated-group-lines.docx')).arrayBuffer()));
    const proto = OffscreenCanvasRenderingContext2D.prototype, originals = {}, strokes = [];
    let points = [];
    for (const name of ['beginPath', 'moveTo', 'lineTo', 'stroke']) {
      originals[name] = proto[name];
      proto[name] = function (...args) {
        if (name === 'beginPath') points = [];
        if (name === 'moveTo' || name === 'lineTo') { const m = this.getTransform(); points.push([(m.a * args[0] + m.c * args[1] + m.e) / 2, (m.b * args[0] + m.d * args[1] + m.f) / 2]); }
        if (name === 'stroke') strokes.push({ points: [...points], width: this.lineWidth, dash: this.getLineDash() });
        return originals[name].apply(this, args);
      };
    }
    try {
      const decoded = await decodeShape(Object.values(pkg.assets)[0], new Map());
      for (const s of strokes) s.points = s.points.map(([x, y]) => [(x + decoded.left) * .75, (y + decoded.top) * .75]);
      decoded.close();
    } finally { for (const name of Object.keys(originals)) proto[name] = originals[name]; }
    return strokes;
  });
  expect(strokes).toHaveLength(reference.cases.length);
  reference.cases.forEach((c, i) => {
    c.points.forEach((p, j) => p.forEach((v, k) => expect(Math.abs(strokes[i].points[j][k] - v), c.name).toBeLessThan(.015)));
    expect(strokes[i].width * .75).toBeCloseTo(2);
    expect(strokes[i].dash).toHaveLength(4);
    [8, 6, 2, 6].forEach((v, j) => expect(strokes[i].dash[j] * .75).toBeCloseTo(v, 5));
  });
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/rotated-group-lines.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Rotated line probes/); await expect(input).toHaveJSProperty('readOnly', false);
  const check = async () => {
    await expect(page.locator('#playground-error')).toBeEmpty();
    await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
    await expect.poll(() => page.locator('canvas.canvas-page').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let i = 0; i < pixels.length; i += 4) if (Math.max(...pixels.slice(i, i + 3)) - Math.min(...pixels.slice(i, i + 3)) > 30) colored++;
      return colored;
    })).toBeGreaterThan(1000);
  };
  await check(); const original = await input.inputValue();
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited '); await check();
  const save = async suffix => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(`rotated-lines-${suffix}.docx`); await (await pending).saveAs(path); return path;
  };
  const edited = await save('edited'); await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original); await check();
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(unzipSync(readFileSync('public/fixtures/rotated-group-lines.docx')));
  await reopenDocx(page, input, edited, 'Edited ' + original); await check();
  writeFileSync(info.outputPath('rotated-lines.png'), Buffer.from(await page.locator('canvas.canvas-page').evaluate(canvas => canvas.toDataURL().split(',')[1]), 'base64'));
});
