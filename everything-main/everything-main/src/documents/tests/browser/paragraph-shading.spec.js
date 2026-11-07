import { openReadOnlyPreview } from './helpers/preview.js';
import { showAllTools } from './helpers/editor-tools.js';
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

async function choose(input, text, caret = false) {
  await input.evaluate((el, { text, caret }) => { const at = el.value.indexOf(text); if (at < 0) throw new Error('Missing text'); el.setSelectionRange(at, caret ? at : at + text.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, { text, caret });
}
async function shade(page, value) {
  const button = page.getByRole('button', { name: 'Paragraph shading', exact: true }); await button.focus(); await button.press('Enter');
  const palette = page.getByRole('menu', { name: 'Paragraph shading', exact: true });
  if (['auto', 'foreground'].includes(value)) await palette.getByRole('menuitemradio', { name: value === 'auto' ? 'No fill' : 'Automatic foreground', exact: true }).click();
  else {
    await palette.getByRole('textbox', { name: 'Custom paragraph fill hex value' }).fill('#' + value);
    await palette.getByRole('button', { name: 'Apply custom paragraph fill' }).click();
  }
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Document text' })).toBeFocused();
}
async function download(page, testInfo, name) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = testInfo.outputPath(name); await (await event).saveAs(path); return path;
}
async function pixels(page, hex, index = 0) {
  return page.locator('canvas.canvas-page').nth(index).evaluate((canvas, hex) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data, rgb = hex.match(/../g).map(v => parseInt(v, 16)); let count = 0;
    for (let i = 0; i < data.length; i += 4) if (rgb.every((v, j) => Math.abs(data[i + j] - v) <= 2)) count++;
    return count;
  }, hex);
}

test('paints inherited and direct paragraph fills with layered text backgrounds, edits headers and reopens exports', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/paragraph-shading.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }), button = page.getByRole('button', { name: 'Paragraph shading', exact: true });
  await expect(input).toHaveValue(/^Paragraph shading Á😀/); const text = await input.inputValue(), pages = await page.locator('canvas.canvas-page').count(); expect(pages).toBeGreaterThan(2);
  await expect(button.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  for (const hex of ['F4F4F4', 'DDEEFF', '224466', 'C3D69B', 'FFFF00', 'CCAAEE', '0050C8', '000000', '66CCDD', '55AA77', 'FFE4CC']) expect(await pixels(page, hex), hex).toBeGreaterThan(100);
  const contrast = await page.locator('canvas.canvas-page').first().evaluate(canvas => {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const rgb = (x, y) => [...d.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 3)];
    let white = 0;
    for (let y = 0; y < canvas.height; y++) {
      const xs = []; for (let x = 0; x < canvas.width; x++) if (rgb(x, y).join() === '0,80,200') xs.push(x);
      if (xs.length > 100) for (let x = xs[0]; x <= xs.at(-1); x++) if (rgb(x, y).every(v => v > 240)) white++;
    }
    return white;
  }); expect(contrast).toBeGreaterThan(20);
  await choose(input, 'Direct override'); await shade(page, 'AABBCC'); await expect(button).toHaveAttribute('title', 'Paragraph shading: #AABBCC');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(button).toHaveAttribute('title', 'Paragraph shading: #224466');
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await choose(input, 'Theme background'); await shade(page, 'auto');
  await choose(input, 'Shaded header'); await shade(page, '55AA77'); await choose(input, 'Tail', true);
  expect(await pixels(page, 'FFFF00')).toBeGreaterThan(100); expect(await pixels(page, 'CCAAEE')).toBeGreaterThan(100); expect(await pixels(page, 'C3D69B')).toBe(0);
  let repeated = 0, cellFill = 0, paragraphFill = 0;
  for (let index = 1; index < pages; index++) {
    if (await pixels(page, '55AA77', index) > 100) repeated++;
    cellFill += await pixels(page, '224466', index); paragraphFill += await pixels(page, 'FFDDAA', index);
  }
  expect(cellFill).toBeGreaterThan(100); expect(paragraphFill).toBeGreaterThan(100);
  expect(repeated).toBeGreaterThan(1); await expect(page.locator('canvas.canvas-page')).toHaveCount(pages); await expect(input).toHaveValue(text);
  const saved = await download(page, testInfo, 'paragraph-shading.docx'); await reopenDocx(page, input, saved, text);
  for (const [label, value] of [['Direct override', '#AABBCC'], ['Theme background', 'No fill'], ['Shaded header', '#55AA77']]) { await choose(input, label); await expect(button).toHaveAttribute('title', 'Paragraph shading: ' + value); }
  await choose(input, 'Tail', true); const png = await page.locator('canvas.canvas-page').first().evaluate(c => c.toDataURL().split(',')[1]); writeFileSync(testInfo.outputPath('paragraph-shading.png'), Buffer.from(png, 'base64'));
  const tablePng = await page.locator('canvas.canvas-page').last().evaluate(c => c.toDataURL().split(',')[1]); writeFileSync(testInfo.outputPath('paragraph-shading-table.png'), Buffer.from(tablePng, 'base64'));
  await button.click(); await page.screenshot({ path: testInfo.outputPath('paragraph-shading-dialog.png'), animations: 'disabled' });
  await page.keyboard.press('Escape'); expect(errors).toEqual([]);
});

