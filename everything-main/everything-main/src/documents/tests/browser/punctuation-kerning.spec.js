import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const refs = JSON.parse(readFileSync('tests/fixtures/punctuation-kerning/reference.json', 'utf8')).cases;
for (const ref of refs) test(`retains native punctuation kerning and editing: ${ref.fixture}`, async ({ page }, info) => {
  const path = `public/fixtures/${ref.fixture}.docx`, bytes = readFileSync(path);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.docxSha256);
  expect(createHash('sha256').update(readFileSync(`tests/fixtures/punctuation-kerning/${ref.fixture}-native.pdf`)).digest('hex')).toBe(ref.pdfSha256);
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(path);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^K01 AVATAR/); await expect(input).toBeEditable();
  const original = await input.inputValue();
  const geometry = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js'), { layoutDocument } = await import('/src/engine/layout.js'), { pageGeometry } = await import('/src/engine/page-settings.js'), { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const p = await DocxPackage.open(new Uint8Array(bytes)); await loadCanvasFonts(p); const c = document.createElement('canvas').getContext('2d');
    const layout = layoutDocument(p.paragraphs, (t,s) => measureCanvasText(c,t,s), pageGeometry(p.pageSettings), p.numbering, p.tables);
    c.font = '24px "Times New Roman", monospace'; const times = c.measureText('AVATAR T.A').width;
    c.font = '24px monospace'; const hasTimes = Math.abs(times - c.measureText('AVATAR T.A').width) > .1;
    return { pages: layout.pageCount, widths: layout.lines.map(l => l.width * .75), hasTimes };
  }, [...bytes]);
  expect(geometry.pages).toBe(ref.pages); expect(geometry.widths).toHaveLength(ref.lines.length);
  if (!ref.fixture.includes('asian')) for (const [on, off] of [[0,48],[2,49],[3,50],[8,51]]) {
    const expected = ref.lines[off].terminalX - ref.lines[on].terminalX;
    expect(expected).toBeGreaterThan(1);
    expect(geometry.widths[off]).toBeGreaterThan(geometry.widths[on]);
    // CI need not redistribute the proprietary font; retain behavioral assertions
    // there and compare exact native pair adjustments when the font is installed.
    if (geometry.hasTimes) expect(Math.abs(geometry.widths[off] - geometry.widths[on] - expected)).toBeLessThan(.15);
  }
  const download = async suffix => { const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const file = info.outputPath(`${ref.fixture}-${suffix}.docx`); await (await pending).saveAs(file); return file; };
  const parts = unzipSync(bytes), same = (file, except = []) => { const out = unzipSync(readFileSync(file)); expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort()); for (const [n,b] of Object.entries(parts)) if (!except.includes(n)) expect(Buffer.from(out[n]).equals(Buffer.from(b)), n).toBe(true); };
  same(await download('original'));
  await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited '); const edited = await input.inputValue(), saved = await download('edited'); same(saved, ['word/document.xml']);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(input).toHaveValue(original); same(await download('undo'));
  await reopenDocx(page, input, saved, edited);
});
