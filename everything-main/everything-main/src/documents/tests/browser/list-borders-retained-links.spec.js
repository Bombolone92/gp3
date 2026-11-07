import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const FIXTURE = 'tests/fixtures/list-borders-retained-links/combined.docx';
async function choose(input, text) { await input.evaluate((el, text) => { const at = el.value.indexOf(text); if (at < 0) throw new Error('Missing text'); el.setSelectionRange(at, at + text.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, text); }
async function dialog(page, input) { await input.focus(); await input.press('ControlOrMeta+k'); await expect(page.getByRole('dialog')).toBeVisible(); }

test('opens list-level borders, picture nvPr and unopenable links for editing and keeps them on download', async ({ page }, info) => {
  await page.addInitScript(() => { window.linkOpens = []; window.open = (...args) => { window.linkOpens.push(args); return null; }; });
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(FIXTURE);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^List level borders/);
  await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.getByText('Some features are shown approximately')).toHaveCount(0);
  await expect(page.locator('#playground-error')).toBeEmpty();

  // The retained destination is shown, explained and kept when left unchanged.
  await choose(input, 'relative destination'); await dialog(page, input);
  const box = page.getByRole('dialog');
  await expect(box.getByRole('textbox', { name: 'Link address', exact: true })).toHaveValue('../Shared Documents/Plan v2.docx');
  await expect(box).toContainText('can’t be opened here');
  await expect(box.getByRole('button', { name: 'Open link', exact: true })).toHaveCount(0);
  await box.screenshot({ path: info.outputPath('retained-link-dialog.png'), animations: 'disabled' });
  await box.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(box.getByRole('alert')).toHaveCount(0);

  // Ordinary links still open.
  await choose(input, 'web destination'); await dialog(page, input);
  await page.getByRole('dialog').getByRole('button', { name: 'Open link', exact: true }).click();
  expect(await page.evaluate(() => window.linkOpens)).toEqual([['https://example.com/report', '_blank', 'noopener,noreferrer']]);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();

  await choose(input, 'Bordered item one'); await input.press('End'); await input.pressSequentially(' edited');
  await choose(input, 'file destination'); await input.press('End'); await input.pressSequentially(' edited');
  await page.locator('canvas.canvas-page').first().screenshot({ path: info.outputPath('list-level-borders.png') });
  const text = await input.inputValue();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const path = info.outputPath('list-borders-retained-links.docx'); await (await event).saveAs(path);
  const parts = unzipSync(readFileSync(path));
  const rels = strFromU8(parts['word/_rels/document.xml.rels']);
  for (const target of ['../Shared Documents/Plan v2.docx', 'file:///C:\\Reports\\Q3 summary.docx', 'Appendix A.docx', 'https://example.com/report']) expect(rels).toContain(`Target="${target}"`);
  expect(strFromU8(parts['word/numbering.xml'])).toBe(strFromU8(unzipSync(readFileSync(FIXTURE))['word/numbering.xml']));
  expect(strFromU8(parts['word/document.xml'])).toContain('<pic:nvPr/>');
  await reopenDocx(page, input, path, text);
  await expect(input).toHaveJSProperty('readOnly', false);
});
