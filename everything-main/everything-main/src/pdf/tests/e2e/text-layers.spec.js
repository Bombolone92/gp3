import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { decode, pageSource } from '../../src/core/text-edit.js';

for (const form of [false, true]) {
  test(`text in hidden layers has no editing targets (Form XObject=${form})`, async ({ page }) => {
    await page.route('https://js.puter.com/**', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `window.puter = { env: 'web', auth: { isSignedIn: () => true, getUser: async () => ({ username: 'test' }) }, fs: { readdir: async () => [] }, ui: { onLaunchedWithItems: () => {}, onItemsOpened: () => {} } };`,
      }),
    );
    const doc = await PDFDocument.create(),
      ctx = doc.context,
      n = PDFName.of;
    const sheet = doc.addPage([400, 400]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const layer = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of('Hidden') }));
    doc.catalog.set(n('OCProperties'), ctx.obj({ OCGs: [layer], D: { OFF: [layer] } }));
    const hidden = 'BT /F 20 Tf 1 0 0 1 40 320 Tm (Hidden words) Tj ET';
    const resources = ctx.obj({ Font: { F: font.ref }, Properties: { Hidden: layer } });
    if (form)
      resources.set(
        n('XObject'),
        ctx.obj({
          Fm: ctx.register(
            ctx.flateStream(hidden, {
              Type: 'XObject',
              Subtype: 'Form',
              OC: layer,
              BBox: [0, 0, 400, 400],
              Resources: { Font: { F: font.ref } },
            }),
          ),
        }),
      );
    sheet.node.set(n('Resources'), resources);
    sheet.node.set(
      n('Contents'),
      ctx.register(
        ctx.flateStream(`${form ? '/Fm Do' : `/OC /Hidden BDC ${hidden} EMC`}
      BT /F 20 Tf 1 0 0 1 40 140 Tm (Visible words) Tj ET`),
      ),
    );
    await page.goto('/#library');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Open a PDF/ }).click();
    await (
      await chooser
    ).setFiles({
      name: 'layers.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    });
    await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Edit text: Visible words', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.text-target')).toHaveCount(1);
    const blankTop = () =>
      page
        .locator('.paper > canvas')
        .first()
        .evaluate((canvas) =>
          Array.from(
            canvas.getContext('2d').getImageData(0, 0, canvas.width, Math.floor(canvas.height / 2))
              .data,
          ).every((value) => value === 255),
        );
    await expect.poll(blankTop).toBe(true);
    await page.locator('.text-target').click();
    const input = page.getByRole('textbox', { name: 'Edit text', exact: true });
    await input.fill('Changed words');
    await input.press('ControlOrMeta+Enter');
    await expect(
      page.getByRole('button', { name: 'Edit text: Changed words', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.text-target')).toHaveCount(1);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const saved = await PDFDocument.load(await readFile(await (await pending).path()));
    const source = form
      ? decode(saved.getPage(0).node.Resources().lookup(n('XObject')).lookup(n('Fm')))
      : pageSource(saved.getPage(0));
    expect(source).toContain('(Hidden words) Tj');
    expect(saved.catalog.lookup(n('OCProperties')).lookup(n('D')).lookup(n('OFF')).size()).toBe(1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Edit text: Visible words', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.text-target')).toHaveCount(1);
    await expect.poll(blankTop).toBe(true);
  });
}
