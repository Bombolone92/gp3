import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { overflowFont } from './helpers/overflow-kern.js';
import { readFontMetadata } from '../src/engine/font-metadata.js';
const state = vi.hoisted(() => ({ version: 0, local: [], synthetic: false }));
vi.mock('../src/engine/local-fonts.js', () => ({ localFontVersion: () => state.version, localFamilyFontData: async () => state.local, prepareAuthorizedLocalFonts: async () => {} }));
vi.mock('../src/engine/synthetic-bold.js', () => ({ usesSyntheticAdvance: () => state.synthetic }));
const bytes = file => new Uint8Array(readFileSync('public/fonts/' + file)).buffer;
const sources = [{ source: 'url("https://documents.test/fonts/BebasNeue-Regular.ttf")' }];
let api, registered, loaded;
beforeEach(async () => {
  vi.resetModules(); state.version = 0; state.local = []; state.synthetic = false; registered = new Set(); loaded = [];
  vi.stubGlobal('document', { baseURI: 'https://documents.test/playground.html', fonts: { add: face => registered.add(face), delete: face => registered.delete(face) } });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes('BebasNeue-Regular.ttf') })));
  vi.stubGlobal('FontFace', class { constructor(family, data, descriptors) { Object.assign(this, { family, data, descriptors }); } async load() { loaded.push(this); return this; } });
  api = await import('../src/engine/gpos-only-kerning.js');
});
afterEach(() => vi.unstubAllGlobals());
it('prepares once concurrently and selects only legacy runs requesting kerning', async () => {
  await Promise.all([api.prepareLegacyGpos('Bebas Neue', sources), api.prepareLegacyGpos('BEBAS NEUE', sources)]);
  expect(fetch).toHaveBeenCalledTimes(1); expect(registered.size).toBe(1);
  const style = { fontFamily: 'Bebas Neue', kerning: 1, legacyKerning: true };
  expect(api.legacyGposFamily(style)).toBe(loaded[0].family);
  expect(api.legacyGposFamily({ ...style, legacyKerning: false })).toBeUndefined();
  expect(api.legacyGposFamily({ ...style, kerning: 0 })).toBeUndefined();
  expect(api.legacyGposFamily({ ...style, fontFamily: 'Unknown' })).toBeUndefined();
});
it('keeps styles and synthetic advance faces separate', async () => {
  state.synthetic = true;
  await api.prepareLegacyGpos('Bebas Neue', [...sources, { ...sources[0], descriptors: { style: 'italic' } }]);
  expect(registered.size).toBe(4);
  expect(loaded.map(face => face.descriptors)).toEqual([{}, { style: 'italic' }, { weight: '700', style: 'normal' }, { weight: '700', style: 'italic' }]);
  const style = { fontFamily: 'Bebas Neue', kerning: 1, legacyKerning: true };
  expect(api.legacyGposFamily(style, true)).not.toBe(api.legacyGposFamily(style));
});
it('does not register a partial family after a failed face', async () => {
  vi.stubGlobal('FontFace', class { constructor(family, data, descriptors) { this.descriptors = descriptors; } async load() { if (this.descriptors.style) throw Error('failed'); return this; } });
  await api.prepareLegacyGpos('Bebas Neue', [...sources, { ...sources[0], descriptors: { style: 'italic' } }]);
  expect(registered.size).toBe(0); expect(api.legacyGposFamily({ fontFamily: 'Bebas Neue', kerning: 1, legacyKerning: true })).toBeUndefined();
});
it('keeps an upright synthetic source available for browser oblique synthesis', async () => {
  state.synthetic = true;
  await api.prepareLegacyGpos('Bebas Neue', sources);
  expect(loaded.map(face => face.descriptors)).toEqual([{}, { weight: '700', style: 'normal' }]);
});
it('rejects external sources without fetching', async () => {
  await api.prepareLegacyGpos('Bebas Neue', [{ source: 'url("https://elsewhere.test/font.ttf")' }]);
  expect(fetch).not.toHaveBeenCalled(); expect(registered.size).toBe(0);
});
it('leaves variable families unchanged', async () => {
  fetch.mockResolvedValue({ ok: true, arrayBuffer: async () => bytes('OpenSans.ttf') });
  await api.prepareLegacyGpos('Open Sans', sources); expect(registered.size).toBe(0);
});
it('uses only authorized local data and refreshes after permission changes', async () => {
  const local = [{ source: 'local("Bebas Neue")' }];
  await api.prepareLegacyGpos('Bebas Neue', local); expect(registered.size).toBe(0); expect(fetch).not.toHaveBeenCalled();
  const { readFontMetadata } = await import('../src/engine/font-metadata.js'), buffer = bytes('BebasNeue-Regular.ttf');
  state.local = [{ buffer, metadata: readFontMetadata(buffer) }]; state.version++;
  await api.prepareLegacyGpos('Bebas Neue', local); expect(registered.size).toBe(1);
  state.version++; state.local = [];
  await api.prepareLegacyGpos('Bebas Neue', local); expect(registered.size).toBe(0);
});

