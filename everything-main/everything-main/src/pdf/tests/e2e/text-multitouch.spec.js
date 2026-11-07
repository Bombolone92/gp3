import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function openParagraph(page) {
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  doc.addPage([500, 500]).drawText('One two three\nfour five.', {
    x: 40.123456,
    y: 400.654321,
    size: 18,
    lineHeight: 22,
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'test.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.locator('.text-target').click();
  return page.getByRole('textbox', { name: 'Edit text', exact: true });
}

for (const [primaryName, secondaryName] of [
  ['Move text', 'Resize paragraph width'],
  ['Resize paragraph width', 'Move text'],
]) {
  test(`a second finger on ${secondaryName} does not start another text gesture`, async ({
    page,
  }) => {
    await openParagraph(page);
    const primary = page.getByRole('button', { name: primaryName, exact: true });
    const secondary = page.getByRole('button', { name: secondaryName, exact: true });
    const state = () =>
      page.evaluate(() =>
        ['Text X in points', 'Text Y in points', 'Paragraph width in points'].map(
          (label) => document.querySelector(`[aria-label="${label}"]`).value,
        ),
      );
    const before = await state();
    const at = async (control, id) => {
      const box = await control.boundingBox();
      const move = (await control.getAttribute('aria-label')) === 'Move text';
      const point = {
        id,
        x: box.x + (move ? 3 : box.width / 2),
        y: box.y + (move ? 3 : box.height / 2),
      };
      expect(
        await control.evaluate(
          (node, point) => node.contains(document.elementFromPoint(point.x, point.y)),
          point,
        ),
      ).toBe(true);
      return point;
    };
    const first = await at(primary, 1);
    const second = await at(secondary, 2);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [first, second],
    });
    second.x += 20;
    second.y += 10;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [first, second] });
    expect(await state()).toEqual(before);
    // The ignored second contact must not prevent the primary finger from dragging.
    first.x += 12;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [first, second] });
    await expect.poll(state).not.toEqual(before);
    const after = await state();
    if (primaryName === 'Move text') expect(after[2]).toBe(before[2]);
    else expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    expect(await state()).toEqual(before);
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  });
}
