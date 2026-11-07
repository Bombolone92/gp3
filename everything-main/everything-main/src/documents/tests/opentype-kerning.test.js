import {it,expect,vi,afterEach} from 'vitest';
import {legacyOnlyFamily,requestsOpenTypeKerning,selectKerningSources} from '../src/engine/opentype-kerning.js';
import {readFontMetadata} from '../src/engine/font-metadata.js';
import {metadataFont} from './helpers/sfnt-metadata.js';
import {withoutLegacyKerning} from '../src/engine/legacy-kerning-font.js';

afterEach(()=>vi.unstubAllGlobals());
const legacy=()=>readFontMetadata(metadataFont({legacyKerning:true}));
it('requires consistent legacy-only metadata across the selectable family',()=>{
 expect(legacyOnlyFamily([legacy(),legacy()])).toBe(true);
 for(const faces of [[],[null],[legacy(),null],[legacy(),readFontMetadata(metadataFont())],[legacy(),readFontMetadata(metadataFont({legacyKerning:true,glyphPositioning:true}))],[readFontMetadata(metadataFont({legacyKerning:true,variable:true}))]])expect(legacyOnlyFamily(faces)).toBe(false);
});
it('keeps condensed siblings from replacing the requested family width',()=>{
 const face=(fullName,weight,widthClass,italic=false)=>({fullName,metadata:{weight,widthClass,italic}});
 const regular=face('Fixture',400,6),bold=face('Fixture Bold',700,6),italic=face('Fixture Italic',400,5,true),condensed=face('Fixture Condensed',400,3);
 expect(selectKerningSources([regular,bold,italic,condensed],'Fixture')).toEqual([regular,bold,italic]);
 expect(selectKerningSources([condensed],'Fixture Condensed')).toEqual([condensed]);
});
it('does not request an OpenType policy for ordinary or disabled kerning',()=>{
 expect(requestsOpenTypeKerning({ligatures:'standardContextual',kerning:1})).toBe(true);
 for(const style of [{},{ligatures:'none',kerning:1},{ligatures:'standard',kerning:0},{kerning:1},{ligatures:'standard',kerning:1,characterSpacing:.3},{ligatures:'standard',kerning:1,characterSpacing:-.3}])expect(requestsOpenTypeKerning(style)).toBe(false);
});
async function environment(state='granted') {
 vi.resetModules();const blobs=[vi.fn(async()=>new Blob([metadataFont({legacyKerning:true})])),vi.fn(async()=>new Blob([metadataFont({legacyKerning:true,bold:true,weight:700})])),vi.fn(async()=>new Blob([metadataFont({glyphPositioning:true})]))];
 const query=vi.fn(async()=>[
  {family:'Fixture',fullName:'Fixture Regular',postscriptName:'Fixture-Regular',blob:blobs[0]},
  {family:'Fixture',fullName:'Fixture Bold',postscriptName:'Fixture-Bold',blob:blobs[1]},
  {family:'Other',fullName:'Other Regular',postscriptName:'Other-Regular',blob:blobs[2]},
 ]);
 vi.stubGlobal('window',{queryLocalFonts:query});vi.stubGlobal('navigator',{permissions:{query:vi.fn(async()=>({state}))}});
 vi.stubGlobal('document',{fonts:new Set()});vi.stubGlobal('FontFace',class {constructor(family,data,descriptors){this.family=family;this.data=data;this.descriptors=descriptors;}async load(){return this;}});
 return {...await import('../src/engine/opentype-kerning.js'),local:await import('../src/engine/local-fonts.js'),blobs,query};
}
it('prepares just the requested family once and records the initial catalogue version',async()=>{
 const e=await environment();await e.prepareOpenTypeKerning('Fixture');await e.prepareOpenTypeKerning(' Fixture ');
 const style={fontFamily:'Fixture',kerning:1,ligatures:'standardContextual'};
 expect(e.openTypeKerningFamily(style)).toMatch(/^Canvas OpenType kerning /);expect(e.openTypeKerningFamily({...style,ligatures:'none'})).toBeUndefined();
 expect(e.blobs[0]).toHaveBeenCalledTimes(2);expect(e.blobs[1]).toHaveBeenCalledTimes(2);expect(e.blobs[2]).not.toHaveBeenCalled();
 expect(document.fonts.size).toBe(2);
 await e.local.browseLocalFonts();expect(e.openTypeKerningFamily(style)).toBeUndefined();
 await e.prepareOpenTypeKerning('Fixture');expect(e.openTypeKerningFamily(style)).toMatch(/^Canvas OpenType kerning /);expect(document.fonts.size).toBe(2);
});
it.each(['denied','prompt'])('retains current behavior without enumerating when access is %s',async state=>{
 const e=await environment(state);await e.prepareOpenTypeKerning('Fixture');
 expect(e.openTypeKerningFamily({fontFamily:'Fixture',kerning:1,ligatures:'standard'})).toBeUndefined();
 expect(e.query).not.toHaveBeenCalled();e.blobs.forEach(blob=>expect(blob).not.toHaveBeenCalled());
});
it('removes only legacy kerning, rebuilding checksums without changing source metadata',()=>{
 const source=metadataFont({legacyKerning:true}),copy=source.slice(0),derived=withoutLegacyKerning(source);
 expect(source).toEqual(copy);expect(readFontMetadata(derived)).toEqual({...readFontMetadata(source),legacyKerning:false});
 const view=new DataView(derived);let sum=0;for(let i=0;i<derived.byteLength;i+=4)sum=(sum+view.getUint32(i))>>>0;expect(sum).toBe(0xb1b0afba);
 for(const options of [{},{legacyKerning:true,glyphPositioning:true},{legacyKerning:true,variable:true}])expect(withoutLegacyKerning(metadataFont(options))).toBeNull();
 expect(withoutLegacyKerning(new ArrayBuffer(0))).toBeNull();
});
it('normalizes non-Macintosh cmap language metadata without changing glyph mappings',()=>{
 const table=(b,tag)=>{const v=new DataView(b);for(let i=0;i<v.getUint16(4);i++){const p=12+i*16;if(String.fromCharCode(...new Uint8Array(b,p,4))===tag)return new Uint8Array(b,v.getUint32(p+8),v.getUint32(p+12));}};
 for(const platform of [0,1,3]){
  const source=metadataFont({legacyKerning:true,cmapLanguage:1,cmapPlatform:platform}),copy=source.slice(0),derived=withoutLegacyKerning(source);
  const expected=table(source,'cmap').slice();if(platform!==1)new DataView(expected.buffer).setUint16(16,0);
  expect(table(derived,'cmap')).toEqual(expected);expect(source).toEqual(copy);
 }
 const malformed=metadataFont({legacyKerning:true,cmapLanguage:1});new DataView(table(malformed,'cmap').buffer,table(malformed,'cmap').byteOffset).setUint32(8,0);
 expect(withoutLegacyKerning(malformed)).toBeNull();
});
