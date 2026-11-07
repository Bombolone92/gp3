import { showAllTools } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

// Scroll the point being tested. A whole page can be taller than the viewport,
// so centering the canvas does not guarantee its first line is clickable.
async function revealLine(canvas, y) {
  await canvas.evaluate((c, y) => {
    const host = c.closest('.canvas-host');
    host.scrollTop += c.getBoundingClientRect().top + y - (host.getBoundingClientRect().top + host.clientHeight / 2);
  }, y);
}

test('edits inherited pagination, preserves canvas selection and undo, and reopens a validated DOCX', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/paragraph-pagination.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  const canvases = page.locator('canvas.canvas-page');
  const keepNext = page.getByRole('button', { name: 'Keep with next paragraph', exact: true });
  const keepLines = page.getByRole('button', { name: 'Keep lines together', exact: true });
  const widow = page.getByRole('button', { name: 'Widow and orphan control', exact: true });
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  await expect(input).toHaveValue(/^Filler line 1\n/); await expect(canvases).toHaveCount(4);
  for (const button of [keepNext, keepLines, widow]) {
    await expect(button.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    await expect(button).toHaveAttribute('title', await button.getAttribute('aria-label'));
  }
  const text = await input.inputValue(), headingStart = text.indexOf('Keep this heading'), bodyStart = text.indexOf('First body line');
  const clickLine = async (pageIndex, y, shift = false) => {
    const canvas = canvases.nth(pageIndex);
    await revealLine(canvas, y);
    const box = await canvas.boundingBox();
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.click(box.x + 48, box.y + y);
    if (shift) await page.keyboard.up('Shift');
  };
  const range = () => input.evaluate(el => [el.selectionStart, el.selectionEnd]);
  // The inherited keepNext chain moved both headings from page 1 to page 2.
  await clickLine(1, 60); expect(await range()).toEqual([headingStart, headingStart]);
  await expect(keepNext).toHaveAttribute('aria-pressed', 'true');
  await expect(keepLines).toHaveAttribute('aria-pressed', 'true');
  await expect(widow).toHaveAttribute('aria-pressed', 'false');
  await clickLine(1, 108, true); expect(await range()).toEqual([headingStart, bodyStart]);
  // Selection ends at the body's start; only the two headings are formatted.
  await keepNext.click(); await expect(keepNext).toHaveAttribute('aria-pressed', 'false');
  expect(await range()).toEqual([headingStart, bodyStart]);
  await expect(canvases).toHaveCount(3);
  await undo.click(); await expect(canvases).toHaveCount(4);
  expect(await range()).toEqual([headingStart, bodyStart]);
  await redo.click(); await expect(canvases).toHaveCount(3);
  await keepLines.click(); await expect(keepLines).toHaveAttribute('aria-pressed', 'false');
  // Keyboard activation returns focus to the native editing input.
  await widow.focus(); await widow.press('Space');
  await expect(widow).toHaveAttribute('aria-pressed', 'true'); await expect(input).toBeFocused();
  expect(await range()).toEqual([headingStart, bodyStart]);
  await undo.click(); await expect(widow).toHaveAttribute('aria-pressed', 'false');
  await redo.click(); await expect(widow).toHaveAttribute('aria-pressed', 'true');
  // After reflow, click the heading at its new position near the first page's end.
  await clickLine(0, 300); expect(await range()).toEqual([headingStart, headingStart]);
  await page.keyboard.insertText('Edited ');
  const edited = await input.inputValue();
  await clickLine(0, 324); await clickLine(1, 84, true);
  const crossPage = await range(); expect(crossPage[1]).toBeGreaterThan(crossPage[0]);
  await page.keyboard.insertText('Temporary replacement');
  await undo.click(); await expect(input).toHaveValue(edited); expect(await range()).toEqual(crossPage);
  await page.screenshot({ path: testInfo.outputPath('pagination-editor.png'), fullPage: true, animations: 'disabled' });
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = testInfo.outputPath('pagination.docx'); await (await downloaded).saveAs(saved);
  const originalParts = unzipSync(readFileSync('public/fixtures/paragraph-pagination.docx'));
  const savedParts = unzipSync(readFileSync(saved));
  expectBodyEditParts(savedParts, originalParts);
  await reopenDocx(page, input, saved, await input.inputValue());
  await expect(input).toHaveValue(edited); await expect(undo).toBeDisabled(); await expect(canvases).toHaveCount(3);
  await clickLine(0, 300);
  await expect(keepNext).toHaveAttribute('aria-pressed', 'false');
  await expect(keepLines).toHaveAttribute('aria-pressed', 'false');
  await expect(widow).toHaveAttribute('aria-pressed', 'true');
  await input.press('ControlOrMeta+a'); await expect(keepLines).toHaveAttribute('aria-pressed', 'mixed');
  await expect(widow).toHaveAttribute('aria-pressed', 'mixed');
  expect(errors).toEqual([]);
});

test('keep-lines and widow toggles move actual lines and their click positions between pages', async ({ page }, testInfo) => {
  await page.goto('/playground.html'); await showAllTools(page);
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/paragraph-pagination.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  const canvases = page.locator('canvas.canvas-page');
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const keepLines = page.getByRole('button', { name: 'Keep lines together', exact: true });
  const widow = page.getByRole('button', { name: 'Widow and orphan control', exact: true });
  await expect(canvases).toHaveCount(4);
  const text = await input.inputValue();
  const click = async (pageIndex, y, expected) => {
    await revealLine(canvases.nth(pageIndex), y);
    const box = await canvases.nth(pageIndex).boundingBox();
    await page.mouse.click(box.x + 48, box.y + y);
    expect(await input.evaluate(el => el.selectionStart)).toBe(text.indexOf(expected));
  };
  await click(2, 60, 'Kept line 1');
  await expect(keepLines).toHaveAttribute('aria-pressed', 'true');
  await keepLines.click(); await expect(canvases).toHaveCount(3);
  await click(1, 180, 'Kept line 1');
  await undo.click(); await expect(canvases).toHaveCount(4);
  await click(2, 60, 'Kept line 1');
  await click(3, 60, 'Widow line 4');
  await expect(widow).toHaveAttribute('aria-pressed', 'true');
  await widow.click();
  await click(2, 324, 'Widow line 4');
  await click(3, 60, 'Widow line 5');
  await undo.click(); await click(3, 60, 'Widow line 4');
  await expect(input).toHaveValue(text);
  await canvases.nth(2).screenshot({ path: testInfo.outputPath('widow-controlled-page.png'), animations: 'disabled' });
});
