import {test, expect} from '@playwright/test';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const root='tests/fixtures/frame-default-compatibility/';
const cases=JSON.parse(readFileSync(root+'cases.json','utf8'));
for(const name of Object.keys(cases)) test(`native frame defaults: ${name}`,async({page},info)=>{
  test.setTimeout(180000);
  const bytes=readFileSync(root+name+'.docx');
  const native=JSON.parse(readFileSync(root+name+'-native.json','utf8').replace(/^\uFEFF/,''));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(native.sourceSha256);
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(root+name+'.docx');
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^Before frame/);
  await expect(input).toHaveJSProperty('readOnly',false);
  const geometry=await page.evaluate(async data=>{
    const {openCanvasDocument}=await import('/src/engine/open-document.js');
    const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
    const {pkg,images}=await openCanvasDocument(new Uint8Array(data));
    const host=document.createElement('div');document.body.append(host);
    const editor=new CanvasEditor(host,{...pkg,images});
    try{return {frames:editor.layout.paragraphFrames,lines:editor.layout.lines.map(l=>({text:l.fragments.map(f=>f.text).join(''),x:l.fragments[0]?.x*.75,y:(l.y+(l.wrapBefore||0))*.75}))};}
    finally{editor.destroy();host.remove();}
  },[...bytes]);
  writeFileSync(info.outputPath('geometry.json'),JSON.stringify(geometry,null,2));
  expect(geometry.frames).toHaveLength(1);
  for(const item of native.paragraphs){
    const line=geometry.lines.find(l=>l.text&&item.text.trim().startsWith(l.text.trim()));expect(line).toBeDefined();
    expect(Math.abs(line.x-item.x)).toBeLessThan(.5);
    expect(Math.abs(line.y-item.y)).toBeLessThan(1);
  }
  const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);return readFileSync(path);};
  expect(unzipSync(await download('noedit.docx'))).toEqual(unzipSync(bytes));
  const original=await input.inputValue();await input.focus();await input.evaluate(e=>e.setSelectionRange(e.value.indexOf('Framed first line')+7,e.value.indexOf('Framed first line')+7));
  await page.keyboard.insertText('Edited ');expect(await input.inputValue()).not.toBe(original);
  await download('edited.docx');await input.press('ControlOrMeta+z');expect(await input.inputValue()).toBe(original);
  expect(unzipSync(await download('undo.docx'))).toEqual(unzipSync(bytes));
  await page.screenshot({path:info.outputPath('frame.png'),fullPage:true});
});
