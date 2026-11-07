import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const reference = JSON.parse(readFileSync('tests/fixtures/story-controls/reference.json', 'utf8'));

test('renders controlled first/even/default stories like their unwrapped contents and preserves downloads', async ({page}, info) => {
  await page.addInitScript(() => {
    window.storyPaint = [];
    const paint = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text,x,y,...args) {
      if (/^(Header )?(First|Even|Default) /.test(text)) window.storyPaint.push({text,x,y,canvas:this.canvas});
      return paint.call(this,text,x,y,...args);
    };
  });
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  let plain;
  for (const mode of ['plain','wrapped']) {
    const path=`public/fixtures/story-controls-${mode}.docx`, bytes=readFileSync(path);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(reference[mode].sourceSha256);
    await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(path);
    const input=page.getByRole('textbox',{name:'Document text'});
    await expect(input).toHaveValue('Body page 1\nBody page 2\nBody page 3');
    await expect(input).toHaveJSProperty('readOnly',false);
    await expect(page.locator('canvas.canvas-page')).toHaveCount(3);
    await expect.poll(()=>page.evaluate(()=>[...document.querySelectorAll('canvas.canvas-page')].map(canvas=>
      [...new Set(window.storyPaint.filter(p=>p.canvas===canvas).map(p=>p.text))].sort()))).toEqual([
        ['First 1','Header First 1'],['Even 2','Header Even 2'],['Default 3','Header Default 3'],
      ]);
    const pages=await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL()));
    if (mode==='plain') plain=pages; else expect(pages).toEqual(plain);
    for (const [i,png] of pages.entries()) writeFileSync(info.outputPath(`${mode}-${i+1}.png`),Buffer.from(png.split(',')[1],'base64'));
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
    const saved=info.outputPath(`story-controls-${mode}.docx`);await(await pending).saveAs(saved);
    const original = unzipSync(bytes);
    expect(unzipSync(readFileSync(saved))).toEqual(original);
    const text = await input.inputValue();
    const save = async suffix => {
      const event = page.waitForEvent('download'); await page.getByRole('button',{name:'Download .docx',exact:true}).click();
      const file = info.outputPath(`story-controls-${mode}-${suffix}.docx`); await(await event).saveAs(file); return file;
    };
    await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
    const edited = await save('edited'), parts = unzipSync(readFileSync(edited));
    for (const name of Object.keys(original)) if (name !== 'word/document.xml') expect(parts[name],name).toEqual(original[name]);
    await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(text);
    expect(unzipSync(readFileSync(await save('undo')))).toEqual(original);
    await reopenDocx(page,input,edited,'Edited '+text);
  }
  expect(errors).toEqual([]);
});
