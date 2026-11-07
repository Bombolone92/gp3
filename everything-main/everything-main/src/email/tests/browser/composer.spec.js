import { test, expect } from '@playwright/test';

const start = async (page) => {
  await page.goto('/tests/browser/composer.html');
  await page.getByRole('button', { name: 'Compose', exact: true }).click();
};
const address = async (page) => {
  await page.getByRole('combobox', { name: 'To', exact: true }).fill('alex@example.com');
  await page.getByRole('combobox', { name: 'To', exact: true }).press('Enter');
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('Quarterly report');
};

test('inserts and edits a custom link without losing the selection, and supports native undo', async ({ page }) => {
  await start(page);
  const body = page.getByRole('textbox', { name: 'Message body' });
  await body.fill('Read our report');
  await body.press('ControlOrMeta+a');
  await body.press('ControlOrMeta+k');
  await expect(page.getByRole('textbox', { name: 'Link text' })).toHaveValue('Read our report');
  await page.getByRole('textbox', { name: 'Link URL' }).fill('example.com/report');
  await page.getByRole('button', { name: 'Apply link' }).click();
  await expect(body.locator('a')).toHaveAttribute('href', 'https://example.com/report');
  await expect(body.locator('a')).toHaveText('Read our report');
  await body.press('ControlOrMeta+z');
  await expect(body.locator('a')).toHaveCount(0);
  await expect(body).toHaveText('Read our report');
});

test('rejects unsafe links and Escape closes only the link editor', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Insert or edit link' }).click();
  await page.getByRole('textbox', { name: 'Link URL' }).fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Apply link' }).click();
  await expect(page.getByText('Enter a valid web address or email address.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Link URL' }).press('Escape');
  await expect(page.getByRole('group', { name: 'Edit link' })).toBeHidden();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('restores attachment bytes after an actual page reload and sends multipart mail', async ({ page }) => {
  let raw = '';
  await page.route('**/test-api/email/send', async (route) => {
    raw = route.request().postData();
    await route.fulfill({ json: { ok: true } });
  });
  await start(page);
  await address(page);
  await page.getByRole('textbox', { name: 'Message body' }).fill('The latest figures.');
  await page.locator('input[type=file]').setInputFiles({ name: 'report.txt', mimeType: 'text/plain', buffer: Buffer.from('attachment survives reload') });
  await expect(page.getByText('Draft saved on this device')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Resume draft' }).click();
  await expect(page.getByRole('group', { name: 'Attachments', exact: true })).toContainText('report.txt');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => raw).toContain(Buffer.from('attachment survives reload').toString('base64'));
  expect(raw).toContain('multipart/mixed');
});

test('alignment and highlighting survive draft save and reload', async ({ page }) => {
  await start(page);
  const body = page.getByRole('textbox', { name: 'Message body' });
  await body.fill('Quarterly highlights');
  await body.press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Text alignment' }).click();
  await page.getByRole('menuitemradio', { name: 'Centre' }).click();
  await page.getByRole('button', { name: 'Highlight colour' }).click();
  await page.getByRole('menuitem', { name: 'Yellow' }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Resume draft' }).click();
  await expect(body.locator('[style*="text-align"]')).toHaveCSS('text-align', 'center');
  await expect(body.locator('[style*="background-color"]')).toHaveCSS('background-color', 'rgb(255, 242, 168)');
});

for (const [name, viewport, theme] of [
  ['desktop', { width: 1280, height: 800 }, 'light'],
  ['phone', { width: 390, height: 844 }, 'light'],
  ['short-dark', { width: 720, height: 440 }, 'dark'],
]) {
  test(`composer remains usable at ${name} size`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme });
    await start(page);
    await address(page);
    await page.getByRole('textbox', { name: 'Message body' }).fill('Hi Alex,\n\nHere is our latest quarterly update.\n\nThank you,\nMorgan');
    await page.getByRole('button', { name: 'Expand composer' }).click();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
    const panel = page.getByRole('dialog');
    const box = await panel.boundingBox();
    expect(box.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  });
}

