import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
vi.mock('../src/engine/local-fonts.js',()=>({localSourceFontData:async()=>null}));
let api,registered,loaded;
const bytes=name=>{const b=readFileSync('public/fonts/'+name);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
beforeEach(async()=>{
  vi.resetModules();registered=[];loaded=[];
  vi.stubGlobal('document',{baseURI:'https://documents.test/playground.html',fonts:{add:face=>registered.push(face)}});
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,arrayBuffer:async()=>bytes('OpenSans-Light.ttf')})));
  vi.stubGlobal('FontFace',class{constructor(family,data,descriptors){Object.assign(this,{family,data,descriptors});}async load(){loaded.push(this);return this;}});
  api=await import('../src/engine/synthetic-advance.js');
});
afterEach(()=>vi.unstubAllGlobals());
it('prepares an intrinsic-light source once and keeps source advances intact',async()=>{
  const original=bytes('OpenSans-Light.ttf'),before=original.slice(0);
  fetch.mockResolvedValue({ok:true,arrayBuffer:async()=>original});
  const sources=[{source:'url("https://documents.test/light.ttf")',descriptors:{weight:'300'}}];
  await api.prepareSyntheticAdvance('Light',sources,()=>true);
  expect(registered).toHaveLength(1);expect(fetch).toHaveBeenCalledTimes(1);
  expect(loaded[0].descriptors.weight).toBe('700');expect(loaded[0].data).not.toBe(original);
  expect(new Uint8Array(original)).toEqual(new Uint8Array(before));
  expect(api.syntheticAdvanceFamily('Light',true)).toBe(api.syntheticAdvanceFamily('Light',false));
  await api.prepareSyntheticAdvance('Light',sources,()=>true);expect(fetch).toHaveBeenCalledTimes(1);
  await api.prepareSyntheticAdvance('Light',sources,()=>false);expect(api.syntheticAdvanceFamily('Light',false)).toBeUndefined();
});
it('does not add synthetic units to semibold or unknown light registrations',async()=>{
  await api.prepareSyntheticAdvance('Semibold',[{source:'url("https://documents.test/semibold.ttf")',descriptors:{weight:'600'}}],()=>true);
  expect(fetch).not.toHaveBeenCalled();expect(registered).toEqual([]);
  fetch.mockResolvedValue({ok:true,arrayBuffer:async()=>bytes('OpenSans-SemiBold.ttf')});
  await api.prepareSyntheticAdvance('Unknown',[{source:'url("https://documents.test/unknown.ttf")',descriptors:{weight:'300'}}],()=>true);
  expect(registered).toEqual([]);expect(api.syntheticAdvanceFamily('Unknown',false)).toBeUndefined();
});
