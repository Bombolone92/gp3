import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const signedIn = `window.puter = {env:'web',auth:{isSignedIn:()=>true,getUser:async()=>({username:'test-user'}),signIn:async()=>{},signOut:async()=>{}},fs:{readdir:async()=>[],write:async()=>({})},ui:{onLaunchedWithItems:()=>{},onItemsOpened:()=>{}}};`;

for (const width of [320, 360, 390, 430, 768, 1280])
  for (const account of ['local', 'signed in'])
    for (const dirty of [false, true])
      test(`protected header stays clickable at ${width}px, ${account}, ${dirty ? 'unsaved' : 'unchanged'}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 844 });
        await page.route('https://js.puter.com/**', (route) =>
          route.fulfill({
            contentType: 'application/javascript',
            body: account === 'signed in' ? signedIn : '',
          }),
        );
        await page.goto('/#library');
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: /Open a PDF/ }).click();
        await (
          await chooser
        ).setFiles({
          name: 'restricted.pdf',
          mimeType: 'application/pdf',
          buffer: await readFile(new URL('../fixtures/security/owner-only.pdf', import.meta.url)),
        });
        await expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
        await expect(
          page.getByRole('button', {
            name: account === 'signed in' ? 'Save to Puter' : 'Sign in to save',
            exact: true,
          }),
        ).toBeVisible();
        if (dirty) await page.getByLabel('name (on page)', { exact: true }).fill('Updated draft');
        await expect(page.locator('.save-status')).toHaveText(
          dirty ? 'Unsaved changes' : 'Local file',
        );
        await expect(page.locator('.save-status')).toHaveAttribute(
          'title',
          dirty ? 'Unsaved changes' : 'Local file',
        );
        const blocked = await page.locator('.topbar-row button:visible').evaluateAll((buttons) =>
          buttons.flatMap((button) => {
            const box = button.getBoundingClientRect();
            const hit = document
              .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
              ?.closest('button');
            return hit === button
              ? []
              : [
                  {
                    name: button.getAttribute('aria-label'),
                    hit: hit?.getAttribute('aria-label'),
                  },
                ];
          }),
        );
        expect(blocked).toEqual([]);
        if (width === 390 && dirty && account === 'local')
          await page.screenshot({
            path: testInfo.outputPath('protected-header.png'),
          });
        const downloads = [];
        page.on('download', (download) => downloads.push(download.suggestedFilename()));
        await page.getByRole('button', { name: 'Protected', exact: true }).click();
        const dialog = page.getByRole('dialog', {
          name: 'Permissions password required',
          exact: true,
        });
        await expect(dialog).toBeVisible();
        expect(downloads).toEqual([]);
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByLabel('name (on page)', { exact: true })).toHaveValue(
          dirty ? 'Updated draft' : 'Grace',
        );
        await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
      });
