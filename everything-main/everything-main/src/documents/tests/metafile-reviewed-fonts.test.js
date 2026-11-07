import {it,expect,vi,afterEach} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
const registry=vi.hoisted(()=>({sources:new Map(),calls:[]}));
vi.mock('../src/engine/font-availability.js',()=>({checkFontAvailability:async name=>registry.calls.push(name),canvasFontSources:name=>registry.sources.get(name)||[]}));
afterEach(()=>{vi.unstubAllGlobals();registry.sources.clear();registry.calls.length=0;});
async function setup(installed=[]){
 vi.resetModules();const dom=new JSDOM('',{url:'http://localhost/playground.html'});
 vi.stubGlobal('document',dom.window.document);vi.stubGlobal('DOMParser',dom.window.DOMParser);vi.stubGlobal('XMLSerializer',dom.window.XMLSerializer);
 vi.stubGlobal('FontFace',class{constructor(name,source){this.source=source;}async load(){if(!installed.some(n=>this.source===`local("${n}")`))throw Error('Missing');return this;}});
 return{dom,...await import('../src/engine/metafile-reviewed-fonts.js')};
}
const svg='<svg xmlns="http://www.w3.org/2000/svg"><text font-family="&quot;Reviewed&quot;" x="12" font-weight="700"><tspan x="42" y="51">Original</tspan></text></svg>';
it('embeds complete reviewed styles, deduplicates bytes and preserves explicit glyph placement',async()=>{
 const s=await setup();try{
  registry.sources.set('Reviewed',[{source:'url("http://localhost/fonts/regular.ttf")'},{source:'url("http://localhost/fonts/bold.ttf")',descriptors:{weight:'700'}}]);
  const fetcher=vi.fn(async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([0,1,2,3]).buffer}));vi.stubGlobal('fetch',fetcher);
  const [a,b]=await Promise.all([s.prepareMetafileFonts(svg,[['Reviewed']]),s.prepareMetafileFonts(svg,[['Reviewed'],['Reviewed']])]);
  expect(a).toEqual(b);expect(a.missing).toEqual([]);expect(fetcher).toHaveBeenCalledTimes(2);
  const before=new s.dom.window.DOMParser().parseFromString(svg,'application/xml'),after=new s.dom.window.DOMParser().parseFromString(a.svg,'application/xml');
  expect(after.querySelector('style').textContent.match(/@font-face/g)).toHaveLength(2);
  expect(after.querySelector('style').textContent).toContain('font-weight:700');
  expect(after.querySelector('tspan').outerHTML).toBe(before.querySelector('tspan').outerHTML);
  for(const attr of before.querySelector('text').attributes)if(attr.name!=='font-family')expect(after.querySelector('text').getAttribute(attr.name)).toBe(attr.value);
 }finally{s.dom.window.close();}
});
it('keeps installed family alternatives and vector-only images unchanged without downloading',async()=>{
 const s=await setup(['Reviewed']);try{vi.stubGlobal('fetch',vi.fn());expect(await s.prepareMetafileFonts(svg,[['Reviewed Bold','Reviewed']])).toEqual({svg,missing:[]});expect(await s.prepareMetafileFonts(svg,[])).toEqual({svg,missing:[]});expect(registry.calls).toEqual([]);expect(fetch).not.toHaveBeenCalled();}finally{s.dom.window.close();}
});
it.each(['http://other/fonts/a.ttf','blob:http://localhost/abc'])('does not bridge unreviewed origin or blob source %s',async url=>{
 const s=await setup();try{registry.sources.set('Reviewed',[{source:`url("${url}")`}]);vi.stubGlobal('fetch',vi.fn());expect(await s.prepareMetafileFonts(svg,[['Reviewed']])).toEqual({svg,missing:['Reviewed']});expect(fetch).not.toHaveBeenCalled();}finally{s.dom.window.close();}
});
it('retains a warning after an incomplete family fetch and permits a later retry',async()=>{
 const s=await setup();try{
  registry.sources.set('Reviewed',[{source:'url("http://localhost/fonts/regular.ttf")'},{source:'url("http://localhost/fonts/italic.ttf")',descriptors:{style:'italic'}}]);
  let fail=true;const fetcher=vi.fn(async url=>({ok:!fail||!url.includes('italic'),arrayBuffer:async()=>new Uint8Array([1,2]).buffer}));vi.stubGlobal('fetch',fetcher);
  expect(await s.prepareMetafileFonts(svg,[['Reviewed']])).toEqual({svg,missing:['Reviewed']});fail=false;
  expect((await s.prepareMetafileFonts(svg,[['Reviewed']])).missing).toEqual([]);expect(fetcher).toHaveBeenCalledTimes(3);
 }finally{s.dom.window.close();}
});
it('uses Windows ascent and native one-third italic shear around explicit glyph origins',async()=>{
 const s=await setup();try{
  const {metafileFileFonts}=await import('../src/engine/metafile-file-fonts.js');
  const bytes=readFileSync('public/fonts/Karla-Regular.ttf'),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  const source='<svg xmlns="http://www.w3.org/2000/svg"><text font-family="&quot;Reviewed&quot;" font-size="40" font-style="italic" font-weight="400" dominant-baseline="text-before-edge" transform="matrix(1 0 0 1 0 0)"><tspan x="10" y="20">A</tspan><tspan x="40" y="20">B</tspan></text></svg>';
  const result=metafileFileFonts(source,[['Reviewed']],new Map([['Reviewed',{alias:'Managed',faces:[{buffer,descriptors:{}}]}]]));
  const doc=new s.dom.window.DOMParser().parseFromString(result,'application/xml'),glyphs=[...doc.querySelectorAll('text')];
  expect(glyphs).toHaveLength(2);expect(glyphs.map(g=>g.textContent)).toEqual(['A','B']);expect(glyphs.map(g=>g.getAttribute('x'))).toEqual(['10','40']);
  for(const g of glyphs){expect(g.getAttribute('y')).toBe('61.24');expect(g.getAttribute('font-style')).toBe('normal');expect(g.getAttribute('dominant-baseline')).toBe('alphabetic');expect(g.getAttribute('transform')).toContain('matrix(1 0 -0.3333333333333333 1 0 0)');}
 }finally{s.dom.window.close();}
});
