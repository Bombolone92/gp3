import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const root='tests/fixtures/paragraph-frames/';
const cases=['terminal-page','terminal-text','terminal-empty-inline','footer-inline','footer-inline-text','footer-page','footer-text','footer-grouped','inline-flow','cell-inline','bordered','footer-bordered','shaded','footer-shaded'];
const download=async(page,info,name)=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
for(const name of cases)test(`frame terminal/story/inline semantics: ${name}`,async({page},info)=>{
 test.setTimeout(180000);const bytes=readFileSync(root+name+'.docx');
 const native=JSON.parse(readFileSync(root+name+'-native.json','utf8').replace(/^\uFEFF/,''));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(native.sourceSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+name+'.docx');
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Healthy before/);await expect(input).toHaveJSProperty('readOnly',false);
 expect(unzipSync(readFileSync(await download(page,info,'noedit.docx')))).toEqual(unzipSync(bytes));
 const geometry=await page.evaluate(async data=>{
   const {openCanvasDocument}=await import('/src/engine/open-document.js'),{CanvasEditor}=await import('/src/engine/canvas-editor.js');
   const {pkg,images}=await openCanvasDocument(new Uint8Array(data)),host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
   const lines=items=>items.filter(l=>!l.virtual).map(l=>({text:l.fragments.map(f=>f.text).join(''),x:l.stops[0].x*.75,y:(l.y+(l.wrapBefore||0))*.75,page:l.page}));
   try{return {body:lines(editor.layout.lines),footer:lines(editor.storyLayout.lines),bodyFrames:editor.layout.paragraphFrames?.length||0,storyFrames:editor.storyLayout.paragraphFrames?.length||0,pages:editor.layout.pageCount, borders:[...editor.layout.paragraphBorders,...editor.storyLayout.borders].filter(b=>b.frameId).map(b=>({side:b.side,x:b.x,y:b.y,width:b.width,height:b.height})), shading:[...editor.layout.lines,...editor.storyLayout.lines].filter(l=>l.frameId&&l.paragraphBackground).map(l=>({x:l.paragraphBackground.x,width:l.paragraphBackground.width,y:l.y,bottom:l.y+l.height+l.paragraphBackground.after}))};}finally{editor.destroy();host.remove();}
 },[...bytes]);
 writeFileSync(info.outputPath('geometry.json'),JSON.stringify(geometry,null,2));expect(geometry.pages).toBe(native.pages);
 expect(geometry.bodyFrames).toBe(native.frames.length);
 if(name.includes('bordered')) {const border=geometry.borders.find(b=>b.side==='bottom');expect(border.y+border.height).toBeCloseTo(288,4);expect(geometry.borders).toHaveLength(4);}
 if(name.includes('shaded')) {expect(geometry.shading.at(-1).bottom).toBeCloseTo(288,4);expect(geometry.shading[0].x).toBe(192);expect(geometry.shading[0].width).toBe(192);}
 const footer=name.startsWith('footer-');
 if(footer)expect(geometry.storyFrames).toBe(native.footers[0].frames.length);
 const expected=footer?native.footers[0].paragraphs:native.paragraphs.slice(0,name==='terminal-empty-inline'?2:3);
 const actual=footer?geometry.footer:geometry.body;
 for(const p of expected){const text=p.text.replace(/[\r\u0007]+$/,'');const line=actual.find(l=>l.text===text);expect(line,`${text} is rendered`).toBeDefined();expect(Math.abs(line.x-p.x)).toBeLessThan(name==='cell-inline'?1:.5);expect(Math.abs(line.y-p.y)).toBeLessThan(1);}
 const target=actual.find(l=>l.text==='Framed first line')||geometry.body[0];
 await page.locator('canvas.canvas-page').evaluate((c,y)=>{let host=c.parentElement;while(host&&!['auto','scroll'].includes(getComputedStyle(host).overflowY))host=host.parentElement;if(host)host.scrollTop=Math.max(0,y-host.clientHeight/2);},target.y/.75);
 const canvas=await page.locator('canvas.canvas-page').boundingBox();
 if(footer&&target.text==='Framed first line')await page.mouse.dblclick(canvas.x+target.x/.75+8,canvas.y+target.y/.75+8);
 else await page.mouse.click(canvas.x+target.x/.75+8,canvas.y+target.y/.75+8);
 const activeInput=page.getByRole('textbox',{name:footer&&target.text==='Framed first line'?'Footer text':'Document text'});
 const before=await activeInput.inputValue();await page.keyboard.insertText('Edited ');expect(await activeInput.inputValue()).not.toBe(before);
 await download(page,info,'edited.docx');await activeInput.press('ControlOrMeta+z');expect(await activeInput.inputValue()).toBe(before);
 expect(unzipSync(readFileSync(await download(page,info,'undo.docx')))).toEqual(unzipSync(bytes));
 await page.screenshot({path:info.outputPath('frame-story.png'),fullPage:true});
});
