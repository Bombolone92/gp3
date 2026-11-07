import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const reference = JSON.parse(readFileSync('tests/fixtures/picture-alpha/reference.json', 'utf8'));
for (const name of ['group-picture-flips', 'shape-picture-fills', 'picture-3d-outlines']) {
  test(`composes picture alpha inside ${name} without changing bounds`, async ({ page }) => {
    const original = readFileSync(`public/fixtures/${name}.docx`), parts = unzipSync(original);
    parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace(/<a:blip\b([^>]*?)(\/>|>)/g, (_, attrs, end) =>
      `<a:blip${attrs}><a:alphaModFix amt="50000"/>${end === '/>' ? '</a:blip>' : ''}`));
    await page.goto('/playground.html');
    const result = await page.evaluate(async ({ original, modified }) => {
      const { DocxPackage } = await import('/src/engine/docx.js');
      const { decodeShape } = await import('/src/engine/canvas-shapes.js');
      const render = async bytes => {
        const pkg = await DocxPackage.open(new Uint8Array(bytes)), bitmaps = new Map();
        for (const [id, a] of Object.entries(pkg.assets)) if (a.bytes) bitmaps.set(id, await createImageBitmap(new Blob([a.bytes], { type: a.mime })));
        const asset = Object.values(pkg.assets).find(a => a.scene), decoded = await decodeShape(asset, bitmaps);
        const canvas = new OffscreenCanvas(decoded.bitmap.width, decoded.bitmap.height), ctx = canvas.getContext('2d');
        ctx.drawImage(decoded.bitmap, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const bounds = [decoded.left, decoded.top, decoded.width, decoded.height];
        decoded.close(); for (const bitmap of bitmaps.values()) bitmap.close();
        return { data, bounds };
      };
      const before = await render(original), after = await render(modified);
      let changed = 0, worst = 0;
      for (let i = 3; i < before.data.length; i += 4) {
        if (before.data[i] === 255 && after.data[i] !== 255) {
          changed++; worst = Math.max(worst, Math.abs(after.data[i] - 127.5));
        }
      }
      return { before: before.bounds, after: after.bounds, changed, worst };
    }, { original: [...original], modified: [...zipSync(parts)] });
    expect(result.after).toEqual(result.before);
    expect(result.changed).toBeGreaterThan(100);
    expect(result.worst).toBeLessThanOrEqual(1);
  });
}
test('matches native alpha colors and saved-image pixels through edits, undo and reopen', async ({ page }, info) => {
  expect(createHash('sha256').update(readFileSync('public/fixtures/picture-alpha.docx')).digest('hex')).toBe(reference.sourceSha256);
  await page.goto('/playground.html');
  const positions = await page.evaluate(async () => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const pkg = await DocxPackage.open(new Uint8Array(await (await fetch('/fixtures/picture-alpha.docx')).arrayBuffer()));
    await loadCanvasFonts(pkg); const ctx = document.createElement('canvas').getContext('2d');
    const layout = layoutDocument(pkg.paragraphs, (t,s) => measureCanvasText(ctx,t,s), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables);
    return layout.lines.flatMap(l => l.fragments.filter(f => f.image).map(f => ({ x:f.x, y:l.baseline-f.ascent, width:f.width, height:f.ascent })));
  });
  expect(positions).toHaveLength(reference.cases.length);
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/picture-alpha.docx');
  const input = page.getByRole('textbox', { name:'Document text' });
  await expect(input).toHaveValue(/^Picture alpha probes/); await expect(input).toHaveJSProperty('readOnly',false);
  const check = async () => {
    await expect(page.locator('#playground-error')).toBeEmpty(); await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
    await expect.poll(async () => page.locator('canvas.canvas-page').evaluate((canvas, { positions, reference }) => {
      const ctx=canvas.getContext('2d'),scale=canvas.width/816; let worst=0;
      positions.forEach((p,i) => reference.cases[i].colors.forEach((color,j) => {
        const actual=ctx.getImageData(Math.floor((p.x+p.width*(j+.5)/4)*scale),Math.floor((p.y+p.height*.5)*scale),1,1).data;
        color.forEach((v,k) => { worst=Math.max(worst,Math.abs(actual[k]-v)); });
      })); return worst;
    }, { positions, reference })).toBeLessThanOrEqual(3);
  };
  await check(); const original=await input.inputValue();
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited '); await check();
  const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`picture-alpha-${suffix}.docx`);await(await pending).saveAs(path);return path;};
  const edited=await save('edited');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(unzipSync(readFileSync('public/fixtures/picture-alpha.docx')));
  await reopenDocx(page,input,edited,'Edited '+original);await check();
  writeFileSync(info.outputPath('picture-alpha.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
});
