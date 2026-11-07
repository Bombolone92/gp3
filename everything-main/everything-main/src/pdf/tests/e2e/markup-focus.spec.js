import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { addHighlight, listHighlights, MARKUP_KINDS } from '../../src/core/highlight.js';

for (const [kind, { label }] of Object.entries(MARKUP_KINDS))
  for (const action of ['color', 'delete'])
    for (const moved of [false, true])
      test(`${label} ${action} ${moved ? 'preserves newer focus' : 'restores editor focus'}`, async ({
        page,
      }) => {
        await page.route('https://js.puter.com/**', (route) =>
          route.fulfill({
            body: `window.puter = {env:'web',auth:{isSignedIn:()=>true,getUser:async()=>({username:'test-user'})},fs:{readdir:async()=>[]},ui:{onLaunchedWithItems(){},onItemsOpened(){}}};`,
          }),
        );
        await page.goto('/#library');
        const doc = await PDFDocument.create();
        doc.addPage([400, 500]);
        addHighlight(doc, 0, {
          kind,
          text: 'Original',
          hex: '#ffff00',
          quads: [[40, 320, 180, 320, 40, 296, 180, 296]],
        });
        const chooser = page.waitForEvent('filechooser');
        await page.keyboard.press('ControlOrMeta+o');
        await (
          await chooser
        ).setFiles({
          name: 'markup-focus.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(await doc.save()),
        });
        const target = page.getByRole('button', { name: `Edit ${label}: Original`, exact: true });
        await target.click();
        await page.evaluate(async () => {
          const { blankPdf, validatePdf } = await import('/src/core/document.js');
          const prototype = Object.getPrototypeOf(await validatePdf(await blankPdf()));
          const save = prototype.save;
          prototype.save = async function (...args) {
            prototype.save = save;
            const bytes = await save.apply(this, args);
            await new Promise((resolve) => {
              window.releaseMarkup = resolve;
            });
            return bytes;
          };
        });
        const picker = page.getByLabel(`${label[0].toUpperCase() + label.slice(1)} color`, {
          exact: true,
        });
        if (action === 'color') {
          await picker.focus();
          await picker.fill('#00aa00');
        } else {
          const button = page.getByRole('button', { name: `Delete ${label}`, exact: true });
          await button.focus();
          await button.press('Enter');
        }
        await expect.poll(() => page.evaluate(() => !!window.releaseMarkup)).toBe(true);
        const settings = page.getByRole('button', { name: 'Settings', exact: true });
        if (moved) await settings.focus();
        await page.evaluate(() => window.releaseMarkup());
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        if (action === 'color') await expect(picker).toHaveValue('#00aa00');
        else await expect(target).toHaveCount(0);
        await expect(
          moved ? settings : action === 'color' ? picker : page.locator('.drawing-overlay'),
        ).toBeFocused();
        const marks = async () => {
          const pending = page.waitForEvent('download');
          await page.getByRole('button', { name: 'Download', exact: true }).click();
          return listHighlights(
            await PDFDocument.load(await readFile(await (await pending).path())),
            0,
          ).map(({ kind, hex, text }) => ({ kind, hex, text }));
        };
        const edited = action === 'color' ? [{ kind, hex: '#00aa00', text: 'Original' }] : [];
        expect(await marks()).toEqual(edited);
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect(target).toBeVisible();
        expect(await marks()).toEqual([{ kind, hex: '#ffff00', text: 'Original' }]);
        await page.getByRole('button', { name: 'Redo', exact: true }).click();
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        expect(await marks()).toEqual(edited);
      });
