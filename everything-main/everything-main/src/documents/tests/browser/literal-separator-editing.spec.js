import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';

const source='tests/fixtures/line-separator-fonts/control.docx';
async function open(page,lazy=false){
 await page.context().grantPermissions(['local-fonts']);await page.goto('/playground.html');
 await page.evaluate(async({bytes,lazy})=>{
  const {DocxPackage,createDocx}=await import('/src/engine/docx.js');
  const {paragraph}=await import('/src/engine/model.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  let pkg;
  if(lazy){const p=paragraph('AB');Object.assign(p.runs[0],{fontAscii:'Times New Roman',fontHAnsi:'Times New Roman',fontSize:9});pkg=createDocx([p]);}
  else pkg=await DocxPackage.open(new Uint8Array(bytes));
  await loadCanvasFonts(pkg);window.separatorBefore=measureCanvasText(document.createElement('canvas').getContext('2d'),'\u2028',{fontFamily:'Times New Roman',fontSize:9}).width;
  const host=document.createElement('div');host.id='separator-editor';host.style.cssText='position:fixed;inset:0;overflow:auto;background:white;z-index:1000';document.body.append(host);
  window.separatorErrors=[];window.separatorPackage=pkg;
  window.separatorEditor=new CanvasEditor(host,{...pkg,onError:e=>window.separatorErrors.push(e.message)});
  const e=window.separatorEditor,index=lazy?1:e.model.text.indexOf('\u2028',e.model.text.indexOf('Start times'));
  window.separatorOffset=index;e.model.select(index,index);e.syncInput();e.revealCaret();
 },{bytes:[...readFileSync(source)],lazy});
 return page.locator('#separator-editor textarea');
}
async function save(page,info,name){
 const bytes=new Uint8Array(await page.evaluate(async()=>[...new Uint8Array(await window.separatorEditor.export(window.separatorPackage).arrayBuffer())]));
 writeFileSync(info.outputPath(name+'.docx'),bytes);return unzipSync(bytes);
}
async function caretWidth(page){return page.evaluate(async()=>{
 const {caretRect}=await import('/src/engine/layout.js'),e=window.separatorEditor,n=window.separatorOffset;
 return caretRect(e.selectionLayout,n+1).x-caretRect(e.selectionLayout,n).x;
});}

test('native separator glyph supports caret movement, deletion, undo and DOCX reopening',async({page},info)=>{
 const input=await open(page),original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 expect(await page.evaluate(()=>window.separatorBefore)).toBeCloseTo(12,4);expect(await caretWidth(page)).toBeCloseTo(12,4);
 expect(await save(page,info,'noedit')).toEqual(parts);
 await input.focus();await input.press('ArrowRight');
 expect(await page.evaluate(()=>window.separatorEditor.model.selection.focus)).toBe(await page.evaluate(()=>window.separatorOffset+1));
 await input.press('Shift+ArrowLeft');await input.press('Backspace');
 expect((await input.inputValue()).match(/\u2028/g)).toHaveLength(5);
 await input.press('Control+z');await expect(input).toHaveValue(original);expect(await save(page,info,'undo')).toEqual(parts);
 await page.evaluate(()=>{const e=window.separatorEditor;e.model.select(window.separatorOffset,window.separatorOffset);e.syncInput();});
 await page.keyboard.insertText('\u2028');
 expect((await input.inputValue()).match(/\u2028/g)).toHaveLength(7);
 const edited=await save(page,info,'edited');
 for(const [name,bytes]of Object.entries(parts))if(name!=='word/document.xml')expect(edited[name],name).toEqual(bytes);
 const reopened=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const p=await DocxPackage.open(new Uint8Array(bytes));
  return p.paragraphs.flatMap(p=>p.runs.map(r=>r.text)).join('');
 },[...readFileSync(info.outputPath('edited.docx'))]);
 expect(reopened.match(/\u2028/g)).toHaveLength(7);expect(reopened).not.toContain('\uffff');
 expect(await page.evaluate(()=>window.separatorErrors)).toEqual([]);
});

