import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const refs=JSON.parse(readFileSync('tests/fixtures/font-alternatives/positions.json','utf8'));
for(const [name,alternate] of [['font-alternatives','Arial'],['font-alternatives-serif','Times New Roman']])test(`${name}: native font choice, layout and retained edits`,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.fontPaint=new Map();const original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){window.fontPaint.set(text,{x,y,font:this.font});return original.call(this,text,x,y,...rest);};});
 await page.goto('/playground.html');
 const available=await page.evaluate(async()=>{const {checkFontAvailability,fontAvailable}=await import('/tools/font-availability-modules.js');await Promise.all(['Arial','Times New Roman'].map(checkFontAvailability));return ['Arial','Times New Roman'].every(fontAvailable);});
 test.skip(!available,'The native reference requires installed Arial and Times New Roman.');
 const fixture=`public/fixtures/${name}.docx`;await page.getByLabel('Open DOCX file').setInputFiles(fixture);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Alternate font/);await expect(input).toHaveJSProperty('readOnly',false);const text=await input.inputValue();
 const check=async()=>{const actual=await page.evaluate(()=>Object.fromEntries(window.fontPaint));for(const w of refs[name]){expect(actual[w.text].font).toContain(w.text.startsWith('Available')?'Arial':alternate);expect(Math.abs(actual[w.text].y*.75-w.y),JSON.stringify({w,actual:actual[w.text]})).toBeLessThan(.2);}};
 await check();await input.press('ControlOrMeta+Home');
 await expect(page.getByLabel('Latin font family',{exact:true})).toHaveText(new RegExp('AltProbeMissing.*'+alternate));
 await page.keyboard.insertText('Edited ');
 const download=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const file=info.outputPath(name+suffix+'.docx');await(await pending).saveAs(file);return file;};
 const saved=await download(''),source=unzipSync(readFileSync(fixture)),edited=unzipSync(readFileSync(saved));
 expect(Object.keys(edited).sort()).toEqual(Object.keys(source).sort());for(const part of Object.keys(source))if(part!=='word/document.xml')expect(Buffer.from(edited[part]).equals(Buffer.from(source[part])),part).toBe(true);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);await check();
 const undo=unzipSync(readFileSync(await download('-undo')));for(const part of Object.keys(source))expect(Buffer.from(undo[part]).equals(Buffer.from(source[part])),part).toBe(true);
 await reopenDocx(page,input,saved,'Edited '+text);expect(errors).toEqual([]);
});
test('keeps font alternatives local to each rendering context and falls back when both names are unavailable',async({page})=>{
 await page.goto('/playground.html');
 const result=await page.evaluate(async()=>{
  const {checkFontAvailability,fontAvailable}=await import('/tools/font-availability-modules.js');
  const {setCanvasFontAlternatives,measureCanvasText,loadCanvasFonts}=await import('/src/engine/canvas-text.js');
  await loadCanvasFonts();await Promise.all(['Arial','Times New Roman','AltProbeMissing73','Absent Alternative 75','constructor'].map(checkFontAvailability));
  const a=document.createElement('canvas').getContext('2d'),b=document.createElement('canvas').getContext('2d');
  setCanvasFontAlternatives(a,{altprobemissing73:'Arial'});setCanvasFontAlternatives(b,{altprobemissing73:'Times New Roman'});
  const style={fontAscii:'AltProbeMissing73',fontSize:12};measureCanvasText(a,'MWiiii',style);const first=a.font;
  measureCanvasText(b,'MWiiii',style);const second=b.font;measureCanvasText(a,'MWiiii',style);const again=a.font;
  setCanvasFontAlternatives(a,{altprobemissing73:'Absent Alternative 75'});measureCanvasText(a,'MWiiii',style);const missing=a.font;
  setCanvasFontAlternatives(a,{});measureCanvasText(a,'MWiiii',{...style,fontAscii:'constructor'});const inherited=a.font;
  return {first,second,again,missing,inherited,native:fontAvailable('Arial')&&fontAvailable('Times New Roman')};
 });
 if(result.native){expect(result.first).toContain('Arial');expect(result.second).toContain('Times New Roman');}
 expect(result.first).toBe(result.again);expect(result.missing).toContain('Canvas Noto Sans');expect(result.inherited).toContain('Canvas Noto Sans');
 // Native families are covered by the platform-specific native comparisons above.
});
