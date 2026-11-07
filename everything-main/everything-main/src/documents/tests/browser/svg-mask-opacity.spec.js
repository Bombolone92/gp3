import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

for (const fixture of ['svg-mask-opacity', 'svg-mask-opacity-expanded', 'svg-mask-luminance-coefficients']) {
  test(`${fixture}: follows native mask luminance and preserves authored alpha mode`, async ({ page }, info) => {
    const folder = `tests/fixtures/${fixture}/`, source = `public/fixtures/${fixture}.docx`;
    const bytes = readFileSync(source), parts = unzipSync(bytes), reference = JSON.parse(readFileSync(folder + 'metafile-reference.json'));
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    expect(hash(bytes)).toBe(reference.sourceSha256);
    expect(hash(readFileSync(folder + 'native.emf'))).toBe(reference.nativeSha256);
    for (const im of reference.images) expect(hash(readFileSync(folder + im.path))).toBe(im.sha256);
    await page.goto('/playground.html');
    const samples = await page.evaluate(async xml => {
      const { decodeSvg } = await import('/src/engine/svg-images.js');
      const before = document.body.children.length, image = await decodeSvg(new TextEncoder().encode(xml));
      const c = document.createElement('canvas'); c.width = 120; c.height = 80;
      const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0); image.close();
      return { clean: before === document.body.children.length, colors: Array.from({ length: 6 }, (_, i) => [...ctx.getImageData(10 + i * 20, 40, 1, 1).data]) };
    }, new TextDecoder().decode(parts['word/media/vector.svg']));
    expect(samples.clean).toBe(true);
    for (const [i, actual] of samples.colors.entries()) {
      if (fixture === 'svg-mask-luminance-coefficients') continue;
      // Independently discovered color/opacity quantization gap. Kept as an
      // explicit native fidelity failure below, not hidden by a tolerance.
      if (fixture === 'svg-mask-opacity' && i === 5) continue;
      const ref = reference.images[i], native = ref.middleColumn[Math.floor(ref.size[1] / 2)];
      expect(actual[3], `mask ${i + 1} alpha`).toBe(native[3]);
      for (let c = 0; c < 3; c++) expect(Math.abs(actual[c] * actual[3] / 255 - native[c] * native[3] / 255)).toBeLessThanOrEqual(1);
    }
    await page.getByLabel('Open DOCX file').setInputFiles(source);
    const input = page.getByRole('textbox', { name: 'Document text' });
    await expect(input).toHaveValue(/^SVG vector pictures/); await expect(input).toHaveJSProperty('readOnly', false);
    await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
    const original = await input.inputValue();
    const save = async name => { const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const path = info.outputPath(name + '.docx'); await (await event).saveAs(path); return path; };
    expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
    await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
    const edited = await save('edited'), changed = unzipSync(readFileSync(edited));
    expectBodyEditParts(changed, parts);
    await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
    expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
    await reopenDocx(page, input, edited, 'Edited ' + original);
    await expect(input).toHaveJSProperty('readOnly', false);
    if (fixture === 'svg-mask-luminance-coefficients') {
      // Keep provenance and editing failures outside this known rendering gap.
      test.fail(true, 'Browser luminance coefficients differ from six discriminating native mask controls.');
      expect(samples.colors.map(c => c[3])).toEqual(reference.images.map(im => im.middleColumn[Math.floor(im.size[1] / 2)][3]));
    }
  });
}

test('half-transparent blue mask matches native luminance quantization', async ({ page }) => {
  const source = readFileSync('public/fixtures/svg-mask-opacity.docx');
  await page.goto('/playground.html');
  const alpha = await page.evaluate(async xml => {
    const { decodeSvg } = await import('/src/engine/svg-images.js');
    const im = await decodeSvg(new TextEncoder().encode(xml)), c = document.createElement('canvas');
    c.width = 120; c.height = 80; const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0); im.close();
    return ctx.getImageData(110, 40, 1, 1).data[3];
  }, new TextDecoder().decode(unzipSync(source)['word/media/vector.svg']));
  const ref = JSON.parse(readFileSync('tests/fixtures/svg-mask-opacity/metafile-reference.json')).images[5];
  test.fail(true, 'Existing combined mask color/opacity quantization: browser 45, native 44.');
  expect(alpha).toBe(ref.middleColumn[Math.floor(ref.size[1] / 2)][3]);
});
