import { it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { readFontFileInfo } from '../src/engine/font-file-info.js';
const data = name => { const b = readFileSync(`tests/fixtures/font-files/${name}.ttf`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
afterEach(() => vi.unstubAllGlobals());
it.each([['Regular',400,false],['Bold',700,false],['Italic',400,true],['BoldItalic',700,true]])('reads internal names and style for %s independently of filenames', (name, weight, italic) => {
  expect(readFontFileInfo(data(name))).toMatchObject({family:'Corpus File Font',legacyFamily:'Corpus File Font',postscriptName:`CorpusFileFont-${name}`,metadata:{weight,italic},axes:{}});
});
it('reads real weight and width variation ranges', () => {
  const b = readFileSync('public/fonts/OpenSans.ttf');
  expect(readFontFileInfo(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))).toMatchObject({axes:{wght:{min:300,max:800},wdth:{min:75,max:100}}});
});
it('rejects truncated, out-of-bounds and unsupported fonts instead of guessing from a filename', () => {
  for (const mutate of [v=>v.setUint32(0,0x74746366),v=>v.setUint32(20,0xffffffff),v=>{
    for(let i=0;i<v.getUint16(4);i++)if(v.getUint32(12+i*16)===0x6e616d65)v.setUint16(v.getUint32(20+i*16)+4,0);
  }]) { const b=data('Regular');mutate(new DataView(b));expect(()=>readFontFileInfo(b)).toThrow(); }
  expect(()=>readFontFileInfo(data('Regular').slice(0,40))).toThrow();
});
async function registry() {
  vi.resetModules();const add=vi.fn();
  vi.stubGlobal('document',{fonts:{add}});
  vi.stubGlobal('FontFace',class {constructor(family,source,descriptors){Object.assign(this,{family,source,descriptors});}async load(){return this;}});
  return {...await import('../src/engine/file-fonts.js'),add};
}
const file = name => ({size:data(name).byteLength,arrayBuffer:async()=>data(name)});
function namedFont(records, languages = []) {
  const chunks = [], entries = [], languageEntries = [];
  let length = 0;
  const string = value => {const b=Buffer.from(value,'utf16le');b.swap16();const offset=length;length+=b.length;chunks.push(b);return [b.length,offset];};
  for (const [id, text, language = 0x409] of records) entries.push([3,1,language,id,...string(text)]);
  for (const language of languages) languageEntries.push(string(language));
  const header=6+entries.length*12+(languages.length?2+languages.length*4:0), table=Buffer.alloc(header+length);
  table.writeUInt16BE(languages.length?1:0);table.writeUInt16BE(entries.length,2);table.writeUInt16BE(header,4);
  entries.forEach((entry,i)=>entry.forEach((value,j)=>table.writeUInt16BE(value,6+i*12+j*2)));
  if(languages.length){const at=6+entries.length*12;table.writeUInt16BE(languages.length,at);languageEntries.forEach((entry,i)=>entry.forEach((value,j)=>table.writeUInt16BE(value,at+2+i*4+j*2)));}
  Buffer.concat(chunks).copy(table,header);
  const original=data('Regular'),v=new DataView(original),tables=[];
  for(let i=0;i<v.getUint16(4);i++){const p=12+i*16,tag=v.getUint32(p);tables.push({tag,data:tag===0x6e616d65?table:new Uint8Array(original,v.getUint32(p+8),v.getUint32(p+12))});}
  const size=12+tables.length*16+tables.reduce((n,t)=>n+Math.ceil(t.data.length/4)*4,0), result=new ArrayBuffer(size),out=new DataView(result);new Uint8Array(result).set(new Uint8Array(original,0,12));let at=12+tables.length*16;
  tables.forEach((t,i)=>{const p=12+i*16;out.setUint32(p,t.tag);out.setUint32(p+8,at);out.setUint32(p+12,t.data.length);new Uint8Array(result,at,t.data.length).set(t.data);at+=Math.ceil(t.data.length/4)*4;});return result;
}
it('retains localized names, prefers English language-tag records and distinguishes legacy families',()=>{
  const b=namedFont([[1,'Famille Étroite',0x8000],[16,'Famille',0x8000],[4,'Famille Étroite Regular',0x8000],[1,'Corpus Narrow',0x8001],[16,'Corpus Family',0x8001],[4,'Corpus Narrow Regular',0x8001],[6,'Corpus-Narrow']],['fr','en-US']);
  expect(readFontFileInfo(b)).toMatchObject({family:'Corpus Family',legacyFamily:'Corpus Narrow',fullName:'Corpus Narrow Regular',familyNames:['Famille','Corpus Family'],legacyNames:['Famille Étroite','Corpus Narrow']});
});
it('rejects control-character names and ignores unknown language-tag identifiers',()=>{
  expect(()=>readFontFileInfo(namedFont([[1,'Bad\u0000Name'],[4,'Full'],[6,'PostScript']]))).toThrow('needs family');
  expect(()=>readFontFileInfo(namedFont([[1,'Unknown',0x8002],[4,'Full'],[6,'PostScript']],['en']))).toThrow('needs family');
});
it('adds styles to a family, retains exact aliases, deduplicates bytes and never asks for OS font permission',async()=>{
  const query=vi.fn();vi.stubGlobal('window',{queryLocalFonts:query});const r=await registry();
  await r.loadFontFile(file('Regular'));const first=r.fileFontFamily('Corpus File Font'),version=r.fileFontVersion();
  expect(r.fileFontFamily(undefined)).toBeUndefined();expect(r.fileFontSources(null)).toBeUndefined();
  expect((await import('../src/engine/font-availability.js')).fontAvailable(undefined)).toBe(true);
  expect(r.fileFontSources(first)).toHaveLength(1);
  expect(await r.loadFontFile(file('Regular'))).toMatchObject({duplicate:true});expect(r.fileFontVersion()).toBe(version);
  await r.loadFontFile(file('Bold'));const second=r.fileFontFamily('Corpus File Font');expect(second).not.toBe(first);
  expect(r.fileFontSources(second).map(f=>f.descriptors.weight)).toEqual(['400','700']);expect(r.fileFontSources(first)).toHaveLength(1);
  expect(r.fileFontSources(r.fileFontFamily('CorpusFileFont-Bold'))[0].descriptors).toEqual({});
  expect(query).not.toHaveBeenCalled();expect(r.fileFontNames()).toEqual(['Corpus File Font']);
});
it('failed replacements and invalid selections preserve existing working faces',async()=>{
  const r=await registry();await r.loadFontFile(file('Regular'));const before=r.fileFontFamily('Corpus File Font'),version=r.fileFontVersion();
  const changed=data('Regular');new Uint8Array(changed)[changed.byteLength-1]^=1;
  vi.stubGlobal('FontFace',class {async load(){throw Error('Invalid outlines');}});
  await expect(r.loadFontFile({size:changed.byteLength,arrayBuffer:async()=>changed})).rejects.toThrow('could not be loaded');
  await expect(r.loadFontFile({size:33*1024*1024})).rejects.toThrow('32 MB');
  expect(r.fileFontFamily('Corpus File Font')).toBe(before);expect(r.fileFontVersion()).toBe(version);
});