test('authors fills and explicit no-fill, reports mixed paragraphs and saves a fresh document', async ({ page }, testInfo) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }), button = page.getByRole('button', { name: 'Paragraph shading', exact: true });
  await expect(input).toHaveValue(''); await input.fill('Blue paragraph\nPlain paragraph\nLast paragraph');
  await choose(input, 'Blue paragraph'); await shade(page, '224466');
  await choose(input, 'Plain paragraph'); await shade(page, 'foreground'); await expect(button).toHaveAttribute('title', 'Paragraph shading: Automatic foreground'); await shade(page, 'auto');
  await choose(input, 'Last paragraph'); await shade(page, '55AA77'); await choose(input, 'Blue paragraph\nPlain paragraph');
  await expect(button).toHaveAttribute('title', 'Paragraph shading: Mixed'); await button.click(); await expect(page.getByText(/selection has mixed colors/)).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  const text = await input.inputValue(), saved = await download(page, testInfo, 'new-paragraph-shading.docx'); await reopenDocx(page, input, saved, text);
  for (const [label, value] of [['Blue paragraph', '#224466'], ['Plain paragraph', 'No fill'], ['Last paragraph', '#55AA77']]) { await choose(input, label); await expect(button).toHaveAttribute('title', 'Paragraph shading: ' + value); }
});

test('edits shared style shading, removes a declaration to inherit and retains direct paragraph overrides', async ({ page }) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/paragraph-shading.docx');
  const input = page.getByRole('textbox', { name: 'Document text' }), button = page.getByRole('button', { name: 'Paragraph shading', exact: true });
  await expect(input).toHaveValue(/^Paragraph shading/); await choose(input, 'Inherited first');
  const edit = async value => {
    await page.getByRole('button', { name: 'Edit paragraph style', exact: true }).click();
    await page.getByRole('textbox', { name: 'Style paragraph fill', exact: true }).fill(value);
    await page.getByRole('dialog').getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  };
  await edit('334455'); await choose(input, 'Inherited second'); await expect(button).toHaveAttribute('title', 'Paragraph shading: #334455');
  await choose(input, 'Direct override'); await expect(button).toHaveAttribute('title', 'Paragraph shading: #224466');
  await choose(input, 'Inherited first'); await edit('auto'); await expect(button).toHaveAttribute('title', 'Paragraph shading: No fill');
  await edit(''); await expect(button).toHaveAttribute('title', 'Paragraph shading: #DDEEFF');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(button).toHaveAttribute('title', 'Paragraph shading: No fill');
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(button).toHaveAttribute('title', 'Paragraph shading: #DDEEFF');
});

test('finalizes composition before opening paragraph shading and preserves separate undo steps', async ({ page }) => {
  await page.goto('/playground.html'); await showAllTools(page); await page.getByRole('button', { name: 'New', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue('');
  await input.evaluate(el => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); el.value = 'Compose Á😀'; el.setSelectionRange(el.value.length, el.value.length);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: el.value, isComposing: true }));
  });
  await shade(page, '224466'); await expect(input).toHaveValue('Compose Á😀');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue('Compose Á😀');
  await expect(page.getByRole('button', { name: 'Paragraph shading', exact: true })).toHaveAttribute('title', 'Paragraph shading: No fill');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue('');
});

test('previews unsupported paragraph patterns as read-only with the original available', async ({ page }) => {
  const parts = unzipSync(readFileSync('public/fixtures/paragraph-shading.docx'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('w:val="clear" w:fill="224466"', 'w:val="diagStripe" w:fill="224466"'));
  await page.goto('/playground.html'); await showAllTools(page); const input = page.getByRole('textbox', { name: 'Document text' }); await expect(input).toHaveValue(/^A small beginning/); const before = await input.inputValue();
  await openReadOnlyPreview(page, { name: 'patterned-paragraph.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zipSync(parts)) });

});
