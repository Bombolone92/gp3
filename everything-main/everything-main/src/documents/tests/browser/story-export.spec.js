import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

test('an edited footer keeps its live page field through browser export and body editing', async ({ page }, info) => {
  await page.goto('/playground.html');
  const generated = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { TextDocument } = await import('/src/engine/model.js');
    const pkg = await DocxPackage.open(new Uint8Array(bytes)), path = 'word/footer-even.xml', story = pkg.pageStories.stories[path];
    const d = new TextDocument(story.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, story.tables, pkg.assets);
    d.select(0); d.replace('Edited ');
    const blob = pkg.export(undefined, undefined, undefined, undefined, undefined, undefined, { [path]: { paragraphs: d.paragraphs, tables: d.tables } });
    const output = new Uint8Array(await blob.arrayBuffer()), reopened = await DocxPackage.open(output);
    return { bytes: [...output], field: reopened.pageStories.stories[path].paragraphs[0].runs.find(r => r.field).field.type };
  }, [...readFileSync('tests/fixtures/page-stories/footer-variants.docx')]);
  expect(generated.field).toBe('PAGE');
  const source = Buffer.from(generated.bytes), path = info.outputPath('edited-story.docx');
  writeFileSync(path, source);
  await page.getByLabel('Open DOCX file').setInputFiles(path);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveJSProperty('readOnly', false);
  await expect(input).not.toHaveValue('');
  const original = await input.inputValue();
  await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Body edit ');
  await expect(input).toHaveValue('Body edit ' + original);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = info.outputPath('body-and-story.docx'); await (await download).saveAs(saved);
  const parts = unzipSync(readFileSync(saved)), originals = unzipSync(source);
  for (const name of Object.keys(originals)) if (name !== 'word/document.xml') expect(parts[name], name).toEqual(originals[name]);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
});
