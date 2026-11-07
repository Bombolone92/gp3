import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

const folder = 'tests/fixtures/legacy-nbsp-font-policy/';
const source = folder + 'control.docx';
const reference = JSON.parse(readFileSync(folder + 'reference.json', 'utf8'));
const cases = JSON.parse(readFileSync(folder + 'cases.json', 'utf8'));
const original = cases.map(row => row.text).join('\n');

test.describe.configure({ timeout: 120000 });
test.beforeEach(async ({ page }, info) => {
  for (const [file, hash] of Object.entries(reference.sha256)) {
    expect(createHash('sha256').update(readFileSync(folder + file)).digest('hex'), file).toBe(hash);
  }
  if (!info.title.startsWith('NBSP survives')) {
    // Avoid concurrent font preparation by the playground's default sample.
    await page.route('**/playground.html', route => route.fulfill({ contentType: 'text/html', body:
      '<!doctype html><html><head><script type="module">import "/src/styles/index.css";</script></head><body></body></html>' }));
  }
  await page.goto('/playground.html');
});

async function inspect(page) {
  return page.evaluate(async encoded => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { validateCanvasLayout, measureCanvasText, setCanvasFontAlternatives, setCanvasTextStyle, canvasText } = await import('/src/engine/canvas-text.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { displayedFont } = await import('/src/engine/font-availability.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
    await validateCanvasLayout(pkg);
    const ctx = document.createElement('canvas').getContext('2d');
    setCanvasFontAlternatives(ctx, pkg.styles.fontAlternatives);
    const layout = layoutDocument(pkg.paragraphs, (t, s) => measureCanvasText(ctx, t, s),
      pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories, { styles: pkg.styles });
    return {
      readOnly: !!pkg.readOnly,
      pages: layout.pages.length,
      rows: layout.lines.filter(line => !line.virtual).map(line => ({
        text: line.fragments.map(f => f.text).join(''),
        x: line.fragments[0].x * .75,
        baseline: 792 - line.baseline * .75,
      })),
      runs: pkg.paragraphs.map(p => {
        const run = p.runs.find(r => r.text.length);
        const style = { ...run, caretOffsets: Array.from({ length: run.text.length + 1 }, (_, i) => i), bidiDirection: 'ltr' };
        const nbsp = measureCanvasText(ctx, run.text, style);
        const space = measureCanvasText(ctx, run.text.replaceAll('\u00a0', ' '), style);
        const paint = text => {
          ctx.canvas.width = 512; ctx.canvas.height = 96;
          setCanvasTextStyle(ctx, run);
          ctx.fillText(canvasText(ctx, text, run), 8, 68);
          return ctx.getImageData(0, 0, 512, 96).data;
        };
        const actualInk = paint(run.text), spaceInk = paint(run.text.replaceAll('\u00a0', ' '));
        return { font: displayedFont(run, pkg.styles.fontAlternatives),
          marker: measureCanvasText(ctx, 'A', run).width * .75,
          width: nbsp.width * .75, carets: nbsp.caretAdvances, spaceCarets: space.caretAdvances,
          inkDifferences: actualInk.reduce((n, value, i) => n + Number(value !== spaceInk[i]), 0) };
      }),
    };
  }, readFileSync(source).toString('base64'));
}

test('distinct embedded NBSP controls use their authored faces and retain editable content', async ({ page }, info) => {
  const actual = await inspect(page);
  writeFileSync(info.outputPath('actual.json'), JSON.stringify(actual, null, 2));
  expect(actual.readOnly).toBe(false);
  expect(actual.pages).toBe(1);
  expect(actual.rows.map(row => row.text)).toEqual(cases.map(row => row.text));
  expect(new Set(actual.runs.map(run => run.font)).size).toBe(3);
  for (const [i, run] of actual.runs.entries()) {
    expect(run.font).toMatch(/^Canvas embedded font /);
    expect(Math.abs(run.marker - cases[i].aAdvance * 36 / 1000), `face identity ${i}`).toBeLessThan(.02);
    expect(Math.abs(actual.rows[i].baseline - reference.rows[i].baseline), `baseline ${i}`).toBeLessThan(.2);
  }
});

