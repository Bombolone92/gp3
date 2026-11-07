import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

const folder = 'tests/fixtures/cell-text-direction';
const reference = JSON.parse(readFileSync(`${folder}/pictures-reference.json`));
for (const control of reference.cases) test(`native upright pictures in rotated cells: ${control.name}`, async ({ page }, info) => {
  for (const [file, hash] of Object.entries(control.hashes)) expect(createHash('sha256').update(readFileSync(`${folder}/${file}`)).digest('hex')).toBe(hash);
  await page.goto('/playground.html');
  const result = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { decodeImages } = await import('/src/engine/images.js');
    const { imageAtPoint, selectionRects } = await import('/src/engine/layout.js');
    const { hyperlinkAtPoint } = await import('/src/engine/hyperlink-hit.js');
    const pkg = await DocxPackage.open(new Uint8Array(bytes), { bestEffort: true });
    await loadCanvasFonts(pkg); const context = document.createElement('canvas').getContext('2d');
    const layout = layoutDocument(pkg.paragraphs, (text, style) => measureCanvasText(context, text, style), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories, { bestEffort: true });
    const host = document.createElement('div'); document.body.append(host);
    const editor = new CanvasEditor(host, { ...pkg, images: await decodeImages(pkg.assets, pkg.styles.fontAlternatives) });
    const canvas = editor.canvases[0], scale = canvas.width / editor.layout.pages[0].width;
    const interactions = layout.lines.flatMap(line => line.fragments.filter(f => f.image).map(f => {
      const frame = f.uprightImage || { x: f.x, y: line.baseline - f.ascent, width: f.image.width / 9525, height: f.image.height / 9525 };
      const samples = [.25, .75].flatMap(dx => [.25, .75].map(dy => {
        const x = frame.x + frame.width * dx, y = frame.y + frame.height * dy;
        return { start: imageAtPoint(layout, 0, x, y)?.start, target: hyperlinkAtPoint(layout, pkg.paragraphs, 0, x, y)?.link.target,
          rgb: [...canvas.getContext('2d').getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data].slice(0, 3) };
      }));
      return { start: f.start, frame, samples, selected: selectionRects(layout, f.start, f.end),
        outside: imageAtPoint(layout, 0, frame.x + frame.width / 2, frame.y - 2)?.start ?? null };
    }));
    return { png: canvas.toDataURL().split(',')[1], interactions, readOnly: pkg.readOnly, pages: layout.pageCount, frames: layout.lines.flatMap(line => line.fragments.filter(f => f.image).map(f => ({
      direction: line.cellText ? line.cellText.matrix[1] < 0 ? 'btLr' : 'tbRl' : 'lrTb',
      x: f.x * .75, y: (line.cellText ? f.y : line.baseline - f.ascent) * .75,
      width: (line.cellText ? f.width : f.image.width / 9525) * .75,
      height: (line.cellText ? f.height : f.image.height / 9525) * .75,
    }))) };
  }, [...readFileSync(`${folder}/${control.name}.docx`)]);
  const { png, ...geometry } = result;
  writeFileSync(info.outputPath('page.png'), Buffer.from(png, 'base64'));
  writeFileSync(info.outputPath('picture-geometry.json'), JSON.stringify(geometry, null, 2));
  expect(!!result.readOnly).toBe(false); expect(result.pages).toBe(1);
  expect(result.frames.map(f => f.direction)).toEqual(['lrTb', 'btLr', 'tbRl']);
  for (const [index, frame] of result.frames.entries()) {
    for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(frame[key] - control.pictures[index][key]), `${frame.direction} ${key}`).toBeLessThan(.15);
  }
  for (const interaction of result.interactions) {
    expect(interaction.outside).toBeNull();
    for (const [index, sample] of interaction.samples.entries()) {
      expect(sample.start).toBe(interaction.start);
      expect(sample.target).toBe('https://example.com/rotation-image');
      expect(sample.rgb).toEqual(result.interactions[0].samples[index].rgb);
      if (index < 2) expect(sample.rgb[2] - sample.rgb[0]).toBeGreaterThan(100);
      else expect(sample.rgb[0] - sample.rgb[2]).toBeGreaterThan(100);
    }
    if (interaction !== result.interactions[0]) {
      expect(interaction.selected).toHaveLength(1);
      expect(interaction.selected[0].page).toBe(0);
      for (const key of ['x', 'y', 'width', 'height']) expect(interaction.selected[0][key]).toBeCloseTo(interaction.frame[key], 9);
    }
  }
});

test('preserves linked-picture DOCX after editing and undo', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const source = `${folder}/links-inline.docx`;
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/Link target/);
  await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const before = await input.inputValue();
  await input.focus(); await page.keyboard.insertText('Editable');
  expect(await input.inputValue()).not.toBe(before);
  await input.press('Control+z');
  await expect(input).toHaveValue(before);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const output = info.outputPath('original.docx'); await (await download).saveAs(output);
  expect(unzipSync(readFileSync(output))).toEqual(unzipSync(readFileSync(source)));
  expect(errors).toEqual([]);
});
