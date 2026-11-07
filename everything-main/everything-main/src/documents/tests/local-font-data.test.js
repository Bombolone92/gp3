import {it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
const data=readFileSync('public/fonts/Karla-Regular.ttf');
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
it('uses the same local face bytes for metadata and rendering',async()=>{
 let reads=0;
 const face={family:'Karla',fullName:'Karla Regular',postscriptName:'Karla-Regular',blob:async()=>{reads++;return new Blob([data]);}};
 vi.stubGlobal('window',{queryLocalFonts:async()=>[face]});
 vi.stubGlobal('navigator',{permissions:{query:async()=>({state:'granted'})}});
 const fonts=await import('../src/engine/local-fonts.js');
 await fonts.prepareAuthorizedLocalFonts();const version=fonts.localFontVersion();
 const [source]=await fonts.localFamilyFontData('Karla');
 expect(reads).toBe(1);expect(source.metadata.weight).toBe(400);expect(new Uint8Array(source.buffer)).toEqual(new Uint8Array(data));
 expect(await fonts.localFamilyMetadata('Karla')).toEqual([source.metadata]);expect(reads).toBe(1);
 await fonts.browseLocalFonts();expect(fonts.localFontVersion()).toBeGreaterThan(version);
 await fonts.localFamilyFontData('Karla Regular');expect(reads).toBe(2);
});
it('does not enumerate local faces or prompt without existing permission',async()=>{
 const queryLocalFonts=vi.fn();vi.stubGlobal('window',{queryLocalFonts});
 vi.stubGlobal('navigator',{permissions:{query:async()=>({state:'prompt'})}});
 const fonts=await import('../src/engine/local-fonts.js');await fonts.prepareAuthorizedLocalFonts();
 expect(await fonts.localFamilyFontData('Karla')).toEqual([]);expect(queryLocalFonts).not.toHaveBeenCalled();
});
