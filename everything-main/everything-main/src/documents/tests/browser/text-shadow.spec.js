import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder = 'tests/fixtures/text-shadow-line-metrics';
const reference = JSON.parse(readFileSync(`${folder}/matrix-paint-reference.json`));
const native = JSON.parse(readFileSync(`${folder}/reference.json`));

test('paints native text shadows and retains them through editing, undo and export', async ({ page }, info) => {
  test.setTimeout(180000);
  for (const name of ['matrix.docx', 'matrix-native.pdf']) expect(createHash('sha256').update(readFileSync(`${folder}/${name}`)).digest('hex')).toBe(native.hashes[name]);
  const parts = unzipSync(readFileSync(`${folder}/matrix.docx`)), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/playground.html');
  const referenceFontInstalled = await page.evaluate(async () => {
    const { checkFontAvailability, fontAvailable } = await import('/src/engine/font-availability.js');
    await checkFontAvailability('Rockwell'); return fontAvailable('Rockwell');
  });
  test.skip(!referenceFontInstalled, 'The native reference paint oracle requires installed Rockwell; proprietary fonts are not redistributed.');
  await page.getByLabel('Open DOCX file').setInputFiles(`${folder}/matrix.docx`);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Sample line/); await expect(input).toHaveJSProperty('readOnly', false);
  const check = async () => {
    await expect(page.locator('canvas.canvas-page')).toHaveCount(21);
    const differences = await page.locator('canvas.canvas-page').evaluateAll((canvases, ref) => canvases.flatMap((canvas, index) => {
      const ctx = canvas.getContext('2d'), scale = canvas.width / 816;
      return ref.pages[index].flatMap(([x, y]) => {
        const rgb = [...ctx.getImageData(Math.floor((x + .5) * scale), Math.floor((y + .5) * scale), 1, 1).data].slice(0, 3);
        return rgb.some((value, channel) => Math.abs(value - ref.color[channel]) > ref.tolerance) ? [{ page: index + 1, x, y, rgb }] : [];
      });
    }), reference);
    writeFileSync(info.outputPath('paint-differences.json'), JSON.stringify(differences));
    expect(reference.pages.flat().length).toBe(128);
    expect(differences).toEqual([]);
    await expect(page.locator('#playground-error')).toBeEmpty();
  };
  await check();
  const save = async name => {
    const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(name + '.docx'); await (await event).saveAs(path); return path;
  };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  const original = await input.inputValue(); await input.focus(); await input.press('ControlOrMeta+Home');
  await page.keyboard.insertText('Edited '); await expect(input).toHaveValue('Edited ' + original);
  const edited = await save('edited'), output = unzipSync(readFileSync(edited));
  for (const name in parts) if (name !== 'word/document.xml') expect(output[name], name).toEqual(parts[name]);
  await check(); await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page, input, edited, 'Edited ' + original); await expect(input).toHaveValue('Edited ' + original); await check();
  expect(errors).toEqual([]);
});

test('casts a mixed-run shadow beyond its source color window without changing shaping', async ({ page }) => {
  await page.goto('/playground.html');
  const result = await page.evaluate(async () => {
    const { paintTextShadows } = await import('/src/engine/canvas-paint-text.js');
    const { setCanvasTextStyle, measureCanvasText, loadCanvasFonts } = await import('/src/engine/canvas-text.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { TextDocument, paragraph } = await import('/src/engine/model.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    await loadCanvasFonts(); const d = new TextDocument([paragraph('AVAV')]);
    d.select(0, 4); d.setRunFormat({ fontAscii: 'Arial', fontSize: 36, kerning: 14 });
    const canvas = document.createElement('canvas'); canvas.width = 816; canvas.height = 300; const ctx = canvas.getContext('2d');
    const layout = () => layoutDocument(d.paragraphs, (text, style) => measureCanvasText(ctx, text, style), pageGeometry(d.pageSettings));
    const before = layout();
    d.select(1, 2); d.setRunFormat({ textShadow: { distance: 152400, direction: 0, scaleX: 1, scaleY: 1, alignment: 'ctr', color: 'FF0000' } });
    const after = layout(), line = after.lines[0], fragment = line.fragments[0];
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 816, 300); setCanvasTextStyle(ctx, fragment); paintTextShadows(ctx, fragment, line.baseline);
    const span = fragment.colors.find(s => s.textShadow), boundary = Math.ceil(fragment.x + span.x + span.width);
    const data = ctx.getImageData(boundary, 0, 40, 300).data; let red = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] < 100 && data[i + 2] < 100) red++;
    return { red, before: before.lines[0].stops, after: line.stops, fragments: line.fragments.length };
  });
  expect(result.fragments).toBe(1); expect(result.after).toEqual(result.before); expect(result.red).toBeGreaterThan(10);
});
