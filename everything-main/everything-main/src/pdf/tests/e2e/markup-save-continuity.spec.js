import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { addHighlight, listHighlights, MARKUP_KINDS } from '../../src/core/highlight.js';
import { readFile } from 'node:fs/promises';

async function openMarkup(
  page,
  { kind = 'highlight', mode = 'page', viewportWidth = 850, pages = 1, field = false } = {},
) {
  const { label } = MARKUP_KINDS[kind];
  await page.setViewportSize({ width: viewportWidth, height: 800 });
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  for (let index = 0; index < pages; index++) {
    const sheet = doc.addPage([600, 800]);
    if (field && !index) {
      const review = doc.getForm().createTextField('Review');
      review.setText('Original');
      review.addToPage(sheet, { x: 300, y: 300, width: 160, height: 30 });
    }
    addHighlight(doc, index, {
      kind,
      text: index ? 'Destination' : 'Original',
      hex: '#ffff00',
      quads: [[120, 100, 200, 100, 120, 80, 200, 80]],
    });
  }
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (
    await chooser
  ).setFiles({
    name: 'markup-continuity.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.page-caption')).toHaveText(`Page 1 of ${pages}`);
  const paper = page.locator('.paper');
  await page.getByLabel('Zoom', { exact: true }).selectOption(mode);
  if (mode === '2') await expect(paper).toHaveCSS('width', '1200px');
  else await expect.poll(async () => (await paper.boundingBox())?.width).toBeLessThan(500);
  const target = page.getByRole('button', { name: `Edit ${label}: Original`, exact: true });
  await target.evaluate((node) => node.focus({ preventScroll: true }));
  await page.keyboard.press('Enter');
  const picker = page.getByLabel(`${label[0].toUpperCase() + label.slice(1)} color`, {
    exact: true,
  });
  await expect(picker).toHaveValue('#ffff00');
  await page.waitForTimeout(200);
  return { paper, target, picker };
}

async function exportedPdf(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  return PDFDocument.load(await readFile(await (await pending).path()));
}

async function holdMarkupSave(page, fails = false) {
  await page.evaluate(async (fails) => {
    const { PdfSession } = await import('/src/core/document.js');
    const change = PdfSession.prototype.change;
    PdfSession.prototype.change = async function (...args) {
      PdfSession.prototype.change = change;
      await new Promise((resolve) => {
        window.releaseMarkupSave = resolve;
      });
      if (fails) throw new Error('Delayed markup save failed.');
      return change.apply(this, args);
    };
  }, fails);
}

for (const [kind, { label }] of Object.entries(MARKUP_KINDS))
  for (const fails of [false, true])
    test(`pending ${label} ${fails ? 'failed' : 'successful'} recoloring keeps mutation controls locked`, async ({
      page,
    }) => {
      const { picker } = await openMarkup(page, { kind });
      await holdMarkupSave(page, fails);
      await picker.fill('#00aa00');
      await expect.poll(() => page.evaluate(() => !!window.releaseMarkupSave)).toBe(true);
      const remove = page.getByRole('button', { name: `Delete ${label}`, exact: true });
      const colorLocked = await picker.isDisabled();
      const deleteLocked = await remove.isDisabled();
      await expect(
        page.getByRole('button', { name: `Close ${label} editor`, exact: true }),
      ).toBeEnabled();
      // An enabled native color control must not accept a value that the pending save discards.
      if (!colorLocked) await picker.fill('#0000ff');
      const pendingColor = await picker.inputValue();
      await page.evaluate(() => window.releaseMarkupSave());
      const savedColor = fails ? '#ffff00' : '#00aa00';
      if (fails) await expect(page.locator('#toast')).toHaveText('Delayed markup save failed.');
      await expect(picker).toHaveValue(savedColor);
      await expect(picker).toBeFocused();
      expect(listHighlights(await exportedPdf(page), 0).map((mark) => mark.hex)).toEqual([
        savedColor,
      ]);
      expect({ colorLocked, deleteLocked, pendingColor }).toEqual({
        colorLocked: true,
        deleteLocked: true,
        pendingColor: '#00aa00',
      });
      await expect(picker).toBeEnabled();
      await expect(remove).toBeEnabled();
      if (fails) {
        await picker.fill('#00aa00');
        await expect(picker).toHaveValue('#00aa00');
        expect(listHighlights(await exportedPdf(page), 0).map((mark) => mark.hex)).toEqual([
          '#00aa00',
        ]);
      }
    });

