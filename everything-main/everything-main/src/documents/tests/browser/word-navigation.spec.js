import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {unzipSync} from 'fflate';
const root='tests/fixtures/native-navigation/';
const source=readFileSync(root+'control.docx');
const reference=JSON.parse(readFileSync(root+'native-ranges.json','utf8').replace(/^\uFEFF/,''));
test.setTimeout(180000);
async function load(page,bytes=source){
 await page.goto('/playground.html');
 return page.evaluate(async bytes=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));
  const host=document.createElement('div');host.id='native-navigation-probe';document.body.append(host);
  window.nativePkg=pkg;window.nativeErrors=[];
  window.nativeEditor=new CanvasEditor(host,{...pkg,images,onError:e=>window.nativeErrors.push(e.message)});
  return {readOnly:!!pkg.readOnly,text:window.nativeEditor.model.text};
 },[...bytes]);
}
test('Ctrl and Shift+Ctrl arrows match native word units without changing layout or source parts',async({page},info)=>{
 const original=await load(page);expect(original.readOnly).toBe(false);
 expect(original.text).toBe(reference.text.replace(/\r/g,'\n').slice(0,-1));
 const result=await page.evaluate(({reference})=>{
  const e=window.nativeEditor,geometry=()=>JSON.stringify(e.layout.lines),before=geometry(),failures=[];
  // Detached reference automation API ranges can begin inside combining/ZWJ graphemes; keyboard
  // carets cannot. The unit test still checks all raw UTF-16 reference points.
  const legal=new Set([...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(e.model.text)].map(s=>s.index).concat(e.model.text.length));
  const rows=reference.positions.filter(row=>legal.has(row.position));
  for(const row of rows)for(const move of row.moves)for(const shift of [false,true]){
   e.model.select(row.position);e.syncInput();
   e.keydown(new KeyboardEvent('keydown',{key:move.direction<0?'ArrowLeft':'ArrowRight',ctrlKey:true,shiftKey:shift,cancelable:true}));
   const expected=Math.min(e.model.text.length,shift?move.extendedPosition:move.position);
   if(e.model.selection.focus!==expected||e.model.selection.anchor!==(shift?row.position:expected))failures.push({position:row.position,move,shift,selection:e.model.selection});
  }
  for(const move of reference.selections)for(const reverse of [false,true]){
   e.model.select(reverse?move.end:move.start,reverse?move.start:move.end);e.syncInput();
   e.keydown(new KeyboardEvent('keydown',{key:move.direction<0?'ArrowLeft':'ArrowRight',ctrlKey:true,cancelable:true}));
   if(e.model.selection.anchor!==move.position||e.model.selection.focus!==move.position)failures.push({move,reverse,selection:e.model.selection});
  }
  return {failures,sameGeometry:before===geometry(),errors:window.nativeErrors,positions:rows.length};
 },{reference});
 expect(result).toEqual({failures:[],sameGeometry:true,errors:[],positions:265});
 const bytes=await page.evaluate(async()=>[...new Uint8Array(await (await window.nativeEditor.export(window.nativePkg)).arrayBuffer())]);
 expect(unzipSync(new Uint8Array(bytes))).toEqual(unzipSync(source));
 writeFileSync(info.outputPath('navigation-only.docx'),Buffer.from(bytes));
});
const originalSource=process.env.DOCX_WORD_NAV_REVIEW_SOURCE;
test('original card retains its page pixels, editing, export and undo',async({page,context},info)=>{
 test.skip(!originalSource||!existsSync(originalSource),'Local original supplied through DOCX_WORD_NAV_REVIEW_SOURCE.');
 const bytes=readFileSync(originalSource),parent=execFileSync('git',['show','bdb96076:src/engine/canvas-editor.js'],{encoding:'utf8'});
 const previous=await context.newPage();
 await previous.route('**/src/engine/canvas-editor.js*',route=>route.fulfill({status:200,contentType:'application/javascript',body:parent}));
 const baseline=await load(previous,bytes);expect(baseline.readOnly).toBe(false);
 const pixels=await previous.locator('#native-navigation-probe canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL()));
 await previous.close();
 const current=await load(page,bytes);expect(current).toEqual(baseline);
 expect(await page.locator('#native-navigation-probe canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL()))).toEqual(pixels);
 const untouched=await page.evaluate(async()=>[...new Uint8Array(await (await window.nativeEditor.export(window.nativePkg)).arrayBuffer())]);
 const parts=unzipSync(bytes);expect(unzipSync(new Uint8Array(untouched))).toEqual(parts);
 await page.evaluate(()=>{const e=window.nativeEditor;e.model.select(e.model.text.length);e.syncInput();e.focus();});
 const input=page.locator('#native-navigation-probe textarea');await page.keyboard.insertText(' REVIEW');
 const edited=await page.evaluate(async()=>[...new Uint8Array(await (await window.nativeEditor.export(window.nativePkg)).arrayBuffer())]);
 const changed=unzipSync(new Uint8Array(edited));
 for(const [name,value] of Object.entries(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(value);
 expect(await page.evaluate(async bytes=>{const {DocxPackage}=await import('/src/engine/docx.js');const p=await DocxPackage.open(new Uint8Array(bytes));return p.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n');},edited)).toBe(current.text+' REVIEW');
 await input.press('Control+z');
 const undo=await page.evaluate(async()=>[...new Uint8Array(await (await window.nativeEditor.export(window.nativePkg)).arrayBuffer())]);
 expect(unzipSync(new Uint8Array(undo))).toEqual(parts);
 for(const [name,value] of [['edited',edited],['undo',undo]])writeFileSync(info.outputPath(name+'.docx'),Buffer.from(value));
 expect(await page.evaluate(()=>window.nativeErrors)).toEqual([]);
});
test('actual keyboard word selection replaces one word, exports and undoes exactly',async({page},info)=>{
 const original=await load(page),input=page.locator('#native-navigation-probe textarea');
 await page.evaluate(()=>{const e=window.nativeEditor;e.model.select(0);e.syncInput();e.focus();});
 await input.press('Control+ArrowRight');expect(await input.evaluate(e=>e.selectionStart)).toBe(6);
 await input.press('Control+Shift+ArrowRight');expect(await input.evaluate(e=>e.value.slice(e.selectionStart,e.selectionEnd))).toBe('beta ');
 await page.keyboard.insertText('REPLACED ');
 const expected=original.text.replace('beta ','REPLACED ');
 expect(await input.inputValue()).toBe(expected.replace(/\v/g,'\n'));
 const edited=await page.evaluate(async()=>[...new Uint8Array(await (await window.nativeEditor.export(window.nativePkg)).arrayBuffer())]);
 writeFileSync(info.outputPath('edited.docx'),Buffer.from(edited));
 const parts=unzipSync(source),changed=unzipSync(new Uint8Array(edited));
 for(const [name,bytes] of Object.entries(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(bytes);
 expect(await page.evaluate(async bytes=>{const {DocxPackage}=await import('/src/engine/docx.js');const p=await DocxPackage.open(new Uint8Array(bytes));return p.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n');},edited)).toBe(expected);
 await input.press('Control+z');expect(await input.inputValue()).toBe(original.text.replace(/\v/g,'\n'));
 const undo=await page.evaluate(async()=>[...new Uint8Array(await (await window.nativeEditor.export(window.nativePkg)).arrayBuffer())]);
 expect(unzipSync(new Uint8Array(undo))).toEqual(parts);writeFileSync(info.outputPath('undo.docx'),Buffer.from(undo));
});
test('Option arrows move to word starts and ends like native Mac text fields',async({page})=>{
 await page.goto('/mock.html#/new');
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(page.getByRole('button',{name:'Bold',exact:true})).toBeEnabled();
 await input.fill('Hello brave, new world. Second sentence here.');
 const caret=()=>input.evaluate(e=>[e.selectionStart,e.selectionEnd]);
 const left=[],right=[];
 for(let i=0;i<4;i++){await input.press('Alt+ArrowLeft');left.push((await caret())[0]);}
 expect(left).toEqual([44,40,31,24]);
 for(let i=0;i<4;i++){await input.press('Alt+ArrowRight');right.push((await caret())[0]);}
 expect(right).toEqual([30,39,44,45]);
 await input.press('Alt+Shift+ArrowLeft');await input.press('Alt+Shift+ArrowLeft');
 expect(await caret()).toEqual([40,45]);
 await page.keyboard.insertText('there.');
 await expect(input).toHaveValue('Hello brave, new world. Second sentence there.');
 await input.press('ControlOrMeta+z');
 await expect(input).toHaveValue('Hello brave, new world. Second sentence here.');
});