test('edits and removes an existing link while keeping its text', async ({ page }) => {
  await start(page);
  const body = page.getByRole('textbox', { name: 'Message body' });
  await body.fill('Read the report');
  await body.press('ControlOrMeta+a');
  await body.press('ControlOrMeta+k');
  await page.getByRole('textbox', { name: 'Link URL' }).fill('https://example.com/first');
  await page.getByRole('button', { name: 'Apply link' }).click();
  await body.press('ControlOrMeta+k');
  await expect(page.getByRole('textbox', { name: 'Link URL' })).toHaveValue('https://example.com/first');
  await page.getByRole('textbox', { name: 'Link URL' }).fill('https://example.com/updated');
  await page.getByRole('button', { name: 'Apply link' }).click();
  await expect(body.locator('a')).toHaveAttribute('href', 'https://example.com/updated');
  await body.press('ControlOrMeta+k');
  await page.getByRole('button', { name: 'Remove link' }).click();
  await expect(body.locator('a')).toHaveCount(0);
  await expect(body).toHaveText('Read the report');
});

test('minimizes without closing, restores the same draft, files and selection', async ({ page }, testInfo) => {
  await start(page);
  await address(page);
  const body = page.getByRole('textbox', { name: 'Message body' });
  await body.fill('Keep this exact draft');
  await page.locator('input[type=file]').setInputFiles({ name: 'keep.txt', mimeType: 'text/plain', buffer: Buffer.from('keep me') });
  await body.press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Minimize composer' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#app')).not.toHaveAttribute('inert');
  await expect(page.getByRole('region', { name: 'Minimized drafts' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('minimized.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Restore draft: Quarterly report' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore draft: Quarterly report' }).click();
  await expect(body).toHaveText('Keep this exact draft');
  await expect(page.getByRole('group', { name: 'Attachments', exact: true })).toContainText('keep.txt');
  await expect(page.getByRole('region', { name: 'Minimized drafts' })).toHaveCount(0);
  await expect(page.locator('#app')).toHaveAttribute('inert');
  await body.press('ControlOrMeta+b');
  await expect(body.locator('b, strong')).toHaveText('Keep this exact draft');
  await page.getByRole('button', { name: 'Minimize composer' }).click();
  await page.getByRole('button', { name: 'Resume draft', exact: true }).click();
  await expect(page.locator('.modal-root')).toHaveCount(1);
  await expect(body).toHaveText('Keep this exact draft');
  await body.press('ControlOrMeta+z');
  await expect(body.locator('b, strong')).toHaveCount(0);
  await expect(body).toHaveText('Keep this exact draft');
});

for (const touch of [false, true]) {
  test(`recipient heights and focus bounds are stable (${touch ? 'touch' : 'mouse'})`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width: 560, height: 760 }, hasTouch: touch });
    const page = await context.newPage();
    // Relative, like every other spec: the config's baseURL says where the
    // server is, and a context made here still takes the config's defaults.
    await page.goto('/tests/browser/composer.html');
    await page.getByRole('button', { name: 'Compose', exact: true }).click();
    const to = page.getByRole('combobox', { name: 'To', exact: true });
    const cc = page.getByRole('combobox', { name: 'Cc', exact: true });
    const height = () => to.locator('xpath=ancestor::div[contains(@class,"compose-field")]').evaluate((node) => node.getBoundingClientRect().height);
    const empty = await height();
    await to.fill('alex@example.com');
    expect(await height()).toBe(empty);
    await to.press('Enter');
    expect(await height()).toBe(empty);
    await cc.focus();
    expect((await cc.locator('xpath=ancestor::div[contains(@class,"compose-field")]').boundingBox()).height).toBe(empty);
    await page.screenshot({ path: testInfo.outputPath(`recipients-${touch ? 'touch' : 'mouse'}.png`) });
    const body = page.getByRole('textbox', { name: 'Message body' });
    await body.focus();
    await expect(body).toHaveCSS('outline-offset', '-2px');
    const editorBox = await body.boundingBox();
    const footerBox = await page.locator('.compose-footer').boundingBox();
    expect(editorBox.y + editorBox.height).toBeLessThanOrEqual(footerBox.y + 1);
    await page.screenshot({ path: testInfo.outputPath(`editor-focus-${touch ? 'touch' : 'mouse'}.png`) });
    await context.close();
  });
}
