import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
for (const fixture of ['svg-pictures', 'svg-viewbox-pictures', 'svg-space-pictures']) test(`${fixture}: paints vectors in pictures, groups and fills, then edits and retains both source representations`,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(`public/fixtures/${fixture}.docx`);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^SVG vector/);await expect(page.locator('#playground-error')).toBeEmpty();
 const samples=await page.evaluate(async(fixture)=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{decodeImages}=await import('/src/engine/images.js');
  const p=await DocxPackage.open(new Uint8Array(await(await fetch(`/fixtures/${fixture}.docx`)).arrayBuffer()));const images=await decodeImages(p.assets);
  const vector=images.get('word/media/vector.svg');const canvas=document.createElement('canvas');canvas.width=600;canvas.height=400;const c=canvas.getContext('2d');c.drawImage(vector,0,0,600,400);
  const color=(x,y)=>[...c.getImageData(x,y,1,1).data];const direct=[color(30,30),color(550,200)];
  const groups=[...images.values()].filter(i=>i.bitmap).map(i=>{c.clearRect(0,0,600,400);c.drawImage(i.bitmap,0,0,600,400);return [color(30,30),color(550,200)];});
  images.forEach(i=>i.close());return {direct,groups};
 }, fixture);
 for(const [green,blue] of [samples.direct,...samples.groups]){expect(green).toEqual([24,160,96,255]);expect(blue[0]).toBeLessThan(40);expect(blue[1]).toBeGreaterThan(70);expect(blue[2]).toBeGreaterThan(180);expect(blue[3]).toBe(255);}
 expect(samples.groups).toHaveLength(2);
 writeFileSync(info.outputPath('svg-pictures.png'), Buffer.from(await page.locator('canvas.canvas-page').first().evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const saved=info.outputPath(`${fixture}.docx`);await(await pending).saveAs(saved);
 await reopenDocx(page,input,saved,'Edited '+original);expect(errors).toEqual([]);
});
test('keeps unsupported SVG read-only without fetching resources or changing the original download',async({page},info)=>{
 const parts=unzipSync(readFileSync('public/fixtures/svg-pictures.docx'));
 parts['word/media/vector.svg']=strToU8('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><image href="https://svg-resource.invalid/secret.png"/></svg>');
 const bytes=zipSync(parts),path=info.outputPath('unsafe-source.docx');writeFileSync(path,bytes);const requests=[];page.on('request',r=>{if(r.url().includes('svg-resource.invalid'))requests.push(r.url());});
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(path);
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveAttribute('readonly');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const saved=info.outputPath('unsafe-original.docx');await(await download).saveAs(saved);
 expect(readFileSync(saved).equals(Buffer.from(bytes))).toBe(true);expect(requests).toEqual([]);
});
test('opens the second local birthday card for editing and preserves SVGs and linked controls',async({page},info)=>{
 test.skip(!process.env.SECOND_BIRTHDAY_CARD_PATH,'Optional private local corpus specimen');
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(process.env.SECOND_BIRTHDAY_CARD_PATH);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/MAIL@EXAMPLE.COM/);await expect(input).toHaveJSProperty('readOnly',false);
 const original=await input.inputValue();await input.evaluate(el=>{const at=el.value.indexOf('MAIL@EXAMPLE.COM');el.focus();el.setSelectionRange(at,at+4);el.dispatchEvent(new Event('select'));});await input.press('ControlOrMeta+b');
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const saved=info.outputPath('second-birthday-linked-edit.docx');await(await pending).saveAs(saved);
 const before=unzipSync(readFileSync(process.env.SECOND_BIRTHDAY_CARD_PATH)),out=unzipSync(readFileSync(saved));for(const n of Object.keys(before))if(n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(before[n])),n).toBe(true);
 await page.getByRole('button',{name:'Undo',exact:true}).click();const undo=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const restored=info.outputPath('second-birthday-linked-undo.docx');await(await undo).saveAs(restored);const parts=unzipSync(readFileSync(restored));for(const n of Object.keys(before))expect(Buffer.from(parts[n]).equals(Buffer.from(before[n])),n).toBe(true);
 await reopenDocx(page,input,saved,original);

 writeFileSync(info.outputPath('second-birthday-svg-preview.png'), Buffer.from(await page.locator('canvas.canvas-page').first().evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const fonts = await page.evaluate(async () => { const { fontAvailable, displayedFont } = await import('/src/engine/font-availability.js'); return ['Impact', 'Book Antiqua'].map(name => ({ name, available: fontAvailable(name), displayed: displayedFont({ fontFamily: name }) })); });
 writeFileSync(info.outputPath('second-birthday-fonts.json'), JSON.stringify(fonts, null, 2));
 await input.evaluate(el=>{const at=el.value.indexOf('PICNIC IN THE park');el.focus();el.setSelectionRange(at,at+'PICNIC IN THE park'.length);el.dispatchEvent(new Event('select'));});
 const copied=await input.evaluate(el=>{const data=new DataTransfer();el.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));return data.getData('text/plain');});expect(copied).toBe('PICNIC IN THE park');
 await input.evaluate(el=>{const at=el.value.indexOf('MAIL@EXAMPLE.COM');el.focus();el.setSelectionRange(at+2,at+2);el.dispatchEvent(new Event('select'));const data=new DataTransfer();data.setData('text/plain','INVITE@EXAMPLE.COM');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
 await expect(input).toHaveValue(original.replace('MAIL@EXAMPLE.COM','INVITE@EXAMPLE.COM'));
 const pastedDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const pastedPath=info.outputPath('second-birthday-pasted.docx');await(await pastedDownload).saveAs(pastedPath);
 await reopenDocx(page,input,pastedPath,original.replace('MAIL@EXAMPLE.COM','INVITE@EXAMPLE.COM'));
});
