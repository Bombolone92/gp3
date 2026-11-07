import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { addNote } from '../../src/core/notes.js';
import { addHighlight, MARKUP_KINDS } from '../../src/core/highlight.js';

for (const from of ['text', 'note'])
  for (const to of ['text', 'note', 'shape', ...Object.keys(MARKUP_KINDS)])
    for (const mode of ['keyboard', 'pointer'])
      for (const moved of [false, true])
        for (const fails of [false, true])
          test(`a pending ${from} to ${to} ${mode} selection ${fails ? 'failure' : 'commit'} ${moved ? 'preserves newer focus' : 'restores expected focus'}`, async ({
            page,
          }) => {
            await openDocument(page, 850, '2', MARKUP_KINDS[to] ? to : null);
            await selectObject(page, from);
            await expectObject(page, from);
            await changeSource(page, from);
            await page.evaluate(async (fails) => {
              const { PdfSession } = await import('/src/core/document.js');
              const change = PdfSession.prototype.change;
              PdfSession.prototype.change = async function (...args) {
                PdfSession.prototype.change = change;
                await new Promise((resolve) => {
                  window.releaseSelectionSave = resolve;
                });
                if (fails) throw new Error('Selection save failed.');
                return change.apply(this, args);
              };
            }, fails);
            const label = MARKUP_KINDS[to]?.label || to;
            const destination = page.getByRole('button', {
              name:
                to === 'shape'
                  ? 'Select shape 1'
                  : `Edit ${label}: ${['text', 'note'].includes(to) ? 'Second' : 'First'} ${to}`,
              exact: true,
            });
            const select = async () => {
              if (mode === 'pointer') await destination.click();
              else {
                await destination.evaluate((node) => node.focus({ preventScroll: true }));
                await page.keyboard.press('Enter');
              }
            };
            await select();
            await expect.poll(() => page.evaluate(() => !!window.releaseSelectionSave)).toBe(true);
            const settings = page.getByRole('button', { name: 'Settings', exact: true });
            if (moved) {
              await settings.focus();
              await settings.evaluate((node) =>
                node.addEventListener('blur', () => {
                  window.selectionFocusLost = true;
                }),
              );
            }
            await page.evaluate(() => window.releaseSelectionSave());
            const source =
              from === 'text'
                ? page.locator('.page-text-input')
                : page.getByLabel('Note text', { exact: true });
            const control =
              to === 'text'
                ? page.getByRole('button', { name: 'Move text', exact: true })
                : to === 'note'
                  ? page.getByLabel('Note text', { exact: true })
                  : to === 'shape'
                    ? page.getByRole('button', { name: 'Move selected shape', exact: true })
                    : page.getByLabel(`${label[0].toUpperCase() + label.slice(1)} color`, {
                        exact: true,
                      });
            const expectDestination = async () => {
              if (to === 'text')
                await expect(page.locator('.page-text-input')).toHaveValue('Second text');
              else if (to === 'note')
                await expect(page.getByLabel('Note text', { exact: true })).toHaveValue(
                  'Second note',
                );
              else await expectObject(page, to);
              await expect(page.locator('.properties-sidebar')).not.toHaveClass(/is-switching/);
            };
            if (fails) {
              await expect(page.locator('.text-edit-error')).toHaveText('Selection save failed.');
              await expect(source).toHaveValue(`Changed ${from}`);
              await expect(page.locator('.properties-sidebar')).not.toHaveClass(/is-switching/);
            } else await expectDestination();
            await expect(moved ? settings : fails ? source : control).toBeFocused();
            if (moved) expect(await page.evaluate(() => !!window.selectionFocusLost)).toBe(false);
            if (fails) {
              await select();
              await expectDestination();
              await expect(control).toBeFocused();
            }
            await expect(
              page.getByRole('button', { name: `Edit ${from}: Changed ${from}`, exact: true }),
            ).toHaveCount(1);
            if (mode === 'keyboard' && moved && !fails) {
              await page.getByRole('button', { name: 'Undo', exact: true }).click();
              await expect(
                page.getByRole('button', { name: `Edit ${from}: First ${from}`, exact: true }),
              ).toHaveCount(1);
              await page.getByRole('button', { name: 'Redo', exact: true }).click();
              await expect(
                page.getByRole('button', { name: `Edit ${from}: Changed ${from}`, exact: true }),
              ).toHaveCount(1);
            }
          });

