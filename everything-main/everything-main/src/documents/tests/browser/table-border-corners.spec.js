import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const reference=JSON.parse(readFileSync('tests/fixtures/border-corners/reference.json','utf8'));
const bounds=boxes=>({width:Math.max(...boxes.map(b=>b[0]+b[2])),height:Math.max(...boxes.map(b=>b[1]+b[3]))});
const colorAt=(boxes,x,y)=>boxes.findLast(([a,b,w,h])=>x>a&&x<a+w&&y>b&&y<b+h)?.[4] ?? null;
const near=(boxes,x,y)=>boxes.some(([a,b,w,h])=>((Math.abs(x-a)<.3||Math.abs(x-a-w)<.3)&&y>b-.3&&y<b+h+.3)||((Math.abs(y-b)<.3||Math.abs(y-b-h)<.3)&&x>a-.3&&x<a+w+.3));
for(const source of reference.cases) test(`matches native table corner ink and preserves editing: ${source.fixture}`,async({page},info)=>{
 await page.goto('/playground.html');const file=`public/fixtures/${source.fixture}.docx`, bytes=readFileSync(file);
 await page.getByLabel('Open DOCX file').setInputFiles(file);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/Border control/);await expect(input).toBeEditable();const original=await input.inputValue();
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js'),{paintParagraphBorder}=await import('/src/engine/canvas-paragraph-borders.js');
  const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);const context=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(context,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return p.tables.map(table=>{
   const boxes=[],ctx={save(){},restore(){},fillRect(...box){boxes.push([...box.map(v=>v*.75),this.fillStyle.toUpperCase()]);}};
   for(const stroke of l.tableBorders.filter(s=>s.tableId===table.id&&!s.guide))paintParagraphBorder(ctx,stroke);
   const x=Math.min(...boxes.map(b=>b[0])),y=Math.min(...boxes.map(b=>b[1]));return boxes.map(([a,b,w,h,color])=>[a-x,b-y,w,h,color]);
  });
 },[...bytes]);
 expect(actual).toHaveLength(source.tables.length);
 for(const [i,boxes]of actual.entries()){
  const word=source.tables[i].rectangles,a=bounds(boxes),b=bounds(word),differences=[];let checked=0;
  for(const right of [false,true])for(const bottom of [false,true])for(let dx=.36;dx<16;dx+=.48)for(let dy=.36;dy<12;dy+=.48){
   const ax=right?a.width-dx:dx,ay=bottom?a.height-dy:dy,bx=right?b.width-dx:dx,by=bottom?b.height-dy:dy;
   if(near(boxes,ax,ay)||near(word,bx,by))continue;
   const actual=colorAt(boxes,ax,ay),expected=colorAt(word,bx,by);
   if(actual!==expected)differences.push({table:i,right,bottom,dx,dy,actual,expected});checked++;
  }
  expect(differences).toEqual([]);expect(checked).toBeGreaterThan(100);
 }
 const download=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`${source.fixture}-${suffix}.docx`);await(await pending).saveAs(path);return path;};
 await input.evaluate(el=>{const at=el.value.lastIndexOf('Border control');el.focus();el.setSelectionRange(at,at+14);el.dispatchEvent(new Event('select',{bubbles:true}));});
 await page.keyboard.insertText('Edited corner');const edited=await input.inputValue(),saved=await download('edited');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);
 const undo=unzipSync(readFileSync(await download('undo'))),parts=unzipSync(bytes);for(const[n,b]of Object.entries(parts))expect(Buffer.from(undo[n]).equals(Buffer.from(b)),n).toBe(true);
 await reopenDocx(page,input,saved,edited);
});
