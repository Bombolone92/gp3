import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
test('paints wrapped behind-text pictures at native reference positions and preserves editing', async ({page},info) => {
  const source='tests/fixtures/wrapped-behind/control.docx';
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'}), canvases=page.locator('canvas.canvas-page');
  await expect(input).toHaveValue(/^ANCHOR 0/); await expect(input).toBeEditable(); await expect(canvases).toHaveCount(8);
  // The reference PDF places the blue rectangle at (72,86)-(144,122) pt and
  // the red rectangle at (90,86)-(162,122), with red in front, on all 8 pages.
  for(let i=0;i<8;i++)await expect.poll(()=>canvases.nth(i).evaluate(c=>{
    const ctx=c.getContext('2d'),s=c.width/612;
    return [[80,100],[100,100],[155,100],[170,100]].map(([x,y])=>[...ctx.getImageData(Math.floor(x*s),Math.floor(y*s),1,1).data].slice(0,3));
  })).toEqual([[20,80,190],[220,40,40],[220,40,40],[255,255,255]]);
  const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
  const original=await input.inputValue(),parts=unzipSync(readFileSync(source)); expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');
  const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
  for(const [name,bytes] of Object.entries(parts))if(name!=='word/document.xml')expect(changed[name]).toEqual(bytes);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,'EDIT '+original);await expect(page.locator('#playground-error')).toBeEmpty();
});
