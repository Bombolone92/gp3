import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { requireNativeWordFonts } from './helpers/native-fonts.js';

const root = 'tests/fixtures/bidi-decorations/';
const cases = JSON.parse(readFileSync(root + 'cases.json', 'utf8'));
const reference = JSON.parse(readFileSync(root + 'reference.json', 'utf8'));

test('places Arabic and Hebrew decorations at native context-shaped boundaries', async ({ page }, info) => {
  for (const [file, key] of [['control.docx', 'sourceSha256'], ['native.pdf', 'pdfSha256'], ['cases.json', 'casesSha256']]) {
    expect(createHash('sha256').update(readFileSync(root + file)).digest('hex')).toBe(reference[key]);
  }
  await page.goto('/playground.html');
  await requireNativeWordFonts(page, ['Arial']);
  const actual = await page.evaluate(async ({ cases, bytes }) => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { pkg, images } = await openCanvasDocument(Uint8Array.from(atob(bytes), c => c.charCodeAt(0)));
    const host = document.createElement('div'); document.body.append(host);
    const editor = new CanvasEditor(host, { ...pkg, images });
    try {
      const samples = cases.filter(c => c.mode !== 'color').map(c => {
        const line = editor.layout.lines.find(l => l.paragraphId === pkg.paragraphs[2*c.index+1].id);
        const span = line[{ underline: 'underlines', highlight: 'backgrounds', strike: 'strikes' }[c.mode]][0];
        return { index: c.index, page: line.page, x: span.x*.75, width: span.width*.75 };
      });
      return { samples, readOnly: editor.input.readOnly, pages: editor.canvases.map(c => c.toDataURL().split(',')[1]) };
    } finally { editor.destroy(); host.remove(); }
  }, { cases, bytes: readFileSync(root + 'control.docx').toString('base64') });
  writeFileSync(info.outputPath('actual.json'), JSON.stringify(actual.samples, null, 2));
  for (const [i, png] of actual.pages.entries()) writeFileSync(info.outputPath(`page-${i+1}.png`), Buffer.from(png, 'base64'));
  expect(actual.readOnly).toBe(false);
  expect(actual.pages).toHaveLength(3);
  for (const sample of actual.samples) {
    const native = reference.cases.find(c => c.index === sample.index);
    expect(sample.page).toBe(native.page);
    expect(Math.abs(sample.x - native.x), `case ${sample.index+1} start`).toBeLessThan(.2);
    expect(Math.abs(sample.width - native.width), `case ${sample.index+1} width`).toBeLessThan(.2);
  }
  await page.getByLabel('Open DOCX file').setInputFiles(root + 'control.docx');
  await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveJSProperty('readOnly', false);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const output = info.outputPath('noedit.docx'); await (await pending).saveAs(output);
  expect(unzipSync(readFileSync(output))).toEqual(unzipSync(readFileSync(root + 'control.docx')));
});
