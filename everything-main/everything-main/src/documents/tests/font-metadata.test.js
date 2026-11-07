import {it,expect,vi,afterEach} from 'vitest';
import {readFontMetadata} from '../src/engine/font-metadata.js';
import {metadataFont} from './helpers/sfnt-metadata.js';
afterEach(()=>vi.unstubAllGlobals());
it('reads normal, heavy and bold metadata independently of the font name',()=>{
 expect(readFontMetadata(metadataFont())).toEqual({unitsPerEm:2048,weight:400,widthClass:5,bold:false,italic:false,variable:false,legacyKerning:false,glyphPositioning:false});
 expect(readFontMetadata(metadataFont({weight:900,unitsPerEm:1000}))).toMatchObject({unitsPerEm:1000,weight:900,bold:false});
 expect(readFontMetadata(metadataFont({weight:700,bold:true}))).toMatchObject({weight:700,bold:true});
 expect(readFontMetadata(metadataFont({variable:true})).variable).toBe(true);
});
it('rejects malformed, duplicate, truncated and unsupported font tables',()=>{
 for(const mutate of [v=>v.setUint32(0,0x74746366),v=>v.setUint16(4,65535),v=>v.setUint32(20,0xfffffff0),v=>v.setUint32(24,0xfffffff0),v=>v.setUint32(28,0x68656164),v=>v.setUint32(44+12,0),v=>v.setUint16(44+18,0),v=>v.setUint16(100+4,1001)]){
  const b=metadataFont();mutate(new DataView(b));expect(readFontMetadata(b)).toBeNull();
 }
 expect(readFontMetadata(new ArrayBuffer(11))).toBeNull();expect(readFontMetadata(metadataFont().slice(0,140))).toBeNull();
});
async function environment(state='granted') {
 vi.resetModules();const blob=vi.fn(async()=>new Blob([metadataFont()]));
 const query=vi.fn(async()=>[{family:'Fixture Family',fullName:'Fixture Regular',postscriptName:'Fixture-Regular',blob}]);
 vi.stubGlobal('window',{queryLocalFonts:query});vi.stubGlobal('navigator',{permissions:{query:vi.fn(async()=>({state}))}});
 return {...await import('../src/engine/local-fonts.js'),query,blob};
}
it.each(['prompt','denied'])('does not enumerate or read font data when permission is %s',async state=>{
 const env=await environment(state);expect(await env.localSourceMetadata('local("Fixture Regular")')).toBeNull();expect(env.query).not.toHaveBeenCalled();expect(env.blob).not.toHaveBeenCalled();
});
it('reads only exact full/PostScript faces and coalesces repeated metadata requests',async()=>{
 const env=await environment();
 expect(await env.localSourceMetadata('local("Fixture Family")')).toBeNull();expect(env.blob).not.toHaveBeenCalled();
 const results=await Promise.all([env.localSourceMetadata('local("Fixture Regular")'),env.localSourceMetadata('local("Fixture-Regular")')]);
 expect(results[0]).toEqual(results[1]);expect(results[0].weight).toBe(400);expect(env.query).toHaveBeenCalledTimes(1);expect(env.blob).toHaveBeenCalledTimes(1);
 expect(await env.localSourceMetadata('url("https://example.test/font.ttf")')).toBeNull();expect(env.query).toHaveBeenCalledTimes(1);
});
it('explicit browsing permits later metadata reads and invalidates preparation versions',async()=>{
 const env=await environment('prompt');await env.localSourceMetadata('local("Fixture Regular")');const before=env.localFontVersion();
 await env.browseLocalFonts();expect(env.localFontVersion()).toBeGreaterThan(before);expect(env.blob).not.toHaveBeenCalled();
 expect(await env.localSourceMetadata('local("Absent"), local("Fixture Regular")')).toMatchObject({weight:400});expect(env.blob).toHaveBeenCalledTimes(1);
});
it('unreadable local faces leave the ordinary renderer available',async()=>{
 const env=await environment();env.blob.mockRejectedValue(new Error('Access revoked'));
 expect(await env.localSourceMetadata('local("Fixture Regular")')).toBeNull();
});
it('retains native weight-boundary evidence independently of the browser classifier',async()=>{
 const {readFileSync}=await import('node:fs'),{createHash}=await import('node:crypto');
 const folder='tests/fixtures/synthetic-bold/',ref=JSON.parse(readFileSync(folder+'weights-reference.json'));
 expect(createHash('sha256').update(readFileSync(folder+'weights.docx')).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(folder+'weights-native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 expect(ref.cases.filter(c=>c.bold).map(c=>[c.weight,c.textRenderingMode])).toEqual([[600,0],[350,0],[400,2],[500,0]]);
});
