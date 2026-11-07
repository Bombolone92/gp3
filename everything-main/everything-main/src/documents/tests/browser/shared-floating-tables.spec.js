import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { reopenDocx } from './helpers/reopen-docx.js';
for (const name of ['same', 'continuous']) test(`shared floating tables match native origins: ${name}`, async ({ page }) => {
  test.setTimeout(120000);
  const source = `tests/fixtures/section-floating-tables/${name}.docx`, composite = JSON.parse(readFileSync(`tests/fixtures/section-floating-tables/${name}-reference.json`));
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

for (const name of ['same', 'continuous']) test(`shared floating tables edit, reopen and undo exactly: ${name}`, async ({page}, info) => {
  test.setTimeout(180000);
  const source = `tests/fixtures/section-floating-tables/${name}.docx`, originalParts = unzipSync(readFileSync(source));
  const pixels = () => page.locator('canvas.canvas-page').evaluateAll(cs => cs.map(c => c.toDataURL()));
  await page.goto('/playground.html');
  const input = page.getByRole('textbox', {name:'Document text', exact:true}), previous = await input.elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  await expect.poll(() => previous.evaluate(e => e.isConnected)).toBe(false); await previous.dispose();
  await expect(input).toHaveJSProperty('readOnly', false); await expect(page.locator('canvas.canvas-page')).toHaveCount(3);
  const original = await input.inputValue(), at = original.lastIndexOf('Row 12');
  const save = async name => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', {name:'Download .docx',exact:true}).click();
    const path = info.outputPath(name); await (await pending).saveAs(path); return path;
  };
  expect(unzipSync(readFileSync(await save('noedit.docx')))).toEqual(originalParts);
  await input.evaluate((el,at) => {el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select',{bubbles:true}));}, at);
  await input.evaluate(el => el.blur()); const before = await pixels();
  await input.focus(); await page.keyboard.insertText('EDIT ');
  const editedText = original.slice(0,at)+'EDIT '+original.slice(at); await expect(input).toHaveValue(editedText);
  await input.evaluate(el => el.blur()); const after = await pixels(), exported = await save('edited.docx'), parts = unzipSync(readFileSync(exported));
  for (const [path,bytes] of Object.entries(originalParts)) if (path !== 'word/document.xml') expect(parts[path],path).toEqual(bytes);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original); await input.evaluate(el => el.blur()); expect(await pixels()).toEqual(before);
  expect(unzipSync(readFileSync(await save('undo.docx')))).toEqual(originalParts);
  await reopenDocx(page,input,exported,editedText); await input.evaluate(el => el.blur()); expect(await pixels()).toEqual(after);
  await expect(input).toHaveJSProperty('readOnly',false); await expect(page.locator('canvas.canvas-page')).toHaveCount(3);
  await expect(page.locator('#playground-error')).toBeEmpty(); await expect(page.locator('.canvas-message-error')).toHaveCount(0);
});
