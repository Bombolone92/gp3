import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { requireNativeWordFonts } from './helpers/native-fonts.js';

const cases = JSON.parse(readFileSync('tests/fixtures/bidi-layout/cases.json', 'utf8'));

test('retains the nearest visual boundary when moving vertically or extending selection', async ({ page }, info) => {
  const reference = JSON.parse(readFileSync('tests/fixtures/bidi-layout/reference.json', 'utf8'));
  for (const [name, key] of [['control.docx', 'sourceSha256'], ['cases.json', 'casesSha256']]) {
    expect(createHash('sha256').update(readFileSync(`tests/fixtures/bidi-layout/${name}`)).digest('hex')).toBe(reference[key]);
  }
  await page.goto('/playground.html');
  await requireNativeWordFonts(page, ['Arial']);
  const result = await page.evaluate(async cases => {
    const { bidiControlParagraphs } = await import('/tests/helpers/bidi-controls.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { prepareCanvasFont } = await import('/src/engine/font-availability.js');
    const { caretRect } = await import('/src/engine/layout.js');
    await prepareCanvasFont('Arial');
    const host = document.createElement('div'); document.body.append(host);
    const editor = new CanvasEditor(host, { paragraphs: bidiControlParagraphs(cases) });
    const samples = [], original = editor.model.text;
    try {
      for (const [index, line] of editor.layout.lines.entries()) {
        if (!line.bidi) continue;
        for (const [key, origin] of [['ArrowDown', editor.layout.lines[index - 1]], ['ArrowUp', editor.layout.lines[index + 1]]]) {
          if (!origin) continue;
          for (const shift of [false, true]) for (const stop of line.stops.filter(s => s.affinity)) {
            editor.model.select(origin.start, origin.start);
            editor.caretAffinity = 'forward'; editor.caretPage = origin.page;
            editor.preferredCellId = null; editor.preferredX = stop.x;
            editor.move(key, shift, false, false);
            const caret = caretRect(editor.layout, editor.model.selection.focus, editor.caretAffinity, editor.caretPage);
            samples.push({ key, shift, position: editor.model.selection.focus, error: Math.abs(caret.x - stop.x), page: caret.page, expectedPage: line.page,
              anchorCorrect: editor.model.selection.anchor === (shift ? origin.start : editor.model.selection.focus) });
          }
        }
      }
      return { samples, unchanged: editor.model.text === original, history: editor.model.history.length };
    } finally { editor.destroy(); host.remove(); }
  }, cases);
  writeFileSync(info.outputPath('vertical-samples.json'), JSON.stringify(result, null, 2));
  expect(result.samples.length).toBeGreaterThan(100);
  expect(result.samples.filter(s => s.error > .01 || s.page !== s.expectedPage || !s.anchorCorrect)).toEqual([]);
  expect(result.unchanged).toBe(true); expect(result.history).toBe(0);
});
