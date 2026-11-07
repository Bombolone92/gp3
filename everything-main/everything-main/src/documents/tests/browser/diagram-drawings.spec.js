import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
const folder='tests/fixtures/diagram-drawings',ref=JSON.parse(readFileSync(`${folder}/reference.json`));
test.use({deviceScaleFactor:3});
test('shows native saved diagram ink as a read-only approximation and preserves its package',async({page},info)=>{
  test.setTimeout(120000);
  const original=readFileSync(`${folder}/control.docx`);
  expect(createHash('sha256').update(original).digest('hex')).toBe(ref.sourceSha256);
  expect(createHash('sha256').update(readFileSync(`${folder}/native.pdf`)).digest('hex')).toBe(ref.pdfSha256);
  const parts=unzipSync(original);for(const key of Object.keys(parts).filter(k=>/diagrams\/layout/.test(k)))parts[key]=strToU8(strFromU8(parts[key]).replaceAll('type="lin"','type="composite"'));const bytes=zipSync(parts);
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles({name:'unsupported-diagram.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(bytes)});
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^Independent cached diagram/);await expect(input).toHaveJSProperty('readOnly',true);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(3);await expect(page.locator('#playground-error')).toBeEmpty();
  const errors=await page.locator('canvas.canvas-page').evaluateAll((cs,pages)=>cs.flatMap((c,i)=>{
    const ctx=c.getContext('2d'),scale=c.width/612;
    return pages[i].flatMap(s=>{const rgb=[...ctx.getImageData(Math.round(s.x*scale),Math.round(s.y*scale),1,1).data].slice(0,3);return Math.max(...rgb.map((v,j)=>Math.abs(v-s.rgb[j])))>3?[{page:i+1,...s,actual:rgb}]:[];});
  }),ref.pages);
  writeFileSync(info.outputPath('differences.json'),JSON.stringify(errors,null,2));expect(errors.slice(0,20)).toEqual([]);
  for(const [i,data] of (await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL()))).entries())writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(data.split(',')[1],'base64'));
  const originalText=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.type('Not editable');await expect(input).toHaveValue(originalText);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const saved=info.outputPath('noedit.docx');await(await download).saveAs(saved);
  expect(unzipSync(readFileSync(saved))).toEqual(unzipSync(bytes));
  await page.reload();await page.getByLabel('Open DOCX file').setInputFiles(saved);await expect(input).toHaveValue(originalText);await expect(input).toHaveJSProperty('readOnly',true);await expect(page.locator('canvas.canvas-page')).toHaveCount(3);
});
