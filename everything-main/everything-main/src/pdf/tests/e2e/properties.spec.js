import { clickAway } from './editing-helpers.js';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { addHighlight } from '../../src/core/highlight.js';
import { addNote } from '../../src/core/notes.js';

async function openDocument(page) {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  const sheet = doc.addPage([600, 800]);
  sheet.drawText('Edit this text', {
    x: 50,
    y: 690,
    size: 24,
    font: await doc.embedFont(StandardFonts.Helvetica),
  });
  sheet.drawRectangle({
    x: 70,
    y: 440,
    width: 200,
    height: 120,
    color: rgb(0.85, 0.3, 0.3),
    borderColor: rgb(0.3, 0.1, 0.1),
    borderWidth: 2,
  });
  addHighlight(doc, 0, {
    quads: [[50, 650, 240, 650, 50, 630, 240, 630]],
    hex: '#ffff00',
  });
  addNote(doc, 0, { x: 340, y: 540, text: 'A review note', hex: '#ffff00' });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'properties.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
  return page.getByRole('complementary', { name: 'Selection properties' });
}

async function expectDocked(page, dock) {
  await expect(dock).toBeVisible();
  const [panel, workspace] = await Promise.all([
    dock.boundingBox(),
    page.locator('.workspace').boundingBox(),
  ]);
  if (page.viewportSize().width > 1000) {
    // Selection settings sit in the tools column, beside the page rather than over it.
    expect(panel.x + panel.width).toBeLessThanOrEqual(workspace.x + 1);
  } else {
    expect(panel.y).toBeGreaterThanOrEqual(workspace.y + workspace.height - 1);
  }
  expect(panel.x + panel.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(panel.y + panel.height).toBeLessThanOrEqual(page.viewportSize().height);
  await expect(
    page.locator(
      '.paper .text-edit-actions, .paper .image-edit-panel, .paper .note-editor, .paper .highlight-edit-panel, .paper .crop-panel',
    ),
  ).toHaveCount(0);
}

test('properties follow text, shapes, highlights, and notes without covering the page', async ({
  page,
}, testInfo) => {
  const dock = await openDocument(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Edit text: Edit this text', exact: true }).click();
  await expect(dock.getByRole('heading')).toHaveText('Text');
  await expectDocked(page, dock);
  await expect(page.locator('.contextbar').getByLabel('Text size')).toBeVisible();
  await expect(
    page.locator('.paper').getByRole('button', { name: 'Move text', exact: true }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Edit text', exact: true }).fill('Updated text');
  await page.screenshot({ path: testInfo.outputPath('text-properties.png') });
  await clickAway(page);
  await expect(
    page.getByRole('button', { name: 'Edit text: Updated text', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const shape = page.getByRole('button', { name: 'Select shape 1', exact: true });
  await shape.press('Enter');
  await expect(dock.getByRole('heading')).toHaveText('Shape');
  await expectDocked(page, dock);
  const width = dock.getByLabel('Shape width in points', { exact: true });
  await width.fill('210');
  await width.press('Tab');
  await expect(width).toBeEnabled();
  await expect(width).toHaveValue('210');
  await page.screenshot({ path: testInfo.outputPath('shape-properties.png') });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: /^Edit highlight/ }).click();
  await expect(dock.getByRole('heading')).toHaveText('Highlight');
  await expect(dock.getByLabel('Highlight color')).toBeFocused();
  await expectDocked(page, dock);
  await page.getByRole('button', { name: 'Edit note: A review note', exact: true }).click();
  await expect(dock.getByRole('heading')).toHaveText('Note');
  await expect(dock.getByLabel('Note text')).toHaveValue('A review note');
  await expectDocked(page, dock);
  await dock.getByLabel('Note text').fill('Updated note');
  await clickAway(page);
  await expect(
    page.getByRole('button', { name: 'Edit note: Updated note', exact: true }),
  ).toBeVisible();
  await expect(dock.getByRole('group')).toHaveCount(0);
});

test('fit-page selection and dock stay stable through scrolling and cancellation', async ({
  page,
}) => {
  const dock = await openDocument(page);
  await page.getByLabel('Zoom', { exact: true }).selectOption('page');
  await page.getByRole('button', { name: 'Select shape 1', exact: true }).press('Enter');
  await expect(dock.getByRole('heading')).toHaveText('Shape');
  await expectDocked(page, dock);
  const bounds = await dock.boundingBox();
  // A workspace resize observer runs after opening the phone's bottom dock. It must
  // not refit the page, clear selection, then expand and refit it again.
  await expect
    .poll(async () => {
      await page.locator('.workspace').evaluate((node) => {
        node.scrollTop += 20;
      });
      return dock.getByLabel('Shape width in points').inputValue();
    })
    .toBe('202');
  await page.waitForTimeout(300);
  const width = dock.getByLabel('Shape width in points');
  await width.fill('');
  await width.press('Escape');
  await expect(width).toHaveValue('202');
  await expectDocked(page, dock);
  expect(await dock.boundingBox()).toEqual(bounds);
  await width.press('Escape');
  await expect(page.getByRole('button', { name: 'Select shape 1', exact: true })).toBeFocused();
  await expect(dock.getByRole('group')).toHaveCount(0);
});
