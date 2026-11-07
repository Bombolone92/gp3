import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source = 'public/fixtures/table-crossing-borders.docx';
const folder = 'tests/fixtures/table-crossing-borders/';
const reference = JSON.parse(readFileSync(folder + 'reference.json', 'utf8'));
test.use({deviceScaleFactor: 3});

test('matches native crossing precedence and preserves edits, undo and reopening', async ({page}, info) => {
  test.setTimeout(90000);
  expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
  expect(createHash('sha256').update(readFileSync(folder + 'native.pdf')).digest('hex')).toBe(reference.pdfSha256);
  expect(reference.blackCrossings).toHaveLength(2);
  expect(reference.blackCrossings.map(c => c.dark)).toEqual([0, 0]);
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  await expect(page.getByRole('textbox', {name: 'Document text'})).toHaveValue(/^Thin black horizontal/);
  await expect(page.getByRole('textbox', {name: 'Document text'})).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  await expect(page.locator('#playground-error')).toBeEmpty();
  const check = async () => {
  const observed = await page.locator('canvas.canvas-page').evaluate((canvas, ref) => {
    const ctx = canvas.getContext('2d'), scale = canvas.width / 612;
    const dark = ref.blackCrossings.map(({rect: [x,y,w,h]}) => {
      const data = ctx.getImageData(Math.round(x*scale), Math.round(y*scale), Math.round(w*scale), Math.round(h*scale)).data;
      let dark = 0;
      for (let i=0; i<data.length; i+=4) if (Math.max(data[i],data[i+1],data[i+2]) < 200) dark++;
      return dark;
    });
    return {dark, colors:ref.samples.map(s=>Array.from(ctx.getImageData(Math.round(s.x*scale),Math.round(s.y*scale),1,1).data).slice(0,3))};
  }, reference);
  expect(observed.dark).toEqual([0, 0]);
  expect(observed.colors).toEqual(reference.samples.map(s=>s.color));
  };
  await check();
  const input=page.getByRole('textbox',{name:'Document text'}), original=await input.inputValue(), parts=unzipSync(readFileSync(source));
  const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  // A trailing space in the last paragraph does not move the junction controls.
  await input.press('ControlOrMeta+End');await page.keyboard.insertText(' ');
  const edited=await save('edited'), changed=unzipSync(readFileSync(edited));
  for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(parts[name]);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await check();
  await reopenDocx(page,input,edited,original+' ');await check();
});
