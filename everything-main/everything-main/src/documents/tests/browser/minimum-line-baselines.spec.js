import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

const controls = [["minimum-line-baselines", "Arial-10-18"], ["minimum-line-baselines", "Arial-10-24"], ["minimum-line-baselines", "Arial-10-6"], ["minimum-line-baselines", "Arial-16-18"], ["minimum-line-baselines", "Arial-16-24"], ["minimum-line-baselines", "Arial-16-6"], ["minimum-line-baselines", "Calibri-10-18"], ["minimum-line-baselines", "Calibri-10-24"], ["minimum-line-baselines", "Calibri-10-6"], ["minimum-line-baselines", "Calibri-16-18"], ["minimum-line-baselines", "Calibri-16-24"], ["minimum-line-baselines", "Calibri-16-6"], ["minimum-line-baselines", "mark10-atLeast"], ["minimum-line-baselines", "mark10-auto"], ["minimum-line-baselines", "mark11-atLeast"], ["minimum-line-baselines", "mark11-auto"], ["minimum-line-baselines", "mark12-atLeast"], ["minimum-line-baselines", "mark12-auto"], ["minimum-line-baselines", "TimesNewRoman-10-18"], ["minimum-line-baselines", "TimesNewRoman-10-24"], ["minimum-line-baselines", "TimesNewRoman-10-6"], ["minimum-line-baselines", "TimesNewRoman-16-18"], ["minimum-line-baselines", "TimesNewRoman-16-24"], ["minimum-line-baselines", "TimesNewRoman-16-6"]];
for (const [family, name] of controls) test(`matches native ${family} and preserves edits: ${name}`, async ({ page }, info) => {
  const folder = `tests/fixtures/${family}/`;
  const source = readFileSync(`${folder}${name}.docx`), ref = JSON.parse(readFileSync(`${folder}${name}-reference.json`));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  expect(hash(source)).toBe(ref.sourceSha256); expect(hash(readFileSync(`${folder}${name}.pdf`))).toBe(ref.pdfSha256);
  const errors = []; page.on('pageerror', e => errors.push(e.message)); await page.goto('/playground.html');
  const nativeFont = await page.evaluate(async font => { try { await new FontFace('Native reference probe', `local("${font}")`).load(); return true; } catch { return false; } }, ref.font);
  if (!nativeFont) info.annotations.push({ type: 'font substitution', description: `${ref.font} unavailable: native baseline comparison requires the reference font; geometry and editing checks still run.` });
  const geometry = async bytes => page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { layoutDocument, hitTest, selectionRects } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const pkg = await DocxPackage.open(new Uint8Array(bytes)); await loadCanvasFonts(pkg);
    const ctx = document.createElement('canvas').getContext('2d');
    const l = layoutDocument(pkg.paragraphs, (t,s) => measureCanvasText(ctx,t,s), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables);
    return { pages: l.pageCount, lines: l.lines.filter(l => l.fragments.some(f => f.text.trim())).map(line => ({
      page: line.page, x: line.fragments[0].x*.75, baseline: line.baseline*.75, y: line.y*.75,
      text: line.fragments.map(f => f.text).join('').trim(), start: line.start,
      hit: hitTest(l, line.page, line.stops[0].x+.1, line.y+line.height/2),
      rectangles: selectionRects(l, line.start, line.end),
    })) };
  }, [...bytes]);
  const check = actual => {
    expect(actual.pages).toBe(ref.pages); expect(actual.lines).toHaveLength(ref.lines.length);
    ref.lines.forEach((expected,i) => {
      const line = actual.lines[i]; expect(line.page).toBe(expected.page);
      expect(Math.abs(line.x-expected.x), expected.text+' x').toBeLessThan(.15);
      if (nativeFont) expect(Math.abs(line.baseline-expected.baseline), expected.text+' baseline').toBeLessThan(.15);
      expect(line.hit, expected.text+' hit').toBe(line.start);
      expect(line.rectangles.some(r => r.page===line.page && Math.abs(r.x*.75-line.x)<.01)).toBe(true);
    });
  };
  const initial = await geometry(source); check(initial);
  writeFileSync(info.outputPath('geometry.json'), JSON.stringify(initial,null,2));
  await page.getByLabel('Open DOCX file').setInputFiles(`${folder}${name}.docx`);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(new RegExp(ref.lines[0].text)); await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.pages);
  const original = await input.inputValue(), parts = unzipSync(source);
  const save = async suffix => { const pending=page.waitForEvent('download'); await page.getByRole('button',{name:'Download .docx',exact:true}).click(); const path=info.outputPath(suffix+'.docx'); await(await pending).saveAs(path); return path; };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  const at = name === 'leading' ? 1 : 0;
  await input.evaluate((e,at)=>{e.focus();e.setSelectionRange(at,at);e.dispatchEvent(new Event('select',{bubbles:true}));},at); await page.keyboard.insertText('X');
  const edited = await save('edited'), changed = unzipSync(readFileSync(edited));
  for (const key of Object.keys(parts)) if(key!=='word/document.xml') expect(changed[key],key).toEqual(parts[key]);
  check(await geometry(readFileSync(edited)));
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,original.slice(0,at)+'X'+original.slice(at)); await expect(input).toHaveJSProperty('readOnly',false);
  check(await geometry(readFileSync(edited))); expect(errors).toEqual([]);
  await page.getByRole('button',{name:'Download .docx',exact:true}).focus();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  for(const [i,data] of (await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL()))).entries()) writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(data.split(',')[1],'base64'));
});
