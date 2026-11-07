import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const reference = JSON.parse(readFileSync('tests/fixtures/svg-use/reference.json','utf8'));
const styleReference = JSON.parse(readFileSync('tests/fixtures/svg-use/styles-reference.json','utf8'));

test('local SVG instances match native pen widths and preserve vectors through the editor workflow', async ({page}, info) => {
  test.setTimeout(60000);
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/svg-use-pictures.docx');
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^SVG vector pictures/);
  await expect(input).not.toHaveAttribute('readonly');
  const result=await page.evaluate(async()=>{
    const {DocxPackage}=await import('/src/engine/docx.js');
    const {decodeSvg,svgInfo}=await import('/src/engine/svg-images.js');
    const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
    const p=await DocxPackage.open(new Uint8Array(await(await fetch('/fixtures/svg-use-pictures.docx')).arrayBuffer()));
    const bytes=p.assets['word/media/vector.svg'].bytes, xml=new DOMParser().parseFromString(new TextDecoder().decode(bytes),'image/svg+xml');
    const before=new XMLSerializer().serializeToString(xml), count=document.body.children.length;
    const root=nativeSvgStrokes(xml.documentElement,svgInfo(bytes));
    const widths=[...root.querySelectorAll('path')].filter(n=>!n.closest('defs')).map(n=>Number(n.style.strokeWidth));
    const image=await decodeSvg(bytes),canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;
    const c=canvas.getContext('2d');c.drawImage(image,0,0,1200,800);image.close();
    const colors=[[120,120],[420,120],[720,120],[980,80],[120,520],[1020,520]].map(([x,y])=>[...c.getImageData(x,y,1,1).data]);
    const ink=[450,700].map(x=>{let sum=0;for(let y=480;y<570;y++) {const pixel=c.getImageData(x,y,1,1).data;sum+=Math.max(0,(238-pixel[1])/(238-32));}return sum/10;});
    return {widths, colors, ink, unchanged:before===new XMLSerializer().serializeToString(xml),clean:count===document.body.children.length};
  });
  const nativeWidth=reference.forms[0].geometry.find(o=>o.operator==='w').values[0]/.12;
  expect(result.widths[0]).toBeCloseTo(nativeWidth,4);
  expect(result.widths[1]).toBeCloseTo(nativeWidth*2,4);
  expect(result.ink[0]).toBeCloseTo(nativeWidth,1);
  // Blue's green channel is 80, so normalize the second integral accordingly.
  expect(result.ink[1]*206/158).toBeCloseTo(nativeWidth,1);
  expect(result.colors.slice(0,5)).toEqual([[24,160,96,255],[32,80,224,255],[224,32,48,255],[128,64,192,255],[24,160,96,255]]);
  expect(result.colors[5].slice(0,3)).toEqual([234,177,181]);
  expect(result.unchanged && result.clean).toBe(true);
  const original=await input.inputValue(), before=unzipSync(readFileSync('public/fixtures/svg-use-pictures.docx'));
  const save=async(suffix,edited)=>{
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
    const path=info.outputPath(`svg-use-${suffix}.docx`);await(await pending).saveAs(path);
    const after=unzipSync(readFileSync(path));expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    if(edited) expectBodyEditParts(after,before); else for(const name of Object.keys(before)) expect(Buffer.from(after[name]).equals(Buffer.from(before[name])),name).toBe(true);
    return path;
  };
  await save('noedit',false);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue(original);await save('undo',false);
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const saved=await save('edited',true);await reopenDocx(page,input,saved,'Edited '+original);
  expect(errors).toEqual([]);
});

test('SVG reuse matches native source CSS, percentage positions and legacy-reference precedence', async ({page}) => {
  test.setTimeout(60000);
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/svg-use-styles.docx');
  const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^SVG vector pictures/);
  await expect(input).not.toHaveAttribute('readonly');
  const result=await page.evaluate(async()=>{
    const {DocxPackage}=await import('/src/engine/docx.js');
    const {decodeSvg,svgInfo}=await import('/src/engine/svg-images.js');
    const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
    const p=await DocxPackage.open(new Uint8Array(await(await fetch('/fixtures/svg-use-styles.docx')).arrayBuffer()));
    const bytes=p.assets['word/media/vector.svg'].bytes;
    const image=await decodeSvg(bytes),c=document.createElement('canvas');c.width=1200;c.height=800;
    const ctx=c.getContext('2d');ctx.drawImage(image,0,0,1200,800);image.close();
    const colors=[120,520].flatMap(y=>[120,420,720,1020].map(x=>[...ctx.getImageData(x,y,1,1).data].slice(0,3)));
    const doc=new DOMParser().parseFromString(new TextDecoder().decode(bytes),'image/svg+xml');
    const root=nativeSvgStrokes(doc.documentElement,svgInfo(bytes));
    const ids=[...root.querySelectorAll('[id]')].map(n=>n.id);
    return {colors,unique:ids.length===new Set(ids).size};
  });
  const native=styleReference.forms[0].fillColors.slice(1);
  expect(result.colors).toHaveLength(native.length);
  result.colors.forEach((rgb,i)=>rgb.forEach((v,j)=>expect(Math.abs(v-native[i][j]*255)).toBeLessThan(1)));
  expect(result.unique).toBe(true);
});

test('reused local paint resources, nested references and translation compose without ID collisions', async ({page}) => {
  await page.goto('/playground.html');
  const result=await page.evaluate(async()=>{
    const {decodeSvg}=await import('/src/engine/svg-images.js');
    const source=`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><style>rect, &gt; {fill:red}</style><defs>
      <g id="tile"><defs><linearGradient id="paint"><stop stop-color="#2050e0"/><stop offset="1" stop-color="#2050e0"/></linearGradient></defs><rect width="16" height="16" fill="url(#paint)"/></g>
      <use id="nested" href="#tile" x="2"/>
      </defs><use href="#tile" x="5" y="5"/><use href="#nested" transform="translate(30 0)" x="3" y="5"/>
      <use href="#tile" x="65" y="5"/><use href="#tile" x="95" y="5"/></svg>`;
    const image=await decodeSvg(new TextEncoder().encode(source)),c=document.createElement('canvas');c.width=1200;c.height=800;
    const ctx=c.getContext('2d');ctx.drawImage(image,0,0,1200,800);image.close();
    return [120,420,720,1020].map(x=>[...ctx.getImageData(x,120,1,1).data]);
  });
  expect(result).toEqual(Array(4).fill([32,80,224,255]));
});
