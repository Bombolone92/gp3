import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const folder = 'tests/fixtures/image-recovery/';

test('one broken bitmap retains healthy pixels, styles, tables, numbering and page stories', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async inputs => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const opened = [];
    for (const bytes of inputs) {
      const { pkg, images } = await openCanvasDocument(new Uint8Array(bytes));
      const host = document.createElement('div'); document.body.append(host);
      const editor = new CanvasEditor(host, { ...pkg, images });
      const canvas = editor.canvases[0];
      opened.push({ pkg, images, editor, canvas, pixels: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data });
    }
    const [a, b, c] = opened;
    const geometry = e => e.layout.lines.map(l => ({ x: l.x, y: l.y, baseline: l.baseline, height: l.height,
      fragments: l.fragments.map(f => ({ text: f.text, x: f.x, width: f.width, ascent: f.ascent, fontSize: f.fontSize, bold: f.bold })) }));
    const line = a.editor.layout.lines.find(l => l.fragments.some(f => f.image?.assetId === 'word/media/image2.png'));
    const fragment = line.fragments.find(f => f.image?.assetId === 'word/media/image2.png');
    const ratio = a.canvas.width / parseFloat(a.canvas.style.width);
    const left = fragment.x * ratio, top = (line.baseline - fragment.ascent) * ratio;
    const right = left + fragment.width * ratio, bottom = top + fragment.ascent * ratio;
    let changed = 0, outside = 0;
    for (let i = 0; i < a.pixels.length; i += 4) if ([0, 1, 2, 3].some(k => a.pixels[i + k] !== b.pixels[i + k])) {
      changed++; const x = i / 4 % a.canvas.width, y = Math.floor(i / 4 / a.canvas.width);
      if (x < left - 2 || x > right + 2 || y < top - 2 || y > bottom + 2) outside++;
    }
    const result = { healthyReadOnly: !!a.pkg.readOnly, readOnly: b.pkg.readOnly, issues: b.pkg.previewIssues,
      healthyAssets: [...a.images.keys()], recoveredAssets: [...b.images.keys()],
      placeholder: b.images.get('word/media/image2.png')?.previewPlaceholder,
      placeholderPixels: Array.from({ length: b.pixels.length / 4 }, (_, i) => i * 4).filter(i => b.pixels[i] === 243 && b.pixels[i + 1] === 244 && b.pixels[i + 2] === 246).length,
      geometry: [geometry(a.editor), geometry(b.editor)], settings: [a.pkg.pageSettings, b.pkg.pageSettings],
      tables: b.pkg.tables.length, stories: Object.keys(b.pkg.pageStories.stories), changed, outside,
      canvasSizes: opened.map(o => [o.canvas.width, o.canvas.height]), text: b.editor.input.value,
      failedBackground: c.pkg.pageSettings.backgroundPicture.assetId, backgroundReadOnly: c.pkg.readOnly,
      backgroundGeometry: geometry(c.editor), backgroundPixelsUnchanged: b.pixels.every((value, i) => c.pixels[i] === value) };
    opened.forEach(o => o.editor.destroy()); return result;
  }, ['healthy', 'broken', 'broken-background'].map(name => [...readFileSync(`${folder}${name}.docx`)]));
  expect(result.healthyReadOnly).toBe(false); expect(result.readOnly).toBe(true);
  expect(result.issues).toEqual(['Image word/media/image2.png: The image could not be decoded.']);
  expect(result.healthyAssets).toHaveLength(2); expect(result.recoveredAssets).toEqual(['word/media/image1.png', 'word/media/image2.png']);
  expect(result.placeholder).toBe(true); expect(result.placeholderPixels).toBeGreaterThan(100);
  expect(result.geometry[1]).toEqual(result.geometry[0]); expect(result.settings[1]).toEqual(result.settings[0]);
  expect(result.canvasSizes[1]).toEqual(result.canvasSizes[0]); expect(result.tables).toBe(1);
  expect(result.stories).toContain('word/header1.xml'); expect(result.changed).toBeGreaterThan(100); expect(result.outside).toBe(0);
  expect(result.text).toContain('Retained table cell'); expect(result.text).toContain('Numbered item');
  expect(result.failedBackground).toBe('word/media/image2.png'); expect(result.backgroundReadOnly).toBe(true);
  expect(result.backgroundGeometry).toEqual(result.geometry[1]); expect(result.backgroundPixelsUnchanged).toBe(true);
});

test('downloads the exact original file from the recovered read-only preview', async ({ page }, info) => {
  test.setTimeout(90000);
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Open DOCX file').setInputFiles(`${folder}broken.docx`);
  await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveValue(/^Styled heading/);
  await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveAttribute('readonly', '');
  await page.screenshot({ path: info.outputPath('recovered-document.png'), fullPage: true });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const target = info.outputPath('original.docx'); await (await download).saveAs(target);
  expect(readFileSync(target)).toEqual(readFileSync(`${folder}broken.docx`));
});