for (const [kind, { label }] of Object.entries(MARKUP_KINDS))
  for (const moved of [false, true])
    test(`a failed ${label} deletion ${moved ? 'preserves newer focus' : 'restores Delete focus'}`, async ({
      page,
    }) => {
      const { picker, target } = await openMarkup(page, { kind });
      const remove = page.getByRole('button', { name: `Delete ${label}`, exact: true });
      await holdMarkupSave(page, true);
      await remove.press('Enter');
      await expect.poll(() => page.evaluate(() => !!window.releaseMarkupSave)).toBe(true);
      await expect(picker).toBeDisabled();
      await expect(remove).toBeDisabled();
      const settings = page.getByRole('button', { name: 'Settings', exact: true });
      if (moved) await settings.focus();
      await page.evaluate(() => window.releaseMarkupSave());
      await expect(page.locator('#toast')).toHaveText('Delayed markup save failed.');
      await expect(picker).toHaveValue('#ffff00');
      await expect(remove).toBeEnabled();
      await expect(moved ? settings : remove).toBeFocused();
      expect(listHighlights(await exportedPdf(page), 0).map((mark) => mark.hex)).toEqual([
        '#ffff00',
      ]);
      await remove.press('Enter');
      await expect(target).toHaveCount(0);
      expect(listHighlights(await exportedPdf(page), 0)).toEqual([]);
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      expect(listHighlights(await exportedPdf(page), 0).map((mark) => mark.hex)).toEqual([
        '#ffff00',
      ]);
      await page.getByRole('button', { name: 'Redo', exact: true }).click();
      expect(listHighlights(await exportedPdf(page), 0)).toEqual([]);
    });

for (const [kind, { label }] of Object.entries(MARKUP_KINDS))
  for (const { field, moved } of [
    { field: false, moved: true },
    { field: true, moved: false },
    { field: true, moved: true },
  ])
    test(`a failed ${label} recolor after ${field ? 'a form draft' : 'a color edit'} ${moved ? 'preserves newer focus' : 'focuses the failed draft'} and restores the saved color`, async ({
      page,
    }) => {
      const { picker } = await openMarkup(page, { kind, field });
      const review = page.getByLabel('Review (on page)', { exact: true });
      if (field) await review.fill('Reviewed');
      await holdMarkupSave(page, true);
      await picker.fill('#00aa00');
      await expect.poll(() => page.evaluate(() => !!window.releaseMarkupSave)).toBe(true);
      await expect(picker).toBeDisabled();
      await expect(
        page.getByRole('button', { name: `Delete ${label}`, exact: true }),
      ).toBeDisabled();
      const settings = page.getByRole('button', { name: 'Settings', exact: true });
      if (moved) {
        await settings.focus();
        await settings.evaluate((node) =>
          node.addEventListener('blur', () => {
            window.markupFocusLost = true;
          }),
        );
      }
      await page.evaluate(() => window.releaseMarkupSave());
      await expect(page.locator('#toast')).toHaveText('Delayed markup save failed.');
      await expect(picker).toHaveValue('#ffff00');
      await expect(page.locator('.properties-sidebar')).not.toHaveClass(/is-switching/);
      await expect(moved ? settings : review).toBeFocused();
      if (moved) expect(await page.evaluate(() => !!window.markupFocusLost)).toBe(false);
      if (field) await expect(review).toHaveValue('Reviewed');
      else {
        await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
        expect(listHighlights(await exportedPdf(page), 0).map((mark) => mark.hex)).toEqual([
          '#ffff00',
        ]);
      }
      await picker.fill('#00aa00');
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
      await expect(picker).toHaveValue('#00aa00');
      const exported = await exportedPdf(page);
      expect(listHighlights(exported, 0).map((mark) => mark.hex)).toEqual(['#00aa00']);
      if (field) expect(exported.getForm().getTextField('Review').getText()).toBe('Reviewed');
    });

