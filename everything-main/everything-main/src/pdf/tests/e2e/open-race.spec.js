import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { openDevicePicker } from './editing-helpers.js';

async function setup(page) {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  const bytes = Buffer.from(await doc.save()).toString('base64');
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      const bytes = await read.call(this);
      if (!this.name.startsWith('earlier.')) return bytes;
      return new Promise((resolve, reject) => {
        window.pendingReads[this.name] = { resolve: () => resolve(bytes), reject };
      });
    };
  });
  await page.route('https://js.puter.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
        window.pendingReads = {};
        window.puter = {
          env: 'app',
          auth: { getUser: async () => ({ username: 'test-user' }) },
          fs: {
            readdir: async () => [],
            read: (path) => new Promise((resolve, reject) => {
              window.pendingReads[path] = { resolve: () => resolve(new Blob([
                Uint8Array.from(atob(${JSON.stringify(bytes)}), c => c.charCodeAt(0))
              ])), reject };
            }),
          },
          ui: {
            onLaunchedWithItems: () => {},
            onItemsOpened: handler => { window.openItems = handler; },
          },
        };`,
    }),
  );
  await page.goto('/');
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
  await expect.poll(() => page.evaluate(() => typeof window.openItems)).toBe('function');
  return Buffer.from(bytes, 'base64');
}

async function requestFile(page, name) {
  await page.evaluate((name) => window.openItems([{ path: name, name }]), name);
  await expect.poll(() => page.evaluate((name) => !!window.pendingReads[name], name)).toBe(true);
}

async function finishRead(page, name, error = null) {
  await page.evaluate(
    ({ name, error }) => {
      const read = window.pendingReads[name];
      if (error) read.reject(new Error(error));
      else read.resolve();
    },
    { name, error },
  );
  // Give the released read time to parse its tiny PDF and update the already-loaded editor.
  await page.waitForTimeout(500);
}

for (const source of ['cloud', 'device', 'pictures'])
  test(`a slower earlier ${source} open cannot replace the latest chosen PDF`, async ({ page }) => {
    const pdf = await setup(page);
    const name = source === 'pictures' ? 'earlier.png' : 'earlier.pdf';
    if (source === 'cloud') await requestFile(page, name);
    else {
      const chooser = page.waitForEvent('filechooser');
      await openDevicePicker(page);
      await (
        await chooser
      ).setFiles({
        name,
        mimeType: source === 'pictures' ? 'image/png' : 'application/pdf',
        buffer:
          source === 'pictures'
            ? Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==',
                'base64',
              )
            : pdf,
      });
      await expect
        .poll(() => page.evaluate((name) => !!window.pendingReads[name], name))
        .toBe(true);
    }
    await requestFile(page, 'latest.pdf');
    await finishRead(page, 'latest.pdf');
    await expect(page).toHaveTitle('latest.pdf · PDF Editor');
    await finishRead(page, name);
    await expect(page).toHaveTitle('latest.pdf · PDF Editor');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.locator('#toast').isVisible()).toBe(false);
  });

test('an obsolete cloud read failure does not interrupt the latest PDF', async ({ page }) => {
  await setup(page);
  await requestFile(page, 'earlier.pdf');
  await requestFile(page, 'latest.pdf');
  await finishRead(page, 'latest.pdf');
  await expect(page).toHaveTitle('latest.pdf · PDF Editor');
  await finishRead(page, 'earlier.pdf', 'Earlier read failed');
  expect(await page.locator('#toast').isVisible()).toBe(false);
  await expect(page).toHaveTitle('latest.pdf · PDF Editor');
});

test('returning to the library cancels a pending cloud open', async ({ page }) => {
  await setup(page);
  await requestFile(page, 'earlier.pdf');
  await page.getByRole('button', { name: 'Back to your PDFs', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New blank PDF' })).toBeVisible();
  await finishRead(page, 'earlier.pdf');
  await expect(page.getByRole('button', { name: 'New blank PDF' })).toBeVisible();
  await expect(page).toHaveTitle('PDF Editor');
});

test('a current cloud read failure leaves the open PDF usable and reports the error', async ({
  page,
}) => {
  await setup(page);
  await requestFile(page, 'latest.pdf');
  await finishRead(page, 'latest.pdf', 'Current read failed');
  await expect(page.locator('#toast')).toHaveText('Current read failed');
  await expect(page).toHaveTitle('Untitled.pdf · PDF Editor');
  await requestFile(page, 'retry.pdf');
  await finishRead(page, 'retry.pdf');
  await expect(page).toHaveTitle('retry.pdf · PDF Editor');
});

test('a newer desktop open dismisses the password prompt belonging to the old request', async ({
  page,
}) => {
  await setup(page);
  const chooser = page.waitForEvent('filechooser');
  await openDevicePicker(page);
  await (
    await chooser
  ).setFiles({
    name: 'locked.pdf',
    mimeType: 'application/pdf',
    buffer: await readFile(new URL('../fixtures/security/aes-256.pdf', import.meta.url)),
  });
  const prompt = page.getByRole('dialog', { name: 'Password required' });
  await expect(prompt).toBeVisible();
  await requestFile(page, 'latest.pdf');
  await finishRead(page, 'latest.pdf');
  await expect(page).toHaveTitle('latest.pdf · PDF Editor');
  await expect(prompt).toHaveCount(0);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Place at page center', exact: true }),
  ).toBeVisible();
});

test('returning to the library dismisses a pending password prompt', async ({ page }) => {
  await setup(page);
  const chooser = page.waitForEvent('filechooser');
  await openDevicePicker(page);
  await (
    await chooser
  ).setFiles({
    name: 'locked.pdf',
    mimeType: 'application/pdf',
    buffer: await readFile(new URL('../fixtures/security/aes-256-r5.pdf', import.meta.url)),
  });
  await expect(page.getByRole('dialog', { name: 'Password required' })).toBeVisible();
  await page.evaluate(() => {
    location.hash = '#library';
  });
  await expect(page.getByRole('button', { name: 'New blank PDF' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('an obsolete automatic password check cannot open a dialog over the latest document', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const digest = SubtleCrypto.prototype.digest;
    let first = true;
    window.passwordHashes = 0;
    SubtleCrypto.prototype.digest = async function (...args) {
      const result = await digest.apply(this, args);
      window.passwordHashes++;
      if (first) {
        first = false;
        await new Promise((resolve) => {
          window.releasePasswordHash = resolve;
        });
      }
      return result;
    };
  });
  const chooser = page.waitForEvent('filechooser');
  await openDevicePicker(page);
  await (
    await chooser
  ).setFiles({
    name: 'locked.pdf',
    mimeType: 'application/pdf',
    buffer: await readFile(new URL('../fixtures/security/aes-256-r5.pdf', import.meta.url)),
  });
  await expect.poll(() => page.evaluate(() => !!window.releasePasswordHash)).toBe(true);
  await requestFile(page, 'latest.pdf');
  await finishRead(page, 'latest.pdf');
  await expect(page).toHaveTitle('latest.pdf · PDF Editor');
  await page.evaluate(() => window.releasePasswordHash());
  await expect.poll(() => page.evaluate(() => window.passwordHashes)).toBe(2);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(await page.getByRole('dialog').count()).toBe(0);
  await expect(page).toHaveTitle('latest.pdf · PDF Editor');
});

test('a newer desktop open replaces the previous leave confirmation without discarding the draft', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Place at page center', exact: true }).click();
  const draft = page.getByRole('textbox', { name: 'Text to add', exact: true });
  await draft.fill('Keep this draft');
  await requestFile(page, 'earlier.pdf');
  await finishRead(page, 'earlier.pdf');
  const confirmation = page.getByRole('dialog', { name: 'Leave this PDF?', exact: true });
  await expect(confirmation).toHaveCount(1);
  await requestFile(page, 'latest.pdf');
  await finishRead(page, 'latest.pdf');
  await expect(confirmation).toHaveCount(1);
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page).toHaveTitle('* Untitled.pdf · PDF Editor');
  await expect(draft).toHaveValue('Keep this draft');
  await requestFile(page, 'retry.pdf');
  await finishRead(page, 'retry.pdf');
  await confirmation.getByRole('button', { name: 'Leave without saving', exact: true }).click();
  await expect(page).toHaveTitle('retry.pdf · PDF Editor');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

async function editorMenu(page, section, name) {
  const bar = page.getByRole('menubar', { name: 'PDF menus' });
  if (await bar.isVisible())
    await bar.getByRole('menuitem', { name: section, exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    if (section !== 'File')
      await page.getByRole('menu').getByRole('menuitem', { name: section, exact: true }).click();
  }
  await page.getByRole('menu').getByRole('menuitem', { name, exact: true }).click();
}

for (const title of [
  'Document details',
  'Protect with password',
  'Add signature',
  'Add stamp',
  'Name this PDF',
])
  test(`replacing a PDF dismisses its ${title} dialog`, async ({ page }) => {
    await setup(page);
    if (title === 'Add signature')
      await page.getByRole('button', { name: 'Sign', exact: true }).click();
    else if (title === 'Name this PDF') await page.locator('.document-name').click();
    else if (title === 'Add stamp') await editorMenu(page, 'Insert', 'Stamp…');
    else await editorMenu(page, 'File', `${title}…`);
    await expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible();
    await requestFile(page, 'replacement.pdf');
    await finishRead(page, 'replacement.pdf');
    await expect(page).toHaveTitle('replacement.pdf · PDF Editor');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Place at page center', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  });

test('returning to the library closes the previous PDF document details dialog', async ({
  page,
}) => {
  await setup(page);
  await editorMenu(page, 'File', 'Document details…');
  await expect(page.getByRole('dialog', { name: 'Document details' })).toBeVisible();
  await page.evaluate(() => {
    location.hash = '#library';
  });
  await expect(page.getByRole('button', { name: 'New blank PDF' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a delayed insertion read cannot ask for a password over a replacement PDF', async ({
  page,
}) => {
  await setup(page);
  const chooser = page.waitForEvent('filechooser');
  await editorMenu(page, 'Page', 'Insert pages from PDF…');
  await (
    await chooser
  ).setFiles({
    name: 'earlier.pdf',
    mimeType: 'application/pdf',
    buffer: await readFile(new URL('../fixtures/security/aes-256.pdf', import.meta.url)),
  });
  await expect.poll(() => page.evaluate(() => !!window.pendingReads['earlier.pdf'])).toBe(true);
  await requestFile(page, 'replacement.pdf');
  await finishRead(page, 'replacement.pdf');
  await finishRead(page, 'earlier.pdf');
  await expect(page).toHaveTitle('replacement.pdf · PDF Editor');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
