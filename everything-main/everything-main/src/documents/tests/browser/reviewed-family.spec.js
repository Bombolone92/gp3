import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {reviewedFamilyOrigins,captureReviewedFamilyEditor} from './helpers/reviewed-family-origins.js';
import {recordFontTransfers} from './helpers/font-transfers.js';
const source='public/fixtures/reviewed-family.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/reviewed-family/reference.json','utf8'));
test('loads reviewed variable families and preserves native regular, bold and italic rendering',async({page},info)=>{
  test.setTimeout(90000);
  const transfers=await recordFontTransfers(page,/\/(Oswald|OpenSans(?:-Italic)?)\.ttf/);
  expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
  expect(createHash('sha256').update(readFileSync('tests/fixtures/reviewed-family/native.pdf')).digest('hex')).toBe(reference.pdfSha256);
  await page.goto('/playground.html');await expect(page.getByRole('textbox',{name:'Document text'})).toBeVisible();expect(transfers.records()).toEqual([]);
  await captureReviewedFamilyEditor(page);
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^REGULAR CONDENSED/);await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(reference.pages.length);
  const actual=await reviewedFamilyOrigins(page,readFileSync(source).toString('base64'),false,true);
  writeFileSync(info.outputPath('actual.json'),JSON.stringify(actual,null,2));
  writeFileSync(info.outputPath('rendered.png'),Buffer.from(await page.locator('canvas.canvas-page').first().evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  expect(actual.available).toEqual([true,true]);
  expect(actual.pages.map(p=>p.map(l=>l.text))).toEqual(reference.pages.map(p=>p.map(l=>l.text)));
  for(const [i,lines] of actual.pages.entries())for(const [j,l] of lines.entries()){
    const ref=reference.pages[i][j];expect(Math.abs(l.baseline-ref.baseline),l.text).toBeLessThan(.2);
    // Oswald matches the native reference's glyph geometry. Open Sans has a separately retained
    // expected-failure oracle below; do not widen its tolerance to hide drift.
    if(j<2)for(const [k,x] of ref.glyphs.entries())expect(Math.abs(l.glyphs[k]-x),`${l.text} glyph ${k}`).toBeLessThan(.2);
  }
  const requests=transfers.downloads().map(row=>row.url);
  expect(requests.length).toBeLessThanOrEqual(3);expect(new Set(requests).size).toBe(requests.length);
  for(const url of requests)expect(new URL(url).origin).toBe(new URL(page.url()).origin);
  const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
  const save=async n=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(n+'.docx');await(await event).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
  for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(parts[name]);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,'EDIT '+original);await expect(page.locator('#playground-error')).toBeEmpty();
  expect(transfers.downloads().map(row=>row.url)).toEqual(requests);
  // Direct metadata fetches are separate from CSS font downloads. Preserve
  // them as optimization evidence instead of counting them as duplicate faces.
  writeFileSync(info.outputPath('font-requests.json'),JSON.stringify(transfers.records(),null,2));
  await transfers.close();
});

test('Open Sans glyph origins match the native reference (known shaping gap)',async({page})=>{
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  await expect(page.getByRole('textbox',{name:'Document text'})).toHaveValue(/^REGULAR CONDENSED/);
  const actual=await reviewedFamilyOrigins(page,readFileSync(source).toString('base64'));
  expect(actual.available).toEqual([true,true]);
  for(const line of actual.pages[0])for(const error of line.advanceErrors)expect(error,'SVG/canvas advance').toBeLessThan(.02);
  const glyphs=actual.pages[0].slice(2).map(line=>line.glyphs);
  expect(glyphs).toHaveLength(reference.pages[0].length-2);
  for(const [i,line] of reference.pages[0].entries()){expect(actual.pages[0][i].text).toBe(line.text);expect(actual.pages[0][i].glyphs).toHaveLength(line.glyphs.length);}
  test.fail(true,'Bundled Open Sans still differs from native full-fragment glyph origins. See fixture README.');
  for(const [i,line] of reference.pages[0].slice(2).entries())for(const [j,x] of line.glyphs.entries())expect(Math.abs(glyphs[i][j]-x),`${line.text} glyph ${j}`).toBeLessThan(.35);
});
