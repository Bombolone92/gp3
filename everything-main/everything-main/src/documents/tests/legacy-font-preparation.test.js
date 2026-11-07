import { it, expect, vi, afterEach } from 'vitest';
import { loadCanvasFonts } from '../src/engine/canvas-text.js';

const state = vi.hoisted(() => ({ sources: null, probes: null, prefetched: [], prepared: new Set(), activated: [], modes: [] }));
vi.mock('../src/engine/font-availability.js', async original => ({
  ...await original(),
  checkFontAvailability: async () => {},
  fontAvailable: () => true,
  canvasFontSources: name => [{ source: `local("${name}")` }],
  embeddedFontCandidates: async () => new Set(),
  prepareCanvasFont: async name => { await state.probes.promise; state.prepared.add(name.toLowerCase()); },
  displayedFont: style => style.fontFamily,
}));
vi.mock('../src/engine/gpos-only-kerning.js', () => ({
  legacyGposFamily: () => undefined,
  prefetchLegacyGpos: (name,sources,recoveryOnly) => {
    state.modes.push({name,recoveryOnly});
    state.prefetched.push(name.toLowerCase());
    return { name, promise: state.sources.promise };
  },
  prepareLegacyGpos: async (name, sources, prefetched) => {
    expect(state.prepared.has(name.toLowerCase())).toBe(true);
    expect(prefetched.name.toLowerCase()).toBe(name.toLowerCase());
    state.activated.push(name);
  },
}));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
afterEach(() => vi.unstubAllGlobals());

it('bounds early preparation, deduplicates family names and waits for face-selection probes before activation', async () => {
  const fallback = deferred(); state.sources = deferred(); state.probes = deferred();
  state.prefetched = []; state.prepared = new Set(); state.activated = [];
  vi.stubGlobal('document', { fonts: { load: () => fallback.promise, check: () => true } });
  const names = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'ONE'];
  const pending = loadCanvasFonts({
    paragraphs: [{ runs: names.map(fontFamily => ({ text: 'A WA', fontAscii: fontFamily, kerning: 1 })) }],
    styles: {},
  });
  await vi.waitFor(() => expect(state.prefetched).toHaveLength(4));
  expect(state.prepared.size).toBe(0); expect(state.activated).toEqual([]);
  // The first four source jobs must finish before the next families start.
  state.sources.resolve();
  await vi.waitFor(() => expect(state.prefetched).toHaveLength(6));
  expect(new Set(state.prefetched).size).toBe(6);
  fallback.resolve();
  await Promise.resolve();
  expect(state.activated).toEqual([]);
  state.probes.resolve(); await pending;
  expect(new Set(state.activated.map(name => name.toLowerCase())).size).toBe(6);
});


it('queues modern legacy recovery only for runs that retain legacy pairs',async()=>{
 state.sources=deferred();state.sources.resolve();state.probes=deferred();state.probes.resolve();
 state.prefetched=[];state.prepared=new Set();state.activated=[];state.modes=[];
 vi.stubGlobal('document',{fonts:{load:async()=>[],check:()=>true}});
 await loadCanvasFonts({paragraphs:[{runs:[
  {text:'Tracked',fontAscii:'Tracked',kerning:1,ligatures:'standard',characterSpacing:.5},
  {text:'No ligatures',fontAscii:'No ligatures',kerning:1,ligatures:'none'},
  {text:'Unkerned',fontAscii:'Unkerned',kerning:0,ligatures:'none'},
  {text:'OpenType',fontAscii:'OpenType',kerning:1,ligatures:'standard'},
 ]}],styles:{openTypeFeatures:true}});
 expect(state.modes.map(item=>item.name).sort()).toEqual(['No ligatures','Tracked']);
 expect(state.modes.every(item=>item.recoveryOnly===true)).toBe(true);
 expect(state.activated.sort()).toEqual(['No ligatures','Tracked']);
});
