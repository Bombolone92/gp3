import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraph,documentText} from '../src/engine/model.js';
import {checkedSearchText} from '../src/engine/search.js';
import {MAX_DOCUMENT_CHARACTERS} from '../src/engine/text-limits.js';

let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});

const source=readFileSync('tests/fixtures/large-text/control.docx'),reference=JSON.parse(readFileSync('tests/fixtures/large-text/reference.json'));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());

it('opens an independent large DOCX editable and preserves every part through editing and undo',async()=>{
 expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
 const pkg=await DocxPackage.open(source),doc=model(pkg),before=doc.text;
 expect(before.length).toBe(reference.characters);expect(before.length).toBeGreaterThan(100000);
 expect(doc.paragraphs).toHaveLength(reference.paragraphs);expect(pkg.readOnly).not.toBe(true);
 expect(documentText(DocxPackage.preview(pkg.parts).paragraphs)).toBe(before);
 expect(unzipSync(await save(pkg,doc))).toEqual(unzipSync(source));
 doc.select(100100);doc.replace('Large edit ');
 const edited=await save(pkg,doc),reopened=await DocxPackage.open(edited);
 expect(documentText(reopened.paragraphs)).toBe(before.slice(0,100100)+'Large edit '+before.slice(100100));
 const changed=unzipSync(edited),original=unzipSync(source);
 for(const key of Object.keys(original))if(key!=='word/document.xml')expect(changed[key],key).toEqual(original[key]);
 doc.undo();expect(unzipSync(await save(pkg,doc))).toEqual(original);
});

it('allows large paste, table growth and replacement without the old cap',()=>{
 const text='x'.repeat(100001),doc=new TextDocument([paragraph('needle')]);
 expect(checkedSearchText(text)).toBe(text);
 doc.replaceMatches('needle',text,{},true);expect(doc.text.length).toBe(text.length);expect(doc.text===text).toBe(true);doc.undo();expect(doc.text).toBe('needle');
 doc.select(doc.text.length);doc.replace('\n'+text);const before=doc.text;
 doc.insertTable(1,1);expect(doc.tables).toHaveLength(1);
 doc.insertTableRow();expect(doc.tables[0].rows).toHaveLength(2);
 doc.insertTableColumn();expect(doc.tables[0].grid).toHaveLength(2);
 doc.undo();doc.undo();doc.undo();expect(doc.text).toBe(before);expect(doc.tables).toHaveLength(0);
});

it('retains the new upper boundary for import, preview and search',async()=>{
 const parts=unzipSync(source);
 parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace(/<w:body>[\s\S]*<w:sectPr>/,`<w:body><w:p><w:r><w:t>${'x'.repeat(MAX_DOCUMENT_CHARACTERS+1)}</w:t></w:r></w:p><w:sectPr>`));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow('5,000,000');
 expect(()=>DocxPackage.preview(parts)).toThrow('5,000,000');
 expect(checkedSearchText('x'.repeat(MAX_DOCUMENT_CHARACTERS))).toHaveLength(MAX_DOCUMENT_CHARACTERS);
 expect(()=>checkedSearchText('x'.repeat(MAX_DOCUMENT_CHARACTERS+1))).toThrow('5,000,000');
},30000);
