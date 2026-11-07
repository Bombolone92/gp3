import { test, expect, type Page } from '@playwright/test';
import { boot, idle } from './helpers';

async function textDoc(page: Page, texts: string[]) {
  await page.evaluate(async (texts) => {
    const e = window.photoStudio;
    const { newDocument, layer: newLayer } = await import('/src/model/document.ts');
    const doc = newDocument(800, 400, 'Text');
    e.history.reset(doc);
    e.hasDocument = true;
    const { fromPlainText, defaultCharStyle } = await import('/src/imaging/text/model.ts');
    texts.forEach((text, i) => {
      const data = { content: fromPlainText(text, { ...defaultCharStyle(), size: 30 }), mode: 'point' as const, origin: { x: 40, y: 80 + i * 80 }, orientation: 'horizontal' as const, antiAlias: 'smooth' as const };
      const l = newLayer('text', text, 1, 1);
      l.textData = data;
      l.text = text;
      e.command('Add', (d) => d.layers.push(l));
      e.selected = l.id;
    });
    e.update();
  }, texts);
  await idle(page);
}
const layerTexts = (page: Page) => page.evaluate(() => window.photoStudio.doc.layers.map((l) => l.text));

test('Find and Replace changes text across layers', async ({ page }) => {
  await boot(page);
  await textDoc(page, ['a dog and a Dog', 'hotdog dog']);
  await page.evaluate(() => window.photoStudio.runCommand('edit.find-replace-text'));
  const dlg = page.locator('dialog.fr-workspace');
  await dlg.locator('#fr-find').fill('dog');
  await dlg.locator('#fr-change').fill('cat');
  await dlg.getByLabel('Whole Word Only').check();
  await dlg.getByRole('button', { name: 'Find Next' }).click();
  await expect(dlg.locator('#fr-status')).toContainText('Found in');
  await dlg.getByRole('button', { name: 'Change All' }).click();
  await expect(dlg.locator('#fr-status')).toContainText('Changed 3 occurrences in 2 layers');
  expect(await layerTexts(page)).toEqual(['a cat and a cat', 'hotdog cat']);
  expect(await page.evaluate(() => window.photoStudio.history.labels.at(-1))).toBe('Replace Text');
});

test('Check Spelling suggests and changes a misspelled word', async ({ page }) => {
  await boot(page);
  await textDoc(page, ['over teh lazy dog']);
  await page.evaluate(() => window.photoStudio.runCommand('edit.check-spelling'));
  const dlg = page.locator('dialog.sp-workspace');
  await expect(dlg.locator('#sp-word')).toHaveText('teh');
  await expect(dlg.locator('#sp-change')).toHaveValue('the');
  await dlg.getByRole('button', { name: 'Change', exact: true }).click();
  await expect(dlg.locator('#sp-status')).toHaveText('Spell check complete.');
  await dlg.getByRole('button', { name: 'Done' }).click();
  await page.evaluate(() => window.photoStudio.runCommand('select.deselect-layers'));
  await idle(page);
  expect(await layerTexts(page)).toEqual(['over the lazy dog']);
});
