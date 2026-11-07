import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/text-fill/', refs=JSON.parse(readFileSync(root+'reference.json'));

for (const [name,ref] of Object.entries(refs.variants)) test(`native text fills, spacing and round trips: ${name}`,async({page},info)=>{
  test.setTimeout(120000);
  const source=root+name+'.docx',bytes=readFileSync(source),errors=[];
  for(const [path,hash] of [[source,ref.sourceSha256],[root+name+'-native.pdf',ref.pdfSha256]]) expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(hash);
  page.on('pageerror',e=>errors.push(e.message)); await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(name==='shapes'?/^Shape 1:/:/^01 \|/);
  await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  // Hide the caret before sampling native ink; no text or formatting changes.
  await page.getByRole('button',{name:'Download .docx',exact:true}).focus();
  const sample=()=>page.locator('canvas.canvas-page').evaluate((canvas,lines)=>{
    const c=document.createElement('canvas');c.width=816;c.height=1056;const ctx=c.getContext('2d');ctx.drawImage(canvas,0,0,c.width,c.height);
    const a=ctx.getImageData(0,0,c.width,c.height).data;
    const classify=(r,g,b)=>{if(Math.max(r,g,b)-Math.min(r,g,b)<40)return Math.max(r,g,b)<140?'black':null;if(r>g*1.5&&r>b*1.5)return'red';if(g>r*1.5&&g>b*1.5)return'green';if(b>r*1.5&&b>g*1.5)return'blue';if(g>r*1.5&&b>r*1.5)return'teal';return null;};
    return lines.map(line=>{const colors={};for(let y=line.strip[0];y<line.strip[1];y++)for(let x=0;x<c.width;x++){
      const i=(y*c.width+x)*4,color=classify(a[i],a[i+1],a[i+2]);if(!color)continue;
      const p=colors[color]||=( {count:0,left:x,right:x,top:y,bottom:y} );p.count++;p.left=Math.min(p.left,x);p.right=Math.max(p.right,x);p.top=Math.min(p.top,y);p.bottom=Math.max(p.bottom,y);
    }return colors;});
  },ref.lines);
  // The UI paints asynchronously after focus and image decoding.
  await expect.poll(async()=>{const a=await sample();return a.every((c,i)=>Object.keys(ref.lines[i].colors).every(k=>c[k]?.count));}).toBeTruthy();
  const actual=await sample();writeFileSync(info.outputPath('ink.json'),JSON.stringify(actual,null,2));
  for(const [i,line] of ref.lines.entries()) for(const color of ['black','red','green','blue','teal']){
    const expected=line.colors[color],ink=actual[i][color],label=`${name}: ${line.text} ${color}`;
    if(!expected){expect(ink?.count||0,label).toBe(0);continue;}
    expect(ink,label).toBeTruthy();
    expect(ink.count/expected.count,label).toBeGreaterThan(.7);expect(ink.count/expected.count,label).toBeLessThan(1.45);
    for(const side of ['left','right','top','bottom'])expect(Math.abs(ink[side]-expected[side]),`${label} ${side}`).toBeLessThanOrEqual(2);
  }
  writeFileSync(info.outputPath('page.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  const original=await input.inputValue(),parts=unzipSync(bytes);
  const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
  const same=(path,edit=false)=>{const out=unzipSync(readFileSync(path));expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());if(edit)expectBodyEditParts(out,parts);else for(const n in parts)expect(Buffer.from(out[n]).equals(Buffer.from(parts[n])),n).toBe(true);};
  same(await save('noedit'));await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited');same(edited,true);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);same(await save('undo'));await reopenDocx(page,input,edited,'Edited '+original);expect(errors).toEqual([]);
});
