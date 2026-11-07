import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

test('nested body tables retain native first/even/default story clearance through editing', async ({ page }, info) => {
  test.setTimeout(120000);
  const folder = 'tests/fixtures/nested-table-stories', source = `${folder}/control.docx`;
  const ref = JSON.parse(readFileSync(`${folder}/reference.json`)), bytes = readFileSync(source), errors = [];
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
  expect(createHash('sha256').update(readFileSync(`${folder}/native.pdf`)).digest('hex')).toBe(ref.pdfSha256);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/Nested 3.2/);
  await expect(input).toHaveJSProperty('readOnly', false);
  const verify = async path => {
    const actual = await page.evaluate(async b => {
      const { DocxPackage } = await import('/src/engine/docx.js');
      const { TextDocument } = await import('/src/engine/model.js');
      const { layoutDocument } = await import('/src/engine/layout.js');
      const { pageGeometry } = await import('/src/engine/page-settings.js');
      const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
      const p = await DocxPackage.open(Uint8Array.from(atob(b), c => c.charCodeAt(0)));
      await loadCanvasFonts(p);
      const d = new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
      const ctx = document.createElement('canvas').getContext('2d');
      const placed = layoutDocument(d.paragraphs, (t,s) => measureCanvasText(ctx,t,s), pageGeometry(d.pageSettings), d.numbering, d.tables, p.pageStories, { styles: d.styles });
      return { pages: placed.pageCount, pictures: placed.lines.flatMap(l => l.fragments.filter(f => f.image).map(f => ({ page: l.page, x: f.x*.75, y: (l.baseline-f.ascent)*.75, width: f.width*.75 }))) };
    }, readFileSync(path).toString('base64'));
    writeFileSync(info.outputPath(path === source ? 'original-geometry.json' : 'edited-geometry.json'), JSON.stringify(actual,null,2));
    expect(actual.pages).toBe(ref.pages);
    expect(actual.pictures).toHaveLength(ref.pictures.length);
    for (const [i,p] of actual.pictures.entries()) {
      expect(p.page).toBe(ref.pictures[i].page);
      for (const axis of ['x','y','width']) expect(Math.abs(p[axis]-ref.pictures[i][axis]), `${i} ${axis}`).toBeLessThan(.2);
    }
    await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
    await expect(page.locator('#playground-error')).toBeEmpty();
  };
  await verify(source);
  const original = await input.inputValue(), parts = unzipSync(bytes);
  const save = async name => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(`${name}.docx`); await (await pending).saveAs(path); return path;
  };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const edited = await save('edited'), changed = unzipSync(readFileSync(edited));
  expectBodyEditParts(changed, parts);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,'Edited '+original); await verify(edited);
  expect(errors).toEqual([]);
});
