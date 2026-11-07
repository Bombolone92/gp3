import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
const source = 'tests/fixtures/section-floating-tables/separate.docx';
const native = JSON.parse(readFileSync('tests/fixtures/multipage-floating/reference.json')).lines['text-480-15-native'];
const nativePages = Math.max(...native.map(line => line.page)) + 1;
const composite = JSON.parse(readFileSync('tests/fixtures/section-floating-tables/reference.json'));

test('matches the freshly observed composite native text origins on all four pages', async ({ page }) => {
  test.setTimeout(120000);
  const bytes = readFileSync(source);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(composite.sourceSha256);
  await page.goto('/playground.html');
  const actual = await page.evaluate(async encoded => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
    await loadCanvasFonts(pkg);
    const ctx = document.createElement('canvas').getContext('2d');
    const layout = layoutDocument(pkg.paragraphs, (t, s) => measureCanvasText(ctx, t, s), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables);
    return { pages: layout.pageCount, lines: layout.lines.map(line => {
      const chars = [];
      for (const segment of line.wrapSegments || [line]) for (const fragment of segment.fragments) {
        let offset = fragment.start;
        for (const text of fragment.text) {
          const stop = segment.stops.find(s => s.offset === offset && s.x >= fragment.x - 1e-6 && s.x <= fragment.x + fragment.width + 1e-6);
          if (!/\s/u.test(text)) {
            if (!stop) throw new Error('Missing character origin in composite control.');
            chars.push({ text, x: stop.x * .75, y: line.baseline * .75 });
          }
          offset += text.length;
        }
      }
      return { page: line.page, text: chars.map(c => c.text).join(''), chars };
    }).filter(line => line.chars.length) };
  }, bytes.toString('base64'));
  expect(actual.pages).toBe(composite.pages);
  expect(actual.lines).toHaveLength(composite.lines.length);
  for (const expected of composite.lines) {
    const match = actual.lines.filter(l => l.page === expected.page && l.text === expected.text);
    expect(match, `${expected.page + 1}: ${expected.text}`).toHaveLength(1);
    expect(match[0].chars).toHaveLength(expected.chars.length);
    for (const [i, char] of expected.chars.entries()) {
      expect(match[0].chars[i].text).toBe(char.text);
      expect(Math.abs(match[0].chars[i].x - char.x)).toBeLessThan(.15);
      expect(Math.abs(match[0].chars[i].y - char.y)).toBeLessThan(.2);
    }
  }
});
test('next-page sections retain independent native floating-table geometry', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/playground.html');
  const actual = await page.evaluate(async encoded => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
    await loadCanvasFonts(pkg);
    const ctx = document.createElement('canvas').getContext('2d');
    const layout = layoutDocument(pkg.paragraphs, (t, s) => measureCanvasText(ctx, t, s), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables);
    return { pages: layout.pageCount, lines: layout.lines.flatMap(l => (l.wrapSegments || [l]).map(segment => ({ page: l.page, text: segment.fragments.map(f => f.text).join('').trim(), x: segment.stops[0].x * .75, y: l.baseline * .75 }))) };
  }, readFileSync(source).toString('base64'));
  expect(actual.pages).toBe(nativePages * 2);
  for (let section = 0; section < 2; section++) for (const line of native) {
    const match = actual.lines.find(l => l.page === line.page + section * nativePages && l.text === line.text);
    expect(match, `${section}: ${line.text}`).toBeTruthy();
    expect(Math.abs(match.x - line.x)).toBeLessThan(.15);
    expect(Math.abs(match.y - line.y)).toBeLessThan(.2);
  }
});
test('edits a later-section continuation and preserves source positions through save, undo and reopening', async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto('/playground.html');
  const previous = await page.getByRole('textbox', { name: 'Document text', exact: true }).elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  await expect.poll(() => previous.evaluate(e => e.isConnected)).toBe(false);
  const input = page.getByRole('textbox', { name: 'Document text', exact: true });
  await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(nativePages * 2);
  const original = await input.inputValue(), parts = unzipSync(readFileSync(source));
  const save = async name => {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(`${name}.docx`); await (await event).saveAs(path); return path;
  };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  const canvas = page.locator('canvas.canvas-page').nth(nativePages * 2 - 1);
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox(), scale = box.width / 816;
  await canvas.click({ position: { x: 146 * 4 / 3 * scale, y: 78 * 4 / 3 * scale } });
  const at = await input.evaluate(e => e.selectionStart), start = original.lastIndexOf('Row 12');
  expect(at).toBeGreaterThanOrEqual(start); expect(at).toBeLessThanOrEqual(start + 6);
  await page.keyboard.insertText('EDIT ');
  const changedText = await input.inputValue(); expect(changedText).toContain('EDIT ');
  const edited = await save('edited'), changed = unzipSync(readFileSync(edited));
  for (const name of Object.keys(parts).filter(n => n !== 'word/document.xml')) expect(changed[name], name).toEqual(parts[name]);
  const positions = data => new TextDecoder().decode(data).match(/<w:tblpPr\b[^>]*\/>/g);
  expect(positions(changed['word/document.xml'])).toEqual(positions(parts['word/document.xml']));
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  const old = await input.elementHandle(); page.once('dialog', d => d.accept());
  await page.getByLabel('Open DOCX file').setInputFiles(edited);
  await expect.poll(() => old.evaluate(e => e.isConnected)).toBe(false);
  await expect(input).toHaveValue(changedText); await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(nativePages * 2);
  await expect(page.locator('#playground-error')).toBeEmpty();
});
