import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
import {showAllTools} from './helpers/editor-tools.js';
import {reopenDocx} from './helpers/reopen-docx.js';

test('uses relocated settings for native layout and retains their location through UI edits and undo',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.settingsPaint=[];const original=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){window.settingsPaint.push({text,x,y});return original.call(this,text,x,y,...rest);};
 });
 await page.goto('/playground.html');await showAllTools(page);
 await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/settings-location.docx');
 const input=page.getByRole('textbox',{name:'Document text'}), original='A\tB\nLabel\nValue\nAfter table';
 await expect(input).toHaveValue(original);await expect(input).toHaveJSProperty('readOnly',false);
 const painted=await page.evaluate(()=>Object.fromEntries(['B','Label','Value'].map(text=>[text,window.settingsPaint.findLast(p=>p.text===text)])));
 const positions=JSON.parse(readFileSync('tests/fixtures/settings-location/positions.json','utf8'));
 for(const {text,x} of positions.filter(p=>['B','Label','Value'].includes(p.text))) expect(Math.abs(painted[text].x*.75-x)).toBeLessThan(.1);
 await page.getByRole('button',{name:'Indents and tabs',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Indents and tabs'}),spacing=dialog.getByRole('spinbutton',{name:'Default tab spacing (in)',exact:true});
 await expect(spacing).toHaveValue('1');await spacing.fill('0.75');await dialog.getByRole('button',{name:'Apply',exact:true}).click();
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
 const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const file=info.outputPath(name);await(await pending).saveAs(file);return file;};
 const saved=await download('settings-location.docx'),source=unzipSync(readFileSync('public/fixtures/settings-location.docx')),edited=unzipSync(readFileSync(saved));
 expect(Object.keys(edited).sort()).toEqual(Object.keys(source).sort());
 expect(strFromU8(edited['config/settings2.xml'])).toContain('w:val="1080"');
 for(const name of Object.keys(source)) if(!['word/document.xml','config/settings2.xml'].includes(name)) expect(Buffer.from(edited[name]).equals(Buffer.from(source[name])),name).toBe(true);
 await input.press('ControlOrMeta+z');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
 const restored=unzipSync(readFileSync(await download('settings-location-undo.docx')));
 for(const name of Object.keys(source)) expect(Buffer.from(restored[name]).equals(Buffer.from(source[name])),name).toBe(true);
 await reopenDocx(page,input,saved,'Edited '+original);
 await page.getByRole('button',{name:'Indents and tabs',exact:true}).click();await expect(spacing).toHaveValue('0.75');
 expect(errors).toEqual([]);
});
