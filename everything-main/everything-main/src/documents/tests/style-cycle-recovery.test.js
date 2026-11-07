import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraphText} from '../src/engine/model.js';
import {recoverStyleInheritance} from '../src/engine/docx-style-identities.js';
import {parseXml} from '../src/engine/docx-xml.js';
let dom;
beforeAll(()=>{dom=new JSDOM();for(const name of ['Node','document','DOMParser','XMLSerializer'])globalThis[name]=dom.window[name];});
afterAll(()=>{dom.window.close();for(const name of ['Node','document','DOMParser','XMLSerializer'])delete globalThis[name];});
const source=name=>readFileSync(`tests/fixtures/style-cycle-recovery/${name}.docx`);
const variants=['paragraph','character','table','default','self','derived','combined','companion'];

it.each(variants)('retains own style formatting and surrounding rich content for cycles: %s',async name=>{
 const bytes=source(name);
 await expect(DocxPackage.open(bytes)).rejects.toThrow(/cyclic/i);
 const pkg=await DocxPackage.open(bytes,{bestEffort:true});
 const control=await DocxPackage.open(source(`${name}-control`));
 expect(pkg.readOnly).toBe(true);
 expect(pkg.styles).toEqual(control.styles);
 expect(pkg.previewIssues.join(' ')).toMatch(/cyclic style inheritance.*basedOn.*retained/i);
 expect(pkg.previewIssues.join(' ')).toContain(name==='companion'?'word/stylesWithEffects.xml':'word/styles.xml');
 const model=pkg=>new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets,{displayOnly:true});
 const doc=model(pkg),healthy=model(control);
 expect(doc.paragraphs.map(p=>({text:paragraphText(p),runs:p.runs,format:p.format}))).toEqual(
  healthy.paragraphs.map(p=>({text:paragraphText(p),runs:p.runs,format:p.format})));
 expect(pkg.tables).toHaveLength(2);expect(Object.keys(pkg.assets)).toHaveLength(2);
 const original=unzipSync(bytes);
 for(const part of Object.keys(original))expect(pkg.parts[part],part).toEqual(original[part]);
 expect(()=>pkg.export()).toThrow('read-only');
});

it('breaks every cycle edge independently of declaration order, leaving descendant links and source XML intact',()=>{
 const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 const node=(id,base,type='paragraph')=>`<w:style w:type="${type}" w:styleId="${id}"><w:basedOn w:val="${base}"/></w:style>`;
 const entries=[node('Derived','A'),node('A','B'),node('B','C'),node('C','A'),node('Self','Self'),node('Missing','Absent'),node('WrongType','A','character'),node('Numbering','Numbering','numbering')];
 for(const declarations of [entries,[...entries].reverse()]){
  const doc=parseXml(`<w:styles xmlns:w="${W}">${declarations.join('')}</w:styles>`),errors=[];
  const before=new XMLSerializer().serializeToString(doc);
  const view=recoverStyleInheritance(doc,'custom/styles.xml',e=>errors.push(e.message));
  expect(new XMLSerializer().serializeToString(doc)).toBe(before);
  const bases=Object.fromEntries([...view.documentElement.children].map(n=>[n.getAttributeNS(W,'styleId'),n.firstElementChild?.getAttributeNS(W,'val')??null]));
  expect(bases).toEqual({Derived:'A',A:null,B:null,C:null,Self:null,Missing:'Absent',WrongType:'A',Numbering:'Numbering'});
  expect(errors).toHaveLength(2);expect(errors.every(e=>e.includes('custom/styles.xml'))).toBe(true);
  expect(recoverStyleInheritance(view,'custom/styles.xml',()=>{throw Error('already recovered');})).toBe(view);
 }
});

it('leaves acyclic and differently typed inheritance unchanged',()=>{
 const doc=parseXml('<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="A" w:type="paragraph"><w:basedOn w:val="B"/></w:style><w:style w:styleId="B" w:type="character"><w:basedOn w:val="A"/></w:style></w:styles>');
 expect(recoverStyleInheritance(doc,'styles.xml',()=>{throw Error('not a cycle in a typed chain');})).toBe(doc);
});
