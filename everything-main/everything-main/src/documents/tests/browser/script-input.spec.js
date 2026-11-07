import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { requireNativeWordFonts } from './helpers/native-fonts.js';

test('typed Latin text leaves RTL formatting while mixed input, history and serialized flags remain correct', async ({page},info) => {
  await page.goto('/playground.html'); await requireNativeWordFonts(page,['Arial']);
  await page.evaluate(async () => {
    const {CanvasEditor} = await import('/src/engine/canvas-editor.js');
    const {paragraph} = await import('/src/engine/model.js');
    const host = document.createElement('div'); host.id='script-input-control'; document.body.append(host);
    const p = paragraph('AB'); Object.assign(p.runs[0],{rtl:true,fontAscii:'Arial',fontHAnsi:'Arial',fontCs:'Arial',fontSize:10,fontSizeCs:16});
    window.scriptErrors=[];
    // Exercise the editor component; source-package editing is tested separately.
    window.scriptEditor=new CanvasEditor(host,{paragraphs:[p],onError:e=>window.scriptErrors.push(String(e))});
    const editor=window.scriptEditor; editor.model.select(1); editor.syncInput(); editor.focus();
  });
  const input=page.locator('#script-input-control textarea');
  await input.pressSequentially('X');
  const typed=await page.evaluate(() => {
    const e=window.scriptEditor;
    return {runs:e.model.paragraphs[0].runs.map(r=>[r.text,!!r.cs,!!r.rtl]),fragments:e.layout.lines.flatMap(l=>l.fragments.map(f=>[f.text,f.fontSize]))};
  });
  expect(typed.runs).toEqual([['A',false,true],['X',false,false],['B',false,true]]);
  expect(typed.fragments).toContainEqual(['X',10]);
  await input.press('Control+z'); await expect(input).toHaveValue('AB');
  const result=await page.evaluate(async () => {
    const editor=window.scriptEditor, {createDocx,DocxPackage}=await import('/src/engine/docx.js');
    editor.model.select(1); editor.syncInput();
    editor.input.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:'Aא1'}));
    const flags=()=>editor.model.paragraphs[0].runs.map(r=>[r.text,!!r.cs,!!r.rtl]);
    const before=flags(),pkg=createDocx(editor.model.paragraphs);
    const bytes=new Uint8Array(await pkg.export().arrayBuffer());
    const reopened=await DocxPackage.open(bytes,{bestEffort:true});
    editor.undo(); const undone=editor.model.text; editor.redo();
    return {before,undone,redone:flags(),reopened:reopened.paragraphs[0].runs.map(r=>[r.text,!!r.cs,!!r.rtl]),bytes:[...bytes],errors:window.scriptErrors};
  });
  expect(result.before).toEqual([['A',false,true],['A',false,false],['א1',false,true],['B',false,true]]);
  expect(result.undone).toBe('AB'); expect(result.redone).toEqual(result.before); expect(result.reopened).toEqual(result.before); expect(result.errors).toEqual([]);
  writeFileSync(info.outputPath('script-input.docx'),Buffer.from(result.bytes));
  await page.evaluate(()=>{window.scriptEditor.destroy();document.getElementById('script-input-control').remove();});
});
