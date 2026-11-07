import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder = 'tests/fixtures/nonbreaking-hyphen/';

test('matches native nonbreaking and ASCII hyphen wrapping and glyph advances', async ({ page }, info) => {
  test.setTimeout(120000);
  const ref = JSON.parse(readFileSync(folder + 'semantics-reference.json'));
  for (const [name, hash] of [['semantics.docx', ref.sourceSha256], ['semantics-native.pdf', ref.pdfSha256]]) {
    expect(createHash('sha256').update(readFileSync(folder + name)).digest('hex')).toBe(hash);
  }
  await page.goto('/playground.html');
  const actual = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { validateCanvasLayout, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { fontAvailable } = await import('/src/engine/font-availability.js');
    const p = await DocxPackage.open(new Uint8Array(bytes)); await validateCanvasLayout(p);
    const c = document.createElement('canvas').getContext('2d');
    const l = layoutDocument(p.paragraphs, (t, s) => measureCanvasText(c, t, s), pageGeometry(p.pageSettings));
    let offset = 0;
    const advances = [];
    for (const paragraph of p.paragraphs) {
      for (const run of paragraph.runs) {
        if (run.noBreakHyphen) {
          const line = l.lines.find(line => line.stops.some(s => s.offset === offset) && line.stops.some(s => s.offset === offset + 1));
          advances.push((line.stops.find(s => s.offset === offset + 1).x - line.stops.find(s => s.offset === offset).x) * .75);
        }
        offset += run.text.length;
      }
      offset++;
    }
    return { native: ['Arial', 'Times New Roman'].every(fontAvailable), pages: l.pageCount,
      advances, cases: p.paragraphs.filter((_, i) => i % 2).map(p => {
        const rows = l.lines.filter(line => line.paragraphId === p.id);
        return rows.map(line => ({ text: line.fragments.map(f => f.text).join('').trimEnd(), x: line.stops[0].x * .75, baseline: line.baseline * .75 }));
      }) };
  }, [...readFileSync(folder + 'semantics.docx')]);
  writeFileSync(info.outputPath('native-comparison.json'), JSON.stringify(actual, null, 2));
  expect(actual.pages).toBe(1); expect(actual.cases).toHaveLength(6);
  const expected = Array.from({ length: 6 }, (_, i) => ref.lines.slice(i * 3 + 1, i * 3 + 3));
  if (actual.native) {
    expect(actual.advances).toHaveLength(ref.elementHyphens.length);
    actual.advances.forEach((advance, i) => expect(Math.abs(advance - ref.elementHyphens[i].advance)).toBeLessThan(.2));
    actual.cases.forEach((lines, i) => {
      expect(lines.map(l => l.text)).toEqual(expected[i].map(l => l.text.replaceAll('\ufffe', '-')));
      // Compare line spacing within each case; literal U+2011 font fallback is
      // an independent existing path, not the element's glyph mapping.
      if (i % 3 !== 2) {
        expect(Math.abs((lines[1].baseline - lines[0].baseline) - (expected[i][1].baseline - expected[i][0].baseline))).toBeLessThan(.2);
        for (const line of lines) expect(Math.abs(line.x - expected[i][0].x)).toBeLessThan(.2);
      }
    });
  } else info.annotations.push({ type: 'native fonts', description: 'Arial/Times New Roman are required for native wrapping comparison.' });
  await page.getByLabel('Open DOCX file').setInputFiles(folder + 'semantics.docx');
  await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveJSProperty('readOnly', false);
  await page.screenshot({ path: info.outputPath('semantics.png'), fullPage: true });
});

test('keeps mixed-run pictures and hyphens editable with exact undo and reopening', async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto('/playground.html');
  const results = await page.evaluate(async sources => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const out = [];
    for (const bytes of sources) {
      const { pkg, images } = await openCanvasDocument(new Uint8Array(bytes));
      const host = document.createElement('div'); document.body.append(host);
      const errors = [], editor = new CanvasEditor(host, { ...pkg, images, onError: e => errors.push(e.message) });
      try {
        const runs = [...pkg.paragraphs, ...Object.values(pkg.pageStories.stories).flatMap(s => s.paragraphs)].flatMap(p => p.runs);
        out.push({ readOnly: !!pkg.readOnly, issues: pkg.previewIssues || [], errors,
          pictures: runs.filter(r => r.image && r.bold && r.link).length, pages: editor.canvases.length });
      } finally { editor.destroy(); host.remove(); }
    }
    return out;
  }, ['before', 'after', 'both'].map(n => [...readFileSync(folder + n + '-element.docx')]));
  for (const r of results) expect(r).toEqual({ readOnly: false, issues: [], errors: [], pictures: 4, pages: 1 });
  const source = folder + 'both-element.docx';
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/Styled heading/); await expect(input).toHaveJSProperty('readOnly', false);
  const original = await input.inputValue(), parts = unzipSync(readFileSync(source));
  const save = async name => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(name + '.docx'); await (await pending).saveAs(path); return path;
  };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const edited = await save('edited'), changed = unzipSync(readFileSync(edited));
  for (const [n, bytes] of Object.entries(parts)) if (n !== 'word/document.xml') expect(changed[n]).toEqual(bytes);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page, input, edited, 'Edited ' + original);
  await expect(page.locator('#playground-error')).toBeEmpty();
  await page.screenshot({ path: info.outputPath('mixed.png'), fullPage: true });
});
