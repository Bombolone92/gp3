import { test, expect } from '@playwright/test';
import { reopenDocx } from './helpers/reopen-docx.js';

test('measures, paints and preserves declared fonts and reports missing Latin fonts', async ({ page }, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/font-families.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Font families/);
  await expect(page.locator('#playground-error')).toBeEmpty();
  const data = await page.evaluate(async () => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { fontAvailable } = await import('/src/engine/font-availability.js');
    const pkg = await DocxPackage.open(new Uint8Array(await (await fetch('/fixtures/font-families.docx')).arrayBuffer()));
    await loadCanvasFonts(pkg);
    const context = document.createElement('canvas').getContext('2d');
    const result = layoutDocument(pkg.paragraphs, (text, style) => measureCanvasText(context, text, style), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables);
    const lines = result.lines.map(l => ({ text: l.fragments.map(f => f.text).join(''), fragments: l.fragments.map(f => ({ text: f.text, family: f.fontFamily, width: f.width, ascent: f.ascent, descent: f.descent })), marker: l.marker?.textParts }));
    const native = ['Arial', 'Courier New', 'Times New Roman', 'Noto Sans'].map(family => {
      context.font = `normal 400 16px "${family === 'Noto Sans' ? 'Canvas Noto Sans' : family}"`;
      context.fontKerning = 'none'; context.letterSpacing = '0px'; context.wordSpacing = '0px';
      const m = context.measureText('Theme default WWW iii');
      return { family, available: fontAvailable(family), width: m.width, ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent };
    });
    return { lines, native, missing: fontAvailable('Unavailable Fixture Typeface') };
  });
  const native = data.native.find(n => n.family === 'Arial');
  expect(native.available).toBe(true);
  const themed = data.lines.find(l => l.text === 'Theme default WWW iii').fragments[0];
  expect(themed.family).toBe('Arial'); expect(themed.width).toBeCloseTo(native.width);
  // The native reference's Arial metrics include external leading and retain subpixel precision;
  // the small native canvas bounding box rounds these values to whole pixels.
  expect(Math.abs(themed.ascent - native.ascent)).toBeLessThan(2);
  expect(Math.abs(themed.descent - native.descent)).toBeLessThan(1);
  expect(data.native.find(n => n.family === 'Courier New').width).not.toBeCloseTo(native.width);
  const partial = data.lines.find(l => l.text.startsWith('Partial override'));
  expect(partial.fragments.map(f => f.family)).toEqual(['Courier New', 'Times New Roman', 'Courier New', 'Noto Sans']);
  expect(data.lines.find(l => l.marker).marker.map(p => [p.text, p.fontFamily])).toEqual([['§', 'Arial'], ['1.', 'Courier New']]);
  expect(data.missing).toBe(false);
  await input.evaluate(el => { const at = el.value.indexOf('Unavailable'); el.focus(); el.setSelectionRange(at, at + 11); el.dispatchEvent(new Event('select')); });
  await expect(page.getByLabel('Latin font family')).toHaveText('Unavailable Fixture Typeface → Noto Sans');
  await expect(page.getByLabel('Latin font family')).toHaveAttribute('title', /original font is retained/);
  await page.screenshot({ path: info.outputPath('font-families.png'), fullPage: true });
  const original = await input.inputValue();
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = info.outputPath('font-families.docx'); await (await pending).saveAs(saved);
  await reopenDocx(page, input, saved, 'Edited ' + original);
  await expect(page.getByLabel('Latin font family')).toHaveText('Arial');
  expect(errors).toEqual([]);
});
