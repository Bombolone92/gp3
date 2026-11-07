import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const root = 'tests/fixtures/positioned-breaks/';
for (const kind of ['page', 'column']) for (const base of ['paragraph', 'line']) test(`${kind} break with ${base}-relative pictures`, async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto('/playground.html');
  const source = `${kind}-${base}.docx`;
  const result = await page.evaluate(async bytes => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { pkg, images } = await openCanvasDocument(new Uint8Array(bytes));
    const host = document.createElement('div'); document.body.append(host);
    const editor = new CanvasEditor(host, { ...pkg, images });
    try {
      const printSheets = editor.printSheets();
      const printedPictures = editor.layout.floatingObjects.map(f => {
        const canvas = printSheets[f.page], scale = canvas.width/editor.layout.pages[f.page].width;
        const pixel = canvas.getContext('2d').getImageData(Math.round((f.x+f.width/2)*scale), Math.round((f.y+f.height/2)*scale), 1, 1).data;
        return [...pixel];
      });
      return { readOnly: !!pkg.readOnly, images: images.size, issues: pkg.previewIssues || [],
        printPages: printSheets.length, printedPictures,
        pages: editor.layout.pages.map((_, page) => ({ page,
          labels: editor.layout.lines.filter(l => l.page === page).map(l => ({ text: l.fragments.map(f => f.text).join('').replaceAll('\ufffc','').trim(), x: l.fragments[0]?.x * .75, top: l.y * .75, baseline: l.baseline * .75 })).filter(l => l.text),
          pictures: editor.layout.floatingObjects.filter(f => f.page === page).map(f => ({ x: f.x * .75, y: f.y * .75, width: f.width * .75, height: f.height * .75 })) })),
        pixels: editor.canvases.map(c => c.toDataURL().split(',')[1]) };
    } finally { editor.destroy(); host.remove(); }
  }, [...readFileSync(root + source)]);
  for (const [index, pixels] of result.pixels.entries()) writeFileSync(info.outputPath(`page${index+1}.png`), Buffer.from(pixels, 'base64'));
  delete result.pixels;
  writeFileSync(info.outputPath('geometry.json'), JSON.stringify(result, null, 2));
  expect(result.readOnly).toBe(false);
  expect(result.images).toBeGreaterThan(0);
  expect(result.pages.flatMap(p => p.pictures)).toHaveLength(2);
  expect(result.printPages).toBe(result.pages.length);
  expect(result.printedPictures).toHaveLength(2);
  for (const pixel of result.printedPictures) expect(pixel[2]-pixel[0]).toBeGreaterThan(100);
  const metadata = JSON.parse(readFileSync(root + source.replace('.docx', '-native.json'), 'utf8').replace(/^\uFEFF/, ''));
  expect(createHash('sha256').update(readFileSync(root + source)).digest('hex')).toBe(metadata.sourceSha256);
  expect(result.pages).toHaveLength(metadata.pages);
  // Reference automation API positions are quantized to screen pixels. This bound checks
  // caret/anchor origins; it is not a glyph-ink or PDF-baseline comparison.
  for (const picture of metadata.pictures) {
    const actual = result.pages[picture.page].pictures.find(p => Math.abs(p.x-picture.x)<.01);
    expect(actual).toBeDefined();
    expect(Math.abs(actual.y-picture.y)).toBeLessThan(.75);
    for (const key of ['width','height']) expect(actual[key]).toBe(picture[key]);
  }
  for (const label of metadata.labels) {
    const actual = result.pages[label.page].labels.find(l => l.text===label.text);
    expect(actual).toBeDefined();
    expect(actual.x).toBeCloseTo(label.x, 6);
    expect(Math.abs(actual.top-label.top)).toBeLessThan(.75);
  }
  if (existsSync(root + 'reference.json')) {
    const reference = JSON.parse(readFileSync(root + 'reference.json')).cases.find(c => c.source === source);
    expect(createHash('sha256').update(readFileSync(root + source)).digest('hex')).toBe(reference.sourceSha256);
    expect(createHash('sha256').update(readFileSync(root + source.replace('.docx', '-native.pdf'))).digest('hex')).toBe(reference.pdfSha256);
    expect(result.pages).toHaveLength(reference.pages.length);
    for (const [index, native] of reference.pages.entries()) {
      const actual = result.pages[index];
      expect(actual.pictures).toHaveLength(native.pictures.length);
      for (const picture of native.pictures) {
        const match = actual.pictures.find(p => Math.abs(p.x - picture.x) < .15);
        expect(match).toBeDefined();
        for (const key of ['x', 'y', 'width', 'height']) expect(Math.abs(match[key]-picture[key]), key).toBeLessThan(.15);
      }
      for (const label of native.labels) {
        const match = actual.labels.find(l => l.text === label.text);
        expect(match).toBeDefined();
        expect(Math.abs(match.x-label.x)).toBeLessThan(.15);
        expect(Math.abs(match.baseline-label.baseline)).toBeLessThan(.15);
      }
    }
  }
});

for (const kind of ['page','column']) for (const base of ['paragraph','line']) test(`${kind}/${base}: editing preserves pictures, break and exact undo`, async ({page}, info) => {
  test.setTimeout(180000);
  await page.goto('/playground.html');
  const old = await page.getByRole('textbox',{name:'Document text'}).elementHandle();
  const source = `${root}${kind}-${base}.docx`, parts = unzipSync(readFileSync(source));
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  await expect.poll(()=>old.evaluate(el=>el.isConnected)).toBe(false); await old.dispose();
  const input=page.getByRole('textbox',{name:'Document text'}), text=await input.inputValue();
  await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(kind==='page'?2:1);
  const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const file=info.outputPath(name+'.docx');await(await event).saveAs(file);return file;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const edited=await save('edited'), changed=unzipSync(readFileSync(edited));
  expect(Object.keys(changed).sort()).toEqual(Object.keys(parts).sort());
  for(const name of Object.keys(parts)) if(name!=='word/document.xml')expect(changed[name],name).toEqual(parts[name]);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await input.press('ControlOrMeta+y');await expect(input).toHaveValue('Edited '+text);
  await reopenDocx(page,input,edited,'Edited '+text);
  await expect(page.getByRole('textbox',{name:'Document text'})).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(kind==='page'?2:1);
  await expect(page.locator('#playground-error')).toBeEmpty();
});
