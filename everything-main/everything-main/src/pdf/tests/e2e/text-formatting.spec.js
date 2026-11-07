import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName, StandardFonts, degrees } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { listHighlights } from '../../src/core/highlight.js';

async function openPdf(page, doc) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'formatting.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
}
async function prepare(page, rotation = 0) {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  const doc = await PDFDocument.create(),
    sheet = doc.addPage([500, 500]);
  sheet.setRotation(degrees(rotation));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  sheet.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F: font.ref } }));
  sheet.node.set(
    PDFName.of('Contents'),
    doc.context.register(
      doc.context.flateStream(
        'BT /F 20 Tf 60 360 Td (Editable ) Tj (text) Tj 0 -120 Td (Neighbor) Tj ET',
      ),
    ),
  );
  await openPdf(page, doc);
}
async function clickAway(page) {
  await page.locator('.workspace').click({ position: { x: 4, y: 4 } });
  await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
}
async function download(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  return PDFDocument.load(await readFile(await (await pending).path()));
}

for (const rotation of [0, 90])
  test(`selected text exposes font styles that survive export and reopening, rotation ${rotation}`, async ({
    page,
  }, info) => {
    await prepare(page, rotation);
    const target = page.getByRole('button', { name: 'Edit text: Editable text', exact: true });
    await target.click();
    const input = page.getByRole('textbox', { name: 'Edit text', exact: true });
    await expect(input).not.toBeEditable();
    await page.keyboard.press('Control+u');
    await expect(page.getByRole('button', { name: 'Underline', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('Control+u');
    for (const style of ['Bold', 'Italic', 'Underline', 'Strikethrough']) {
      const button = page.getByRole('button', { name: style, exact: true });
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(input).toHaveCSS('text-decoration-line', 'underline line-through');
    await expect(input.locator('[data-part]').first()).toHaveCSS('font-weight', '700');
    await expect(input.locator('[data-part]').first()).toHaveCSS('font-style', 'italic');
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.fonts].some(
            (face) =>
              face.family.includes('Noto Sans Styled') &&
              face.weight === '700' &&
              face.style === 'italic' &&
              face.status === 'loaded',
          ),
        ),
      )
      .toBe(true);
    await page.screenshot({ path: info.outputPath('selected-text-formatting.png') });
    await clickAway(page);
    await expect(page.locator('.path-target')).toHaveCount(0);
    const saved = await download(page);
    expect(listHighlights(saved, 0)).toHaveLength(0);
    await page.getByRole('button', { name: 'Back to your PDFs', exact: true }).click();
    await openPdf(page, saved);
    await target.click();
    for (const style of ['Bold', 'Italic', 'Underline', 'Strikethrough'])
      await expect(page.getByRole('button', { name: style, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    await page.getByRole('button', { name: 'Underline', exact: true }).click();
    await clickAway(page);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await target.click();
    await expect(page.getByRole('button', { name: 'Underline', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Strikethrough', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

test('decorations follow dragged text and can be removed without entering typing mode', async ({
  page,
}) => {
  await prepare(page);
  const target = page.getByRole('button', { name: 'Edit text: Editable text', exact: true });
  await target.click();
  await page.getByRole('button', { name: 'Underline', exact: true }).click();
  await clickAway(page);
  const before = await target.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 24, before.y + before.height / 2 + 18, {
    steps: 4,
  });
  await page.mouse.up();
  await expect.poll(async () => (await target.boundingBox())?.x - before.x).toBeCloseTo(24, 0);
  await expect(page.getByRole('button', { name: 'Underline', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Underline', exact: true }).click();
  await clickAway(page);
  await target.click();
  await expect(page.getByRole('button', { name: 'Underline', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Delete text', exact: true }).click();
  await expect(target).toHaveCount(0);
  await expect(page.locator('.path-target')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Edit text: Neighbor', exact: true }),
  ).toBeVisible();
});
