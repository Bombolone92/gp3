import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraphText} from '../src/engine/model.js';
import {recoverStyleIdentities} from '../src/engine/docx-style-identities.js';
import {parseXml} from '../src/engine/docx-xml.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
let dom;
beforeAll(()=>{dom=new JSDOM();for(const name of ['Node','document','DOMParser','XMLSerializer'])globalThis[name]=dom.window[name];});
afterAll(()=>{dom.window.close();for(const name of ['Node','document','DOMParser','XMLSerializer'])delete globalThis[name];});
const source=name=>readFileSync(`tests/fixtures/style-identity-recovery/${name}.docx`);
const variants=['missing','paragraph','character','default','table','cross-type','combined','companion','companion-only'];

it.each(variants)('retains healthy styles, defaults and rich content with rejected identities: %s',async name=>{
 const bytes=source(name);
 await expect(DocxPackage.open(bytes)).rejects.toThrow(/style ID/);
 const pkg=await DocxPackage.open(bytes,{bestEffort:true});
 const control=await DocxPackage.open(source('healthy'));
 expect(pkg.readOnly).toBe(true);expect(pkg.styles).toEqual(control.styles);
 expect(pkg.previewIssues.join(' ')).toContain(name==='companion-only'?'word/stylesWithEffects.xml':'word/styles.xml');
 const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets,{displayOnly:true});
 expect(pkg.tables).toHaveLength(2);expect(Object.keys(pkg.assets)).toHaveLength(2);
 const heading=doc.paragraphs.find(p=>paragraphText(p)==='Styled heading');
 expect(heading.runs[0]).toMatchObject({bold:true,color:'204080',fontSize:18});
 const affected=doc.paragraphs.find(p=>paragraphText(p)==='Retained direct italic');
 expect(affected.runs[0]).toMatchObject({italic:true,color:'336699',fontSize:11});
 const original=unzipSync(bytes);
 expect(Object.keys(pkg.parts).sort()).toEqual(Object.keys(original).sort());
 for(const part of Object.keys(original))expect(pkg.parts[part],part).toEqual(original[part]);
 expect(()=>pkg.export()).toThrow('read-only');
});

it('leaves a healthy view and the original XML untouched; excludes every duplicate',()=>{
 const doc=parseXml(`<w:styles xmlns:w="${W}"><w:style w:styleId="Good"/></w:styles>`),errors=[];
 expect(recoverStyleIdentities(doc,'styles.xml',e=>errors.push(e.message))).toBe(doc);
 const malformed=parseXml(`<w:styles xmlns:w="${W}"><w:style w:styleId="Bad"/><w:style w:styleId="Good"/><w:style w:styleId="Bad"/><w:style/></w:styles>`);
 const before=new XMLSerializer().serializeToString(malformed),excluded=new Set();
 const view=recoverStyleIdentities(malformed,'styles.xml',e=>errors.push(e.message),excluded);
 expect(new XMLSerializer().serializeToString(malformed)).toBe(before);
 expect([...view.documentElement.children].map(n=>n.getAttributeNS(W,'styleId'))).toEqual(['Good']);
 expect([...excluded]).toEqual(['Bad']);expect(errors).toHaveLength(2);
});

it('retains an editable, byte-preserving healthy package',async()=>{
 const bytes=source('healthy'),pkg=await DocxPackage.open(bytes);
 expect(pkg.readOnly).not.toBe(true);
 const out=unzipSync(new Uint8Array(await pkg.export().arrayBuffer())),original=unzipSync(bytes);
 expect(Object.keys(out).sort()).toEqual(Object.keys(original).sort());
 for(const part of Object.keys(original))expect(out[part],part).toEqual(original[part]);
});

it('retains a derived style when only its base identity is ambiguous',async()=>{
 const parts=unzipSync(source('paragraph'));
 parts['word/styles.xml']=strToU8(strFromU8(parts['word/styles.xml']).replace('</w:styles>',
  '<w:style w:type="paragraph" w:styleId="Derived"><w:name w:val="Derived"/><w:basedOn w:val="BadParagraph"/><w:rPr><w:b/><w:color w:val="992233"/></w:rPr></w:style></w:styles>'));
 parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('w:pStyle w:val="BadParagraph"','w:pStyle w:val="Derived"'));
 const pkg=await DocxPackage.open(zipSync(parts),{bestEffort:true});
 const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets,{displayOnly:true});
 const p=doc.paragraphs.find(p=>paragraphText(p)==='Retained direct italic');
 expect(p.runs[0]).toMatchObject({bold:true,italic:true,color:'992233',fontSize:11});
 expect(pkg.styles.definitions.Derived.basedOn).toBe('BadParagraph');
 expect(pkg.styles.definitions.BadParagraph).toBeUndefined();
});

it('reports the relationship-resolved styles part without changing original bytes',async()=>{
 const parts=unzipSync(source('combined'));
 parts['word/custom-styles.xml']=parts['word/styles.xml'];delete parts['word/styles.xml'];
 for(const name of ['word/_rels/document.xml.rels','[Content_Types].xml'])parts[name]=strToU8(strFromU8(parts[name]).replaceAll('styles.xml','custom-styles.xml'));
 const pkg=await DocxPackage.open(zipSync(parts),{bestEffort:true});
 expect(pkg.previewIssues.join(' ')).toContain('word/custom-styles.xml');
 expect(Object.keys(pkg.styles.definitions).sort()).toEqual(['Accent','Heading']);
 expect(pkg.parts['word/custom-styles.xml']).toEqual(parts['word/custom-styles.xml']);
});
