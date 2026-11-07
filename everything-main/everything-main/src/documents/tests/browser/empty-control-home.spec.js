import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

const root = 'tests/fixtures/empty-inline-controls/';
const ref = JSON.parse(readFileSync(root + 'navigation/reference.json', 'utf8'));
test('document Home and two Right keys match the native empty-control route', async ({ page }, info) => {
  const source = readFileSync(root + 'control.docx');
  expect(createHash('sha256').update(source).digest('hex')).toBe(ref.sourceSha256);
  expect(createHash('sha256').update(readFileSync(root + 'navigation/native-keyboard.docx')).digest('hex')).toBe(ref.resultSha256);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(root + 'control.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Start suffix/);
  const original = await input.inputValue();
  const save = async name => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(name + '.docx'); await (await pending).saveAs(path); return path;
  };
  await input.focus(); await input.press('Control+Home');
  expect(unzipSync(readFileSync(await save('home')))).toEqual(unzipSync(source));
  await input.focus(); await input.press('ArrowRight'); await input.press('ArrowRight');
  await page.keyboard.insertText('X');
  await expect(input).toHaveValue(ref.firstParagraph + original.slice(original.indexOf('\n')));
  const text = await input.inputValue(), saved = await save('edited'), parts = unzipSync(readFileSync(saved));
  const controls = await page.evaluate(xml => {
    const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const d = new DOMParser().parseFromString(xml, 'application/xml');
    return [...d.getElementsByTagNameNS(w, 'sdt')].map(s => ({
      text: [...s.getElementsByTagNameNS(w, 't')].map(t => t.textContent).join(''),
      placeholder: !!s.getElementsByTagNameNS(w, 'showingPlcHdr').length,
    }));
  }, strFromU8(parts['word/document.xml']));
  expect(controls).toEqual(ref.controls.map(({ text, placeholder }) => ({ text, placeholder })));
  for (const [name, data] of Object.entries(unzipSync(source))) if (name !== 'word/document.xml') expect(parts[name]).toEqual(data);
  await input.focus(); await input.press('ControlOrMeta+z'); await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue(original); expect(unzipSync(readFileSync(await save('undo')))).toEqual(unzipSync(source));
  await reopenDocx(page, input, saved, text); expect(errors).toEqual([]);
});
