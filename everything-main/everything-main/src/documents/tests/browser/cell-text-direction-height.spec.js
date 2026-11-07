import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

const folder = 'tests/fixtures/cell-text-direction';
for (const name of ['automatic', 'height', 'metrics']) test(`rotated terminal-mark allocation matches the native reference: ${name}`, async ({ page }) => {
  const reference = JSON.parse(readFileSync(`${folder}/${name}-reference.json`));
  for (const [file, hash] of Object.entries(reference.hashes)) {
    expect(createHash('sha256').update(readFileSync(`${folder}/${file}`)).digest('hex')).toBe(hash);
  }
  // Isolated measurement while production import/interaction integration is
  // pending. Strip only the direction in this test copy to read source styles.
  const parts = unzipSync(readFileSync(`${folder}/${name}.docx`));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace(/<w:textDirection\b[^>]*\/>/g, ''));
  await page.goto('/playground.html');
  const actual = await page.evaluate(async ({ bytes, paired }) => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { paragraphFormat, runFormat } = await import('/src/engine/model.js');
    const { measureTextGeometry } = await import('/src/engine/text-geometry.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { rotatedCellMinimumHeight } = await import('/src/engine/cell-text-direction.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(bytes), c => c.charCodeAt(0)));
    await loadCanvasFonts(pkg);
    const context = document.createElement('canvas').getContext('2d');
    return pkg.tables.filter((_, index) => !paired || index % 2 === 0).map(table => table.rows[0].cells.map(cell => {
      const last = pkg.paragraphs.findLast(p => p.cellId === cell.id);
      const style = runFormat(last.markFormat), format = paragraphFormat(last, pkg.numbering, pkg.pageSettings);
      const metrics = measureTextGeometry('', style, (text, font) => measureCanvasText(context, text, font));
      return rotatedCellMinimumHeight(format, style, metrics) * .75 + (cell.margins.top + cell.margins.bottom) / 20 + 1;
    }));
  }, { bytes: Buffer.from(zipSync(parts)).toString('base64'), paired: name === 'metrics' });
  expect(actual).toHaveLength(reference.pages.length);
  for (const [index, heights] of actual.entries()) {
    const edges = [...new Set(reference.pages[index].pathBounds
      .filter(([left, bottom, right, top]) => right - left > 10 && top - bottom < 2)
      .map(([, bottom, , top]) => (bottom + top) / 2))].sort((a, b) => b - a);
    expect(edges).toHaveLength(name === 'metrics' ? 4 : 2);
    const native = edges[0] - edges[1];
    for (const height of heights) expect(Math.abs(height - native), `${name} page ${index + 1}: ${height} vs ${native}`).toBeLessThan(.15);
  }
});
