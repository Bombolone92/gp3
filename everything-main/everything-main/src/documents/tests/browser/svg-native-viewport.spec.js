import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const directory = 'tests/fixtures/svg-viewport-geometry/';
const references = JSON.parse(readFileSync(directory + 'reference.json', 'utf8'));

for (const reference of references) test(`${reference.name}: matches native viewport paint in full, cropped, grouped and filled pictures`, async ({page}, info) => {
  test.setTimeout(60000);
  await page.goto('/playground.html');
  const source = directory + reference.name + '.docx';
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', {name:'Document text'});
  await expect(input).toHaveValue(/^SVG vector pictures/, {timeout:60000});
  const canvas = page.locator('canvas.canvas-page'); await expect(canvas).toHaveCount(1);
  const bounds = await canvas.evaluate(canvas => {
    const normalized = document.createElement('canvas'); normalized.width=816;normalized.height=1056;
    const c=normalized.getContext('2d');c.drawImage(canvas,0,0,816,1056);
    const data=c.getImageData(0,0,816,1056).data,result={};
    for(const color of ['4080c0','d08040']) {
      const rgb=[0,2,4].map(i=>parseInt(color.slice(i,i+2),16)),bands=[];
      for(let y=0;y<1056;y++) {
        let left=816,right=-1;
        for(let x=0;x<816;x++) {const at=(y*816+x)*4;if(rgb.every((v,k)=>v===data[at+k])){left=Math.min(left,x);right=x;}}
        if(right<0)continue;
        if(bands.length&&bands.at(-1)[3]+1===y){const b=bands.at(-1);b[0]=Math.min(b[0],left);b[2]=Math.max(b[2],right);b[3]=y;}
        else bands.push([left,y,right,y]);
      }
      result[color]=bands;
    }
    return result;
  });
  for(const color of Object.keys(reference.inkBounds)) {
    expect(bounds[color]).toHaveLength(4);
    bounds[color].forEach((box,i)=>box.forEach((value,j)=>expect(Math.abs(value-reference.inkBounds[color][i][j]),`${color} picture ${i} edge ${j}`).toBeLessThanOrEqual(1)));
  }
  const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(suffix+'.docx');await(await pending).saveAs(path);return path;};
  const edited=await save('edited'), before=unzipSync(readFileSync(source)), after=unzipSync(readFileSync(edited));
  expectBodyEditParts(after,before);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
  const undone=unzipSync(readFileSync(await save('undo')));
  for(const part of Object.keys(before))expect(Buffer.from(undone[part]).equals(Buffer.from(before[part])),part).toBe(true);
  await reopenDocx(page,input,edited,'Edited '+original);
});

test('preserves root selectors and resource IDs and leaves unproven root clip/transform composition unchanged', async ({page}) => {
  await page.goto('/playground.html');
  const result=await page.evaluate(async()=>{
    const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
    const {decodeSvg}=await import('/src/engine/svg-images.js');
    const body='<style>svg > rect {fill:rgb(64,128,192)} polygon {fill:none}</style><defs><clipPath id="_nativeSvgViewport"><rect width="16" height="12"/></clipPath></defs><rect width="16" height="12"/>';
    const make=attributes=>`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12" viewBox="0 0 16 12" ${attributes}>${body}</svg>`;
    const source=make(''),xml=new DOMParser().parseFromString(source,'image/svg+xml'),before=new XMLSerializer().serializeToString(xml);
    const adjusted=nativeSvgStrokes(xml.documentElement,{width:16,height:12});
    const image=await decodeSvg(new TextEncoder().encode(source));
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const c=canvas.getContext('2d');c.drawImage(image,0,0,160,120);
    const center=[...c.getImageData(80,60,1,1).data];image.close();
    const excluded=['clip-path="url(#_nativeSvgViewport)"','transform="translate(1 1)"'].map(attrs=>{
      const node=new DOMParser().parseFromString(make(attrs),'image/svg+xml').documentElement;
      const result=nativeSvgStrokes(node,{width:16,height:12});
      return {viewBox:result.getAttribute('viewBox'),clip:result.style.clipPath,transform:result.style.transform,clips:result.querySelectorAll('clipPath').length};
    });
    return {center,excluded,ids:[...adjusted.querySelectorAll('[id]')].map(n=>n.id),unchanged:new XMLSerializer().serializeToString(xml)===before};
  });
  expect(result).toEqual({center:[64,128,192,255],excluded:Array(2).fill({viewBox:'0 0 16 12',clip:'',transform:'',clips:1}),ids:['_nativeSvgViewport','_nativeSvgViewport_'],unchanged:true});
});

test('keeps oversized ratio-only coordinates within the existing decoded image budget',async({page})=>{
  await page.goto('/playground.html');
  const result=await page.evaluate(async()=>{
    const {decodeSvg}=await import('/src/engine/svg-images.js');
    const image=await decodeSvg(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100000 100000"><rect width="100000" height="100000" fill="#4080c0"/></svg>'));
    const result=[image.naturalWidth,image.naturalHeight];image.close();return result;
  });
  expect(result).toEqual([150,150]);
});
