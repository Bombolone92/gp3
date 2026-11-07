import { test, expect } from '@playwright/test';
import { PDFDocument, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { inspectPaths } from '../../src/core/path-edit.js';

async function openShape(page, neighbor = false, kind = 'shape') {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  const sheet = doc.addPage([400, 400]);
  if (kind === 'image') {
    const image = await doc.embedPng(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    sheet.drawImage(image, { x: 80, y: 160, width: 80, height: 60 });
  } else
    sheet.drawRectangle({
      x: 80,
      y: 160,
      width: 80,
      height: 60,
      color: rgb(1, 0, 0),
      borderColor: rgb(0, 0, 1),
      borderWidth: 4,
    });
  if (neighbor)
    doc.getPage(0).drawRectangle({ x: 250, y: 160, width: 80, height: 60, color: rgb(0, 1, 0) });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'shape.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
  const target = page.getByRole('button', { name: `Select ${kind} 1`, exact: true });
  await target.focus();
  await target.press('Enter');
  await expect(page.getByRole('group', { name: `Edit ${kind}`, exact: true })).toBeVisible();
}

for (const label of [
  'Shape stroke width in points',
  'Shape width in points',
  'Shape height in points',
])
  test(`empty ${label} does not change the PDF or create an error`, async ({ page }) => {
    await openShape(page);
    const field = page.getByLabel(label, { exact: true });
    const original = await field.inputValue();
    await field.fill('');
    await field.press('Tab');
    await expect(field).toBeEnabled();
    await expect(field).toHaveValue('');
    await expect(page.locator('.image-error')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    await field.press('Escape');
    await expect(field).toHaveValue(original);
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await field.fill('12');
    await field.press('Tab');
    await expect(field).toHaveValue('12');
    await expect(field).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const doc = await PDFDocument.load(await readFile(await (await download).path()));
    const shape = inspectPaths(doc, 0)[0];
    if (label.includes('stroke')) expect(shape.state.width).toBe(12);
    else {
      const axis = label.includes('width') ? 0 : 2;
      expect(Math.hypot(...shape.transform.slice(axis, axis + 2))).toBeCloseTo(12, 5);
    }
  });

for (const [label, value, check] of [
  ['Shape width in points', '120', (shape) => Math.hypot(...shape.transform.slice(0, 2))],
  ['Shape height in points', '96', (shape) => Math.hypot(...shape.transform.slice(2, 4))],
  ['Shape stroke width in points', '8', (shape) => shape.state.width],
  ['Shape fill opacity in percent', '25', (shape) => shape.state.alpha * 100],
  ['Shape stroke opacity in percent', '75', (shape) => shape.state.strokeAlpha * 100],
  [
    'Shape rotation in degrees',
    '45',
    (shape) => (360 - (Math.atan2(shape.transform[1], shape.transform[0]) * 180) / Math.PI) % 360,
  ],
])
  test(`Download shortcut includes a focused ${label} edit`, async ({ page }) => {
    await openShape(page);
    const field = page.getByLabel(label, { exact: true });
    await field.fill(value);
    const download = page.waitForEvent('download');
    await field.press('ControlOrMeta+Shift+s');
    const doc = await PDFDocument.load(await readFile(await (await download).path()));
    expect(check(inspectPaths(doc, 0)[0])).toBeCloseTo(Number(value), 5);
    await expect(field).toHaveValue(value);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  });

for (const [label, value] of [
  ['Shape width in points', ''],
  ['Shape stroke width in points', '-1'],
  ['Shape fill opacity in percent', ''],
  ['Shape stroke opacity in percent', '101'],
  ['Shape rotation in degrees', '361'],
])
  test(`Download keeps invalid ${label} available for correction`, async ({ page }) => {
    await openShape(page);
    const field = page.getByLabel(label, { exact: true });
    await field.fill(value);
    const downloads = [];
    page.on('download', (download) => downloads.push(download));
    await field.press('ControlOrMeta+Shift+s');
    await expect(page.locator('#toast')).toContainText('Choose a valid object property');
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(value);
    expect(downloads).toHaveLength(0);
    await field.fill('12');
    const download = page.waitForEvent('download');
    await field.press('ControlOrMeta+Shift+s');
    await download;
    await expect(field).toHaveValue('12');
  });

test('Download with an unchanged focused shape dimension creates no history', async ({ page }) => {
  await openShape(page);
  const field = page.getByLabel('Shape width in points', { exact: true });
  await field.focus();
  const download = page.waitForEvent('download');
  await field.press('ControlOrMeta+Shift+s');
  await download;
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('84');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

for (const [label, value] of [
  ['Shape width in points', '120'],
  ['Shape stroke width in points', '8'],
  ['Shape fill opacity in percent', '25'],
  ['Shape rotation in degrees', '45'],
  ['Shape height in points', ''],
])
  test(`pending ${label} protects unsaved input and can be discarded`, async ({ page }) => {
    await openShape(page);
    const field = page.getByLabel(label, { exact: true });
    const original = await field.inputValue();
    const warns = () =>
      page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
    expect(await warns()).toBe(false);
    await field.fill(value);
    expect(await warns()).toBe(true);
    await expect(page.locator('.save-status')).toHaveText('Unsaved changes');
    await expect(page).toHaveTitle(/^\* /);
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    await expect(undo).toBeEnabled();
    await field.press('Escape');
    await expect(field).toHaveValue(original);
    await expect(undo).toBeDisabled();
    expect(await warns()).toBe(false);
    await field.fill(value);
    await undo.click();
    await expect(field).toHaveValue(original);
    await expect(undo).toBeDisabled();
    expect(await warns()).toBe(false);
  });

test('selecting another shape commits the typed property before changing selection', async ({
  page,
}) => {
  await openShape(page, true);
  await page.getByLabel('Shape width in points', { exact: true }).fill('120');
  const target = page.getByRole('button', { name: 'Select shape 2', exact: true });
  await target.click();
  await expect(target).toHaveAttribute('aria-pressed', 'true');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const doc = await PDFDocument.load(await readFile(await (await download).path()));
  expect(Math.hypot(...inspectPaths(doc, 0)[0].transform.slice(0, 2))).toBeCloseTo(120, 5);
});

for (const kind of ['shape', 'image'])
  test(`Tab after a ${kind} width edit advances to height through the document reload`, async ({
    page,
  }) => {
    await openShape(page, false, kind);
    const label = kind === 'shape' ? 'Shape' : 'Image';
    const width = page.getByLabel(`${label} width in points`, { exact: true });
    const height = page.getByLabel(`${label} height in points`, { exact: true });
    await width.fill('120');
    await width.press('Tab');
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await expect(height).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('90');
    await height.press('Shift+Tab');
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await expect(width).toBeFocused();
  });
