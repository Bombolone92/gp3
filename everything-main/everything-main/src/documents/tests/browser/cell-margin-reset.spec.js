import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
const source = 'public/fixtures/cell-margin-reset.docx';
const reference = JSON.parse(readFileSync('tests/fixtures/cell-margin-reset/reference.json'));
test.use({deviceScaleFactor: 2});
for(const missingFont of [false,true]) test(`paints native margin-reset geometry through edits (${missingFont?'substituted font':'declared font'})`, async ({page}, info) => {
  test.setTimeout(180000);
  for (const [file, hash] of [[source,reference.sourceSha256],['tests/fixtures/cell-margin-reset/native.pdf',reference.pdfSha256]]) expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash);
  await page.addInitScript(()=>{
    window.marginPaint=[];
    const fill=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
      if(/^M\d+[lr]$/.test(text)){
        const m=this.getTransform(),scale=this.canvas.width/816,metrics=this.measureText(text),origin=(m.a*x+m.e)/scale*.75;
        window.marginPaint.push({text,x:origin,width:metrics.width*.75,baseline:(m.d*y+m.f)/scale*.75,font:this.font,kerning:this.fontKerning});
      }
      return fill.call(this,text,x,y,...rest);
    };
  });
  const parts=unzipSync(readFileSync(source));
  if(missingFont)parts['word/styles.xml']=strToU8(strFromU8(parts['word/styles.xml']).replaceAll('Courier New','Missing Margin Control Font'));
  const sourceBytes=missingFont?zipSync(parts):readFileSync(source);
  await page.goto('/playground.html');
  const referenceFont=await page.evaluate(async()=>{try{await new FontFace('reference probe','local("Courier New")').load();return true;}catch{return false;}});
  await page.getByLabel('Open DOCX file').setInputFiles({name:'cell-margin-reset.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(sourceBytes)});
  const input = page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^table24/,{timeout:45000}); await expect(input).toHaveJSProperty('readOnly',false);
  const check = async () => {
    await expect(page.locator('#playground-error')).toBeEmpty();
    await expect(page.locator('canvas.canvas-page')).toHaveCount(22);
    const actual = await page.evaluate(pages => pages.map((lines,i) => {
      const canvas = document.querySelectorAll('canvas.canvas-page')[i], ctx = canvas.getContext('2d'), scale = canvas.width/612;
      return lines.map(line => {
        const x0=Math.round(100*scale), y0=Math.round((line.baseline-13)*scale), w=Math.round(400*scale), h=Math.round(16*scale);
        const pixels=ctx.getImageData(x0,y0,w,h).data; let left=w,top=h,right=-1,bottom=-1;
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=(y*w+x)*4;if(Math.max(pixels[k],pixels[k+1],pixels[k+2])<80){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
        const p=window.marginPaint.findLast(p=>p.text===line.text),reference=new OffscreenCanvas(w,h),native=reference.getContext('2d');
        native.fillStyle='white';native.fillRect(0,0,w,h);native.fillStyle='black';const factor=scale*.75;native.scale(factor,factor);native.font=p.font;native.fontKerning=p.kerning;
        const expectedX=line.text.endsWith('r')?line.x+line.text.length*7.2-p.width:line.x;
        native.fillText(line.text,(expectedX*scale-x0)/factor,(p.baseline*scale-y0)/factor);
        const expected=native.getImageData(0,0,w,h).data;let nl=w,nr=-1;
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){const k=(y*w+x)*4;if(Math.max(expected[k],expected[k+1],expected[k+2])<80){nl=Math.min(nl,x);nr=Math.max(nr,x);}}
        return {ink:[(left+x0)/scale,(top+y0)/scale,(right+x0+1)/scale,(bottom+y0+1)/scale],native:[(nl+x0)/scale,(nr+x0+1)/scale]};
      });
    }),reference.pages);
    const painted=await page.evaluate(pages=>pages.map(lines=>lines.map(line=>window.marginPaint.findLast(p=>p.text===line.text))),reference.pages);
    for(const[i,lines]of reference.pages.entries())for(const[j,line]of lines.entries()){
      const p=painted[i][j];expect(p,`paint ${line.text}`).toBeTruthy();
      // Right-aligned text keeps its margin edge when substitution changes its
      // advance. The independent native control uses 12pt Courier, 7.2pt per glyph.
      const right=line.text.endsWith('r'),edge=p.x+(right?p.width:0),wordEdge=line.x+(right?line.text.length*7.2:0);
      expect(Math.abs(edge-wordEdge),`painted margin edge ${line.text}`).toBeLessThan(.15);
      for(const[k,native]of [[0,actual[i][j].native[0]],[2,actual[i][j].native[1]]])expect(Math.abs(actual[i][j].ink[k]-native),`native ink ${line.text}`).toBeLessThan(.6);
      if(referenceFont&&!missingFont)for(const k of [0,2])expect(Math.abs(actual[i][j].ink[k]-line.ink[k]),`native ink ${line.text}`).toBeLessThan(.6);
    }
  };
  await check();
  writeFileSync(info.outputPath('cell-margin-reset.png'), Buffer.from(await page.locator('canvas.canvas-page').nth(4).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
  const original=await input.inputValue(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited '); await check();
  const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`cell-margin-reset-${suffix}.docx`);await(await pending).saveAs(path);return path;};
  const edited=await save('edited');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
  const a=unzipSync(sourceBytes), b=unzipSync(readFileSync(await save('undo')));
  for(const name of Object.keys(a))expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);
  const previous=await input.elementHandle();page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited);
  await expect.poll(()=>previous.evaluate(el=>el.isConnected),{timeout:45000}).toBe(false);await previous.dispose();
  await expect(input).toHaveValue('Edited '+original);await check();
});
