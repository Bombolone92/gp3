import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { addNote, listNotes } from '../../src/core/notes.js';
import { readFile } from 'node:fs/promises';

for (const action of ['apply', 'delete'])
  for (const fails of [false, true])
    for (const mode of ['2', 'page'])
      test(`a pending note ${action} ${fails ? 'failure' : 'commit'} keeps its dock and workspace stable at ${mode === 'page' ? 'fit-page' : '200%'}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 850, height: 800 });
        await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
        await page.goto('/#library');
        const doc = await PDFDocument.create();
        doc.addPage([600, 800]);
        addNote(doc, 0, { x: 200, y: 100, text: 'Original note', hex: '#ffff00' });
        const chooser = page.waitForEvent('filechooser');
        await page.keyboard.press('ControlOrMeta+o');
        await (
          await chooser
        ).setFiles({
          name: 'note-continuity.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await doc.save()),
        });
        const paper = page.locator('.paper');
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
        await expect(paper).toHaveAttribute('aria-busy', 'false');
        await page.getByLabel('Zoom', { exact: true }).selectOption(mode);
        if (mode === '2') await expect(paper).toHaveCSS('width', '1200px');
        else await expect.poll(async () => (await paper.boundingBox())?.width).toBeLessThan(500);
        const original = page.getByRole('button', {
          name: 'Edit note: Original note',
          exact: true,
        });
        await original.click();
        const input = page.getByLabel('Note text', { exact: true });
        await input.fill('Updated note');
        await page.evaluate(async (fails) => {
          const { PdfSession } = await import('/src/core/document.js');
          const change = PdfSession.prototype.change;
          PdfSession.prototype.change = async function (...args) {
            PdfSession.prototype.change = change;
            await new Promise((resolve) => {
              window.releaseNoteSave = resolve;
            });
            if (fails) throw new Error('Delayed note save failed.');
            return change.apply(this, args);
          };
        }, fails);
        const workspace = page.locator('.workspace');
        const before = await workspace.evaluate((node) => {
          node.scrollTop = node.scrollHeight;
          return [node.scrollLeft, node.scrollTop, node.clientHeight];
        });
        expect(before[1]).toBeGreaterThan(mode === '2' ? 500 : 0);
        const width = (await paper.boundingBox()).width;
        await page.evaluate(() => {
          window.noteFrames = { running: true, widths: [] };
          const sample = () => {
            if (!window.noteFrames.running) return;
            window.noteFrames.widths.push(
              document.querySelector('.paper').getBoundingClientRect().width,
            );
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        if (action === 'apply') await input.press('ControlOrMeta+Enter');
        else await page.getByRole('button', { name: 'Delete note', exact: true }).press('Enter');
        await expect.poll(() => page.evaluate(() => !!window.releaseNoteSave)).toBe(true);
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'true');
        expect(
          await workspace.evaluate((node) => [node.scrollLeft, node.scrollTop, node.clientHeight]),
        ).toEqual(before);
        await expect(page.locator('.note-editor')).toBeVisible();
        await page.keyboard.type('Ignore typing during the save');
        await expect(input).toHaveValue('Updated note');
        await page.evaluate(() => window.releaseNoteSave());
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        if (fails) {
          await expect(page.locator('.note-editor [role="alert"]')).toHaveText(
            'Delayed note save failed.',
          );
          await expect(input).toBeFocused();
          // The error may grow the dock; it must leave the page at the same scroll position.
          expect(await workspace.evaluate((node) => [node.scrollLeft, node.scrollTop])).toEqual(
            before.slice(0, 2),
          );
          // Undo still discards this unsaved draft; there is no committed edit to redo.
          await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
          await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
        } else {
          await expect(page.getByRole('group', { name: 'Edit note', exact: true })).toHaveCount(0);
          await expect(page.locator('.drawing-overlay')).toBeFocused();
          await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
        }
        // Include the workspace resize observer after the completed save or error feedback.
        await page.waitForTimeout(200);
        const widths = await page.evaluate(() => {
          window.noteFrames.running = false;
          return window.noteFrames.widths;
        });
        expect(widths.length).toBeGreaterThan(1);
        expect(widths.filter((actual) => Math.abs(actual - width) > 0.5)).toEqual([]);
        if (fails) {
          await input.press('Escape');
          await expect(original).toHaveCount(1);
          await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
        }
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        const exported = await PDFDocument.load(await readFile(await (await pending).path()));
        expect(listNotes(exported, 0).map((note) => note.text)).toEqual(
          fails ? ['Original note'] : action === 'apply' ? ['Updated note'] : [],
        );
        if (!fails) {
          await page.getByRole('button', { name: 'Undo', exact: true }).click();
          await expect(original).toHaveCount(1);
          await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
          await page.getByRole('button', { name: 'Redo', exact: true }).click();
          await expect(original).toHaveCount(0);
        }
      });