for (const key of ['=', '2'])
  test(`zoom shortcut ${key} during a markup recolor overrides the retained fit-page scale`, async ({
    page,
  }) => {
    const { paper, picker } = await openMarkup(page);
    const before = (await paper.boundingBox()).width;
    await holdMarkupSave(page);
    await page.evaluate(() => {
      window.zoomFrames = { running: true, widths: [] };
      const sample = () => {
        if (!window.zoomFrames.running) return;
        window.zoomFrames.widths.push(
          document.querySelector('.paper').getBoundingClientRect().width,
        );
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await picker.fill('#00aa00');
    await expect.poll(() => page.evaluate(() => !!window.releaseMarkupSave)).toBe(true);
    await page.keyboard.press(`ControlOrMeta+${key}`);
    await page.evaluate(() => window.releaseMarkupSave());
    // The next fixed zoom level above the fitted page's scale.
    const above = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5].find(
      (level) => level > (before / 600) * 1.01,
    );
    const mode = key === '=' ? String(above) : 'fit';
    await expect(page.getByLabel('Zoom', { exact: true })).toHaveValue(mode);
    const expected =
      key === '='
        ? above * 600
        : await page
            .locator('.workspace')
            .evaluate((node) => Math.min(1.5, (node.clientWidth - 120) / 600) * 600);
    await expect.poll(async () => (await paper.boundingBox())?.width).toBeCloseTo(expected, 0);
    await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.properties-sidebar')).not.toHaveClass(/is-switching/);
    const widths = await page.evaluate(() => {
      window.zoomFrames.running = false;
      return window.zoomFrames.widths;
    });
    expect(widths.length).toBeGreaterThan(1);
    expect(
      widths.filter((width) => Math.abs(width - before) > 0.5 && Math.abs(width - expected) > 0.5),
    ).toEqual([]);
    expect(listHighlights(await exportedPdf(page), 0).map((mark) => mark.hex)).toEqual(['#00aa00']);
  });

test('queued Undo after a pending markup recolor restores the original color once', async ({
  page,
}) => {
  const { picker } = await openMarkup(page);
  await holdMarkupSave(page);
  await picker.fill('#00aa00');
  await expect.poll(() => page.evaluate(() => !!window.releaseMarkupSave)).toBe(true);
  await page.keyboard.press('ControlOrMeta+z');
  await page.evaluate(() => window.releaseMarkupSave());
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.locator('.properties-sidebar')).toHaveClass(/is-empty/);
  await expect(page.locator('.properties-sidebar')).not.toHaveClass(/is-switching/);
  expect(listHighlights(await exportedPdf(page), 0).map((mark) => mark.hex)).toEqual(['#ffff00']);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  expect(listHighlights(await exportedPdf(page), 0).map((mark) => mark.hex)).toEqual(['#00aa00']);
});

test('page navigation during a markup recolor releases its old dock and preserves newer focus', async ({
  page,
}) => {
  const { picker } = await openMarkup(page, { pages: 2 });
  await holdMarkupSave(page);
  await picker.fill('#00aa00');
  await expect.poll(() => page.evaluate(() => !!window.releaseMarkupSave)).toBe(true);
  const number = page.getByLabel('Page number', { exact: true });
  await number.fill('2');
  await number.press('Enter');
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await settings.focus();
  await page.evaluate(() => window.releaseMarkupSave());
  await expect(page.locator('.page-caption')).toHaveText('Page 2 of 2');
  await expect(page.locator('.paper')).toHaveAttribute('aria-busy', 'false');
  await expect(settings).toBeFocused();
  await expect(page.locator('.properties-sidebar')).toHaveClass(/is-empty/);
  await expect(page.locator('.properties-sidebar')).not.toHaveClass(/is-switching/);
  const exported = await exportedPdf(page);
  expect(listHighlights(exported, 0).map((mark) => mark.hex)).toEqual(['#00aa00']);
  expect(listHighlights(exported, 1).map((mark) => mark.hex)).toEqual(['#ffff00']);
});

for (const viewportWidth of [390, 850])
  for (const [kind, { label }] of Object.entries(MARKUP_KINDS))
    for (const mode of ['2', 'page'])
      for (const fails of [false, true])
        test(`${fails ? 'failed' : 'successful'} recoloring of ${label} preserves its ${viewportWidth}px dock and page geometry at ${mode}`, async ({
          page,
        }) => {
          const { paper, target, picker } = await openMarkup(page, { kind, mode, viewportWidth });
          await page.evaluate(async (fails) => {
            const { PdfSession } = await import('/src/core/document.js');
            const change = PdfSession.prototype.change;
            PdfSession.prototype.change = async function (...args) {
              PdfSession.prototype.change = change;
              await new Promise((resolve) => {
                window.releaseMarkupSave = resolve;
              });
              if (fails) throw new Error('Delayed markup save failed.');
              return change.apply(this, args);
            };
          }, fails);
          const workspace = page.locator('.workspace');
          const before = await workspace.evaluate((node) => {
            node.scrollTop = node.scrollHeight;
            return [node.scrollLeft, node.scrollTop, node.clientHeight];
          });
          // A fitted page may fit the workspace exactly, leaving nothing to scroll.
          expect(before[1]).toBeGreaterThanOrEqual(mode === '2' ? 500 : 0);
          const width = (await paper.boundingBox()).width;
          await page.evaluate(() => {
            window.markupFrames = { running: true, samples: [] };
            const sample = () => {
              if (!window.markupFrames.running) return;
              const node = document.querySelector('.workspace');
              window.markupFrames.samples.push([
                node.scrollLeft,
                node.scrollTop,
                node.clientHeight,
                document.querySelector('.paper').getBoundingClientRect().width,
              ]);
              requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
          await picker.fill('#00aa00');
          await expect.poll(() => page.evaluate(() => !!window.releaseMarkupSave)).toBe(true);
          await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'true');
          expect(
            await workspace.evaluate((node) => [
              node.scrollLeft,
              node.scrollTop,
              node.clientHeight,
            ]),
          ).toEqual(before);
          await page.evaluate(() => window.releaseMarkupSave());
          await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
          if (fails) {
            await expect(page.locator('#toast')).toHaveText('Delayed markup save failed.');
            await expect(picker).toHaveValue('#ffff00');
          } else await expect(picker).toHaveValue('#00aa00');
          await expect(target).toHaveAttribute('aria-pressed', 'true');
          await expect(picker).toBeFocused();
          await expect(page.locator('.properties-sidebar')).not.toHaveClass(/is-switching/);
          await page.waitForTimeout(200);
          const frames = await page.evaluate(() => {
            window.markupFrames.running = false;
            return window.markupFrames.samples;
          });
          expect(frames.length).toBeGreaterThan(1);
          expect(
            frames.filter(
              (frame) =>
                frame.slice(0, 3).some((value, i) => value !== before[i]) ||
                Math.abs(frame[3] - width) > 0.5,
            ),
          ).toEqual([]);
          const pending = page.waitForEvent('download');
          await page.getByRole('button', { name: 'Download', exact: true }).click();
          const exported = await PDFDocument.load(await readFile(await (await pending).path()));
          expect(listHighlights(exported, 0).map((mark) => [mark.kind, mark.hex])).toEqual([
            [kind, fails ? '#ffff00' : '#00aa00'],
          ]);
          const editedColor = '#00aa00';
          if (fails) {
            await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
            await picker.fill(editedColor);
            await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
            await expect(picker).toHaveValue(editedColor);
            expect(
              listHighlights(await exportedPdf(page), 0).map((mark) => [mark.kind, mark.hex]),
            ).toEqual([[kind, editedColor]]);
          }
          await page.getByRole('button', { name: 'Undo', exact: true }).click();
          await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
          await target.evaluate((node) => node.focus({ preventScroll: true }));
          await page.keyboard.press('Enter');
          await expect(picker).toHaveValue('#ffff00');
          await page.getByRole('button', { name: 'Redo', exact: true }).click();
          await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
          await target.evaluate((node) => node.focus({ preventScroll: true }));
          await page.keyboard.press('Enter');
          await expect(picker).toHaveValue(editedColor);
          await page
            .getByRole('button', { name: `Close ${label} editor`, exact: true })
            .press('Enter');
          await expect(page.locator('.properties-sidebar')).toHaveClass(/is-empty/);
          await expect(page.locator('.properties-sidebar')).not.toHaveClass(/is-switching/);
          const height = (await paper.boundingBox()).height;
          await page.setViewportSize({ width: viewportWidth, height: 600 });
          if (mode === 'page')
            await expect.poll(async () => (await paper.boundingBox())?.height).toBeLessThan(height);
          else await expect(paper).toHaveCSS('width', '1200px');
        });
