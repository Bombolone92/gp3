import { assertPackageParts } from './helpers/assert-package-parts.js';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraph} from '../src/engine/model.js';
import {checkedRunFormat,RUN_FORMAT} from '../src/engine/formatting.js';
import {validFontSize,MAX_FONT_SIZE} from '../src/engine/font-size.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('accepts half-point boundaries consistently for both font properties and rejects invalid values',()=>{
 expect(MAX_FONT_SIZE).toBe(1638);
 for(const size of [1,200,200.5,650,1637.5,1638])for(const key of ['fontSize','fontSizeCs']){
  expect(validFontSize(size)).toBe(true);expect(()=>checkedRunFormat({...RUN_FORMAT,[key]:size})).not.toThrow();
  const d=new TextDocument([paragraph('A')]);d.select(0,1);d.setRunFormat({[key]:size});expect(d.paragraphs[0].runs[0][key]).toBe(size);
 }
 for(const value of [0,.5,12.25,1638.5,Infinity,NaN,'650'])for(const key of ['fontSize','fontSizeCs']){
  expect(validFontSize(value)).toBe(false);expect(()=>checkedRunFormat({...RUN_FORMAT,[key]:value})).toThrow();
  const d=new TextDocument([paragraph('A')]);d.select(0,1);expect(()=>d.setRunFormat({[key]:value})).toThrow();expect(d.text).toBe('A');
 }
 expect(checkedRunFormat({...RUN_FORMAT,cs:true,fontSizeCs:650})).toMatchObject({cs:true,fontSizeCs:650});
});
it('preserves large-font drawings and style inheritance through edits, exports and exact undo',async()=>{
 const source=readFileSync('tests/fixtures/large-fonts/control.docx'),p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const parts=unzipSync(source),save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 assertPackageParts(unzipSync(await save()), parts);
 const at=d.text.indexOf('\nA\n')+1;expect(at).toBeGreaterThan(0);d.select(at,at+1);d.setRunFormat({fontSize:650.5});
 const edited=await save(),out=unzipSync(edited);expect(strFromU8(out['word/document.xml'])).toContain('1301');
 for(const[n,b]of Object.entries(parts))if(n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);
 const reopened=await DocxPackage.open(edited);expect(reopened.paragraphs.some(p=>p.runs.some(r=>r.fontSize===650.5))).toBe(true);const stableAssets=a=>JSON.parse(JSON.stringify(a,(key,value)=>key==='id'&&typeof value==='string'&&/^p\d+$/.test(value)?'<paragraph-id>':value));expect(stableAssets(reopened.assets)).toEqual(stableAssets(p.assets));
 d.undo();assertPackageParts(unzipSync(await save()), parts);
 expect(()=>d.editCharacterStyle('LargeGlyph',{run:{fontSize:650.5}})).toThrow(/grouped drawings/);
 assertPackageParts(unzipSync(await save()), parts);
});

it('round-trips large character-style edits and exact undo in editable body text',async()=>{
 const source=readFileSync('public/fixtures/character-styles.docx'),p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles).arrayBuffer());
 d.editCharacterStyle('CanvasCharacterBase',{run:{fontSize:650.5}});
 const out=unzipSync(await save());for(const[n,b]of Object.entries(unzipSync(source)))if(!['word/styles.xml','word/document.xml'].includes(n))expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);
 expect((await DocxPackage.open(await save())).paragraphs.some(p=>p.runs.some(r=>r.fontSize===650.5))).toBe(true);
 d.undo();assertPackageParts(unzipSync(await save()), unzipSync(source));
});
