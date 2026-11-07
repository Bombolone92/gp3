import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const reference=JSON.parse(readFileSync('tests/fixtures/page-background/reference.json'));
for(const name of ['dark','light'])test(`matches native ${name} page fill and automatic ink through edit, undo and reopen`,async({page},info)=>{
 test.setTimeout(120000);const source=`public/fixtures/page-background-${name}.docx`,ref=reference[name];
 for(const[file,hash]of[[source,ref.sourceSha256],[`tests/fixtures/page-background/${name}-native.pdf`,ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash);
 await page.addInitScript(()=>{window.backgroundInk={};const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.backgroundInk[text]=this.fillStyle;return fill.call(this,text,...args);};});
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^PAGE AUTO/,{timeout:45000});await expect(input).toHaveJSProperty('readOnly',false);
 const check=async(expectedPages=2)=>{
  await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(expectedPages);
  const fills=await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>Array.from(c.getContext('2d').getImageData(10,10,1,1).data).slice(0,3)));expect(fills).toEqual(Array.from({length:expectedPages},()=>ref.backgrounds[0]));
  const ink=await page.evaluate(()=>window.backgroundInk);for(const c of ref.cases){const hex='#'+c.color.map(v=>v.toString(16).padStart(2,'0')).join('');expect(ink[c.text],c.text).toBe(hex);}
 };
 await check();const original=await input.inputValue();await input.press('ControlOrMeta+End');await page.evaluate(()=>window.backgroundInk={});await page.keyboard.insertText('\nEdited');await check(3); // The new paragraph inherits pageBreakBefore.
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`page-background-${name}-${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await save('edited');await page.evaluate(()=>window.backgroundInk={});await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();const parts=unzipSync(readFileSync(source)),undo=unzipSync(readFileSync(await save('undo')));expect(Object.keys(undo).sort()).toEqual(Object.keys(parts).sort());for(const n of Object.keys(parts))expect(Buffer.from(parts[n]).equals(Buffer.from(undo[n])),n).toBe(true);
 page.once('dialog',d=>d.accept());await page.evaluate(()=>window.backgroundInk={});const prior=await input.elementHandle();await page.getByLabel('Open DOCX file').setInputFiles(edited);await expect.poll(()=>prior.evaluate(el=>el.isConnected)).toBe(false);await prior.dispose();await expect(input).toHaveValue(original+'\nEdited');await check(3);
});
