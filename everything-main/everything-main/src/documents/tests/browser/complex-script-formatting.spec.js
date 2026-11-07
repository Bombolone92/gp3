import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import {requireNativeWordFonts} from './helpers/native-fonts.js';
const root = 'tests/fixtures/complex-script-formatting/';
const reference = JSON.parse(readFileSync(root+'reference.json','utf8'));
const cases = JSON.parse(readFileSync(root+'cases.json','utf8'));

// Component proof: native positions isolate face selection and ink from the
// still-unimplemented paragraph bidi ordering and interactive caret geometry.
test('matches native forced-script Latin faces and RTL synthetic italic ink', async ({page}, info) => {
  test.setTimeout(120000);
  for (const [name,key] of [['control.docx','sourceSha256'],['native.pdf','pdfSha256'],['cases.json','casesSha256'],['native-abc.png','rasterSha256']]) expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(reference[key]);
  await page.goto('/playground.html');
  await requireNativeWordFonts(page,['Arial','Courier New','Times New Roman']);
  const result = await page.evaluate(async ({cases,reference,png}) => {
    const {RUN_FORMAT} = await import('/src/engine/formatting.js');
    const {textFontStyle} = await import('/src/engine/font-families.js');
    const {prepareCanvasFont,fontAvailable} = await import('/src/engine/font-availability.js');
    const {setCanvasTextStyle,measureCanvasText} = await import('/src/engine/canvas-text.js');
    const {paintText} = await import('/src/engine/canvas-paint-text.js');
    for (const family of ['Arial','Courier New','Times New Roman']) await prepareCanvasFont(family);
    const image = new Image(); image.src='data:image/png;base64,'+png; await image.decode();
    const expected=document.createElement('canvas');expected.width=image.width;expected.height=image.height;
    expected.getContext('2d').drawImage(image,0,0);
    const collage=document.createElement('canvas');collage.width=image.width;collage.height=image.height;
    const target=collage.getContext('2d');target.fillStyle='white';target.fillRect(0,0,collage.width,collage.height);
    const actual=[];
    for (const c of cases) {
      const ref=reference.samples[c.index], style=textFontStyle('ABC',{...RUN_FORMAT,fontAscii:'Arial',fontCs:c.family,fontSize:10,fontSizeCs:16,[c.flag]:true,boldCs:c.mode==='bold-italic',italicCs:c.mode!=='plain'});
      const draw=style=>{
        const tile=document.createElement('canvas');tile.width=200;tile.height=128;
        const ctx=tile.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,200,128);ctx.scale(3,3);
        ctx.fillStyle='black';setCanvasTextStyle(ctx,style);
        const before=ctx.getTransform(),width=measureCanvasText(ctx,'ABC',style).width;
        paintText(ctx,{...style,text:'ABC',x:ref.origin[0]/3},ref.origin[1]/3);
        const after=ctx.getTransform();
        return {tile,width,advances:['A','AB'].map(t=>measureCanvasText(ctx,t,style).width*.75),restored:['a','b','c','d','e','f'].every(k=>before[k]===after[k]),data:ctx.getImageData(0,0,200,128).data};
      };
      const normal=draw(style), natural=draw({...style,syntheticItalic:false,italic:c.mode!=='plain'});
      const pixels=expected.getContext('2d').getImageData(...ref.tile).data;
      let nativeInk=0,ink=0,error=0,naturalError=0;
      for(let i=0;i<pixels.length;i+=4){nativeInk+=255-pixels[i];ink+=255-normal.data[i];error+=Math.abs(pixels[i]-normal.data[i]);naturalError+=Math.abs(pixels[i]-natural.data[i]);}
      target.drawImage(normal.tile,ref.tile[0],ref.tile[1]);
      actual.push({index:c.index,available:fontAvailable(c.family),style,inkRatio:ink/nativeInk,error:error/nativeInk,naturalError:naturalError/nativeInk,width:normal.width,advances:normal.advances,restored:normal.restored});
    }
    return {actual,png:collage.toDataURL().split(',')[1]};
  }, {cases,reference,png:readFileSync(root+'native-abc.png').toString('base64')});
  writeFileSync(info.outputPath('actual.json'),JSON.stringify(result.actual,null,2));
  writeFileSync(info.outputPath('actual.png'),Buffer.from(result.png,'base64'));
  for (const actual of result.actual) {
    const c=cases[actual.index], native=reference.samples[c.index].glyphs[0];
    expect(actual.available,c.family).toBe(true);expect(actual.restored).toBe(true);
    // Courier's thin upright strokes already differ between PDFium and Canvas
    // (about 8% total ink). Keep that visible in actual.json, independently of
    // this change's face, advance and shear checks; this is not pixel equivalence.
    expect(actual.inkRatio,JSON.stringify(c)).toBeGreaterThan(.9);expect(actual.inkRatio,JSON.stringify(c)).toBeLessThan(1.1);
    for (const [i,advance] of actual.advances.entries()) expect(Math.abs(advance-(reference.samples[c.index].glyphs[i+1].x-native.x)),JSON.stringify(c)).toBeLessThan(.15);
    expect(native.weight).toBe(c.mode==='bold-italic'?700:400);
    if(c.flag==='rtl'&&c.mode!=='plain'){
      expect(native.matrix[2]).toBeCloseTo(1/3,4);
      expect(native.font).not.toContain('Italic');expect(actual.style.syntheticItalic).toBe(true);
      expect(actual.error,JSON.stringify(c)).toBeLessThan(actual.naturalError*.6);
    } else {
      expect(native.matrix[2]).toBe(0);
      if(c.mode!=='plain') expect(native.font).toContain('Italic');
    }
  }
});

test('edits explicit off direction flags without rewriting or discarding them', async ({page},info) => {
  const parts=unzipSync(readFileSync('tests/fixtures/complex-script-properties/control.docx'));
  parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replaceAll('</w:rPr>','<w:rtl w:val="0"/><w:cs w:val="0"/></w:rPr>'));
  await page.goto('/playground.html');
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toBeVisible();
  await page.getByLabel('Open DOCX file').setInputFiles({name:'inactive-rtl.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(zipSync(parts))});
  await expect(input).toHaveValue(/^Default Latin text/);await expect(input).toHaveJSProperty('readOnly',false);
  const original=await input.inputValue();
  const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.evaluate(el=>{const at=el.value.indexOf('Direct')+3;el.setSelectionRange(at,at);el.dispatchEvent(new Event('select',{bubbles:true}));});
  await input.focus();await page.keyboard.insertText('EDIT');const edited=await save('edited');
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page,input,edited,original.replace('Direct','DirEDITect'));await expect(input).toHaveJSProperty('readOnly',false);
});
