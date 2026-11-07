import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {cachedFieldTree,projectCachedFieldResults} from '../src/engine/docx-field-results.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const parse=body=>new DOMParser().parseFromString(`<w:body xmlns:w="${W}">${body}</w:body>`,'application/xml').documentElement;
const run=text=>`<w:r><w:t>${text}</w:t></w:r>`;
const delimiter=type=>`<w:r><w:fldChar w:fldCharType="${type}"/></w:r>`;
it('retains inherited and direct formatting of editable cached nested hyperlink results',async()=>{
 const source=readFileSync('public/fixtures/toc-pageref-formatting.docx');
 const p=await DocxPackage.open(source);expect(p.readOnly).toBeFalsy();
 const entry=p.paragraphs[1].runs.find(r=>r.text==='First topic');
 expect(entry).toMatchObject({fontAscii:'Times New Roman',fontSize:16,italic:true,color:'7030A0',link:{anchor:'Topic1'}});
 expect(p.paragraphs[1].runs.find(r=>r.text==='2')).toMatchObject({fontAscii:'Courier New',fontSize:14,bold:true,color:'008040'});
 expect(p.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n')).not.toMatch(/PAGEREF|TOC/);
 expect(p.parts).toEqual(unzipSync(source));
 expect(unzipSync(new Uint8Array(await p.export(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets).arrayBuffer()))).toEqual(unzipSync(source));
});
it('tracks a multi-paragraph outer field and nested fields across hyperlink wrappers',()=>{
 const root=parse(`<w:p>${delimiter('begin')}<w:r><w:instrText>TOC</w:instrText></w:r>${delimiter('separate')}<w:hyperlink w:anchor="Target">${run('First')}${delimiter('begin')}<w:r><w:instrText>PAGEREF Target</w:instrText></w:r>${delimiter('separate')}${run('2')}${delimiter('end')}</w:hyperlink></w:p><w:p>${run('Second')}${delimiter('end')}${run('After')}</w:p>`);
 const {fields}=cachedFieldTree(root);expect(fields.map(f=>[f.instruction,f.complete])).toEqual([['TOC',true],['PAGEREF Target',true]]);expect(fields[1].parent).toBe(fields[0]);
 projectCachedFieldResults(root);expect(root.textContent).toBe('First2SecondAfter');expect(root.getElementsByTagNameNS(W,'hyperlink')).toHaveLength(1);
});
it('matches the native reference TOC Hyperlink-style suppression while retaining families, direct formatting and outside styles',async()=>{
 const p=await DocxPackage.open(readFileSync('public/fixtures/toc-hyperlink-style.docx'),{bestEffort:true});
 const first=p.paragraphs[1].runs.find(r=>r.text==='First topic');expect(first).toMatchObject({tocHyperlink:true,fontAscii:'Times New Roman',fontSize:12,italic:false,underline:false});
 const second=p.paragraphs[2].runs.find(r=>r.text==='Second topic');expect(second).toMatchObject({fontSize:12,italic:false,color:'C02030',underlineStyle:'double'});
 expect(p.paragraphs[3].runs.find(r=>r.text==='Third topic')).toMatchObject({fontSize:16,italic:true,color:'7030A0'});
 const outside=p.paragraphs.slice(4).flatMap(p=>p.runs).find(r=>r.text==='First topic');expect(outside).toMatchObject({fontSize:16,italic:true,color:'2050C0',underline:true});expect(outside.tocHyperlink).toBeUndefined();
});
it('hides nested results used as field instructions but retains formatted simple-field results',()=>{
 const root=parse(`<w:p>${delimiter('begin')}<w:r><w:instrText>IF </w:instrText></w:r><w:fldSimple w:instr="PAGE">${run('instruction-only')}</w:fldSimple>${delimiter('separate')}<w:fldSimple w:instr="DATE"><w:r><w:rPr><w:b/></w:rPr><w:t>Visible</w:t></w:r></w:fldSimple>${delimiter('end')}</w:p>`);
 projectCachedFieldResults(root);expect(root.textContent).toBe('Visible');expect(root.getElementsByTagNameNS(W,'b')).toHaveLength(1);expect(root.getElementsByTagNameNS(W,'fldSimple')).toHaveLength(0);
});
it('treats unterminated complex fields as literal results and does not consume another story',()=>{
 const root=parse(`<w:p>${delimiter('begin')}<w:r><w:instrText>TOC</w:instrText></w:r>${run('Literal')}<w:r><w:drawing><w:txbxContent><w:p>${delimiter('end')}${run('Shape')}</w:p></w:txbxContent></w:drawing></w:r></w:p>`);
 expect(cachedFieldTree(root).fields[0].complete).toBe(false);projectCachedFieldResults(root);
 expect(root.textContent).toBe('LiteralShape');expect(root.getElementsByTagNameNS(W,'fldChar')).toHaveLength(1);
});
it('ignores deleted delimiters and retains the MACROBUTTON instruction-label reader',()=>{
 const root=parse(`<w:p><w:del>${delimiter('begin')}</w:del>${delimiter('begin')}<w:r><w:instrText>MACROBUTTON NoAction Label</w:instrText></w:r>${delimiter('end')}</w:p>`);
 expect(cachedFieldTree(root).fields).toHaveLength(1);projectCachedFieldResults(root);
 expect(root.getElementsByTagNameNS(W,'instrText')[0].textContent).toBe('MACROBUTTON NoAction Label');
});
it('does not leak nested macro labels from the outer instruction',()=>{
 const root=parse(`<w:p>${delimiter('begin')}<w:r><w:instrText>IF </w:instrText></w:r>${delimiter('begin')}<w:r><w:instrText>MACROBUTTON NoAction Hidden</w:instrText></w:r>${delimiter('end')}${delimiter('separate')}${run('Shown')}${delimiter('end')}</w:p>`);
 projectCachedFieldResults(root);expect(root.textContent).toBe('Shown');
});
it('retains text and properties when delimiters share a run with ordinary text',()=>{
 const root=parse('<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>Before</w:t><w:fldChar w:fldCharType="begin"/><w:instrText>DATE</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>Result</w:t><w:fldChar w:fldCharType="end"/><w:t>After</w:t></w:r></w:p>');
 projectCachedFieldResults(root);expect(root.textContent).toBe('BeforeResultAfter');expect(root.getElementsByTagNameNS(W,'i')).toHaveLength(1);
});
it('does not let an inactive compatibility branch consume visible field results',()=>{
 const root=parse(`<w:p><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:unknown="urn:unknown"><mc:Choice Requires="unknown">${delimiter('begin')}</mc:Choice><mc:Fallback>${run('Fallback')}</mc:Fallback></mc:AlternateContent>${delimiter('begin')}<w:r><w:instrText>DATE</w:instrText></w:r>${delimiter('separate')}${run('Visible')}${delimiter('end')}</w:p>`);
 expect(cachedFieldTree(root).fields).toHaveLength(1);projectCachedFieldResults(root);expect(root.textContent).toBe('FallbackVisible');
});