for (const width of [390, 850])
  for (const kind of ['text', 'note'])
    test(`pointer handoff from ${kind} to markup preserves the ${width}px workspace`, async ({
      page,
    }) => {
      await openDocument(page, width, '2', 'highlight');
      await page.getByRole('button', { name: `Edit ${kind}: First ${kind}`, exact: true }).click();
      await expectObject(page, kind);
      const workspace = page.locator('.workspace');
      // Bring the next object into view before beginning the measured handoff.
      const before = await workspace.evaluate((node) => {
        node.scrollLeft = 300;
        node.scrollTop = node.scrollHeight;
        return [node.scrollLeft, node.scrollTop];
      });
      const target = page.getByRole('button', {
        name: 'Edit highlight: First highlight',
        exact: true,
      });
      await expect(target).toBeInViewport({ ratio: 1 });
      await target.click();
      await expectObject(page, 'highlight');
      await page.waitForTimeout(200);
      const after = await workspace.evaluate((node) => [
        node.scrollLeft,
        node.scrollTop,
        node.scrollHeight - node.clientHeight,
      ]);
      expect(after.slice(0, 2)).toEqual([before[0], Math.min(before[1], after[2])]);
      await expect(page.locator('.paper')).toHaveCSS('width', '1200px');
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    });

for (const width of [390, 850])
  for (const kind of ['text', 'note'])
    test(`pointer selection of another ${kind} keeps the ${width}px dock and page in place`, async ({
      page,
    }) => {
      await openDocument(page, width);
      await page.getByRole('button', { name: `Edit ${kind}: First ${kind}`, exact: true }).click();
      await expectObject(page, kind);
      const workspace = page.locator('.workspace');
      const before = await workspace.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
        return [node.scrollLeft, node.scrollTop, node.clientHeight];
      });
      const second = page.getByRole('button', {
        name: `Edit ${kind}: Second ${kind}`,
        exact: true,
      });
      await expect(second).toBeInViewport({ ratio: 1 });
      await second.click();
      await expect(
        kind === 'note'
          ? page.getByLabel('Note text', { exact: true })
          : page.locator('.page-text-input'),
      ).toHaveValue(`Second ${kind}`);
      await expect(page.locator('.properties-sidebar')).not.toHaveClass(/is-switching/);
      await page.waitForTimeout(200);
      expect(
        await workspace.evaluate((node) => [node.scrollLeft, node.scrollTop, node.clientHeight]),
      ).toEqual(before);
      await expect(page.locator('.paper')).toHaveCSS('width', '1200px');
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    });

async function selectObject(page, kind) {
  const label = MARKUP_KINDS[kind]?.label || kind;
  const target = page.getByRole('button', {
    name: kind === 'shape' ? 'Select shape 1' : `Edit ${label}: First ${kind}`,
    exact: true,
  });
  await target.evaluate((node) => node.focus({ preventScroll: true }));
  await page.keyboard.press('Enter');
}

async function expectObject(page, kind) {
  if (kind === 'shape')
    await expect(page.getByRole('group', { name: 'Edit shape', exact: true })).toBeVisible();
  else if (MARKUP_KINDS[kind]) {
    const label = MARKUP_KINDS[kind].label;
    await expect(
      page.getByLabel(`${label[0].toUpperCase() + label.slice(1)} color`, { exact: true }),
    ).toHaveValue('#ffff00');
  } else
    await expect(
      kind === 'note'
        ? page.getByLabel('Note text', { exact: true })
        : page.locator('.page-text-input'),
    ).toHaveValue(`First ${kind}`);
  await expect(page.locator('.properties-sidebar')).not.toHaveClass(/is-empty|is-switching/);
}

async function changeSource(page, kind) {
  if (kind === 'text')
    await page.getByRole('button', { name: 'Move text', exact: true }).press('F2');
  await (
    kind === 'note'
      ? page.getByLabel('Note text', { exact: true })
      : page.locator('.page-text-input')
  ).fill(`Changed ${kind}`);
}

