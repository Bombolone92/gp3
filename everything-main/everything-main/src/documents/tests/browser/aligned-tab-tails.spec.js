import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

const folder = 'tests/fixtures/aligned-tab-tails';
const source = `${folder}/source.docx`;
const reference = JSON.parse(readFileSync(`${folder}/reference.json`));

test('aligns native tab tails and preserves their spaces through editing and export', async ({ page }, info) => {
  test.setTimeout(120000);
  for (const name of ['source.docx', 'native.pdf']) expect(createHash('sha256').update(readFileSync(`${folder}/${name}`)).digest('hex')).toBe(reference.hashes[name]);
  await page.goto('/playground.html');
  const nativeFont = await page.evaluate(async () => {
    const { checkFontAvailability, fontAvailable } = await import('/src/engine/font-availability.js');
    await checkFontAvailability('Arial'); return fontAvailable('Arial');
  });
  test.skip(!nativeFont, 'Native reference coordinates require installed Arial; fonts are not redistributed.');
  const geometry = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { loadCanvasFonts } = await import('/src/engine/canvas-text.js');
    const pkg = await DocxPackage.open(new Uint8Array(bytes)); await loadCanvasFonts(pkg);
    const host = document.createElement('div'); document.body.append(host);
    const editor = new CanvasEditor(host, pkg);
    try { return editor.layout.lines.flatMap(line => line.fragments.filter(f => f.text.startsWith('AB12')).map(f => ({ x: f.x * .75, y: line.baseline * .75 }))); }
    finally { editor.destroy(); host.remove(); }
  }, [...readFileSync(source)]);
  expect(geometry).toHaveLength(reference.cases.length);
  for (const [i, expected] of reference.cases.entries()) {
    expect(Math.abs(geometry[i].x - expected.x), `${expected.alignment}/${expected.tail}`).toBeLessThan(.15);
    expect(Math.abs(geometry[i].y - expected.y)).toBeLessThan(.25);
  }
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^\tAB12/); await expect(input).toHaveJSProperty('readOnly', false);
  const original = await input.inputValue(), parts = unzipSync(readFileSync(source));
  const save = async name => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(`${name}.docx`); await (await pending).saveAs(path); return path;
  };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.focus(); await input.press('ControlOrMeta+Home'); await input.press('End');
  await page.keyboard.insertText('  '); const editedText = await input.inputValue();
  expect(editedText).toBe(original.replace('\tAB12\n', '\tAB12  \n'));
  const edited = await save('edited'), editedParts = unzipSync(readFileSync(edited));
  for (const name in parts) if (name !== 'word/document.xml') expect(editedParts[name]).toEqual(parts[name]);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page, input, edited, editedText);
  await expect(page.locator('#playground-error')).toBeEmpty();
});
