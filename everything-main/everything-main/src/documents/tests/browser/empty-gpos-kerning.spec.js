import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Optional, independently obtained Apache-2.0 reference fonts; never install
// them or redistribute proprietary bundled copies. See the fixture README.
const directory = process.env.DOCX_TEST_OPEN_SANS_110_DIR;
const folder = 'tests/fixtures/empty-gpos-kerning/';
const reference = JSON.parse(readFileSync(folder + 'reference.json'));
const hashes = JSON.parse(readFileSync(folder + 'diagnostic-fonts.json'));
test('empty GPOS faces use the existing OpenType preparation path', async ({ page }) => {
  test.skip(!directory, 'Set DOCX_TEST_OPEN_SANS_110_DIR to the documented reference fonts.');
  const faces = [['Regular', '400', 'normal'], ['Bold', '700', 'normal'], ['Italic', '400', 'italic'], ['BoldItalic', '700', 'italic']].map(([name, weight, style]) => {
    const file = `OpenSans-1.10-${name}.ttf`, bytes = readFileSync(resolve(directory, file));
    expect(createHash('sha256').update(bytes).digest('hex'), file).toBe(hashes.sha256[file]);
    return { fullName: 'Open Sans ' + name, weight, style, encoded: bytes.toString('base64') };
  });
  await page.goto('/playground.html');
  const result = await page.evaluate(async ({ faces, source }) => {
    const local = faces.map(f => ({ ...f, buffer: Uint8Array.from(atob(f.encoded), c => c.charCodeAt(0)).buffer }));
    for (const face of local) document.fonts.add(await new FontFace('Open Sans', face.buffer, { weight: face.weight, style: face.style }).load());
    Object.defineProperty(window, 'queryLocalFonts', { configurable: true, value: async () => local.map(face => ({
      family: 'Open Sans', fullName: face.fullName, postscriptName: face.fullName.replaceAll(' ', ''), blob: async () => new Blob([face.buffer]),
    })) });
    const { browseLocalFonts } = await import('/src/engine/local-fonts.js');
    await browseLocalFonts();
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { openTypeKerningFamily } = await import('/src/engine/opentype-kerning.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(source), c => c.charCodeAt(0)));
    await loadCanvasFonts(pkg);
    const ctx = document.createElement('canvas').getContext('2d');
    const layout = layoutDocument(pkg.paragraphs, (text, style) => measureCanvasText(ctx, text, style), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories, { styles: pkg.styles });
    return {
      alias: openTypeKerningFamily({ fontFamily: 'Open Sans', kerning: 1, ligatures: 'standardContextual' }),
      rows: layout.lines.filter(l => l.fragments.map(f => f.text).join('') === 'AVATAR To Wa controls compare flowing words.').map(l => l.fragments[0].x * .75),
    };
  }, { faces, source: readFileSync(folder + 'enabled-1.docx').toString('base64') });
  expect(result.alias).toMatch(/^Canvas OpenType kerning /);
  expect(result.rows).toHaveLength(16);
  // Only the enabled OpenType/ligature path is fixed here. Browser suppression
  // of the original font's legacy kern pairs remains a separate gap.
  for (const index of [3, 7, 11, 15]) expect(Math.abs(result.rows[index] - reference.documents[1].rows[index].x), `case ${index}`).toBeLessThan(.2);
});
