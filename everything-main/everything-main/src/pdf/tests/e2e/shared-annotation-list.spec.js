import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { addNote, listNotes } from '../../src/core/notes.js';

const settled = (page) => expect(page.locator('.editor')).toHaveAttribute('aria-busy', 'false');
async function openShared(page, populated) {
  await page.route('https://js.puter.com/**', (route) => route.abort());
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  doc.addPage([300, 300]);
  if (populated) addNote(doc, 0, { x: 100, y: 200, text: 'Shared note' });
  const array = doc.getPage(0).node.Annots() || doc.context.obj([]);
  const ref = doc.context.register(array);
  for (const sheet of doc.getPages()) sheet.node.set(PDFName.of('Annots'), ref);
  await page.goto('/#library');
  const pending = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Open a PDF/ }).click();
  await (
    await pending
  ).setFiles({
    name: 'shared-annotations.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 2');
  await settled(page);
}
async function goTo(page, number) {
  const input = page.getByLabel('Page number', { exact: true });
  await input.fill(String(number));
  await input.press('Enter');
  await expect(page.locator('.page-caption')).toHaveText(`Page ${number} of 2`);
  await settled(page);
}
async function exported(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  return PDFDocument.load(await readFile(await (await pending).path()));
}
async function expectNotes(page, counts) {
  const doc = await exported(page);
  expect(doc.getPages().map((_, i) => listNotes(doc, i).length)).toEqual(counts);
}
for (const index of [0, 1]) {
  test(`adding a note on page ${index + 1} keeps the other shared list empty through history and export`, async ({
    page,
  }) => {
    await openShared(page, false);
    await goTo(page, index + 1);
    await page.getByRole('button', { name: 'Note', exact: true }).click();
    await page.getByRole('button', { name: 'Place at page center', exact: true }).click();
    const text = page.getByLabel('New note text');
    await text.fill('Only here');
    await text.press('ControlOrMeta+Enter');
    await settled(page);
    await expect(page.locator('.note-target')).toHaveCount(1);
    const counts = index === 0 ? [1, 0] : [0, 1];
    await expectNotes(page, counts);
    await goTo(page, 2 - index);
    await expect(page.locator('.note-target')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await settled(page);
    await expectNotes(page, [0, 0]);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await settled(page);
    await expectNotes(page, counts);
  });
  test(`deleting a note on page ${index + 1} keeps the other shared placement through history and export`, async ({
    page,
  }) => {
    await openShared(page, true);
    await goTo(page, index + 1);
    await page.getByRole('button', { name: 'Edit note: Shared note', exact: true }).click();
    await page.getByRole('button', { name: 'Delete note', exact: true }).click();
    await settled(page);
    await expect(page.locator('.note-target')).toHaveCount(0);
    const counts = index === 0 ? [0, 1] : [1, 0];
    await expectNotes(page, counts);
    await goTo(page, 2 - index);
    await expect(page.locator('.note-target')).toHaveCount(1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await settled(page);
    await expectNotes(page, [1, 1]);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await settled(page);
    await expectNotes(page, counts);
  });
}
