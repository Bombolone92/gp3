import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

const folder = 'tests/fixtures/multipage-floating';
const references = ['reference.json', 'flow-reference.json', 'start-reference.json', 'border-reference.json', 'rows-reference.json'].map(name => JSON.parse(readFileSync(`${folder}/${name}`, 'utf8')));
for (const reference of references) for (const [key, expected] of Object.entries(reference.lines)) {
  const name = key.replace(/-native$/, '');
  test(`multi-page floating table: ${name}`, async ({ page }, info) => {
    const bytes = readFileSync(`${folder}/${name}.docx`);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(reference.hashes[`${name}.docx`]);
    expect(createHash('sha256').update(readFileSync(`${folder}/${key}.pdf`)).digest('hex')).toBe(reference.hashes[`${key}.pdf`]);
    await page.goto('/playground.html');
    const actual = await page.evaluate(async bytes => {
      const { DocxPackage } = await import('/src/engine/docx.js');
      const { layoutDocument } = await import('/src/engine/layout.js');
      const { pageGeometry } = await import('/src/engine/page-settings.js');
      const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
      const p = await DocxPackage.open(Uint8Array.from(atob(bytes), c => c.charCodeAt(0)));
      await loadCanvasFonts(p);
      const ctx = document.createElement('canvas').getContext('2d');
      const layout = layoutDocument(p.paragraphs, (t, s) => measureCanvasText(ctx, t, s), pageGeometry(p.pageSettings), p.numbering, p.tables);
      return { pages: layout.pageCount, lines: [...layout.lines, ...layout.repeatedLines].flatMap(line => (line.wrapSegments || [line]).map(segment => ({
        text: segment.fragments.map(f => f.text).join('').trim(), page: line.page,
        x: segment.stops[0].x * .75, y: line.baseline * .75,
      }))) };
    }, bytes.toString('base64'));
    writeFileSync(info.outputPath('geometry.json'), JSON.stringify(actual, null, 2));
    writeFileSync(info.outputPath('differences.json'), JSON.stringify(expected.map(line => {
      const match = actual.lines.find(item => item.text === line.text && item.page === line.page);
      return { ...line, ...(match ? { dx: match.x - line.x, dy: match.y - line.y } : { missing: true }) };
    }), null, 2));
    expect(actual.pages).toBe(Math.max(...expected.map(line => line.page)) + 1);
    for (const line of expected) {
      const match = actual.lines.find(item => item.text === line.text && item.page === line.page);
      expect(match, `${line.text}, page ${line.page + 1}`).toBeTruthy();
      expect(Math.abs(match.x - line.x), `${line.text} x`).toBeLessThan(.15);
      expect(Math.abs(match.y - line.y), `${line.text} baseline`).toBeLessThan(.2);
    }
  });
}

test('edits the continuation page and preserves positioning through export and undo', async ({ page }, info) => {
  test.setTimeout(120000);
  const source = `${folder}/text-480-15.docx`, parts = unzipSync(readFileSync(source));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/Row 17/);
  await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
  const original = await input.inputValue();
  const save = async name => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(`${name}.docx`);
    await (await download).saveAs(path);
    return path;
  };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  const canvas = page.locator('canvas.canvas-page').nth(1);
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox(), scale = box.width / 816;
  await canvas.click({ position: { x: 146 * 4 / 3 * scale, y: 78 * 4 / 3 * scale } });
  const at = await input.evaluate(element => element.selectionStart), start = original.indexOf('Row 12');
  expect(at).toBeGreaterThanOrEqual(start);
  expect(at).toBeLessThanOrEqual(start + 6);
  await page.keyboard.insertText('EDIT ');
  await expect(input).toHaveValue(/EDIT /);
  const changedText = await input.inputValue(), edited = await save('edited');
  const changed = unzipSync(readFileSync(edited));
  for (const name of Object.keys(parts)) if (name !== 'word/document.xml') expect(changed[name], name).toEqual(parts[name]);
  const position = bytes => new TextDecoder().decode(bytes).match(/<w:tblpPr\b[^>]*\/>/g);
  expect(position(changed['word/document.xml'])).toEqual(position(parts['word/document.xml']));
  await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  const previous = await input.elementHandle();
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Open DOCX file').setInputFiles(edited);
  await page.waitForFunction(element => !element.isConnected, previous, { timeout: 60000 });
  await previous.dispose();
  await expect(input).toHaveValue(changedText);
  await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
  await expect(page.locator('#playground-error')).toBeEmpty();
});
