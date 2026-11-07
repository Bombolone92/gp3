import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
test('thin control print, edit, undo and reopen',async({page},info)=>{
 test.setTimeout(120000);
 const bytes=readFileSync('tests/fixtures/thin-curve-native/source.docx');
 await page.goto('/playground.html');
 const result=await page.evaluate(async bytes=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js'),{CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {pkg,images}=await openCanvasDocument(Uint8Array.from(bytes));if(pkg.readOnly)throw new Error('Partial preview');
  const errors=[],host=document.createElement('div');document.body.append(host);
  const editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
  const save=async()=>[...new Uint8Array(await pkg.export(editor.model.paragraphs,editor.model.pageSettings,editor.model.numbering,editor.model.styles,editor.model.tables,editor.model.assets).arrayBuffer())];
  try{
   const original=await save(),sheets=editor.printSheets(),png=sheets.map(c=>c.toDataURL()),sizes=sheets.map(c=>[c.width,c.height]);
   editor.model.select(0);editor.model.replace('Control ');const edited=await save(),reopened=await openCanvasDocument(Uint8Array.from(edited));
   editor.model.undo();const undone=await save();
   return {original,edited,undone,png,sizes,errors,assets:Object.keys(pkg.assets).length,decoded:images.size,reopenedReadOnly:!!reopened.pkg.readOnly,text:reopened.pkg.paragraphs.flatMap(p=>p.runs).map(r=>r.text??'').join('')};
  }finally{editor.destroy();host.remove();}
 },[...bytes]);
 expect(result.png).toHaveLength(16);expect(result.errors).toEqual([]);expect(result.reopenedReadOnly).toBe(false);expect(result.text.startsWith('Control ')).toBe(true);
 const parts=unzipSync(bytes);expect(unzipSync(Uint8Array.from(result.original))).toEqual(parts);expect(unzipSync(Uint8Array.from(result.undone))).toEqual(parts);
 const edited=unzipSync(Uint8Array.from(result.edited));for(const [name,data] of Object.entries(parts))if(name!=='word/document.xml')expect(edited[name]).toEqual(data);
 result.png.forEach((png,i)=>writeFileSync(info.outputPath(`page-${i+1}.png`),Buffer.from(png.split(',')[1],'base64')));
 writeFileSync(info.outputPath('edited.docx'),Uint8Array.from(result.edited));
 writeFileSync(info.outputPath('result.json'),JSON.stringify({sizes:result.sizes,assets:result.assets,decoded:result.decoded,errors:result.errors,editableReopen:true,noEditAndUndoExact:true},null,2));
});

for(const inline of [false,true])test(`${inline?'inline':'anchored'} print preserves physical outline widths and restores screen cache unchanged`,async({page},info)=>{
 await page.goto('/playground.html');
 const parts=unzipSync(readFileSync('tests/fixtures/thin-curve-native/source.docx'));
 if(inline){
  // This owned source has exactly one no-wrap anchor per page; retain its
  // extent/graphic and convert only the containing Wordprocessing frame.
  const xml=strFromU8(parts['word/document.xml']).replace(/<wp:anchor\b[^>]*>/g,'<wp:inline>')
   .replaceAll('</wp:anchor>','</wp:inline>').replace(/<wp:simplePos\b[^>]*\/>/g,'')
   .replace(/<wp:position[HV]\b[^>]*>[\s\S]*?<\/wp:position[HV]>/g,'').replace(/<wp:wrapNone\b[^>]*\/>/g,'');
  parts['word/document.xml']=strToU8(xml);writeFileSync(info.outputPath('inline.docx'),zipSync(parts));
 }
 const result=await page.evaluate(async bytes=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js'),{CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {pkg,images}=await openCanvasDocument(Uint8Array.from(bytes)),host=document.createElement('div');document.body.append(host);
  const editor=new CanvasEditor(host,{...pkg,images}),pens=[];
  const hash=async c=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',c.getContext('2d').getImageData(0,0,c.width,c.height).data))].join(',');
  const screen=()=>Promise.all(editor.canvases.map(hash));
  const proto=OffscreenCanvasRenderingContext2D.prototype,stroke=proto.stroke;
  try{
   const before=await screen();
   proto.stroke=function(...args){const m=this.getTransform();pens.push(this.lineWidth*Math.hypot(m.a,m.b));return stroke.apply(this,args);};
   const first=await Promise.all(editor.printSheets().map(hash));proto.stroke=stroke;
   editor.paint();const after=await screen(),second=await Promise.all(editor.printSheets().map(hash));
   return {pens,before,after,first,second};
  }finally{proto.stroke=stroke;editor.destroy();host.remove();}
 },[...zipSync(parts)]);
 expect(result.pens).toHaveLength(32);
 for(let i=0;i<32;i++)expect(result.pens[i],`physical pen ${i+1}`).toBeCloseTo([.14,.25,4327/12700,.5][Math.floor(i/8)]*192/72,6);
 expect(result.after).toEqual(result.before);expect(result.second).toEqual(result.first);
});
