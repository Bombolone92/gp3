import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
const folder = 'tests/fixtures/manual-break-wrap/';

for (const scope of ['body', 'header', 'footer']) for (const zoom of [1, .75]) test(`${scope} at ${zoom}: manual-break wrapping retains rich content`, async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto('/playground.html');
  const result = await page.evaluate(async ({ sources, zoom }) => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const out = [];
    for (const bytes of sources) {
      const { pkg, images } = await openCanvasDocument(new Uint8Array(bytes));
      const host = document.createElement('div'); document.body.append(host);
      const errors = [];
      const editor = new CanvasEditor(host, { ...pkg, images, onError: e => errors.push(e.message) });
      try {
        editor.setZoom(zoom);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        out.push({ readOnly: !!pkg.readOnly, images: images.size, tables: pkg.tables.length,
          exported: pkg.readOnly ? null : [...new Uint8Array(await pkg.export().arrayBuffer())],
          issues: pkg.previewIssues || [], storyIssues: editor.storyLayout.unsupported, errors,
          objects: editor.layout.floatingObjects.length + editor.storyLayout.floatingObjects.length,
          pixels: editor.canvases.map(c => c.toDataURL()),
          geometry: [...editor.layout.lines, ...editor.storyLayout.lines].map(l => ({ page: l.page, y: l.y,
            height: l.height, baseline: l.baseline, fragments: l.fragments.map(f => ({ text: f.text, x: f.x, width: f.width })) })) });
      } finally { editor.destroy(); host.remove(); }
    }
    const [actual, control] = out;
    return { actual: { ...actual, pixels: undefined, geometry: undefined, exported: undefined }, control: { ...control, pixels: undefined, geometry: undefined, exported: undefined },
      exported: actual.exported,
      samePixels: JSON.stringify(actual.pixels) === JSON.stringify(control.pixels),
      sameGeometry: JSON.stringify(actual.geometry) === JSON.stringify(control.geometry) };
  }, { sources: ['unsupported', 'matched'].map(n => [...readFileSync(`${folder}${scope}-${n}.docx`)]), zoom });
  expect(unzipSync(new Uint8Array(result.exported))).toEqual(unzipSync(readFileSync(`${folder}${scope}-unsupported.docx`)));
  writeFileSync(info.outputPath('wrapped-export.docx'), Buffer.from(result.exported));
  delete result.exported;
  writeFileSync(info.outputPath('diagnostic.json'), JSON.stringify(result, null, 2));
  expect(result.control.readOnly).toBe(false);
  expect(result.control.images).toBeGreaterThan(0);
  expect(result.control.objects).toBe(scope === 'body' ? 3 : 4);
  expect(result.control.errors).toEqual([]);
  expect(result.actual.readOnly).toBe(false);
  expect(result.actual.objects).toBe(result.control.objects);
  expect(result.actual.images).toBe(result.control.images);
  expect(result.actual.errors).toEqual([]);
  expect(result.sameGeometry).toBe(false);
  expect(result.samePixels).toBe(false);
  const issues = scope === 'body' ? result.actual.issues : result.actual.storyIssues.map(i => i.message);
  expect(issues.filter(s => s.includes('without text wrapping'))).toHaveLength(0);
  const previous = await page.getByRole('textbox', { name: 'Document text' }).elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(`${folder}${scope}-unsupported.docx`);
  await expect.poll(() => previous.evaluate(e => e.isConnected)).toBe(false);
  const input = page.getByRole('textbox', { name: 'Document text' });
  const before = await input.inputValue();
  await expect(input).toBeEditable();
  await input.focus(); await input.press('ControlOrMeta+End'); await page.keyboard.insertText('x');
  expect(await input.inputValue()).toBe(before + 'x');
  const editedEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  await (await editedEvent).saveAs(info.outputPath('edited.docx'));
  await input.press('ControlOrMeta+z'); expect(await input.inputValue()).toBe(before);
  const undoEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const undoPath=info.outputPath('undo.docx');await (await undoEvent).saveAs(undoPath);
  expect(unzipSync(readFileSync(undoPath))).toEqual(unzipSync(readFileSync(`${folder}${scope}-unsupported.docx`)));
  await page.screenshot({ path: info.outputPath('preview.png'), fullPage: true });
});
