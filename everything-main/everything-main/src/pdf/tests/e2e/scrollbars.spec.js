import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

// Playwright hides scrollbars by default; Windows and Linux desktops give them layout space.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });
const PUTER_MOCK = `window.puter = { env: 'web', auth: { isSignedIn: () => true, getUser: async () => ({username:'test-user'}), signIn: async () => {}, signOut: async () => {} }, fs: { readdir: async () => [], write: async (path, blob, options) => { window.lastSave = {path, size:blob.size, options}; return {path, name:path.split('/').pop()}; } }, ui: { onLaunchedWithItems: () => {}, onItemsOpened: () => {} } };`;
async function mockPuter(page) {
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: PUTER_MOCK }),
  );
}
async function openPdf(page, doc, name = 'test.pdf') {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open a PDF/ }).click();
  await (
    await chooser
  ).setFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await expect(page.locator('.page-caption')).toHaveText(`Page 1 of ${doc.getPageCount()}`);
}
test('a page that overflows the workspace keeps the fit width stable', async ({ page }) => {
  // One page at a time, so the short page alone does not overflow.
  await page.addInitScript(() => localStorage.setItem('pdf-editor:page-display', 'single'));
  await mockPuter(page);
  await page.goto('/#library');
  const doc = await PDFDocument.create();
  doc.addPage([400, 100]);
  doc.addPage([400, 4000]);
  await openPdf(page, doc);
  const workspace = page.locator('.workspace');
  const paper = page.locator('.paper');
  const short = await workspace.evaluate((node) => ({
    width: node.clientWidth,
    overflows: node.scrollHeight > node.clientHeight,
  }));
  expect(short.overflows).toBe(false);
  const fitted = await paper.evaluate((node) => node.style.width);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.locator('.page-caption')).toHaveText('Page 2 of 2');
  const tall = await workspace.evaluate((node) => ({
    width: node.clientWidth,
    overflows: node.scrollHeight > node.clientHeight,
  }));
  expect(tall.overflows).toBe(true);
  // The scrollbar's gutter is always reserved, so the width the page is fitted to is the same
  // whether or not the page overflows, and no refit can chase an appearing scrollbar.
  expect(tall.width).toBe(short.width);
  await expect(paper).toHaveCSS('width', fitted);
  await expect(workspace).toHaveCSS('scrollbar-gutter', 'stable');
});
