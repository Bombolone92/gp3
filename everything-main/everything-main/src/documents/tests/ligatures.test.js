import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {readLigatures,readOpenTypeFeatures} from '../src/engine/ligatures.js';
import {emptyStyles,resolveCharacterRun} from '../src/engine/styles.js';
import {RUN_FORMAT} from '../src/engine/formatting.js';
let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=enabled=>readFileSync(`tests/fixtures/latin-ligature-defaults/control-${enabled}.docx`);
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it.each([0,1])('keeps compatibility kerning derived through edits in mode %s',async enabled=>{
 const p=await DocxPackage.open(readFileSync(`tests/fixtures/legacy-kerning-pairs/control-${enabled}.docx`)),d=model(p);
 expect(d.paragraphs[0].runs[0].legacyKerning).toBe(!enabled);
 expect(d.paragraphs[0].runs[0].ligatures).toBe('none');
 d.select(0);expect(Object.keys(d.runFormatting).sort()).toEqual(Object.keys(RUN_FORMAT).sort());
 d.replace('X');
 const bytes=await save(p,d),reopened=model(await DocxPackage.open(bytes));
 expect(reopened.paragraphs[0].runs.every(r=>r.legacyKerning===!enabled)).toBe(true);
 expect(unzipSync(bytes)['word/settings.xml']).toEqual(p.parts['word/settings.xml']);
 d.select(0,2);expect(d.runFormatting).not.toHaveProperty('legacyKerning');
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it.each([0,1])('retains declarations while applying compatibility switch %s',async enabled=>{
 const p=await DocxPackage.open(source(enabled)),d=model(p);
 expect(d.paragraphs.map(p=>p.runs[0].ligatures)).toEqual(['none','none','none','none','none','none',...Array(3).fill(enabled?'standard':'none'),...Array(3).fill(enabled?'standardContextual':'none')]);
 expect(d.paragraphs[9].runs[0].directFormat.ligatures).toBe('standardContextual');
 expect(unzipSync(await save(p,d))).toEqual(p.parts);
 d.select(1,4);d.setRunFormat({bold:true});d.select(2);d.replace('X');
 const reopened=model(await DocxPackage.open(await save(p,d)));
 expect(reopened.text).toBe(d.text);expect(reopened.paragraphs.map(p=>p.runs.map(r=>r.ligatures))).toEqual(d.paragraphs.map(p=>p.runs.map(r=>r.ligatures)));
 d.undo();d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('cascades defaults, character declarations and explicit none without flattening',()=>{
 const s=emptyStyles();s.openTypeFeatures=true;s.defaults.run.ligatures='standardContextual';s.definitions.Off={type:'character',run:{ligatures:'none'}};
 expect(resolveCharacterRun({text:'office'},s,s.defaults.run).ligatures).toBe('standardContextual');
 expect(resolveCharacterRun({text:'office',styleId:'Off'},s,s.defaults.run).ligatures).toBe('none');
 expect(resolveCharacterRun({text:'office',styleId:'Off',styleManaged:true,directFormat:{ligatures:'standard'}},s,s.defaults.run).ligatures).toBe('standard');
 s.openTypeFeatures=false;expect(resolveCharacterRun({text:'office',ligatures:'standard'},s,RUN_FORMAT).ligatures).toBe('none');
});
it('serializes direct changes and restores original bytes after undo',async()=>{
 const p=await DocxPackage.open(source(1)),d=model(p);d.select(0,3);d.setRunFormat({ligatures:'standardContextual'});
 const reopened=model(await DocxPackage.open(await save(p,d)));expect(reopened.paragraphs[0].runs[0].ligatures).toBe('standardContextual');
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('rejects malformed declarations and ambiguous compatibility switches',()=>{
 const parse=s=>new DOMParser().parseFromString(s,'application/xml').documentElement;
 const ns='http://schemas.microsoft.com/office/word/2010/wordml';
 for(const inner of ['<w14:ligatures/>','<w14:ligatures w14:val="bogus"/>','<w14:ligatures w14:val="none"/><w14:ligatures w14:val="standard"/>'])expect(()=>readLigatures(parse(`<r xmlns:w14="${ns}">${inner}</r>`))).toThrow();
 const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main',setting='<w:compatSetting w:name="enableOpenTypeFeatures" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/>';
 expect(()=>readOpenTypeFeatures(parse(`<w:settings xmlns:w="${w}"><w:compat>${setting}${setting}</w:compat></w:settings>`))).toThrow();
});

it('writes style inheritance into a part without previous extension bindings and removes it cleanly',async()=>{
 const p=await DocxPackage.open(source(1)),d=model(p);d.select(0,3);d.createParagraphStyle('Ligature inheritance');
 const id=d.paragraphs[0].styleId;d.editParagraphStyle(id,{run:{ligatures:'standardContextual'}});
 let reopened=model(await DocxPackage.open(await save(p,d)));expect(reopened.paragraphs[0].runs[0].ligatures).toBe('standardContextual');
 const part=new DOMParser().parseFromString(new TextDecoder().decode(unzipSync(await save(p,d))['word/styles.xml']),'application/xml');
 const pr=part.getElementsByTagNameNS('http://schemas.microsoft.com/office/word/2010/wordml','ligatures')[0].parentElement;
 expect(pr.getAttributeNS('http://schemas.openxmlformats.org/markup-compatibility/2006','Ignorable')).toContain('w14');
 d.editParagraphStyle(id,{run:{ligatures:null}});reopened=model(await DocxPackage.open(await save(p,d)));expect(reopened.paragraphs[0].runs[0].ligatures).toBe('none');
 d.undo();d.undo();d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
