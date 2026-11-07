import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

test('edits body and two footer variants with chronological undo, redo and export', async ({ page }, info) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const source = 'tests/fixtures/page-stories/footer-variants.docx';
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const area = page.getByRole('combobox', { name: 'Editing area', exact: true });
  const body = page.getByRole('textbox', { name: 'Document text', exact: true });
  await expect(area).toBeVisible(); const original = await body.inputValue();
  await body.focus(); await body.press('ControlOrMeta+Home'); await page.keyboard.insertText('BODY ');
  await area.selectOption(JSON.stringify(['word/footer-first.xml', 0]));
  const footer = page.getByRole('textbox', { name: 'Footer text', exact: true });
  await expect(footer).toHaveValue('First \ufffc');
  await footer.press('ControlOrMeta+Home'); await page.keyboard.insertText('FIRST ');
  await area.selectOption(JSON.stringify(['word/footer-even.xml', 1]));
  await expect(footer).toHaveValue('Even \ufffc');
  await footer.press('ControlOrMeta+Home'); await page.keyboard.insertText('EVEN ');
  const save = async name => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const destination = info.outputPath(name + '.docx'); await (await download).saveAs(destination); return destination;
  };
  const edited = await save('edited');
  const initialParts = unzipSync(readFileSync(source)), editedParts = unzipSync(readFileSync(edited));
  for (const name of Object.keys(initialParts)) if (!['word/document.xml', 'word/footer-first.xml', 'word/footer-even.xml'].includes(name)) expect(editedParts[name], name).toEqual(initialParts[name]);
  await area.selectOption(''); await body.press('ControlOrMeta+z');
  await expect(footer).toHaveValue('Even \ufffc'); await footer.press('ControlOrMeta+z');
  await expect(footer).toHaveValue('First \ufffc'); await footer.press('ControlOrMeta+z');
  await expect(body).toHaveValue(original); expect(unzipSync(readFileSync(await save('undo')))).toEqual(initialParts);
  await body.press('ControlOrMeta+Shift+z'); await body.press('ControlOrMeta+Shift+z'); await footer.press('ControlOrMeta+Shift+z');
  expect(unzipSync(readFileSync(await save('redo')))).toEqual(editedParts);
  await area.selectOption('');
  await reopenDocx(page, body, edited, 'BODY ' + original);
  await area.selectOption(JSON.stringify(['word/footer-first.xml', 0])); await expect(footer).toHaveValue('FIRST First \ufffc');
  await footer.press('Escape'); await expect(body).toHaveValue('BODY ' + original);
  expect(errors).toEqual([]);
});

test('IME in a header creates one undo entry and preserves its tables', async ({ page }, info) => {
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/page-story-tables.docx');
  const area = page.getByRole('combobox', { name: 'Editing area', exact: true });
  await area.selectOption(JSON.stringify(['word/header.xml', 0]));
  const input = page.getByRole('textbox', { name: 'Header text', exact: true });
  const original = await input.inputValue(); await input.press('ControlOrMeta+Home');
  await input.evaluate(el => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.setRangeText('한', 0, 0, 'end');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true, data: '한' }));
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '한' }));
  });
  await expect(input).toHaveValue('한' + original);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const destination = info.outputPath('header-ime-undo.docx'); await (await pending).saveAs(destination);
  expect(unzipSync(readFileSync(destination))).toEqual(unzipSync(readFileSync('public/fixtures/page-story-tables.docx')));
});

test('double-click enters a footer and typing after its page field remains ordinary text', async ({ page }) => {
  const source = 'tests/fixtures/page-stories/footer-variants.docx';
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(source);
  await expect(page.getByRole('combobox', { name: 'Editing area', exact: true }).locator('option')).toHaveCount(4);
  const point = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { layoutPageStories } = await import('/src/engine/page-story-layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { measureCanvasText } = await import('/src/engine/canvas-text.js');
    const pkg = await DocxPackage.open(new Uint8Array(bytes)), context = document.createElement('canvas').getContext('2d');
    const measure = (text, style) => measureCanvasText(context, text, style);
    const body = layoutDocument(pkg.paragraphs, measure, pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories);
    const story = layoutPageStories(body, pkg.pageStories, [pkg.pageSettings], measure, pkg.numbering, { styles: pkg.styles });
    const line = story.lines.find(l => l.page === 0);
    return { x: line.stops[0].x + 4, y: line.y + line.height / 2 };
  }, [...readFileSync(source)]);
  const canvas = page.locator('canvas.canvas-page').first();
  await canvas.dblclick({ position: point });
  const footer = page.getByRole('textbox', { name: 'Footer text', exact: true });
  await expect(footer).toHaveValue('First \ufffc');
  await footer.press('ControlOrMeta+End'); await page.keyboard.insertText(' tail');
  await expect(footer).toHaveValue('First \ufffc tail');
  await footer.press('ControlOrMeta+z'); await expect(footer).toHaveValue('First \ufffc');
  await footer.press('Escape'); await expect(page.getByRole('textbox', { name: 'Document text', exact: true })).toBeAttached();
});
