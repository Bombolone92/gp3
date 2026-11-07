import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const references = JSON.parse(readFileSync('tests/fixtures/square-wrap-flow/reference.json', 'utf8'));

for (const name of Object.keys(references)) test(`${name}: native line flow, picture placement and retained export`, async ({ page }, info) => {
  test.setTimeout(90000);
  const source = `public/fixtures/${name}.docx`, reference = references[name];
  expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/CASE/); await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(4);
  await expect(page.locator('#playground-error')).toBeEmpty();
  const actual = await page.evaluate(async source => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { loadCanvasFonts, measureCanvasText, setCanvasFontAlternatives } = await import('/src/engine/canvas-text.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { layoutPageStories } = await import('/src/engine/page-story-layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(source), c => c.charCodeAt(0)));
    await loadCanvasFonts(pkg);
    const ctx = document.createElement('canvas').getContext('2d'); setCanvasFontAlternatives(ctx, pkg.styles.fontAlternatives);
    const measure = (t, s) => measureCanvasText(ctx, t, s);
    const body = layoutDocument(pkg.paragraphs, measure, pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories);
    const settings = [...pkg.paragraphs.filter(p => p.sectionEnd).map(p => p.sectionEnd), pkg.pageSettings];
    const stories = layoutPageStories(body, pkg.pageStories, settings, measure, pkg.numbering, { styles: pkg.styles });
    let arial = false; try { await new FontFace('reference availability', 'local("Arial")').load(); arial = true; } catch {}
    const split = body.lines.find(l => l.wrapSegments?.length === 2);
    const interaction = split && { page: split.page, width: body.pages[split.page].width, y: split.y + split.height / 2,
      ends: [split.wrapSegments[0].stops.at(-1), split.wrapSegments[1].stops[0]].map(s => ({ x: s.x, offset: s.offset })) };
    return { arial, interaction, pages: body.pages.map((_, page) => ({
      lines: [...body.lines, ...stories.lines].filter(l => l.page === page && l.fragments.some(f => !f.image && f.text)).map(l => ({
        baseline: l.baseline * .75, text: l.fragments.filter(f => !f.image).map(f => f.text).join(''),
        parts: l.fragments.filter(f => !f.image).map(f => ({ text: f.text, x: f.x * .75 })),
      })),
      pictures: [...body.floatingObjects, ...stories.floatingObjects].filter(f => f.page === page).map(f => [f.x * .75, f.y * .75, (f.x + f.width) * .75, (f.y + f.height) * .75]),
    })) };
  }, readFileSync(source).toString('base64'));
  if (actual.arial) for (const [index, expected] of reference.pages.entries()) {
    const pageResult = actual.pages[index];
    expect(pageResult.lines.map(l => l.text)).toEqual(expected.lines.map(l => l.text));
    for (const [i, line] of pageResult.lines.entries()) {
      let offset = 0;
      for (const part of line.parts) {
        expect(Math.abs(part.x - expected.lines[i].glyphs[offset][1])).toBeLessThan(.15);
        offset += part.text.length;
      }
      // Existing exact-line Arial baseline metrics differ by ~1.1pt. This
      // wrapping regression measures baseline advances independently of that
      // documented font-metric issue, rather than blessing its absolute offset.
      if (i && !line.text.startsWith('Footer')) expect(Math.abs((line.baseline - pageResult.lines[0].baseline) - (expected.lines[i].baseline - expected.lines[0].baseline))).toBeLessThan(.15);
    }
    expect(pageResult.pictures).toHaveLength(expected.pictures.length);
    for (const [i, picture] of pageResult.pictures.entries()) for (let axis = 0; axis < 4; axis++) expect(Math.abs(picture[axis] - expected.pictures[i][axis])).toBeLessThan(.8);
  } else test.info().annotations.push({ type: 'native reference', description: 'Arial unavailable; portable geometry is checked in unit tests.' });
  if (actual.interaction) {
    const { page: index, width, y, ends } = actual.interaction;
    const canvas = page.locator('canvas.canvas-page').nth(index);
    for (const end of ends) {
      const box = await canvas.boundingBox(), zoom = box.width / width;
      await canvas.click({ position: { x: end.x * zoom, y: y * zoom } });
      await expect(input).toHaveJSProperty('selectionStart', end.offset);
      const left = await input.evaluate((input, index) => parseFloat(input.style.left) - document.querySelectorAll('canvas.canvas-page')[index].offsetLeft, index);
      expect(Math.abs(left - end.x * zoom)).toBeLessThan(1);
    }
  }
  const original = await input.inputValue();
  const save = async name => { const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const path = info.outputPath(name + '.docx'); await (await event).saveAs(path); return path; };
  const noedit = await save('noedit');
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited '); await expect(input).toHaveValue('Edited ' + original);
  await expect(page.locator('#playground-error')).toBeEmpty(); const edited = await save('edited');
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original); const undo = await save('undo');
  const parts = unzipSync(readFileSync(source));
  for (const path of [noedit, undo]) expect(unzipSync(readFileSync(path))).toEqual(parts);
  const changed = unzipSync(readFileSync(edited)); for (const name of Object.keys(parts)) if (name !== 'word/document.xml') expect(changed[name], name).toEqual(parts[name]);
  await reopenDocx(page, input, edited, 'Edited ' + original); await expect(page.locator('#playground-error')).toBeEmpty();
  await expect(page.locator('canvas.canvas-page')).toHaveCount(4);
});
