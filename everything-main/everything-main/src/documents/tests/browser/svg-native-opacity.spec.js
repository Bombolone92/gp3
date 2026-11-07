import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

for (const name of ['svg-fill-viewport', 'svg-opacity-values', 'svg-opacity-composition', 'svg-group-raster', 'svg-group-transforms', 'svg-group-composition', 'svg-group-composition-chains']) {
  test(`${name}: native vector opacity, preserved artwork, editing and undo`, async ({ page }, info) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/playground.html');
    await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/${name}.docx`);
    const input = page.getByRole('textbox', { name: 'Document text' });
    await expect(input).toHaveValue(/^SVG vector pictures/);
    const result = await page.evaluate(async name => {
      const { DocxPackage } = await import('/src/engine/docx.js');
      const { decodeSvg, svgInfo } = await import('/src/engine/svg-images.js');
      const { nativeSvgStrokes } = await import('/src/engine/svg-native-strokes.js');
      const p = await DocxPackage.open(new Uint8Array(await (await fetch(`/fixtures/${name}.docx`)).arrayBuffer()));
      const bytes = p.assets['word/media/vector.svg'].bytes;
      const xml = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'image/svg+xml');
      const original = new XMLSerializer().serializeToString(xml), childCount = document.body.children.length;
      const root = nativeSvgStrokes(xml.documentElement, svgInfo(bytes));
      const rects = [...root.querySelectorAll('rect')].map(n => ({ opacity: n.style.opacity, fill: n.style.fillOpacity,
        stroke: n.style.strokeOpacity, parent: n.parentElement.localName }));
      const image = await decodeSvg(bytes), canvas = document.createElement('canvas');
      canvas.width = 1200; canvas.height = name === 'svg-opacity-composition' ? 1000 : 800;
      const c = canvas.getContext('2d'); c.drawImage(image, 0, 0, canvas.width, canvas.height);
      const alpha = [];
      if (name === 'svg-opacity-values') for (let row = 0; row < 3; row++) for (let col = 0; col < 8; col++) {
        alpha.push(c.getImageData(col * 150 + 75, row * 200 + 100, 1, 1).data[3]);
      }
      image.close();
      return { rects, alpha, unchanged: original === new XMLSerializer().serializeToString(xml), clean: childCount === document.body.children.length };
    }, name);
    expect(result.unchanged).toBe(true); expect(result.clean).toBe(true);
    if (name === 'svg-opacity-values') {
      // Independently extracted PDF alpha bytes, not calculated by the runtime.
      expect(result.alpha).toEqual(Array(3).fill([0, 0, 25, 76, 127, 191, 254, 255]).flat());
      expect(result.rects[24].opacity).toBe(''); // Translucent group remains isolated.
      expect(Number(result.rects[25].fill)).toBeCloseTo(63 / 255, 6);
      expect(Number(result.rects[26].fill)).toBeCloseTo(127 / 255, 6); // Stylesheet cascade.
      expect(result.rects[27].opacity).toBe(''); // Nested object/group opacity.
    }
    if (name === 'svg-opacity-composition') {
      for (const [row, byte] of [206, 22, 63, 68].entries()) {
        expect(Number(result.rects[1 + row * 4].fill)).toBeCloseTo(byte / 255, 6);
        expect(Number(result.rects[4 + row * 4].fill)).toBeCloseTo(byte / 255, 6);
        expect(result.rects[2 + row * 4].opacity).toBe('');
      }
      expect(result.rects[17].opacity).toBe(''); // The native reference rasterizes fill + stroke.
      expect(result.rects[18].opacity).toBe('');
      expect(Number(result.rects[19].fill)).toBeCloseTo(206 / 255, 6); // RGBA color alpha.
      expect(Number(result.rects[20].fill)).toBeCloseTo(127 / 255, 6); // Inherited fill opacity.
    }
    const original = await input.inputValue();
    const download = async suffix => {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
      const path = info.outputPath(`${name}-${suffix}.docx`); await (await pending).saveAs(path); return path;
    };
    const before = unzipSync(readFileSync(`public/fixtures/${name}.docx`));
    const check = (path, edited) => {
      const after = unzipSync(readFileSync(path)); expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
      if (edited) expectBodyEditParts(after, before); else for (const part of Object.keys(before)) expect(Buffer.from(after[part]).equals(Buffer.from(before[part])), part).toBe(true);
    };
    check(await download('noedit'), false);
    await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
    await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
    check(await download('undo'), false);
    await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
    const saved = await download('edited'); check(saved, true);
    await reopenDocx(page, input, saved, 'Edited ' + original); expect(errors).toEqual([]);
  });
}

test('retains gradient paint and opaque shapes without freezing their declarations', async ({ page }) => {
  await page.goto('/playground.html');
  const styles = await page.evaluate(async () => {
    const { nativeSvgStrokes } = await import('/src/engine/svg-native-strokes.js');
    const xml = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><defs><linearGradient id="g"><stop stop-color="red"/></linearGradient></defs><rect width="50" height="50" fill="url(#g)" opacity=".5"/><rect x="50" width="50" height="50" fill="red"/></svg>', 'image/svg+xml');
    return [...nativeSvgStrokes(xml.documentElement, { width: 100, height: 100 }).querySelectorAll('rect')].map(n => n.getAttribute('style'));
  });
  expect(styles).toEqual([null, null]);
});
