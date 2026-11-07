import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';

const fixture = 'public/fixtures/group-picture-flips.docx';
const samples = JSON.parse(readFileSync('tests/fixtures/group-picture-flips/samples.json', 'utf8'));
test('matches native grouped picture flips, crop margins and nested scales through edit/undo/reopen', async ({page}, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(fixture);
  const input = page.getByRole('textbox', {name:'Document text'});
  await expect(input).toHaveValue(/^Grouped picture flips/);
  await expect(input).toHaveJSProperty('readOnly', false);
  const original = await input.inputValue();
  const pixels = async () => {
    const actual = await page.evaluate(samples => {
      const canvas = document.querySelector('canvas.canvas-page'), ctx = canvas.getContext('2d');
      const ratio = canvas.width / 816;
      return samples.map((row,i) => row.map(({u,v}) => [...ctx.getImageData(Math.round((72+144*u)*4/3*ratio), Math.round((100+95*i+72*v)*4/3*ratio),1,1).data].slice(0,3)));
    }, samples);
    for (let i=0;i<samples.length;i++) for (let j=0;j<samples[i].length;j++)
      expect(actual[i][j], `native sample ${i}/${j}`).toEqual(samples[i][j].rgb);
    expect(await page.locator('canvas.canvas-page').count()).toBe(1);
  };
  await pixels();
  await page.locator('canvas.canvas-page').screenshot({path:info.outputPath('group-picture-flips.png')});
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const download = async suffix => {
    const pending=page.waitForEvent('download'); await page.getByRole('button',{name:'Download .docx',exact:true}).click();
    const file=info.outputPath(`group-picture-flips${suffix}.docx`); await (await pending).saveAs(file); return file;
  };
  const saved = await download(''), source=unzipSync(readFileSync(fixture)), edited=unzipSync(readFileSync(saved));
  expect(Object.keys(edited).sort()).toEqual(Object.keys(source).sort());
  for (const part of Object.keys(source)) if (part!=='word/document.xml') expect(Buffer.from(edited[part]).equals(Buffer.from(source[part])),part).toBe(true);
  await pixels(); await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original); await pixels();
  const undone=unzipSync(readFileSync(await download('-undo')));
  for(const part of Object.keys(source)) expect(Buffer.from(undone[part]).equals(Buffer.from(source[part])),part).toBe(true);
  await reopenDocx(page,input,saved,'Edited '+original); await pixels(); expect(errors).toEqual([]);
});