for (const mode of ['2', 'page'])
  for (const [from, to, changed = true] of [
    ['text', 'shape'],
    ['note', 'shape'],
    ['shape', 'text'],
    ['shape', 'note'],
    ['text', 'highlight', false],
    ['note', 'highlight', false],
    ...Object.keys(MARKUP_KINDS).flatMap((kind) => [
      ['text', kind],
      ['note', kind],
      ['shape', kind],
    ]),
  ])
    test(`${changed && from !== 'shape' ? 'edited' : 'unchanged'} ${from} to ${to} handoffs preserve the dock through control changes at ${mode}`, async ({
      page,
    }) => {
      const paper = await openDocument(page, 850, mode, MARKUP_KINDS[to] ? to : null);
      await selectObject(page, from);
      await expectObject(page, from);
      if (changed && from !== 'shape') await changeSource(page, from);
      await page.waitForTimeout(200);
      const paperWidth = (await paper.boundingBox()).width;
      const before = await page.locator('.workspace').evaluate((node) => {
        node.scrollTop = node.scrollHeight;
        return [node.scrollLeft, node.scrollTop, node.clientHeight];
      });
      await page.evaluate(() => {
        window.handoffFrames = { running: true, samples: [] };
        const sample = () => {
          if (!window.handoffFrames.running) return;
          const node = document.querySelector('.workspace');
          window.handoffFrames.samples.push([
            node.scrollTop,
            node.clientHeight,
            document.querySelector('.paper').getBoundingClientRect().width,
          ]);
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await selectObject(page, to);
      await expectObject(page, to);
      await page.waitForTimeout(200);
      const frames = await page.evaluate(() => {
        window.handoffFrames.running = false;
        return window.handoffFrames.samples;
      });
      const after = await page
        .locator('.workspace')
        .evaluate((node) => [
          node.scrollLeft,
          node.scrollTop,
          node.clientHeight,
          node.scrollHeight - node.clientHeight,
        ]);
      // A shorter final dock can legitimately clamp to the new bottom, but an
      // empty intermediate dock must never scroll past that destination.
      const destination = Math.min(before[1], after[3]);
      expect(after[1]).toBe(destination);
      // Keyboard text selection reveals a box outside the horizontal viewport.
      if (to === 'text')
        await expect(page.locator('.page-text-input')).toBeInViewport({ ratio: 1 });
      else expect(after[0]).toBe(before[0]);
      expect(
        frames.filter(
          (frame) =>
            frame[0] < destination ||
            frame[1] > Math.max(before[2], after[2]) ||
            Math.abs(frame[2] - paperWidth) > 0.5,
        ),
      ).toEqual([]);
      if (changed && from !== 'shape')
        await expect(
          page.getByRole('button', { name: `Edit ${from}: Changed ${from}`, exact: true }),
        ).toHaveCount(1);
    });

for (const kind of ['text', 'note'])
  for (const to of ['shape', ...Object.keys(MARKUP_KINDS)])
    test(`a failed ${kind} to ${to} handoff releases the dock and preserves its draft`, async ({
      page,
    }) => {
      await openDocument(page, 850, 'page', MARKUP_KINDS[to] ? to : null);
      await selectObject(page, kind);
      await expectObject(page, kind);
      await changeSource(page, kind);
      await page.evaluate(async () => {
        const { PdfSession } = await import('/src/core/document.js');
        const change = PdfSession.prototype.change;
        PdfSession.prototype.change = async function () {
          PdfSession.prototype.change = change;
          await new Promise((resolve) => {
            window.releaseHandoff = resolve;
          });
          throw new Error('Selection save failed.');
        };
      });
      const before = await page.locator('.workspace').evaluate((node) => {
        node.scrollTop = node.scrollHeight;
        return [node.scrollLeft, node.scrollTop, node.clientHeight];
      });
      await selectObject(page, to);
      await expect.poll(() => page.evaluate(() => !!window.releaseHandoff)).toBe(true);
      expect(
        await page
          .locator('.workspace')
          .evaluate((node) => [node.scrollLeft, node.scrollTop, node.clientHeight]),
      ).toEqual(before);
      await page.evaluate(() => window.releaseHandoff());
      await expect(page.locator('.text-edit-error')).toHaveText('Selection save failed.');
      await expect(page.locator('.properties-sidebar')).not.toHaveClass(/is-switching/);
      await expect(
        kind === 'note'
          ? page.getByLabel('Note text', { exact: true })
          : page.locator('.page-text-input'),
      ).toHaveValue(`Changed ${kind}`);
      expect(
        await page.locator('.workspace').evaluate((node) => [node.scrollLeft, node.scrollTop]),
      ).toEqual(before.slice(0, 2));
      await selectObject(page, to);
      await expectObject(page, to);
      await expect(
        page.getByRole('button', { name: `Edit ${kind}: Changed ${kind}`, exact: true }),
      ).toHaveCount(1);
      const label = MARKUP_KINDS[to]?.label || to;
      await page.getByRole('button', { name: `Close ${label} editor`, exact: true }).press('Enter');
      await expect(page.locator('.properties-sidebar')).toHaveClass(/is-empty/);
      await expect(page.locator('.properties-sidebar')).not.toHaveClass(/is-switching/);
    });

async function openDocument(page, width = 850, mode = '2', markup = null) {
  await page.setViewportSize({ width, height: 800 });
  await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  const sheet = doc.addPage([600, 800]);
  sheet.drawText('First text', { x: 120, y: 130, size: 18 });
  sheet.drawText('Second text', { x: 120, y: 100, size: 18 });
  addNote(doc, 0, { x: 120, y: 60, text: 'First note', hex: '#ffff00' });
  addNote(doc, 0, { x: 120, y: 95, text: 'Second note', hex: '#ffff00' });
  sheet.drawRectangle({ x: 180, y: 70, width: 40, height: 30 });
  if (markup)
    addHighlight(doc, 0, {
      kind: markup,
      text: `First ${markup}`,
      hex: '#ffff00',
      quads: [[240, 110, 290, 110, 240, 90, 290, 90]],
    });
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (
    await chooser
  ).setFiles({
    name: 'selections.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
  await page.getByLabel('Zoom', { exact: true }).selectOption(mode);
  const paper = page.locator('.paper');
  if (mode === '2') await expect(paper).toHaveCSS('width', '1200px');
  else await expect.poll(async () => (await paper.boundingBox())?.width).toBeLessThan(500);
  return paper;
}

for (const width of [390, 850])
  for (const mode of ['2', 'page'])
    for (const kind of ['text', 'note'])
      for (const changed of [false, true])
        test(`switching ${changed ? 'changed' : 'unchanged'} ${kind} selections preserves the ${width}px dock at ${mode}`, async ({
          page,
        }) => {
          const paper = await openDocument(page, width, mode);
          const first = page.getByRole('button', {
            name: `Edit ${kind}: First ${kind}`,
            exact: true,
          });
          await first.evaluate((node) => node.focus({ preventScroll: true }));
          await page.keyboard.press('Enter');
          await expect(page.locator('.properties-sidebar')).not.toHaveClass(/is-empty/);
          if (changed) {
            if (kind === 'text')
              await page.getByRole('button', { name: 'Move text', exact: true }).press('F2');
            await (
              kind === 'note'
                ? page.getByLabel('Note text', { exact: true })
                : page.locator('.page-text-input')
            ).fill(`Changed ${kind}`);
          }
          await page.waitForTimeout(200);
          const workspace = page.locator('.workspace');
          const before = await workspace.evaluate((node) => {
            node.scrollTop = node.scrollHeight;
            return [node.scrollLeft, node.scrollTop, node.clientHeight];
          });
          expect(before[1]).toBeGreaterThan(mode === '2' ? 500 : 0);
          const paperWidth = (await paper.boundingBox()).width;
          await page.evaluate(() => {
            window.selectionFrames = { running: true, samples: [] };
            const sample = () => {
              if (!window.selectionFrames.running) return;
              const node = document.querySelector('.workspace');
              window.selectionFrames.samples.push([
                node.scrollLeft,
                node.scrollTop,
                node.clientHeight,
                document.querySelector('.paper').getBoundingClientRect().width,
              ]);
              requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
          const second = page.getByRole('button', {
            name: `Edit ${kind}: Second ${kind}`,
            exact: true,
          });
          await second.evaluate((node) => node.focus({ preventScroll: true }));
          await page.keyboard.press('Enter');
          if (kind === 'note')
            await expect(page.getByLabel('Note text', { exact: true })).toHaveValue('Second note');
          else await expect(page.locator('.page-text-input')).toHaveValue('Second text');
          await page.waitForTimeout(200);
          const frames = await page.evaluate(() => {
            window.selectionFrames.running = false;
            return window.selectionFrames.samples;
          });
          expect(frames.length).toBeGreaterThan(1);
          expect(
            frames.filter(
              (frame) =>
                frame.slice(0, 3).some((value, i) => value !== before[i]) ||
                Math.abs(frame[3] - paperWidth) > 0.5,
            ),
          ).toEqual([]);
          expect((await paper.boundingBox()).width).toBeCloseTo(paperWidth, 0);
          expect(
            await workspace.evaluate((node) => [
              node.scrollLeft,
              node.scrollTop,
              node.clientHeight,
            ]),
          ).toEqual(before);
          if (changed)
            await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
          else await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
          await (
            kind === 'note'
              ? page.getByLabel('Note text', { exact: true })
              : page.getByRole('button', { name: 'Move text', exact: true })
          ).press('Escape');
          await expect(page.locator('.properties-sidebar')).toHaveClass(/is-empty/);
          await expect(page.locator('.properties-sidebar')).not.toHaveClass(/is-switching/);
          if (changed) {
            const original = page.getByRole('button', {
              name: `Edit ${kind}: First ${kind}`,
              exact: true,
            });
            const committed = page.getByRole('button', {
              name: `Edit ${kind}: Changed ${kind}`,
              exact: true,
            });
            await expect(committed).toHaveCount(1);
            await page.getByRole('button', { name: 'Undo', exact: true }).click();
            await expect(original).toHaveCount(1);
            await expect(committed).toHaveCount(0);
            await page.getByRole('button', { name: 'Redo', exact: true }).click();
            await expect(committed).toHaveCount(1);
          }
          const height = (await paper.boundingBox()).height;
          await page.setViewportSize({ width, height: 600 });
          if (mode === 'page')
            await expect.poll(async () => (await paper.boundingBox())?.height).toBeLessThan(height);
          else await expect(paper).toHaveCSS('width', '1200px');
        });
