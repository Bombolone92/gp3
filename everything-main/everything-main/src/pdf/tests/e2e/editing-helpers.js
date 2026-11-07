/** Finish the active edit the same way as clicking blank workspace in the editor. */
export async function clickAway(page) {
  await page.locator('.workspace').click({ position: { x: 4, y: 4 } });
}

/** Firefox gives constructed clipboard events their own data transfer. Populate that copy. */
export async function pasteText(input, text, html) {
  await input.evaluate(
    (el, { text, html }) => {
      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer(),
      });
      event.clipboardData.setData('text/plain', text);
      if (html !== undefined) event.clipboardData.setData('text/html', html);
      el.dispatchEvent(event);
    },
    { text, html },
  );
}

/**
 * Open this device's file picker on the Puter desktop, where Ctrl/⌘ O browses Puter instead:
 * the library's Open card, or File → Open from this device… in the editor.
 */
export async function openDevicePicker(page) {
  if (!(await page.evaluate(() => globalThis.puter?.env === 'app')))
    return page.keyboard.press('ControlOrMeta+o');
  const card = page.locator('.open-card');
  if (await card.isVisible()) return card.click();
  const bar = page.getByRole('menubar', { name: 'PDF menus' });
  if (await bar.isVisible()) await bar.getByRole('menuitem', { name: 'File', exact: true }).click();
  else await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open from this device…', exact: true }).click();
}