for (const kern of [false, true]) test(`native NBSP geometry and carets with kerning ${kern}`, async ({ page }, info) => {
  const actual = await inspect(page);
  const errors = cases.flatMap((row, i) => row.kern !== kern ? [] : [{
    row: i,
    origin: Math.abs(actual.rows[i].x - reference.rows[i].origin),
    end: Math.abs(actual.rows[i].x + actual.runs[i].width - reference.rows[i].end),
    caret: Math.max(...actual.runs[i].carets.map((x, j) => Math.abs(x - actual.runs[i].spaceCarets[j]))),
    ink: actual.runs[i].inkDifferences,
  }]);
  expect(errors).toHaveLength(6);
  writeFileSync(info.outputPath('geometry-errors.json'), JSON.stringify(errors, null, 2));
  for (const error of errors) {
    expect(error.origin, `origin ${error.row}`).toBeLessThan(.2);
    expect(error.end, `end ${error.row}`).toBeLessThan(.2);
    expect(error.caret, `caret ${error.row}`).toBeLessThan(.01);
    expect(error.ink, `space/NBSP glyph pixels ${error.row}`).toBe(0);
  }
});

test('NBSP remains unbreakable when the display uses ordinary-space metrics', async ({ page }) => {
  const lines = await page.evaluate(async encoded => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { validateCanvasLayout, measureCanvasText, setCanvasFontAlternatives } = await import('/src/engine/canvas-text.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
    await validateCanvasLayout(pkg);
    const ctx = document.createElement('canvas').getContext('2d');
    setCanvasFontAlternatives(ctx, pkg.styles.fontAlternatives);
    const paragraphs = pkg.paragraphs.map(p => ({ ...p, runs: p.runs.map(run => ({ ...run,
      text: run.text.includes('\u00a0') ? [run.text, run.text, run.text].join(' ') : run.text })) }));
    const layout = layoutDocument(paragraphs, (t, s) => measureCanvasText(ctx, t, s),
      pageGeometry({ ...pkg.pageSettings, width: 5480, left: 1440, right: 1440 }),
      pkg.numbering, pkg.tables, pkg.pageStories, { styles: pkg.styles });
    return layout.lines.filter(line => !line.virtual).map(line => line.fragments.map(f => f.text).join('').trim());
  }, readFileSync(source).toString('base64'));
  expect(lines).toHaveLength(24);
  expect(lines.filter(text => text.includes('\u00a0'))).toEqual(Array(18).fill('A\u00a0WA'));
  expect(lines.filter(text => !text.includes('\u00a0'))).toEqual(Array(6).fill('A WA'));
});

test('NBSP survives selection, copy, editing, undo and DOCX reopen with embedded fonts intact', async ({ page }, info) => {
  test.setTimeout(120000);
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(original);
  await expect(input).toBeEditable();
  const parts = unzipSync(readFileSync(source));
  const save = async name => {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(name + '.docx');
    await (await event).saveAs(path);
    return path;
  };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.focus();
  await input.press('ControlOrMeta+Home');
  // Five logical positions for the first paragraph and newline, then A + NBSP.
  for (let i = 0; i < 7; i++) await input.press('ArrowRight');
  await input.press('Shift+ArrowLeft');
  expect(await input.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('\u00a0');
  expect(await input.evaluate(el => {
    const data = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
    return data.getData('text/plain');
  })).toBe('\u00a0');
  await input.press('ArrowRight');
  await page.keyboard.insertText('A');
  const changedText = original.slice(0, 7) + 'A' + original.slice(7);
  await expect(input).toHaveValue(changedText);
  const edited = await save('edited');
  const changed = unzipSync(readFileSync(edited));
  expect(Object.keys(changed).sort()).toEqual(Object.keys(parts).sort());
  for (const name of Object.keys(parts)) if (name !== 'word/document.xml') expect(changed[name], name).toEqual(parts[name]);
  await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page, input, edited, changedText);
  await expect(input).toBeEditable();
  await expect(page.locator('#playground-error')).toBeEmpty();
});
