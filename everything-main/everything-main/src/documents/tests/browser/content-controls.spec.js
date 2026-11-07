import { openReadOnlyPreview } from './helpers/preview.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { showAllTools } from './helpers/editor-tools.js';
import { reopenDocx } from './helpers/reopen-docx.js';
const source = 'public/fixtures/content-controls.docx';
async function select(input, text, length = text.length, offset = 0) {
  await input.evaluate((el, { text, length, offset }) => {
    const at = el.value.indexOf(text); if (at < 0) throw new Error('Missing text: ' + text);
    el.focus(); el.setSelectionRange(at + offset, at + offset + length); el.dispatchEvent(new Event('select', { bubbles: true }));
  }, { text, length, offset });
}
async function download(page, info, name) {
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = info.outputPath(name); await (await pending).saveAs(path); return path;
}
async function open(page, path = source) {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles(path);
  await expect(page.locator('#playground-error')).toBeEmpty(); return page.getByRole('textbox', { name: 'Document text' });
}
async function pictures(page, info, prefix) {
  await page.getByRole('button', { name: 'Download .docx', exact: true }).focus();
  const pages = await page.locator('canvas.canvas-page').evaluateAll(cs => cs.map(c => c.toDataURL()));
  pages.forEach((png, i) => writeFileSync(info.outputPath(`${prefix}-${i + 1}.png`), Buffer.from(png.split(',')[1], 'base64')));
  return pages;
}

test('edits temporary placeholders with input formatting and preserves all other controls through export and undo', async ({ page }, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); const input = await open(page);
  await expect(input).toHaveValue(/^Temporary content controls/); const initial = await input.inputValue();
  const before = await pictures(page, info, 'content-controls');
  await select(input, '[Your name]', 0, 3);
  const caret = await input.boundingBox(); await page.mouse.click(caret.x + 5, caret.y + Math.min(8, caret.height / 2));
  expect(await input.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([initial.indexOf('[Your name]'), initial.indexOf('[Your name]') + '[Your name]'.length]);
  await select(input, '[Your name]', 0, 3); await page.keyboard.insertText('Ada Á😀');
  const edited = initial.replace('[Your name]', 'Ada Á😀'); await expect(input).toHaveValue(edited);
  const path = await download(page, info, 'content-controls.docx');
  expect(strFromU8(unzipSync(readFileSync(path))['word/document.xml'])).not.toContain('original-1');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue(initial);
  const unchanged = await download(page, info, 'content-controls-unchanged.docx');
  const original = unzipSync(readFileSync(source)), restored = unzipSync(readFileSync(unchanged));
  for (const name of Object.keys(original)) expect(Buffer.from(original[name]).equals(Buffer.from(restored[name])), name).toBe(true);
  expect(await pictures(page, info, 'controls-restored')).toEqual(before);
  await reopenDocx(page, input, path, edited); await select(input, 'Ada Á😀');
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('copies prompts as plain text, pastes into a cell placeholder, and supports native replacement and composition', async ({ page }, info) => {
  const input = await open(page); await expect(input).toHaveValue(/^Temporary content controls/); const original = await input.inputValue();
  await select(input, '[Your name]');
  const copied = await input.evaluate(el => { const data = new DataTransfer(); el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true })); return data.getData('text/plain'); });
  expect(copied).toBe('[Your name]');
  await select(input, '[Recipient Á😀]');
  await input.evaluate((el, text) => { const data = new DataTransfer(); data.setData('text/plain', text); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); }, copied);
  await expect(input).toHaveValue(original.replace('[Recipient Á😀]', copied));
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue(original);
  await select(input, '[Your name]', 0, 3);
  await input.evaluate(el => {
    const at = el.selectionStart; el.setRangeText('Ada', at, at, 'end');
    el.dispatchEvent(new InputEvent('input', { inputType: 'insertReplacementText', bubbles: true }));
  });
  await expect(input).toHaveValue(original.replace('[Your name]', 'Ada'));
  expect(await input.evaluate(el => el.selectionStart)).toBe(original.indexOf('[Your name]') + 3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await select(input, '[Your name]', 0, 3);
  await input.press('ControlOrMeta+i');
  await input.evaluate(el => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.setRangeText('한', el.selectionStart, el.selectionEnd, 'end');
    el.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', isComposing: true, bubbles: true }));
    el.dispatchEvent(new CompositionEvent('compositionend', { data: '한', bubbles: true }));
  });
  await expect(input).toHaveValue(original.replace('[Your name]', '한'));
  await expect(page.getByRole('button', { name: 'Italic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue(original);
  await download(page, info, 'controls-after-clipboard.docx');
});

test('previews unsupported control types as read-only with the original available', async ({ page }, info) => {
  const input = await open(page); await expect(input).toHaveValue(/^Temporary content controls/); const original = await input.inputValue();
  for (const [from, to, message] of [['w:val="unlocked"', 'w:val="contentLocked"', 'locked'], ['<w:richText/>', '<w:date/>', 'date']]) {
    const parts = unzipSync(readFileSync(source)), xml = strFromU8(parts['word/document.xml']); expect(xml).toContain(from);
    parts['word/document.xml'] = strToU8(xml.replace(from, to));
    await openReadOnlyPreview(page, { name: 'unsupported.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });

  }
});

test('opens the local birthday card, replaces one prompt, exports and restores its complete package', async ({ page }, info) => {
  test.skip(!process.env.BIRTHDAY_CARD_PATH, 'Optional private local corpus specimen');
  const input = await open(page, process.env.BIRTHDAY_CARD_PATH); await expect(input).toHaveValue(/Happy Birthday/);
  const original = await input.inputValue(); await pictures(page, info, 'birthday-card');
  await select(input, 'Happy Birthday'); await page.keyboard.insertText('Happy Day');
  await expect(input).toHaveValue(original.replace('Happy Birthday', 'Happy Day'));
  const saved = await download(page, info, 'birthday-card-edited.docx');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue(original);
  const restored = unzipSync(readFileSync(await download(page, info, 'birthday-card-restored.docx'))), before = unzipSync(readFileSync(process.env.BIRTHDAY_CARD_PATH));
  for (const name of Object.keys(before)) expect(Buffer.from(restored[name]).equals(Buffer.from(before[name])), name).toBe(true);
  await reopenDocx(page, input, saved, original.replace('Happy Birthday', 'Happy Day'));
});
