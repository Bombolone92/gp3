import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { reopenDocx } from './helpers/reopen-docx.js';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

const folder = 'tests/fixtures/font-encoded-bullets';
const word = JSON.parse(readFileSync(`${folder}/reference.json`, 'utf8'));
const bytes = readFileSync(`${folder}/font-encoded-bullets.docx`);
test.use({ deviceScaleFactor: 3 });
test('renders font-encoded bullet glyphs against the native reference and retains them through editing', async ({ page }, info) => {
  await page.goto('/playground.html');
  const installed = await page.evaluate(async () => {
    try { await Promise.all(['Arial', 'Symbol', 'Wingdings', 'Wingdings 2', 'Webdings'].map(name => new FontFace('Reference check', `local("${name}")`).load())); return true; }
    catch { return false; }
  });
  test.skip(!installed, 'Native reference fonts must be installed.');
  await page.getByLabel('Open DOCX file').setInputFiles(`${folder}/font-encoded-bullets.docx`);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^C00 first/); await expect(input).toHaveJSProperty('readOnly', false);
  const lines = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(bytes), c => c.charCodeAt(0))); await loadCanvasFonts(pkg);
    const ctx = document.createElement('canvas').getContext('2d');
    return layoutDocument(pkg.paragraphs, (t,s) => measureCanvasText(ctx,t,s), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables).lines.map(l => ({text:l.fragments.map(f=>f.text||'').join('').trim(),y:l.baseline*.75}));
  }, bytes.toString('base64'));
  expect(lines).toHaveLength(24);
  for (const [i, expected] of word.cases.flatMap(c=>c.lines).entries()) { expect(lines[i].text).toBe(expected.text); expect(Math.abs(lines[i].y-expected.y),expected.text).toBeLessThan(.25); }
  const check = async () => {
    await expect(page.locator('canvas.canvas-page')).toHaveCount(12);
    const actual = await page.locator('canvas.canvas-page').evaluateAll(canvases => canvases.map(c => {
      const scale=c.width/612,ctx=c.getContext('2d'),x0=Math.round(68*scale),y0=Math.round(60*scale),w=Math.round(34*scale),h=Math.round(50*scale),data=ctx.getImageData(x0,y0,w,h).data;
      let left=w,top=h,right=-1,bottom=-1,area=0;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=(y*w+x)*4;if(Math.max(data[k],data[k+1],data[k+2])<100){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);area++;}}
      return {ink:[(x0+left)/scale,(y0+top)/scale,(x0+right+1)/scale,(y0+bottom+1)/scale],area:area/scale**2};
    }));
    for (const [i,c] of actual.entries()) {
      for(let k=0;k<4;k++)expect(Math.abs(c.ink[k]-word.cases[i].ink[k]),`glyph ${i} edge ${k}`).toBeLessThan(.75);
      expect(c.area/word.cases[i].area,`glyph ${i} area`).toBeGreaterThan(.75);
      expect(c.area/word.cases[i].area,`glyph ${i} area`).toBeLessThan(1.25);
    }
    await expect(page.locator('#playground-error')).toBeEmpty();
  };
  await check();
  for (let i=0;i<12;i++) writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  const original = await input.inputValue(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited '); await check();
  const pending=page.waitForEvent('download'); await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const path=info.outputPath('font-encoded-bullets.docx'); await(await pending).saveAs(path);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original); await check();
  await reopenDocx(page,input,path,'Edited '+original); await check();
});

test('keeps encoded labels editable and unchanged when their custom font is absent', async ({ page }) => {
  const parts = unzipSync(bytes), missing = 'Absent Encoded Bullet Control Font';
  parts['word/numbering.xml'] = strToU8(strFromU8(parts['word/numbering.xml']).replace(/(?:Wingdings 2|Wingdings|Webdings|Symbol)/g, missing));
  const source = zipSync(parts);
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles({name:'missing-bullet-font.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(source)});
  const input = page.getByRole('textbox', {name:'Document text'});
  await expect(input).toHaveValue(/^C00 first/); await expect(input).toHaveJSProperty('readOnly', false);
  const result = await page.evaluate(async ({bytes,missing}) => {
    const {DocxPackage}=await import('/src/engine/docx.js');
    const {loadCanvasFonts,canvasText}=await import('/src/engine/canvas-text.js');
    const {fontAvailable}=await import('/src/engine/font-availability.js');
    const {listMarkers}=await import('/src/engine/numbering.js');
    const pkg=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(pkg);
    return {available:fontAvailable(missing),labels:listMarkers(pkg.paragraphs,pkg.numbering).map(m=>canvasText({},m.text,m.level.markerStyle))};
  },{bytes:Buffer.from(source).toString('base64'),missing});
  expect(result.available).toBe(false); expect(result.labels).toEqual(word.cases.map(c=>c.label));
  await expect(page.locator('#playground-error')).toBeEmpty();
});
