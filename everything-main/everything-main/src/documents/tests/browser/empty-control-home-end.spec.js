import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const root = 'tests/fixtures/empty-control-home-end/';
const reference = JSON.parse(readFileSync(root + 'reference.json', 'utf8'));
for (const ref of reference.cases) test(`empty-control exit matches the native reference: ${ref.name}`, async ({ page }, info) => {
  const source = readFileSync(root + ref.source), parts = unzipSync(source), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(root + ref.source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  const original = ref.source === 'leading.docx' ? 'D' : ref.source === 'trailing.docx' ? 'A' : 'AD';
  await expect(input).toHaveValue(original); await input.focus(); await input.press('Control+Home');
  if (ref.source !== 'leading.docx') { await input.press('ArrowRight'); await input.press('ArrowRight'); }
  await expect(input).toHaveValue(original);
  await input.press(ref.key); await page.keyboard.insertText('X'); await expect(input).toHaveValue(ref.text);
  if (ref.name === 'wrapped-end') {
    const png = await page.locator('canvas.canvas-page').first().evaluate(c => c.toDataURL());
    writeFileSync(info.outputPath('wrapped.png'), Buffer.from(png.split(',')[1], 'base64'));
  }
  const save = async name => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(name + '.docx'); await (await pending).saveAs(path); return path;
  };
  const path = await save('edited'), output = unzipSync(readFileSync(path));
  for (const [name, data] of Object.entries(parts)) if (name !== 'word/document.xml') expect(output[name]).toEqual(data);
  const actual = await page.evaluate(xml => {
    const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', d = new DOMParser().parseFromString(xml, 'application/xml');
    const s = d.getElementsByTagNameNS(w, 'sdt')[0];
    return { text: [...s.getElementsByTagNameNS(w, 't')].map(t => t.textContent).join(''), placeholder: !!s.getElementsByTagNameNS(w, 'showingPlcHdr').length };
  }, strFromU8(output['word/document.xml']));
  expect(actual).toEqual({ text: ref.controlText, placeholder: ref.placeholder });
  await input.focus(); await input.press('ControlOrMeta+z'); await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue(original); expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await input.focus(); await input.press('ControlOrMeta+y'); await input.press('ControlOrMeta+y'); await expect(input).toHaveValue(ref.text);
  await reopenDocx(page, input, path, ref.text); expect(errors).toEqual([]);
});

test('read-only Home and End cannot restore or change an empty control', async ({ page }) => {
  await page.goto('/playground.html');
  await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js'), { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const p = await DocxPackage.open(new Uint8Array(bytes)), host = document.createElement('div'); host.id = 'home-end-readonly'; document.body.append(host);
    window.readonlyHomeEnd = new CanvasEditor(host, { ...p, readOnly: true });
  }, [...readFileSync(root + 'control.docx')]);
  const input = page.locator('#home-end-readonly textarea'); await input.focus();
  for (const key of ['Home', 'End', 'Control+Home', 'Control+End']) {
    await page.evaluate(() => {
      const e = window.readonlyHomeEnd, id = e.model.paragraphs[0].runs.find(r => r.contentControl).contentControl.id;
      e.model.select(1, 1, { id, side: 'inside' }); e.syncInput();
    });
    await input.press(key); await expect(input).toHaveValue('AD');
  }
  expect(await page.evaluate(() => window.readonlyHomeEnd.session.history.length)).toBe(0);
});
