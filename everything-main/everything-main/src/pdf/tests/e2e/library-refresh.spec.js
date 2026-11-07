import { test, expect } from '@playwright/test';

for (const outcome of ['success', 'failure'])
  test(`a late library refresh ${outcome} cannot replace a newer listing`, async ({ page }) => {
    await page.route('https://js.puter.com/**', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `
          window.libraryReads = [];
          window.libraryFiles = ['first.pdf', 'second.pdf'];
          window.puter = {
            env: 'web',
            auth: {isSignedIn: () => true, getUser: async () => ({username: 'test-user'})},
            fs: {
              readdir: async () => {
                const files = window.libraryFiles.map(name => ({name, path: 'PDF Editor/' + name}));
                if (!window.holdLibraryReads) return files;
                return new Promise((resolve, reject) => window.libraryReads.push({
                  resolve: () => resolve(files), reject: () => reject(new Error('Old request failed'))
                }));
              },
              rename: () => new Promise(resolve => {window.finishRename = () => {
                window.libraryFiles[0] = 'renamed.pdf'; resolve();
              };}),
              delete: () => new Promise(resolve => {window.finishDelete = () => {
                window.libraryFiles = window.libraryFiles.filter(name => name !== 'second.pdf');
                resolve();
              };})
            }
          };`,
      }),
    );
    await page.goto('/#library');
    await expect(page.locator('.file-open')).toHaveText(['first.pdf', 'second.pdf']);
    await page.evaluate(() => {
      window.holdLibraryReads = true;
    });
    await page.getByRole('button', { name: 'Options for first.pdf', exact: true }).click();
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    const rename = page.getByRole('dialog', { name: 'Rename PDF', exact: true });
    await rename.getByLabel('File name', { exact: true }).fill('renamed');
    await rename.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof window.finishRename)).toBe('function');
    await page.getByRole('button', { name: 'Options for second.pdf', exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Delete PDF?', exact: true })
      .getByRole('button', { name: 'Delete PDF', exact: true })
      .click();
    await expect.poll(() => page.evaluate(() => typeof window.finishDelete)).toBe('function');

    await page.evaluate(() => window.finishRename());
    await expect.poll(() => page.evaluate(() => window.libraryReads.length)).toBe(1);
    await page.evaluate(() => window.finishDelete());
    await expect.poll(() => page.evaluate(() => window.libraryReads.length)).toBe(2);
    await page.evaluate(() => window.libraryReads[1].resolve());
    await expect(page.locator('.file-open')).toHaveText(['renamed.pdf']);
    await page.evaluate(async (outcome) => {
      window.libraryReads[0][outcome === 'failure' ? 'reject' : 'resolve']();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, outcome);
    await expect(page.locator('.file-open')).toHaveText(['renamed.pdf']);
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search PDFs', exact: true }).fill('renamed');
    await expect(page.locator('.file-open')).toHaveText(['renamed.pdf']);
  });
