import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/semibold-face/',source=folder+'control.docx';
const native=JSON.parse(readFileSync(folder+'reference.json'));
const forceAbsent=async page=>{
 return page.addInitScript(()=>{
 const Native=FontFace;
 window.FontFace=class extends Native{
  constructor(name,source,descriptors){super(name,source,descriptors);this.controlSource=source;}
  load(){return typeof this.controlSource==='string'&&this.controlSource.startsWith('local(')&&/source sans pro semibold/i.test(this.controlSource)?Promise.reject(Error('Exact native face absent in control')):super.load();}
 };
});};
test('exact semibold face matches native marker advances and survives editing',async({page},info)=>{
 test.setTimeout(90000);await forceAbsent(page);
 const bytes=readFileSync(source),parts=unzipSync(bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(native.sourceSha256);
 expect([native.savedBefore,native.savedAfter,native.sourceUnchanged]).toEqual([true,true,true]);expect(native.markers).toHaveLength(4);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Semibold face 1:/);await expect(input).toHaveJSProperty('readOnly',false);
 const loaded=await page.evaluate(()=>[...document.fonts].filter(f=>f.family.replace(/^['"]|['"]$/g,'').toLowerCase()==='source sans pro semibold').map(f=>({style:f.style,status:f.status})));
 expect(loaded.sort((a,b)=>a.style.localeCompare(b.style))).toEqual([{style:'italic',status:'loaded'},{style:'normal',status:'loaded'}]);
 const markers=await page.evaluate(async bytes=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js'),{CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes)),host=document.createElement('div');document.body.append(host);const editor=new CanvasEditor(host,{...pkg,images});
  try{return editor.layout.lines.flatMap(l=>l.fragments.filter(f=>f.image).map(f=>({xPt:f.x*.75,widthPt:f.width*.75})));}finally{editor.destroy();host.remove();}
 },[...bytes]);
 writeFileSync(info.outputPath('marker-comparison.json'),JSON.stringify({actual:markers,native:native.markers},null,2));
 expect(markers).toHaveLength(4);markers.forEach((m,i)=>{expect(Math.abs(m.xPt-native.markers[i].xPt),`style ${i+1}`).toBeLessThan(.1);expect(m.widthPt).toBeCloseTo(native.markers[i].widthPt,6);});
 const save=async(kind,edited=false)=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(kind+'.docx');await(await event).saveAs(path);const out=unzipSync(readFileSync(path));expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const name of Object.keys(parts))if(!edited||name!=='word/document.xml')expect(out[name],name).toEqual(parts[name]);return path;};
 const original=await input.inputValue();await save('noedit');await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Reviewed ');const edited=await save('edited',true);await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await save('undo');await reopenDocx(page,input,edited,'Reviewed '+original);await expect(page.locator('#playground-error')).toBeEmpty();
});
test('missing italic asset leaves the entire exact face pair unregistered',async({page})=>{
 await forceAbsent(page);await page.route('**/fonts/SourceSansPro-SemiboldIt.ttf',r=>r.abort());await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveValue(/^Semibold face 1:/);
 expect(await page.evaluate(()=>[...document.fonts].filter(f=>f.family.replace(/^['"]|['"]$/g,'').toLowerCase()==='source sans pro semibold').length)).toBe(0);
 await expect(page.locator('#playground-error')).toBeEmpty();
});
