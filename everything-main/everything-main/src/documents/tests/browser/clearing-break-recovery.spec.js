import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

async function openEditableControl(page, file) {
  const old = await page.getByRole('textbox', { name: 'Document text' }).elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(file);
  if (old) await expect.poll(() => old.evaluate(el => el.isConnected), {timeout:90000}).toBe(false);
  await expect(page.getByRole('textbox', { name: 'Document text' })).toHaveJSProperty('readOnly', false);
  await expect(page.locator('.canvas-message-error')).toHaveCount(0);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  expect(unzipSync(readFileSync(await (await event).path()))).toEqual(unzipSync(readFileSync(file)));
}

const folder = 'tests/fixtures/clearing-break-recovery/';
const names = ['before', 'after', 'both'].flatMap(position => ['none', 'left', 'right', 'all'].map(clear => `${position}-${clear}`));

for (const zoom of [1, 0.75]) test(`inline clearing breaks preserve surrounding pixels and geometry at ${zoom}`, async ({ page }, info) => {
  test.setTimeout(180000);
  page.on('dialog', async dialog => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toBe('Open another document? Download your current changes first if you want to keep them.');
    await dialog.accept();
  });
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  const inputs = Object.fromEntries(names.map(name => [name, [...readFileSync(`${folder}${name}.docx`)]]));
  const results = await page.evaluate(async ({ inputs, zoom }) => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const rendered = {};
    for (const [name, bytes] of Object.entries(inputs)) {
      const { pkg, images } = await openCanvasDocument(new Uint8Array(bytes));
      const host = document.createElement('div'); document.body.append(host);
      const errors = [];
      const editor = new CanvasEditor(host, { ...pkg, images, onError: error => errors.push(error.message) });
      editor.setZoom(zoom);
      rendered[name] = { readOnly: !!pkg.readOnly, tables: pkg.tables.length, errors,
        pictures: [...editor.model.paragraphs, ...Object.values(pkg.pageStories.stories).flatMap(s => s.paragraphs)].flatMap(p => p.runs).filter(r => r.image).length,
        pixels: editor.canvases.map(c => c.toDataURL()),
        geometry: [...editor.layout.lines, ...editor.storyLayout.lines].map(l => ({ page: l.page, y: l.y, baseline: l.baseline, height: l.height,
          fragments: l.fragments.map(f => ({ text: f.text, x: f.x, width: f.width, bold: f.bold, italic: f.italic })) })) };
      editor.destroy(); host.remove();
    }
    return Object.keys(inputs).filter(name => !name.endsWith('-none')).map(name => {
      const control = rendered[`${name.split('-')[0]}-none`], current = rendered[name];
      return { name, editableControl: !control.readOnly, readOnly: current.readOnly,
        tables: current.tables, pictures: current.pictures, errors: current.errors,
        samePixels: JSON.stringify(current.pixels) === JSON.stringify(control.pixels),
        sameGeometry: JSON.stringify(current.geometry) === JSON.stringify(control.geometry) };
    });
  }, { inputs, zoom });
  for (const result of results) {
    expect(result.editableControl).toBe(true); expect(result.readOnly).toBe(false);
    expect(result.tables).toBe(1); expect(result.pictures, result.name).toBe(4); expect(result.errors).toEqual([]);
    expect(result.samePixels, result.name).toBe(true); expect(result.sameGeometry, result.name).toBe(true);
  }
  await openEditableControl(page, `${folder}both-all.docx`);
  const input = page.getByRole('textbox', { name: 'Document text' });
  const original = await input.inputValue();
  await input.focus(); await input.press('ControlOrMeta+End'); await input.press('x');
  expect(await input.inputValue()).toBe(original + 'x');
  await input.press('ControlOrMeta+z'); expect(await input.inputValue()).toBe(original);
  await page.getByRole('combobox', { name: 'Zoom' }).selectOption(String(zoom));
  await page.screenshot({ path: info.outputPath('clearing-break-recovery.png'), fullPage: true });
  if (zoom === 1) for (const name of names.filter(name => !name.endsWith('-none') && name !== 'both-all')) {
    await openEditableControl(page, `${folder}${name}.docx`);
  }
});
