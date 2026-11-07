import { showAllTools } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

test('applies character styles, edits a shared base and preserves direct and empty-paragraph formatting', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/character-styles.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  const style = page.getByRole('combobox', { name: 'Character style', exact: true });
  const size = page.getByRole('spinbutton', { name: 'Font size (pt)', exact: true });
  const edit = page.getByRole('button', { name: 'Edit character style', exact: true });
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  const select = text => input.evaluate((el, text) => { const start = el.value.indexOf(text); el.setSelectionRange(start, start + text.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, text);
  await expect(input).toHaveValue(/^Plain base child direct/); await expect(style).toHaveValue('');
  await select('Plain'); await style.selectOption('CanvasCharacterGrandchild'); await expect(size).toHaveValue('14');
  await expect(edit.locator('svg')).toHaveAttribute('aria-hidden', 'true'); await expect(edit).toHaveAttribute('title', 'Edit character style');
  await undo.click(); await expect(style).toHaveValue(''); await redo.click(); await expect(style).toHaveValue('CanvasCharacterGrandchild');
  await select(' direct'); await style.selectOption(''); await expect(size).toHaveValue('22');
  await expect(page.getByRole('button', { name: 'Italic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await select('base'); await expect(style).toHaveValue('CanvasCharacterBase');
  const selection = await input.evaluate(el => [el.selectionStart, el.selectionEnd]);
  await edit.focus(); await edit.press('Space');
  await expect(page.getByRole('dialog', { name: 'Edit character style' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Following paragraph style', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('character-style-dialog.png'), animations: 'disabled' });
  await page.getByRole('spinbutton', { name: 'Style font size (pt)', exact: true }).fill('18');
  await page.getByRole('combobox', { name: 'Style italic', exact: true }).selectOption('');
  await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(size).toHaveValue('18');
  expect(await input.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual(selection);
  await edit.click(); await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await undo.click(); await expect(size).toHaveValue('14'); await redo.click(); await expect(size).toHaveValue('18');
  await select('Clear this style'); await style.selectOption(''); await expect(size).toHaveValue('12');
  await input.evaluate(el => { const at = el.value.indexOf('\n\n') + 1; el.setSelectionRange(at, at); el.dispatchEvent(new Event('select', { bubbles: true })); });
  await expect(style).toHaveValue('CanvasCharacterGrandchild'); await expect(size).toHaveValue('18');
  await style.selectOption('CanvasCharacterBase'); await undo.click(); await expect(style).toHaveValue('CanvasCharacterGrandchild');
  await page.keyboard.insertText('Empty styled'); await undo.click(); await redo.click();
  const text = await input.inputValue(); await select('Plain');
  await page.screenshot({ path: testInfo.outputPath('character-style-toolbar.png'), animations: 'disabled' });
  await page.locator('canvas.canvas-page').first().screenshot({ path: testInfo.outputPath('character-style-page.png'), animations: 'disabled' });
  await input.press('ControlOrMeta+a'); await expect(style).toHaveValue('__mixed');
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = testInfo.outputPath('character-styles.docx'); await (await downloaded).saveAs(saved);
  const original = unzipSync(readFileSync('public/fixtures/character-styles.docx')), exported = unzipSync(readFileSync(saved));
  expectBodyEditParts(exported, original, ['word/document.xml', 'word/styles.xml']);
  await reopenDocx(page, input, saved, await input.inputValue()); await expect(input).toHaveValue(text);
  await select('Empty styled'); await expect(style).toHaveValue('CanvasCharacterGrandchild'); await expect(size).toHaveValue('18');
  await select('Styled bullet');
  const bullet = page.getByRole('button', { name: 'Bulleted list', exact: true });
  // This fixture's list level belongs to ListBullet, not CanvasCharacterList.
  // The native numbering-style-bindings controls establish inactive inherited
  // markers until the owning paragraph style (or direct numbering) is applied.
  await expect(bullet).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('combobox', { name: 'Paragraph style', exact: true }).selectOption('ListBullet');
  await expect(bullet).toHaveAttribute('aria-pressed', 'true');
  await undo.click(); await expect(bullet).toHaveAttribute('aria-pressed', 'false');
  await expect(style).toHaveValue('CanvasCharacterGrandchild');
  expect(errors).toEqual([]);
});

test('creates a character style for composition and future typing and saves a styled empty paragraph', async ({ page }, testInfo) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' });
  const style = page.getByRole('combobox', { name: 'Character style', exact: true });
  const size = page.getByRole('spinbutton', { name: 'Font size (pt)', exact: true });
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  await input.fill('Seed '); await input.press('ControlOrMeta+End'); await style.selectOption('Emphasis');
  await page.getByRole('button', { name: 'New character style', exact: true }).click();
  await page.getByRole('textbox', { name: 'Style name', exact: true }).fill('Review characters');
  await page.getByRole('button', { name: 'Create style', exact: true }).click(); await expect(style).toHaveValue('CanvasCharacter1');
  await undo.click(); await expect(style).toHaveValue('Emphasis'); await redo.click(); await expect(style).toHaveValue('CanvasCharacter1');
  await page.getByRole('button', { name: 'Edit character style', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Style font size (pt)', exact: true }).fill('16');
  await page.getByRole('combobox', { name: 'Style underline', exact: true }).selectOption('single');
  await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(size).toHaveValue('16');
  await input.evaluate(el => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    for (const text of ['Caf', 'Café']) {
      el.value = 'Seed ' + text; el.setSelectionRange(el.value.length, el.value.length);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: text, isComposing: true }));
    }
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'Café' }));
  });
  await expect(input).toHaveValue('Seed Café'); await expect(style).toHaveValue('CanvasCharacter1'); await expect(size).toHaveValue('16');
  await undo.click(); await expect(input).toHaveValue('Seed '); await expect(style).toHaveValue('CanvasCharacter1'); await redo.click();
  await input.press('Enter'); await expect(style).toHaveValue('CanvasCharacter1'); await style.selectOption(''); await expect(size).toHaveValue('12');
  await page.keyboard.insertText('Plain again'); await input.press('Enter'); await style.selectOption('CanvasCharacter1');
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = testInfo.outputPath('new-character-styles.docx'); await (await downloaded).saveAs(saved);
  await reopenDocx(page, input, saved, await input.inputValue());
  await expect(input).toHaveValue('Seed Café\nPlain again\n'); await input.press('ControlOrMeta+End');
  await expect(style).toHaveValue('CanvasCharacter1'); await expect(size).toHaveValue('16');
  await page.screenshot({ path: testInfo.outputPath('new-character-style.png'), animations: 'disabled' });
});
