import { afterEach, it, expect, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function environment({ selectable = [], loadable = [], assets = [], failedAssets = [], baseURI = 'https://documents.test/playground.html' } = {}) {
  vi.resetModules();
  const fonts = new Set(), loaded = [], added = [];
  fonts.add = face => { added.push(face.family); return Set.prototype.add.call(fonts, face); };
  const sources = [];
  vi.stubGlobal('document', { baseURI, fonts, createElement: () => ({ getContext: () => ({
    font: '', measureText() { const native = [...selectable, ...added].some(name => this.font.includes(`"${name}"`)); return { width: native ? 101 : 100, fontBoundingBoxAscent: 12, fontBoundingBoxDescent: 3 }; },
  }) }) });
  vi.stubGlobal('FontFace', class {
    constructor(family, source, descriptors) { this.family = family; this.source = source; this.descriptors = descriptors; this.status = 'unloaded'; }
    async load() { loaded.push(this.family); sources.push(this.source); const available = this.source.startsWith('url(') ? assets.includes(this.family) : [...this.source.matchAll(/local\("([^"]+)"\)/g)].some(m => loadable.includes(m[1])); if (!available || failedAssets.some(file => this.source.includes(file))) throw new Error('not installed'); this.status = 'loaded'; return this; }
  });
  return { ...await import('../src/engine/font-availability.js'), fonts, loaded, added, sources };
}
it('registers a locally loadable face when its document name is not a selectable CSS family', async () => {
  const env = await environment({ loadable: ['Fixture Demi'] });
  await Promise.all([env.checkFontAvailability('Fixture Demi'), env.checkFontAvailability('Fixture Demi')]);
  expect(env.loaded).toEqual(['Fixture Demi']); expect(env.added).toEqual(['Fixture Demi']);
  expect(env.fontAvailable('Fixture Demi')).toBe(true);
  expect([...env.fonts][0].source).toBe('local("Fixture Demi")');
});
it('does not shadow an existing selectable family with a single regular face', async () => {
  const env = await environment({ selectable: ['Fixture Family'], loadable: ['Fixture Family'] });
  await env.checkFontAvailability('Fixture Family');
  expect(env.fontAvailable('Fixture Family')).toBe(true); expect(env.added).toEqual([]);
});
it('retains CSS-family detection when a family name is not a local full-face name', async () => {
  const env = await environment({ selectable: ['Fixture Family'] });
  await env.checkFontAvailability('Fixture Family');
  expect(env.fontAvailable('Fixture Family')).toBe(true); expect(env.added).toEqual([]);
});
it('leaves missing fonts unavailable and does not register a substitute under their names', async () => {
  const env = await environment(); await env.checkFontAvailability('Missing fixture');
  expect(env.fontAvailable('Missing fixture')).toBe(false); expect(env.added).toEqual([]);
  expect(env.displayedFont({ fontFamily: 'Missing fixture' })).toBe('Noto Sans');
});

it('loads the reviewed same-origin face once when its native family is unavailable', async () => {
  const env = await environment({ assets: ['Bebas Neue'] });
  await Promise.all([env.checkFontAvailability('Bebas Neue'), env.checkFontAvailability('bebas neue')]);
  expect(env.sources).toEqual(['local("Bebas Neue")', 'url("https://documents.test/fonts/BebasNeue-Regular.ttf")']);
  expect(env.fontAvailable('BEBAS NEUE')).toBe(true);
  expect(env.displayedFont({ fontFamily: 'Bebas Neue' })).toBe('Bebas Neue');
});
it('keeps installed reviewed families and ordinary missing families off the asset-loading path', async () => {
  const env = await environment({ selectable: ['Bebas Neue'] });
  await env.checkFontAvailability('Bebas Neue'); await env.checkFontAvailability('Private document font');
  expect(env.sources.every(s => s.startsWith('local('))).toBe(true);
  expect(env.added).toEqual([]);
});
it('falls back normally when the reviewed asset fails to load', async () => {
  const env = await environment(); await env.checkFontAvailability('Bebas Neue');
  expect(env.fontAvailable('Bebas Neue')).toBe(false);
  expect(env.displayedFont({ fontFamily: 'Bebas Neue' })).toBe('Noto Sans');
});
it('resolves reviewed font assets under a relative production base', async () => {
  vi.stubEnv('BASE_URL', './');
  const env = await environment({ assets: ['Bebas Neue'], baseURI: 'https://documents.test/apps/documents/playground.html' });
  await env.checkFontAvailability('Bebas Neue');
  expect(env.sources.at(-1)).toBe('url("https://documents.test/apps/documents/fonts/BebasNeue-Regular.ttf")');
});

it('registers reviewed variable weight and italic faces as one family', async () => {
  const env = await environment({ assets: ['Oswald', 'Open Sans'] });
  await Promise.all([env.checkFontAvailability('Oswald'), env.checkFontAvailability('Open Sans'), env.checkFontAvailability('OPEN SANS')]);
  expect([...env.fonts].map(f => [f.family, f.descriptors])).toEqual([
    ['Oswald', { weight: '200 700' }],
    ['Open Sans', { weight: '300 800', stretch: '75% 100%' }],
    ['Open Sans', { weight: '300 800', stretch: '75% 100%', style: 'italic' }],
  ]);
  expect(env.sources.filter(s => s.startsWith('url('))).toHaveLength(3);
});
it('does not register a partially loaded reviewed family', async () => {
  const env = await environment({ assets: ['Open Sans'], failedAssets: ['OpenSans-Italic.ttf'] });
  await env.checkFontAvailability('Open Sans');
  expect(env.added).toEqual([]); expect(env.fontAvailable('Open Sans')).toBe(false);
});
it('loads the reviewed Karla upright faces together without replacing installed families', async () => {
  const env = await environment({ assets: ['Karla'] });
  await Promise.all([env.checkFontAvailability('Karla'), env.checkFontAvailability('KARLA')]);
  expect([...env.fonts].map(face => face.descriptors)).toEqual([{}, { weight: '700' }]);
  expect(env.sources.filter(source => source.startsWith('url('))).toEqual([
    'url("https://documents.test/fonts/Karla-Regular.ttf")', 'url("https://documents.test/fonts/Karla-Bold.ttf")',
  ]);
  const installed = await environment({ selectable: ['Karla'], assets: ['Karla'] });
  await installed.checkFontAvailability('Karla');
  expect(installed.added).toEqual([]);
  expect(installed.sources).toEqual(['local("Karla")']);
});
it('does not expose a partial Karla family after a failed bold download', async () => {
  const env = await environment({ assets: ['Karla'], failedAssets: ['Karla-Bold.ttf'] });
  await env.checkFontAvailability('Karla');
  expect(env.fontAvailable('Karla')).toBe(false); expect(env.added).toEqual([]);
});
it('loads missing Source Sans Pro styles together and preserves the real bold face',async()=>{
 const env=await environment({assets:['Source Sans Pro']});
 await Promise.all([env.checkFontAvailability('Source Sans Pro'),env.checkFontAvailability('SOURCE SANS PRO')]);
 expect([...env.fonts].map(f=>f.descriptors)).toEqual([{}, {style:'italic'}, {weight:'700'}, {weight:'700',style:'italic'}]);
 expect(env.sources.filter(s=>s.startsWith('url('))).toHaveLength(4);
});
it('does not mistake a selectable sibling for the missing Source Sans Pro Black face',async()=>{
 const env=await environment({selectable:['Source Sans Pro Black'],assets:['Source Sans Pro Black']});
 await env.checkFontAvailability('Source Sans Pro Black');
 expect([...env.fonts].map(f=>f.descriptors)).toEqual([{}, {style:'italic'}]);
 expect(env.sources.filter(s=>s.startsWith('url(')).every(s=>s.includes('SourceSansPro-Black'))).toBe(true);
});
it.each(['Source Sans Pro','Source Sans Pro Black','Selawik Semibold','Open Sans Light','Open Sans SemiBold','Montserrat','Montserrat Light'])('keeps native %s without fetching reviewed assets',async name=>{
 const env=await environment({selectable:[name],loadable:[name],assets:[name]});
 await env.checkFontAvailability(name);expect(env.sources).toEqual([`local("${name}")`]);expect(env.added).toEqual([]);
});
it.each([['Open Sans Light','OpenSans-Light',undefined],['Open Sans SemiBold','OpenSans-SemiBold','600']])('loads the exact %s faces together with their declared weight',async(name,file,weight)=>{
 const env=await environment({selectable:[name],assets:[name]});
 await Promise.all([env.checkFontAvailability(name),env.checkFontAvailability(name.toUpperCase())]);
 expect(env.fontAvailable(name)).toBe(true);
 const descriptors=weight?{weight}:{};
 expect([...env.fonts].map(f=>f.descriptors)).toEqual([descriptors,{...descriptors,style:'italic'}]);
 expect(env.sources.filter(s=>s.startsWith('url('))).toEqual([`url("https://documents.test/fonts/${file}.ttf")`,`url("https://documents.test/fonts/${file}Italic.ttf")`]);
});
it.each([['Open Sans Light','OpenSans-LightItalic.ttf'],['Open Sans SemiBold','OpenSans-SemiBoldItalic.ttf']])('does not register a partial %s alias when italic fails',async(name,file)=>{
 const env=await environment({selectable:[name],assets:[name],failedAssets:[file]});
 await env.checkFontAvailability(name);expect(env.fontAvailable(name)).toBe(false);expect(env.added).toEqual([]);
});
it('loads the reviewed Selawik Semibold face instead of a selectable sibling',async()=>{
 const env=await environment({selectable:['Selawik Semibold'],assets:['Selawik Semibold']});
 await Promise.all([env.checkFontAvailability('Selawik Semibold'),env.checkFontAvailability('SELAWIK SEMIBOLD')]);
 expect(env.fontAvailable('Selawik Semibold')).toBe(true);
 expect([...env.fonts].map(f=>f.descriptors)).toEqual([{weight:'600'}]);
 expect(env.sources.filter(s=>s.startsWith('url('))).toEqual(['url("https://documents.test/fonts/Selawik-Semibold.ttf")']);
});
it('reports Selawik Semibold unavailable when its reviewed asset fails',async()=>{
 const env=await environment({selectable:['Selawik Semibold'],assets:['Selawik Semibold'],failedAssets:['Selawik-Semibold.ttf']});
 await env.checkFontAvailability('Selawik Semibold');expect(env.fontAvailable('Selawik Semibold')).toBe(false);expect(env.added).toEqual([]);
});
it.each([['Source Sans Pro','SourceSansPro-BoldIt.ttf'],['Source Sans Pro Black','SourceSansPro-BlackIt.ttf']])('does not expose a partial %s family',async(name,file)=>{
 const env=await environment({assets:[name],failedAssets:[file]});await env.checkFontAvailability(name);
 expect(env.added).toEqual([]);expect(env.fontAvailable(name)).toBe(false);
});
it('registers installed companion styles once when an exact face has no selectable CSS family', async () => {
 const env = await environment({loadable:['Fixture Face','Fixture Face Italic']});
 await Promise.all([env.prepareCanvasFont(' Fixture Face '),env.prepareCanvasFont('Fixture Face')]);
 const faces=[...env.fonts];
 expect(faces).toHaveLength(2);
 expect(faces.map(f=>f.descriptors)).toEqual([{}, {style:'italic'}]);
 const count=env.sources.length;await env.prepareCanvasFont('Fixture Face');expect(env.sources).toHaveLength(count);
 expect(faces.every(f=>f.family==='Fixture Face')).toBe(true);
});
it('does not load companion styles for an unchanged selectable family', async () => {
 const env=await environment({selectable:['Fixture Family'],loadable:['Fixture Family']});
 await env.prepareCanvasFont('Fixture Family');
 expect(env.sources).toEqual(['local("Fixture Family")']);expect(env.added).toEqual([]);
});
it('loads an exact reviewed face when CSS silently selects an installed sibling',async()=>{
 const env=await environment({selectable:['Source sans pro light'],assets:['Source sans pro light']});
 await env.checkFontAvailability('Source sans pro light');
 expect(env.sources.filter(s=>s.startsWith('url('))).toHaveLength(2);
 expect([...env.fonts].map(f=>f.descriptors)).toEqual([{}, {style:'italic'}]);
 expect(env.fontAvailable('Source sans pro light')).toBe(true);
});
it('retains an installed exact reviewed face without fetching assets',async()=>{
 const env=await environment({selectable:['Source sans pro light'],loadable:['Source sans pro light']});
 await env.checkFontAvailability('Source sans pro light');
 expect(env.sources).toEqual(['local("Source sans pro light")']);
 expect(env.added).toEqual([]);
});
it('does not claim an exact face is available when its reviewed italic asset fails',async()=>{
 const env=await environment({selectable:['Source sans pro light'],assets:['Source sans pro light'],failedAssets:['SourceSansPro-LightIt.ttf']});
 await env.checkFontAvailability('Source sans pro light');
 expect(env.fontAvailable('Source sans pro light')).toBe(false);expect(env.added).toEqual([]);
});

it.each([true,false])('measures and paints the encoded symbol only when its own font is available: %s',async available=>{
 const env=await environment(available?{selectable:['Symbol'],loadable:['Symbol']}:{});await env.checkFontAvailability('Symbol');
 const {canvasText,measureCanvasText}=await import('../src/engine/canvas-text.js');
 const {paintText}=await import('../src/engine/canvas-paint-text.js');
 const style={fontAscii:'Symbol',fontSize:10,symbol:{font:'Symbol',text:'\uf0b7',fallback:'•'}};
 const ctx={font:'',fontKerning:'',measureText:vi.fn(()=>({width:5})),fillText:vi.fn(),save:vi.fn(),restore:vi.fn(),translate:vi.fn(),scale:vi.fn()};
 expect(canvasText(ctx,'•',style)).toBe(available?'\uf0b7':'•');
 measureCanvasText(ctx,'•',style);expect(ctx.measureText).toHaveBeenLastCalledWith(available?'\uf0b7':'•');
 paintText(ctx,{...style,text:'•',x:20},30);expect(ctx.fillText).toHaveBeenLastCalledWith(available?'\uf0b7':'•',available?0:20,available?0:30);
 if(available){expect(ctx.translate).toHaveBeenLastCalledWith(20,30);expect(ctx.scale).toHaveBeenLastCalledWith(10/1536,10/1536);}
 expect(canvasText(ctx,'X',style)).toBe('X');
 expect(canvasText(ctx,'•',{...style,fontFamily:'Arial'})).toBe('•');
  expect(canvasText(ctx,'•',{fontAscii:'Symbol'})).toBe('•');
  Object.assign(ctx,{save:vi.fn(),restore:vi.fn(),translate:vi.fn(),scale:vi.fn()});
  paintText(ctx,{...style,text:'•',x:20,textTransform:{scaleX:1.5,scaleY:1,offsetX:0,offsetY:0}},30);
  expect(ctx.fillText).toHaveBeenLastCalledWith(available?'\uf0b7':'•',0,0);
  paintText(ctx,{...style,text:'•',x:20,textParts:[{text:'•',x:0,fontSize:10}]},30);
  expect(ctx.fillText).toHaveBeenLastCalledWith(available?'\uf0b7':'•',0,0);
});

it('resolves whitespace variants once without losing alternatives or bundled families',async()=>{
 const env=await environment({selectable:['Fixture Family'],loadable:['Fixture Family']});
 await Promise.all(['Fixture Family',' Fixture Family ','Fixture Family\u00a0'].map(env.checkFontAvailability));
 expect(env.loaded).toEqual(['Fixture Family']);expect(env.added).toEqual([]);
 expect(env.displayedFont({fontAscii:' Fixture Family '})).toBe('Fixture Family');
 expect(env.fontAvailable('Fixture Family ')).toBe(true);
 await env.checkFontAvailability(' Missing ');
 expect(env.displayedFont({fontAscii:' Missing '},{' missing ':' Fixture Family '})).toBe('Fixture Family');
 expect(env.displayedFont({fontAscii:' Missing '},{missing:'Fixture Family'})).toBe('Fixture Family');
 expect(env.fontAvailable(' Noto Sans ')).toBe(true);
 const {canvasFontFamily,checkedFontName}=await import('../src/engine/font-families.js');
 expect(canvasFontFamily({fontAscii:' Noto Sans '})).toBe('"Canvas Noto Sans"');
 expect(checkedFontName(' Fixture Family ')).toBe(' Fixture Family ');
});
it('selects the first available fallback while retaining primary-font priority',async()=>{
 const env=await environment({selectable:['Primary Face','First Fallback','Last Fallback'],loadable:['Primary Face','First Fallback','Last Fallback']});
 await Promise.all(['Primary Face','First Fallback','Last Fallback','Missing Face','Missing Alternative'].map(env.checkFontAvailability));
 const chain=['Missing Alternative',' First Fallback ','Last Fallback'];
 expect(env.displayedFont({fontAscii:'Primary Face'},{'primary face':chain})).toBe('Primary Face');
 expect(env.displayedFont({fontAscii:'Missing Face'},{'missing face':chain})).toBe('First Fallback');
 expect(env.displayedFont({fontAscii:'Missing Face'},{'missing face':['Missing Alternative','Last Fallback']})).toBe('Last Fallback');
 expect(env.displayedFont({fontAscii:'Missing Face'},{'missing face':['Missing Alternative']})).toBe('Noto Sans');
 expect(env.displayedFont({fontAscii:'Missing Face'},{'missing face':[]})).toBe('Noto Sans');
});
it('retains symbol encoding when the installed symbol family has surrounding spaces',async()=>{
 const env=await environment({selectable:['Symbol'],loadable:['Symbol']});await env.checkFontAvailability('Symbol ');
 const {canvasText}=await import('../src/engine/canvas-text.js');
 expect(canvasText({},'•',{fontAscii:'Symbol ',symbol:{font:'Symbol ',text:'\uf0b7',fallback:'•'}})).toBe('\uf0b7');
});

it('loads all reviewed Montserrat styles once and the exact Light alias separately',async()=>{
 const env=await environment({assets:['Montserrat','Montserrat Light'],selectable:['Montserrat Light']});
 await Promise.all([env.checkFontAvailability('Montserrat'),env.checkFontAvailability('MONTSERRAT')]);
 expect([...env.fonts].map(f=>f.descriptors)).toEqual([{}, {style:'italic'}, {weight:'700'}, {weight:'700',style:'italic'}]);
 await env.checkFontAvailability('Montserrat Light');
 expect(env.fontAvailable('Montserrat Light')).toBe(true);
 expect(env.sources.filter(s=>s.startsWith('url('))).toHaveLength(6);
 expect(env.canvasFontSources('Montserrat Light').map(f=>f.descriptors)).toEqual([{}, {style:'italic'}]);
});
it.each([['Montserrat','Montserrat-BoldItalic.ttf'],['Montserrat Light','Montserrat-LightItalic.ttf']])('retains normal fallback if a required %s face fails',async(name,file)=>{
 const env=await environment({assets:[name],failedAssets:[file]});await env.checkFontAvailability(name);
 expect(env.fontAvailable(name)).toBe(false);expect(env.added).toEqual([]);
});