it('repairs an overflowing legacy family once using already authorized source data',async()=>{
 const buffer=overflowFont(),before=buffer.slice(0);state.local=[{buffer,metadata:readFontMetadata(buffer)}];
 await Promise.all([api.prepareLegacyGpos('Original fixture',[]),api.prepareLegacyGpos('Original fixture',[])]);
 expect(registered.size).toBe(1);expect(fetch).not.toHaveBeenCalled();expect(loaded[0].data).not.toBe(buffer);
 expect(api.legacyGposFamily({fontFamily:'Original fixture',kerning:1,legacyKerning:true})).toBe(loaded[0].family);
 expect(api.legacyGposFamily({fontFamily:'Original fixture',kerning:0,legacyKerning:true})).toBeUndefined();
 expect(Buffer.from(buffer).equals(Buffer.from(before))).toBe(true);
});
it('prepares both overflowing and ordinary legacy pair tables',async()=>{
 state.local=[overflowFont(),overflowFont({count:10})].map(buffer=>({buffer,metadata:readFontMetadata(buffer)}));
 await api.prepareLegacyGpos('Original fixture',[]);expect(registered.size).toBe(2);
 expect(loaded.map(face=>readFontMetadata(face.data).glyphPositioning)).toEqual([false,true]);
});
it('keeps normal kerning faces when synthesis uses a named semibold source',async()=>{
  state.synthetic=true;
  const buffer=bytes('BebasNeue-Regular.ttf'),view=new DataView(buffer);
  for(let i=0;i<view.getUint16(4);i++){
    const at=12+i*16;
    if(view.getUint32(at)===0x4f532f32)view.setUint16(view.getUint32(at+8)+4,600);
  }
  const before=buffer.slice(0);
  fetch.mockResolvedValue({ok:true,arrayBuffer:async()=>buffer});
  const named=[{...sources[0],descriptors:{weight:'600'}},{...sources[0],descriptors:{weight:'600',style:'italic'}}];
  await api.prepareLegacyGpos('Named semibold',named);
  expect(registered.size).toBe(4);
  expect(loaded.map(face=>face.descriptors)).toEqual([{weight:'600'},{weight:'600',style:'italic'},
    {weight:'700',style:'normal'},{weight:'700',style:'italic'}]);
  const style={fontFamily:'Named semibold',legacyKerning:true,kerning:1};
  expect(api.legacyGposFamily(style)).toBe(loaded[0].family);
  expect(api.legacyGposFamily(style,true)).toBe(loaded[2].family);
  expect(readFontMetadata(loaded[0].data).weight).toBe(600);
  expect(new Uint8Array(loaded[2].data)).toEqual(new Uint8Array(loaded[0].data));
  expect(new Uint8Array(buffer)).toEqual(new Uint8Array(before));
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('retains the synthetic unit for a light face registered at its intrinsic weight',async()=>{
  state.synthetic=true;
  const buffer=bytes('BebasNeue-Regular.ttf'),view=new DataView(buffer);
  for(let i=0;i<view.getUint16(4);i++){
    const at=12+i*16;
    if(view.getUint32(at)===0x4f532f32)view.setUint16(view.getUint32(at+8)+4,300);
  }
  fetch.mockResolvedValue({ok:true,arrayBuffer:async()=>buffer});
  await api.prepareLegacyGpos('Named light',[{...sources[0],descriptors:{weight:'300'}}]);
  expect(registered.size).toBe(2);
  const advance=buffer=>{
    const v=new DataView(buffer);
    for(let i=0;i<v.getUint16(4);i++){const at=12+i*16;if(v.getUint32(at)===0x686d7478)return v.getUint16(v.getUint32(at+8));}
  };
  expect(advance(loaded[1].data)).toBe(advance(loaded[0].data)+1);
});
it('does not register a partial family when a legacy table has unsupported coverage',async()=>{
 const bad=overflowFont({count:10}),v=new DataView(bad);
 for(let i=0;i<v.getUint16(4);i++){const p=12+16*i;if(v.getUint32(p)===0x6b65726e)v.setUint16(v.getUint32(p+8)+8,9);}
 state.local=[overflowFont(),bad].map(buffer=>({buffer,metadata:readFontMetadata(buffer)}));
 await api.prepareLegacyGpos('Original fixture',[]);expect(registered.size).toBe(0);
});
it('keeps the requested width when local enumeration also contains condensed siblings',async()=>{
 const face=(fullName,weight,width)=>{
  const buffer=overflowFont({count:10}),v=new DataView(buffer);
  for(let i=0;i<v.getUint16(4);i++){const at=12+i*16;if(v.getUint32(at)===0x4f532f32){const start=v.getUint32(at+8);v.setUint16(start+4,weight);v.setUint16(start+6,width);}}
  return {fullName,buffer,metadata:readFontMetadata(buffer)};
 };
 state.local=[face('Fixture Condensed',400,3),face('Fixture',400,5),face('Fixture Condensed Bold',700,3),face('Fixture Bold',700,5)];
 await api.prepareLegacyGpos('Fixture',[]);expect(registered.size).toBe(2);
 expect(loaded.map(face=>readFontMetadata(face.data).widthClass)).toEqual([5,5]);
 expect(loaded.map(face=>face.descriptors.weight)).toEqual(['400','700']);
});
it('fails atomically when the requested synthetic advance cannot be prepared',async()=>{
 const buffer=overflowFont();state.local=[{buffer,metadata:readFontMetadata(buffer)}];state.synthetic=true;
 await api.prepareLegacyGpos('Original fixture',[]);expect(registered.size).toBe(0);
 const style={fontFamily:'Original fixture',kerning:1,legacyKerning:true};expect(api.legacyGposFamily(style,true)).toBeUndefined();expect(api.legacyGposFamily(style)).toBeUndefined();
});

it('prepares ordinary faces without registering them and waits for synthetic decisions', async () => {
  const prepared = api.prefetchLegacyGpos('Bebas Neue', sources);
  await prepared.promise;
  expect(fetch).toHaveBeenCalledTimes(1); expect(loaded).toHaveLength(1);
  expect(registered.size).toBe(0);
  const style = { fontFamily: 'Bebas Neue', kerning: 1, legacyKerning: true };
  expect(api.legacyGposFamily(style)).toBeUndefined();
  state.synthetic = true;
  await api.prepareLegacyGpos('BEBAS NEUE', sources, prepared);
  expect(fetch).toHaveBeenCalledTimes(1); expect(registered.size).toBe(2);
  expect(api.legacyGposFamily(style, true)).not.toBe(api.legacyGposFamily(style));
  expect(api.prefetchLegacyGpos('Bebas Neue', sources)).toBeUndefined();
});

it('discards prefetched source data when face descriptors change', async () => {
  const prepared = api.prefetchLegacyGpos('Bebas Neue', sources);
  await prepared.promise;
  await api.prepareLegacyGpos('Bebas Neue', [{ ...sources[0], descriptors: { style: 'italic' } }], prepared);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect([...registered].map(face => face.descriptors)).toEqual([{ style: 'italic' }]);
});

it('does not reuse a local-source token for another family', async () => {
  const buffer = overflowFont({ count: 10 });
  state.local = [{ buffer, metadata: readFontMetadata(buffer) }];
  const prepared = api.prefetchLegacyGpos('First family', []);
  await prepared.promise;
  const oldFace = loaded[0];
  await api.prepareLegacyGpos('Second family', [], prepared);
  expect(loaded).toHaveLength(2); expect(registered.has(oldFace)).toBe(false);
});

it('rereads a prefetched family after the local font catalog changes', async () => {
  const prepared = api.prefetchLegacyGpos('Bebas Neue', sources);
  await prepared.promise;
  const oldFace = loaded[0]; state.version++;
  await api.prepareLegacyGpos('Bebas Neue', sources, prepared);
  expect(fetch).toHaveBeenCalledTimes(2); expect(registered.size).toBe(1);
  expect(registered.has(oldFace)).toBe(false);
});

it('contains an early source failure without publishing a partial family', async () => {
  fetch.mockRejectedValueOnce(new Error('Unavailable face'));
  const prepared = api.prefetchLegacyGpos('Bebas Neue', sources);
  await expect(prepared.promise).resolves.toBeNull();
  await api.prepareLegacyGpos('Bebas Neue', sources, prepared);
  expect(registered.size).toBe(0); expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not register stale synthetic faces and allows the next load to retry', async () => {
  let release;
  state.synthetic = true;
  vi.stubGlobal('FontFace', class {
    constructor(family, data, descriptors) { Object.assign(this, { family, data, descriptors }); }
    async load() {
      loaded.push(this);
      if (this.descriptors.weight === '700') await new Promise(resolve => { release = resolve; });
      return this;
    }
  });
  const pending = api.prepareLegacyGpos('Bebas Neue', sources);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  state.version++; state.synthetic = false; release(); await pending;
  expect(registered.size).toBe(0);
  const style = { fontFamily: 'Bebas Neue', kerning: 1, legacyKerning: true };
  expect(api.legacyGposFamily(style)).toBeUndefined();
  await api.prepareLegacyGpos('Bebas Neue', sources);
  expect(registered.size).toBe(1); expect(api.legacyGposFamily(style)).toBeDefined();
});


it('recovers overflowing modern legacy requests without enabling OpenType pairs',async()=>{
 const buffer=overflowFont(),before=buffer.slice(0);state.local=[{buffer,metadata:readFontMetadata(buffer)}];
 const token=api.prefetchLegacyGpos('Original fixture',[],true);await token.promise;
 await Promise.all([api.prepareLegacyGpos('Original fixture',[],token,true),api.prepareLegacyGpos('Original fixture',[],undefined,true)]);
 expect(loaded).toHaveLength(1);expect(registered.size).toBe(1);expect(loaded[0].data).not.toBe(buffer);
 const tracked={fontFamily:'Original fixture',kerning:1,legacyKerning:false,ligatures:'standard',characterSpacing:.5};
 expect(api.legacyGposFamily(tracked)).toBe(loaded[0].family);
 expect(api.legacyGposFamily({...tracked,characterSpacing:0})).toBeUndefined();
 expect(api.legacyGposFamily({...tracked,ligatures:'none',characterSpacing:0})).toBe(loaded[0].family);
 expect(api.legacyGposFamily({...tracked,kerning:0})).toBeUndefined();
 expect(api.legacyGposFamily({...tracked,legacyKerning:true})).toBeUndefined();
 expect(new Uint8Array(buffer)).toEqual(new Uint8Array(before));
 state.version++;expect(api.legacyGposFamily(tracked)).toBeUndefined();
});
it('leaves valid legacy and GPOS fonts unchanged in modern recovery',async()=>{
 const buffer=overflowFont({count:10});state.local=[{buffer,metadata:readFontMetadata(buffer)}];
 await api.prepareLegacyGpos('Valid',[],undefined,true);expect(loaded).toHaveLength(0);expect(registered.size).toBe(0);
 await api.prepareLegacyGpos('Bebas Neue',sources,undefined,true);expect(loaded).toHaveLength(0);
 await api.prepareLegacyGpos('Bebas Neue',sources);expect(loaded).toHaveLength(1);
 expect(api.legacyGposFamily({fontFamily:'Bebas Neue',kerning:1,ligatures:'none'})).toBeUndefined();
});
it('retains valid sibling bytes when a modern family contains an overflowing face',async()=>{
 const overflow=overflowFont(),valid=overflowFont({count:10});
 state.local=[overflow,valid].map(buffer=>({buffer,metadata:readFontMetadata(buffer)}));
 await api.prepareLegacyGpos('Mixed fixture',[],undefined,true);
 expect(loaded).toHaveLength(2);expect(loaded[1].data).toBe(valid);expect(readFontMetadata(loaded[1].data).glyphPositioning).toBe(false);
});
it('never shares prefetched transformations across modern and legacy policies',async()=>{
 const token=api.prefetchLegacyGpos('Bebas Neue',sources);await token.promise;
 await api.prepareLegacyGpos('Bebas Neue',sources,token,true);
 expect(fetch).toHaveBeenCalledTimes(2);expect(registered.size).toBe(0);
 await api.prepareLegacyGpos('Bebas Neue',sources,token);expect(fetch).toHaveBeenCalledTimes(2);expect(registered.size).toBe(1);
});
