import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { squareRow, squareIntervals } from '../src/engine/square-wrap.js';
import { assertPackageParts } from './helpers/assert-package-parts.js';
const root='tests/fixtures/floating-table-spacing/', source=readFileSync(root+'control.docx');
const refs=JSON.parse(readFileSync(root+'reference.json'));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const render=d=>layoutDocument(d.paragraphs,t=>({width:t.length*5,ascent:12,descent:4}),pageGeometry(d.pageSettings),d.numbering,d.tables);
let dom,pkg,layout;
beforeAll(async()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;pkg=await DocxPackage.open(source);layout=render(pkg);});
afterAll(()=>dom.window.close());
it('binds the native reference and all controls to exact bytes',()=>{
 for(const[name,hash]of Object.entries(refs.sha256))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex'),name).toBe(hash);
 expect(layout.pageCount).toBe(50);
});
for(const[page,lines]of refs.pages.entries())it(`retains paragraph spacing below the floating table on native page ${page+1}`,()=>{
 for(const ref of lines){
  const line=layout.lines.find(l=>l.page===page&&l.fragments.map(f=>f.text).join('').replace(/\s/g,'')===ref.text);
  expect(line,ref.text).toBeTruthy();expect(Math.abs(line.baseline*.75-ref.y),ref.text+' Y').toBeLessThan(.15);
  expect(Math.abs(line.stops[0].x*.75-ref.x),ref.text+' X').toBeLessThan(.15);
  const caret=caretRect(layout,line.start);expect(caret.page).toBe(page);
  expect(hitTest(layout,page,line.stops[0].x+1,line.baseline-2)).toBe(line.start);
 }
});
it('preserves edited paragraphs, export/reopen and exact undo',async()=>{
 const p=await DocxPackage.open(source),d=model(p),before=render(d);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 assertPackageParts(unzipSync(await save()),p.parts);
 d.select(d.text.indexOf('Anchor 9'));d.replace('Extra\n');
 const edited=await save(),reopened=model(await DocxPackage.open(edited));
 expect(render(reopened).lines.map(l=>[l.page,l.baseline])).toEqual(render(d).lines.map(l=>[l.page,l.baseline]));
 const parts=unzipSync(edited);for(const[n,b]of Object.entries(p.parts))if(n!=='word/document.xml')expect(Buffer.from(parts[n]).equals(Buffer.from(b)),n).toBe(true);
 d.undo();expect(render(d)).toEqual(before);assertPackageParts(unzipSync(await save()),p.parts);
});
it('adds no gap beside a table, to continuation lines, or when clearing a picture',()=>{
 const page={height:1000,top:0,bottom:0},edges={left:0,right:300};
 const line={start:0,y:10,height:16},obstacle={page:0,left:0,right:300,top:0,bottom:100,side:'both',table:true};
 const row=(e,index=0)=>squareRow({paragraphs:new Map([['p',[{...line,page:0}]]]),exclusions:[e]},'p',index,edges,page,0,8);
 expect(row(obstacle).before).toBe(98);
 expect(row({...obstacle,right:100}).before).toBe(0);
 expect(row({...obstacle,table:false}).before).toBe(90);
 expect(row(obstacle,1).before).toBe(74);
});
it('distinguishes touching a body table from touching a nested table or picture',()=>{
 const exclusion={page:0,left:0,right:300,top:26,bottom:100,side:'both',table:true};
 expect(squareIntervals(0,300,10,16,0,[exclusion]).intervals).toHaveLength(0);
 expect(squareIntervals(0,300,10,16,0,[{...exclusion,cellId:'cell'}]).intervals).toEqual([{left:0,right:300}]);
 expect(squareIntervals(0,300,10,16,0,[{...exclusion,table:false}]).intervals).toEqual([{left:0,right:300}]);
 expect(squareIntervals(0,300,10,16,0,[{...exclusion,top:26+1/15}]).intervals).toEqual([{left:0,right:300}]);
});
