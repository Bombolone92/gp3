import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument, paragraphText } from '../src/engine/model.js';
import { plainTextControlRanges } from '../src/engine/plain-text-controls.js';
const folder='tests/fixtures/plain-text-controls',bytes=readFileSync(`${folder}/control.docx`);
const ref=JSON.parse(readFileSync(`${folder}/reference.json`));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const name=r=>new DOMParser().parseFromString(r.control.shell,'application/xml').getElementsByTagNameNS(W,'alias')[0].getAttributeNS(W,'val');
const range=(d,n)=>plainTextControlRanges(d.paragraphs).find(r=>name(r)===n);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const sameParts=(actual,expected)=>{expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());for(const name of Object.keys(expected))expect(Buffer.from(actual[name]).equals(Buffer.from(expected[name])),name).toBe(true);};

for(const [index,native]of ref.cases.entries())it(`matches the native reference plain-text behavior: ${native.case}`,async()=>{
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
  const p=await DocxPackage.open(bytes),d=model(p),r=range(d,native.case),original=d.text;
  expect(plainTextControlRanges(d.paragraphs)).toHaveLength(12);
  sameParts(unzipSync(await save(p,d)),p.parts);
  if(native.case.endsWith('format')){
    d.select(r.start+2,r.start+(native.case.includes('caret')?2:4));const selection={...d.selection};
    d.setRunFormat({bold:true});expect(d.selection).toEqual(selection);
  }else{d.select(r.start+2);d.replace(native.case.endsWith('enter')||native.case==='existing-break'?'\v':'X');}
  const edited=await save(p,d),reopened=model(await DocxPackage.open(edited));
  if(native.case.endsWith('format')){
    const xml=new DOMParser().parseFromString(strFromU8(unzipSync(edited)['word/document.xml']),'application/xml');
    const control=[...xml.getElementsByTagNameNS(W,'sdt')].find(s=>s.getElementsByTagNameNS(W,'alias')[0]?.getAttributeNS(W,'val')===native.case);
    expect(control.getElementsByTagNameNS(W,'sdtPr')[0].getElementsByTagNameNS(W,'b')).toHaveLength(1);
  }
  for(const current of [d,reopened]){
    expect(plainTextControlRanges(current.paragraphs)).toHaveLength(native.controlCount);
    expect(paragraphText(current.paragraphs[index])).toBe(native.paragraphText);
    const control=range(current,native.case);expect(!!control).toBe(native.controlRetained);
    if(native.case.endsWith('format')){
      const runs=control.runs||control.paragraphs[0].runs;
      expect(runs.every(r=>r.bold)).toBe(true);
      expect(runs.map(r=>r.text).join('')).toBe(native.runs.map(r=>r.text).join(''));
    }
  }
  const editedParts=unzipSync(edited);
  for(const [path,data]of Object.entries(p.parts))if(path!=='word/document.xml'){
    if(path==='word/settings.xml'&&d.text!==original){
      const expected=new DOMParser().parseFromString(strFromU8(data),'application/xml');
      const state=expected.getElementsByTagNameNS(W,'proofState')[0];
      for(const flag of ['spelling','grammar'])if(state?.getAttributeNS(W,flag)==='clean')state.setAttributeNS(W,`w:${flag}`,'dirty');
      const actual=new DOMParser().parseFromString(strFromU8(editedParts[path]),'application/xml');
      expect(new XMLSerializer().serializeToString(actual),path).toBe(new XMLSerializer().serializeToString(expected));
    }else expect(Buffer.from(editedParts[path]).equals(Buffer.from(data)),path).toBe(true);
  }
  d.undo();expect(d.text).toBe(original);sameParts(unzipSync(await save(p,d)),p.parts);
}, 60000);

