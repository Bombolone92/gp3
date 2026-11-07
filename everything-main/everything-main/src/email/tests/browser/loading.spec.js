import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/browser/loading.html');
  await page.waitForFunction(() => window.fixture);
});

test('fast loads retire hidden placeholders without spinner or progress text', async ({ page }) => {
  const opacity = await page.evaluate(() => {
    fixture.mount();
    return getComputedStyle(document.querySelector('.loading-list')).opacity;
  });
  expect(opacity).toBe('0');
  await expect(page.locator('.row')).toHaveCount(1);
  await expect(page.locator('.loading-placeholder, .spinner')).toHaveCount(0);
  await expect(page.locator('.list-meta')).not.toContainText('Reading');
});

for (const mobile of [false, true]) {
  test(`slow loads show static accessible skeletons (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: mobile ? 'dark' : 'light' });
    await page.evaluate(() => { fixture.hold('list'); fixture.hold('headers'); fixture.mount(); });
    const placeholder = page.getByRole('status', { name: 'Loading your messages' });
    await expect(placeholder).toHaveCSS('opacity', '1');
    expect(await placeholder.evaluate(node => getComputedStyle(node, '::after').content)).toBe('none');
    await expect(placeholder.locator('.skeleton-shapes')).toHaveAttribute('aria-hidden', 'true');
    const animations = await placeholder.evaluate(node => node.getAnimations({ subtree: true })
      .filter(animation => animation.playState === 'running').length);
    expect(animations).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`loading-${mobile ? 'mobile-dark' : 'desktop'}.png`) });
    await page.evaluate(() => fixture.releaselist());
    await expect(page.locator('.list-meta')).toHaveText('');
    await expect(placeholder).toHaveCSS('opacity', '1');
    await page.evaluate(() => fixture.releaseheaders());
    await expect(page.locator('.row')).toHaveCount(1);
    await expect(placeholder).toHaveCount(0);
  });
}

test('late folder completion cannot restore an abandoned skeleton', async ({ page }) => {
  await page.evaluate(() => { fixture.hold('list'); fixture.mount(); });
  await expect(page.locator('.loading-list')).toHaveCSS('opacity', '1');
  await page.locator('.nav-item').filter({ hasText: 'Archive' }).click();
  await expect(page.locator('.msglist')).toContainText('Nothing archived.');
  await page.evaluate(() => fixture.releaselist());
  await expect(page.locator('.loading-placeholder')).toHaveCount(0);
  await expect(page.locator('.msglist')).toContainText('Nothing archived.');
});

test('slow body failures replace the skeleton with a working retry', async ({ page }) => {
  await page.evaluate(() => { fixture.mount(); fixture.hold('body'); fixture.failBody = true; });
  await page.locator('.row').click();
  const placeholder = page.getByRole('status', { name: 'Loading message', exact: true });
  await expect(placeholder).toHaveCSS('opacity', '1');
  expect(await placeholder.evaluate(node => getComputedStyle(node, '::after').content)).toBe('none');
  await page.evaluate(() => fixture.releasebody());
  await expect(placeholder).toHaveCount(0);
  await expect(page.locator('.msg-full')).toContainText('Test connection interrupted');
  await page.evaluate(() => { fixture.failBody = false; });
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.msg-body')).toContainText('Here is the complete message.');
  await expect(page.locator('.loading-placeholder')).toHaveCount(0);
});

test('slow refresh preserves visible rows and restores its icon after showing a spinner', async ({ page }) => {
  await page.evaluate(() => fixture.mount());
  await expect(page.locator('.row')).toHaveCount(1);
  await page.evaluate(() => fixture.hold('list'));
  const refresh = page.getByRole('button', { name: 'Refresh this folder', exact: true });
  const before = await page.locator('.row').boundingBox();
  await refresh.click();
  await expect(refresh).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => refresh.evaluate(node => getComputedStyle(node, '::after').opacity)).toBe('1');
  await expect(refresh.locator('svg')).toHaveCSS('opacity', '0');
  await expect(page.locator('.row')).toHaveCount(1);
  expect(await page.locator('.row').boundingBox()).toEqual(before);
  await expect(page.locator('.loading-placeholder')).toHaveCount(0);
  await page.evaluate(() => fixture.releaselist());
  await expect(refresh).toBeEnabled();
  await expect(refresh).toHaveAttribute('aria-busy', 'false');
  await expect(refresh.locator('svg')).toHaveCSS('opacity', '1');
  expect(await refresh.evaluate(node => getComputedStyle(node, '::after').content)).toBe('none');
});

test('loading spinners stay hidden through 499 ms and appear at 500 ms without shifting content', async ({ page }) => {
  await page.evaluate(() => fixture.mount());
  await expect(page.locator('.row')).toHaveCount(1);
  const result = await page.evaluate(() => {
    fixture.hold('list');
    const node = document.querySelector('[aria-label="Refresh this folder"]');
    node.click();
    const animations = node.getAnimations({ subtree: true });
    const at = time => {
      for (const animation of animations) { animation.pause(); animation.currentTime = time; }
      return { opacity: getComputedStyle(node, '::after').opacity, height: node.getBoundingClientRect().height };
    };
    return { early: at(499), slow: at(500) };
  });
  expect(result.early.opacity).toBe('0');
  expect(result.slow.opacity).toBe('1');
  expect(result.early.height).toBe(result.slow.height);
  await expect(page.locator('.loading-placeholder')).toHaveCount(0);
  await page.evaluate(() => fixture.releaselist());
  await expect(page.getByRole('button', { name: 'Refresh this folder', exact: true })).toBeEnabled();
});

test('fast refresh restores the icon before its spinner becomes visible', async ({ page }) => {
  await page.evaluate(() => fixture.mount());
  await expect(page.locator('.row')).toHaveCount(1);
  const early = await page.evaluate(() => {
    fixture.hold('list');
    const button = document.querySelector('[aria-label="Refresh this folder"]');
    button.click();
    const result = { spinner: getComputedStyle(button, '::after').opacity,
      icon: getComputedStyle(button.querySelector('svg')).opacity };
    fixture.releaselist();
    return result;
  });
  expect(early).toEqual({ spinner: '0', icon: '1' });
  const refresh = page.getByRole('button', { name: 'Refresh this folder', exact: true });
  await expect(refresh).toBeEnabled();
  expect(await refresh.evaluate(node => getComputedStyle(node, '::after').content)).toBe('none');
});

for (const threaded of [true, false]) {
  test(`refresh preserves mounted rows, focus, scroll and cached text (conversations: ${threaded})`, async ({ page }) => {
    await page.evaluate(() => fixture.mount({ count: 40 }));
    await expect(page.locator('.row')).toHaveCount(40);
    if (!threaded) {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('menuitemcheckbox', { name: 'Conversation view' }).click();
    }
    await page.evaluate(() => {
      fixture.hold('list');
      document.querySelector('[aria-label="Refresh this folder"]').click();
    });
    const row = page.locator('.row').nth(25);
    await row.focus();
    const before = await page.evaluate(() => {
      const list = document.querySelector('.msglist');
      fixture.row = document.activeElement;
      fixture.removedRows = 0;
      fixture.rowObserver = new MutationObserver(records => {
        for (const record of records) for (const node of record.removedNodes) {
          if (node === fixture.row || node.contains?.(fixture.row)) fixture.removedRows++;
        }
      });
      fixture.rowObserver.observe(list, { childList: true, subtree: true });
      return { text: fixture.row.textContent, scroll: list.scrollTop, reads: fixture.reads };
    });
    await page.evaluate(() => fixture.releaselist());
    await expect(page.getByRole('button', { name: 'Refresh this folder', exact: true })).toBeEnabled();
    await expect(row).toHaveText(before.text);
    await expect(row).toBeFocused();
    const after = await page.evaluate(() => {
      fixture.rowObserver.disconnect();
      return { scroll: document.querySelector('.msglist').scrollTop,
        reads: fixture.reads, removed: fixture.removedRows,
        same: fixture.row === document.querySelectorAll('.row')[25] };
    });
    expect(after).toEqual({ scroll: before.scroll, reads: before.reads, removed: 0, same: true });
  });
}

test('refresh retries an unreadable header on a reused unthreaded row', async ({ page }) => {
  await page.evaluate(() => { fixture.failHeaders = true; fixture.mount(); });
  await expect(page.locator('.row')).toHaveCount(1);
  await expect(page.locator('.row-sender')).toContainText('unreadable');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Conversation view' }).click();
  await page.evaluate(() => { fixture.failHeaders = false; });
  await page.getByRole('button', { name: 'Refresh this folder', exact: true }).click();
  await expect(page.locator('.row-sender')).toHaveText('Ana');
  await expect(page.locator('.row-snippet')).toContainText('Here is the complete message.');
});

for (const mobile of [false, true]) {
  for (const compact of [false, true]) {
    test(`unthreaded header loads use static shapes without shifting rows (mobile: ${mobile}, compact: ${compact})`, async ({ page }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: mobile ? 'dark' : 'light' });
      await page.evaluate(compact => { fixture.hold('headers'); fixture.mount({ compact }); }, compact);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('menuitemcheckbox', { name: 'Conversation view' }).click();
      const row = page.locator('.row');
      await expect(row).toHaveAttribute('aria-busy', 'true');
      await expect(row).toHaveAccessibleName(/Loading message details/);
      await expect(page.locator('.row-subject')).toHaveText('A steady inbox');
      await expect(page.locator('.row-sender')).toHaveText('');
      await expect(page.locator('.row-when')).toHaveText('');
      await row.focus();
      const before = await row.boundingBox();
      const subject = await page.locator('.row-subject').boundingBox();
      await expect.poll(() => page.locator('.row-sender').evaluate(node =>
        getComputedStyle(node, '::after').opacity)).toBe('1');
      expect(await row.evaluate(node => node.getAnimations({ subtree: true })
        .filter(animation => animation.playState === 'running').length)).toBe(0);
      await page.screenshot({ path: test.info().outputPath('pending-row.png') });
      await page.evaluate(() => fixture.releaseheaders());
      await expect(row).toHaveAttribute('aria-busy', 'false');
      await expect(page.locator('.row-sender')).toHaveText('Ana');
      await expect(page.locator('.row-snippet')).toContainText('Here is the complete message.');
      await expect(row).toBeFocused();
      expect(await row.boundingBox()).toEqual(before);
      expect(await page.locator('.row-subject').boundingBox()).toEqual(subject);
      expect(await page.locator('.row-sender').evaluate(node => getComputedStyle(node, '::after').content)).toBe('none');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

test('account checks use the same quiet placeholder', async ({ page }) => {
  const opacity = await page.evaluate(() => {
    fixture.gate();
    return getComputedStyle(document.querySelector('.loading-boot')).opacity;
  });
  expect(opacity).toBe('0');
  await expect(page.getByRole('status', { name: 'Loading your inbox' })).toHaveCSS('opacity', '1');
  expect(await page.locator('.loading-boot').evaluate(node => getComputedStyle(node, '::after').content)).toBe('none');
  const unchanged = await page.evaluate(() => {
    const original = document.querySelector('.loading-boot');
    fixture.gate();
    return original === document.querySelector('.loading-boot') && getComputedStyle(original).opacity === '1';
  });
  expect(unchanged).toBe(true);
  await expect(page.locator('.spinner')).toHaveCount(0);
});

for (const mobile of [false, true]) {
  test.describe(mobile ? 'touch reader' : 'desktop reader', () => {
    test.use({ hasTouch: mobile });
    test(`reader keeps known header text and positions through body loading (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { fixture.mount(); fixture.hold('body'); });
      await page.locator('.row').click();
      const header = page.locator('.msg-item-head');
      const date = page.locator('.msg-date');
      const recipient = page.locator('.msg-to');
      await expect(recipient).toContainText('me');
      if (mobile) expect(await page.locator('.msg-more-placeholder').evaluate(node => node.offsetWidth)).toBe(44);
      const before = { header: await header.boundingBox(), date: await date.boundingBox(),
        recipient: await recipient.boundingBox(), text: await date.textContent() };
      await expect(page.locator('.loading-body')).toHaveCSS('opacity', '1');
      await page.evaluate(() => fixture.releasebody());
      await expect(page.locator('.msg-body')).toBeVisible();
      expect(await date.textContent()).toBe(before.text);
      expect(await header.boundingBox()).toEqual(before.header);
      expect(await date.boundingBox()).toEqual(before.date);
      expect(await recipient.boundingBox()).toEqual(before.recipient);
      await page.screenshot({ path: test.info().outputPath(`reader-${mobile ? 'mobile' : 'desktop'}.png`) });
    });
  });
}