test('first insertion prepares the selected font and refreshes caret geometry',async({page},info)=>{
 const input=await open(page,true);expect(await page.evaluate(()=>window.separatorBefore)).toBeCloseTo(3,4);
 await input.focus();await page.keyboard.insertText('\u2028');await expect(input).toHaveValue('A\u2028B');
 await expect.poll(()=>caretWidth(page)).toBeCloseTo(12,4);
 expect(await page.evaluate(()=>window.separatorEditor.model.selection.focus)).toBe(2);
 const parts=await save(page,info,'inserted');expect(new TextDecoder().decode(parts['word/document.xml'])).toContain('\u2028');
 expect(new TextDecoder().decode(parts['word/document.xml'])).not.toContain('\uffff');
 await input.press('Control+z');await expect(input).toHaveValue('AB');
 expect(await page.evaluate(()=>window.separatorErrors)).toEqual([]);
});
test('late font readiness preserves newer typing, selection and undo history',async({page})=>{
 const input=await open(page,true);
 await page.evaluate(()=>{
  const load=FontFace.prototype.load,gate=new Promise(resolve=>{window.releaseSeparatorFonts=resolve;});
  FontFace.prototype.load=function(){const ready=load.call(this);if(!this.family.startsWith('Canvas literal separator'))return ready;window.separatorBlocked=true;return ready.then(async face=>{await gate;return face;});};
 });
 await input.focus();await page.keyboard.insertText('\u2028');
 await expect.poll(()=>page.evaluate(()=>!!window.separatorBlocked)).toBe(true);
 await page.keyboard.insertText('X');await input.press('ArrowRight');await expect(input).toHaveValue('A\u2028XB');
 await page.evaluate(()=>window.releaseSeparatorFonts());await expect.poll(()=>caretWidth(page)).toBeCloseTo(12,4);
 expect(await page.evaluate(()=>window.separatorEditor.model.selection.focus)).toBe(4);
 await input.press('Control+z');await expect(input).toHaveValue('A\u2028B');
 await input.press('Control+z');await expect(input).toHaveValue('AB');
 expect(await page.evaluate(()=>window.separatorErrors)).toEqual([]);
});

test('activated separator font preserves ordinary script fallback in every face',async({page})=>{
 await open(page);
 const rows=await page.evaluate(async()=>{
  const {setCanvasTextStyle,canvasText}=await import('/src/engine/canvas-text.js');
  const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=180;const ctx=canvas.getContext('2d'),rows=[];
  for(const bold of [false,true])for(const italic of [false,true])for(const size of [12,48,96]){
   const style={fontFamily:'Times New Roman',fontSize:size*.75,bold,italic,ligatures:'none',kerning:0},text='漢字 العربية עברית AV fi';
   const draw=()=>{ctx.clearRect(0,0,1000,180);ctx.fillText(text,10,120);return {width:ctx.measureText(text).width,pixels:ctx.getImageData(0,0,1000,180).data};};
   setCanvasTextStyle(ctx,style);const actual=draw();
   ctx.font=`${italic?'italic ':''}${bold?700:400} ${size}px "Times New Roman", "Canvas Noto Sans"`;const native=draw();
   rows.push({bold,italic,size,width:actual.width===native.width,pixels:actual.pixels.every((v,i)=>v===native.pixels[i]),source:canvasText(ctx,text,style)===text});
  }return rows;
 });
 for(const row of rows){expect(row.width,JSON.stringify(row)).toBe(true);expect(row.pixels,JSON.stringify(row)).toBe(true);expect(row.source).toBe(true);}
});

test('repeated preparation reuses the already authorized face set',async({page})=>{
 await open(page);
 const created=await page.evaluate(async()=>{
  const {loadCanvasFonts}=await import('/src/engine/canvas-text.js'),Native=FontFace;let created=0;
  globalThis.FontFace=new Proxy(Native,{construct(target,args){created++;return Reflect.construct(target,args);}});
  try{await loadCanvasFonts(window.separatorPackage);return created;}finally{globalThis.FontFace=Native;}
 });
 expect(created).toBe(0);
});