it.each(['temp-prompt','persistent-prompt'])('keeps %s appearance separate from its input formatting, matching the native reference selection edits',async name=>{
  const source=readFileSync(`${folder}/placeholders.docx`),p=await DocxPackage.open(source),d=model(p),r=range(d,name);
  d.select(r.start+2,r.start+4);d.toggleBold();const formatted=await save(p,d);
  const check=(data,phase)=>{
    const doc=new DOMParser().parseFromString(strFromU8(unzipSync(data)['word/document.xml']),'application/xml');
    const native=new DOMParser().parseFromString(readFileSync(`${folder}/${name}-selection2-${phase}-native.xml`,'utf8'),'application/xml');
    const props=root=>[...root.getElementsByTagNameNS(W,'p')][name==='temp-prompt'?0:1];
    const runs=root=>[...props(root).getElementsByTagNameNS(W,'r')].map(r=>({text:[...r.getElementsByTagNameNS(W,'t')].map(t=>t.textContent).join(''),bold:!!r.getElementsByTagNameNS(W,'b').length,color:r.getElementsByTagNameNS(W,'color')[0]?.getAttributeNS(W,'val')}));
    expect(runs(doc)).toEqual(runs(native));
  };
  check(formatted,'formatted');
  d.select(r.start+2);d.replace('Entered');check(await save(p,d),'entered');
  d.undo();d.undo();sameParts(unzipSync(await save(p,d)),unzipSync(source));
}, 60000);

it('applies and clears character formatting across a plain control without moving the caret',async()=>{
  const p=await DocxPackage.open(bytes),d=model(p),r=range(d,'persistent-format');d.select(r.start+3);
  const selected={...d.selection};d.setRunFormat({italic:true,color:'123456'});d.clearDirectTextFormatting();
  expect(d.selection).toEqual(selected);expect(range(d,'persistent-format').runs.every(r=>!r.italic)).toBe(true);
  d.setCharacterStyle('Strong');expect(range(d,'persistent-format').runs.every(r=>r.styleId==='Strong')).toBe(true);
  expect(model(await DocxPackage.open(await save(p,d))).text).toBe(d.text);
});
it('rejects pictures and hyperlinks inside persistent plain controls before changing state',async()=>{
  const p=await DocxPackage.open(bytes),d=model(p),r=range(d,'persistent-format');d.select(r.start+2);const before=d.snapshot();
  expect(()=>d.insertImage('missing',{width:914400,height:914400})).toThrow(/plain-text/);
  expect(()=>d.setHyperlink('https://example.com','Link')).toThrow(/plain-text/);
  expect(d.snapshot()).toEqual(before);
});
it('keeps formatting outside controls and at their end boundary independent',async()=>{
  const d=model(await DocxPackage.open(bytes)),r=range(d,'temp-format');d.select(r.end);d.toggleItalic();
  expect(range(d,'temp-format').runs.every(r=>!r.italic)).toBe(true);
  d.select(0,2);d.toggleBold();expect(range(d,'temp-format').runs.every(r=>!r.bold)).toBe(true);
});
it.each(['boolean','mixed-types','mixed-format','picture','multiple-paragraphs'])('rejects invalid plain-text input: %s',async kind=>{
  const parts=unzipSync(bytes),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
  const s=xml.getElementsByTagNameNS(W,'sdt')[0],pr=s.getElementsByTagNameNS(W,'sdtPr')[0],content=s.getElementsByTagNameNS(W,'sdtContent')[0];
  const make=name=>xml.createElementNS(W,'w:'+name);
  if(kind==='boolean')pr.getElementsByTagNameNS(W,'text')[0].setAttributeNS(W,'w:multiLine','maybe');
  if(kind==='mixed-types')pr.append(make('richText'));
  if(kind==='mixed-format'){const r=content.firstElementChild.cloneNode(true),rp=make('rPr');rp.append(make('b'));r.insertBefore(rp,r.firstChild);content.append(r);}
  if(kind==='picture')content.firstElementChild.append(make('drawing'));
  if(kind==='multiple-paragraphs'){const block=[...xml.getElementsByTagNameNS(W,'sdt')].find(s=>s.parentNode.localName==='body'),c=block.getElementsByTagNameNS(W,'sdtContent')[0];c.append(c.firstElementChild.cloneNode(true));}
  parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
