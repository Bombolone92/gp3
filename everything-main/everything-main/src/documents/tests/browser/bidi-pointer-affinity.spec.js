import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { requireNativeWordFonts } from './helpers/native-fonts.js';

const cases = JSON.parse(readFileSync('tests/fixtures/bidi-layout/cases.json', 'utf8'));

// Exercise editor interaction against the independently authored native layout
// controls. Active RTL DOCX editing remains guarded separately.
test('keeps the caret at the clicked side of mixed-direction boundaries', async ({ page }, info) => {
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
      for (const zoom of [1, 1.25]) {
        editor.setZoom(zoom);
        for (const line of editor.layout.lines.filter(l => l.bidi)) {
          const bounds = editor.canvases[line.page].getBoundingClientRect();
          for (const stop of line.stops.filter(s => s.affinity)) {
            const event = { clientX: bounds.left + stop.x * zoom, clientY: bounds.top + (line.y + line.height / 2) * zoom };
            const position = editor.point(event);
            const caret = caretRect(editor.layout, position, editor.caretAffinity, editor.caretPage);
            samples.push({ zoom, position, affinity: editor.caretAffinity, error: Math.abs(caret.x - stop.x) });
            const savedAffinity = editor.caretAffinity, savedPage = editor.caretPage;
            editor.point({ ...event, clientX: bounds.left + line.stops[0].x * zoom }, false);
            if (editor.caretAffinity !== savedAffinity || editor.caretPage !== savedPage) throw new Error('Hover changed the caret');
          }
        }
      }
      return { samples, unchanged: editor.model.text === original, history: editor.model.history.length };
    } finally { editor.destroy(); host.remove(); }
  }, cases);
  writeFileSync(info.outputPath('pointer-samples.json'), JSON.stringify(result, null, 2));
  expect(result.samples.length).toBeGreaterThan(50);
  expect(result.samples.filter(s => s.error > .01)).toEqual([]);
  expect(result.samples.some(s => s.affinity === 'backward')).toBe(true);
  expect(result.unchanged).toBe(true);
  expect(result.history).toBe(0);
});
