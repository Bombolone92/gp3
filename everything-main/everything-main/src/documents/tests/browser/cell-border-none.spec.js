import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

for(const kind of ['matrix','edges','style','spacing','spacing-rules','style-only','priority','properties'])test(`${kind}: matches native border ink and vertical spacing through editable export`,async({page},info)=>{
  test.setTimeout(60000);
  const source=`tests/fixtures/cell-border-none/${kind}.docx`;
  const native=JSON.parse(readFileSync(`tests/fixtures/cell-border-none/${kind}-native.json`,'utf8'));
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'}),canvases=page.locator('canvas.canvas-page');
  await expect(input).toBeEditable();await expect(canvases).toHaveCount(6);await expect(page.locator('#playground-error')).toBeEmpty();
  for(let i=0;i<6;i++){
    const canvas=canvases.nth(i);await canvas.scrollIntoViewIfNeeded();
    const bounds=()=>canvas.evaluate((el,colors)=>{
      const ctx=el.getContext('2d'),data=ctx.getImageData(0,0,el.width,el.height).data,scale=el.width/576,result={};
      for(const [name,color]of Object.entries(colors)){
        let left=Infinity,top=Infinity,right=-1,bottom=-1;
        for(let y=0;y<el.height;y++)for(let x=0;x<el.width;x++){
          const at=(y*el.width+x)*4;
          if(color.every((v,c)=>Math.abs(data[at+c]-v)<=2)){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
        }
        result[name]=right<0?null:[left/scale,top/scale,(right+1)/scale,(bottom+1)/scale];
      }
      return result;
    },native.colors);
    await expect.poll(async()=>{
      const actual=await bounds();
      return Object.entries(native.pages[i].bounds).filter(([name,box])=>!(box===null?actual[name]===null:actual[name]&&box.every((v,j)=>Math.abs(v-actual[name][j])<=2)))
        .map(([name,expected])=>({name,expected,actual:actual[name]}));
    },{message:`${kind} native border bounds page ${i+1}`}).toEqual([]);
  }
  const lines=await page.evaluate(async bytes=>{
    const {DocxPackage}=await import('/src/engine/docx.js');
    const {validateCanvasLayout,measureCanvasText,setCanvasFontAlternatives}=await import('/src/engine/canvas-text.js');
    const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
    const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await validateCanvasLayout(p);
    const ctx=document.createElement('canvas').getContext('2d');setCanvasFontAlternatives(ctx,p.styles.fontAlternatives);
    const layout=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories,{styles:p.styles,drawingLayouts:p.drawingLayouts});
    return layout.lines.map(l=>({page:l.page,text:l.fragments.map(f=>f.text||'').join('').replace(/\s/g,''),x:l.fragments[0]?.x*.75,y:l.baseline*.75}));
  },readFileSync(source).toString('base64'));
  for(const [i,nativePage]of native.pages.entries())for(const origin of nativePage.origins){
    const line=lines.find(l=>l.page===i&&l.text===origin.text);expect(line).toBeDefined();
    expect(Math.abs(line.y-origin.y),`${kind} page ${i+1} ${origin.text} baseline`).toBeLessThan(.12);
    expect(Math.abs(line.x-origin.x),`${kind} page ${i+1} ${origin.text} horizontal origin`).toBeLessThan(.12);
  }
  const original=await input.inputValue(),before=unzipSync(readFileSync(source));
  const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
  const sameParts=path=>{const after=unzipSync(readFileSync(path));expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());for(const name of Object.keys(before))expect(after[name],name).toEqual(before[name]);};
  sameParts(await download('noedit.docx'));
  await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');
  const edited=await download('edited.docx'),parts=unzipSync(readFileSync(edited));
  expectBodyEditParts(parts,before);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);sameParts(await download('undo.docx'));
  await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toBeEditable();await expect(canvases).toHaveCount(6);
});
