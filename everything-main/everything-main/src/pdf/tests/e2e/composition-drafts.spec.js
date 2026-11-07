import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { addNote, listNotes } from '../../src/core/notes.js';

async function openPdf(page, bytes) {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (
    await chooser
  ).setFiles({
    name: 'composition.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator('.page-caption')).toHaveText('Page 1 of 1');
}

async function start(page, doc) {
  await page.route('https://js.puter.com/**', (route) => route.abort());
  await page.goto('/#library');
  await openPdf(page, await doc.save());
}

async function composingDraft(page, input) {
  await input.fill('Keep this draft ');
  await input.press('End');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'α', selectionStart: 1, selectionEnd: 1 });
  return cdp;
}

async function download(page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  return readFile(await (await pending).path());
}

for (const kind of ['single-line', 'multiline', 'editable choice']) {
  test(`IME cancellation preserves the ${kind} form draft until ordinary Escape`, async ({
    page,
  }) => {
    const doc = await PDFDocument.create();
    const sheet = doc.addPage([400, 500]);
    const form = doc.getForm();
    const field =
      kind === 'editable choice'
        ? form.createDropdown('Response')
        : form.createTextField('Response');
    if (kind === 'editable choice') {
      field.setOptions(['Original']);
      field.enableEditing();
      field.select('Original');
    } else {
      field.setText('Original');
      if (kind === 'multiline') field.enableMultiline();
    }
    field.addToPage(sheet, { x: 40, y: 300, width: 300, height: 80 });
    await start(page, doc);
    const input = page.getByLabel('Response (on page)', { exact: true });
    const cdp = await composingDraft(page, input);
    await input.press('Control+Enter');
    await expect(input).toHaveValue('Keep this draft α');
    await input.press('Escape');
    await expect(input).toHaveValue(/^Keep this draft /);
    await expect(input).toBeFocused();
    await expect(page.locator('.save-status')).toHaveText('Unsaved changes');
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await input.press('Escape');
    await expect(input).toHaveValue('Original');
    await expect(page.locator('.save-status')).toHaveText('Local file');
    await input.fill('Reviewed input');
    await input.press('ControlOrMeta+Enter');
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    const bytes = await download(page);
    const saved = (await PDFDocument.load(bytes)).getForm();
    expect(
      kind === 'editable choice'
        ? saved.getDropdown('Response').getSelected()
        : saved.getTextField('Response').getText(),
    ).toEqual(kind === 'editable choice' ? ['Reviewed input'] : 'Reviewed input');
    await openPdf(page, bytes);
    await expect(page.getByLabel('Response (on page)', { exact: true })).toHaveValue(
      'Reviewed input',
    );
  });
}

for (const existing of [false, true]) {
  test(`IME confirmation and cancellation preserve ${existing ? 'an existing' : 'a new'} note draft`, async ({
    page,
  }) => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 500]);
    if (existing) addNote(doc, 0, { x: 100, y: 350, text: 'Original note', hex: '#f2c438' });
    await start(page, doc);
    if (existing)
      await page.getByRole('button', { name: 'Edit note: Original note', exact: true }).click();
    else {
      await page.getByRole('button', { name: 'Note', exact: true }).click();
      await page.getByRole('button', { name: 'Place at page center', exact: true }).click();
    }
    const input = page.getByRole('textbox', {
      name: existing ? 'Note text' : 'New note text',
      exact: true,
    });
    const cdp = await composingDraft(page, input);
    await input.press('Control+Enter');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('Keep this draft α');
    await input.press('Escape');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(/^Keep this draft /);
    await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    expect(
      listNotes(await PDFDocument.load(await download(page)), 0).map((note) => note.text),
    ).toEqual(existing ? ['Original note'] : []);
  });
}
