import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

const family = 'Picker Local Fixture';
const button = (page, name) => page.getByRole('button', { name, exact: true });
const input = page => page.getByRole('textbox', { name: 'Document text' });
async function open(page, mode) {
  await page.addInitScript(mode => {
    window.fontQueries = 0;
    window.queryLocalFonts = mode === 'unsupported' ? undefined : async () => {
      window.fontQueries++;
      if (mode === 'denied') throw new DOMException('Denied', 'NotAllowedError');
      if (mode === 'pending') await new Promise(resolve => { window.resolveFonts = resolve; });
      return ['Picker Local Fixture', 'Picker Local Fixture', 'Arial'].map(family => ({ family, blob() { throw Error('Must not read font files'); } }));
    };
  }, mode);
  await page.goto('/playground.html');
  // An independently named, real browser face keeps this UI test portable.
  await page.evaluate(async family => document.fonts.add(await new FontFace(family, 'url(/fonts/BebasNeue-Regular.ttf)').load()), family);
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/editor-ux.docx');
  await expect(input(page)).toHaveValue(/^Editor workspace/);
  await select(page);
  await button(page, 'Latin font family').click();
}
async function select(page) {
  await input(page).evaluate(el => {
    const at = el.value.indexOf('Choose this font éΩ');
    el.focus(); el.setSelectionRange(at, at + 'Choose this font éΩ'.length); el.dispatchEvent(new Event('select'));
  });
}
for (const mode of ['enumerated', 'unsupported']) test(`${mode} installed font selection preserves package parts, script slots, undo and reopen`, async ({ page }, info) => {
  await open(page, mode);
  expect(await page.evaluate(() => window.fontQueries)).toBe(0);
  if (mode === 'enumerated') {
    await button(page, 'Browse installed fonts').click();
    await expect(page.getByRole('dialog', { name: 'Font', exact: true }).getByRole('status')).toContainText('2 installed font families');
    await expect(button(page, `${family} On this device`)).toHaveCount(1);
    await button(page, `${family} On this device`).click();
  } else {
    await expect(button(page, 'Browse installed fonts')).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search fonts' }).fill(family);
    await page.getByRole('searchbox', { name: 'Search fonts' }).press('Enter');
  }
  await expect(button(page, 'Latin font family')).toHaveText(family);
  await expect(input(page)).toBeFocused();
  await button(page, 'Undo').click(); await expect(button(page, 'Latin font family')).not.toHaveText(family);
  await button(page, 'Redo').click(); await expect(button(page, 'Latin font family')).toHaveText(family);
  const download = page.waitForEvent('download'); await button(page, 'Download .docx').click();
  const saved = info.outputPath(`${mode}-fonts.docx`); await (await download).saveAs(saved);
  const original = unzipSync(readFileSync('public/fixtures/editor-ux.docx')), parts = unzipSync(readFileSync(saved));
  for (const [name, bytes] of Object.entries(original)) if (name !== 'word/document.xml') expect(Buffer.from(parts[name]).equals(Buffer.from(bytes)), name).toBe(true);
  const xml = strFromU8(parts['word/document.xml']);
  expect(xml).toContain(`w:ascii="${family}"`); expect(xml).toContain(`w:hAnsi="${family}"`);
  expect(xml).toContain('w:eastAsia="Noto Sans"'); expect(xml).toContain('w:cs="Noto Sans"');
  await reopenDocx(page, input(page), saved, await input(page).inputValue()); await select(page);
  await expect(button(page, 'Latin font family')).toHaveText(family);
});
test('denial keeps the picker usable and missing names never change the document', async ({ page }) => {
  await open(page, 'denied');
  await button(page, 'Browse installed fonts').click();
  await expect(page.getByRole('dialog', { name: 'Font', exact: true }).getByRole('status')).toContainText('could not be listed');
  const search = page.getByRole('searchbox', { name: 'Search fonts' });
  await search.fill('Definitely Missing Picker Font 842'); await search.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Font', exact: true }).getByRole('status')).toContainText('could not be loaded on this device');
  await expect(page.getByRole('dialog', { name: 'Font', exact: true })).toBeVisible();
  await search.fill(family); await button(page, `Use “${family}”`).click();
  await expect(button(page, 'Latin font family')).toHaveText(family);
});
test('closing a pending enumeration does not reopen the picker or apply a font', async ({ page }) => {
  await open(page, 'pending');
  const before = await button(page, 'Latin font family').textContent();
  await button(page, 'Browse installed fonts').click();
  await expect(button(page, 'Browse installed fonts')).toBeDisabled();
  await page.keyboard.press('Escape'); await page.evaluate(() => window.resolveFonts());
  await expect(page.getByRole('dialog', { name: 'Font', exact: true })).toHaveCount(0);
  await expect(button(page, 'Latin font family')).toHaveText(before);
});
