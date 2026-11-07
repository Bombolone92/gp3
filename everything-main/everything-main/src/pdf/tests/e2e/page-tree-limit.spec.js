import { test, expect } from '@playwright/test';
import { protectPdf } from '../../src/core/security.js';
import { expandingPageTree } from '../fixtures/page-tree-expansion.js';

for (const encrypted of [false, true])
  for (const [kind, options, message] of [
    ['too many pages', {}, 'Choose a PDF with between 1 and 1,000 pages.'],
    [
      'repeated empty branches',
      { empty: true, keepPage: true },
      'This PDF could not be opened. It may be damaged or unsupported.',
    ],
    [
      'cyclic branches',
      { cycle: true },
      'This PDF could not be opened. It may be damaged or unsupported.',
    ],
  ])
    test(`opening a PDF with ${kind} (encrypted=${encrypted}) keeps the existing workspace responsive`, async ({
      page,
    }) => {
      await page.route('https://js.puter.com/**', (route) => route.fulfill({ body: '' }));
      await page.goto('/');
      await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
      const bytes = await expandingPageTree(options.cycle ? 1 : 60, options);
      const buffer = Buffer.from(
        encrypted ? await protectPdf(bytes, { permissions: 'owner' }) : bytes,
      );
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press('ControlOrMeta+o');
      await (
        await chooser
      ).setFiles({
        name: 'expanding.pdf',
        mimeType: 'application/pdf',
        buffer,
      });
      await expect(page.locator('#toast')).toHaveText(message);
      await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
      await page.getByRole('button', { name: 'Text', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Place at page center', exact: true }),
      ).toBeVisible();
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      expect((await pending).suggestedFilename()).toBe('Untitled.pdf');
    });
