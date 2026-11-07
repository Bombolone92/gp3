import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {Font,Glyph,Path} from '../src/vendor/opentype/opentype.mjs';

const state=vi.hoisted(()=>({version:0,sources:[],reads:0,first:null}));
vi.mock('../src/engine/local-fonts.js',()=>({
 localFontVersion:()=>state.version,prepareAuthorizedLocalFonts:async()=>{},localSourceFontData:async()=>state.first,
 localFamilyFontData:async()=>{state.reads++;return state.sources;},
}));
vi.mock('../src/engine/font-availability.js',()=>({canvasFontSources:()=>[],displayedFont:s=>s.fontFamily}));
vi.mock('../src/engine/synthetic-advance.js',()=>({syntheticAdvanceFamily:()=>undefined}));
vi.mock('../src/engine/opentype-kerning.js',()=>({selectKerningSources:s=>s,openTypeKerningFamily:s=>s.ligatures==='all'?'Unmappable derived policy':undefined}));
vi.mock('../src/engine/gpos-only-kerning.js',()=>({legacyGposFamily:()=>undefined}));
import {prepareLiteralSeparatorDisplay,prepareLiteralSeparatorSources,literalSeparatorFamily,literalSeparatorText} from '../src/engine/literal-separator-display.js';

function source(weight=400,separator=true){
 const path=new Path();path.moveTo(0,0);path.lineTo(500,700);path.lineTo(900,0);path.close();
 const glyphs=[new Glyph({name:'.notdef',advanceWidth:500,path:new Path()}),new Glyph({name:'A',unicode:65,advanceWidth:600,path})];
 if(separator)glyphs.push(new Glyph({name:'separator',unicode:0x2028,advanceWidth:900,path}));
 const font=new Font({familyName:'Original separator display',styleName:'Regular',unitsPerEm:1000,ascender:800,descender:-200,glyphs});
 font.tables.os2.usWeightClass=weight;const buffer=font.toArrayBuffer();
 return{buffer,metadata:{weight,italic:false,widthClass:5,variable:false}};
}
beforeEach(()=>{
 state.version++;state.reads=0;state.first=null;state.sources=[source()];
 vi.stubGlobal('document',{fonts:new Set()});
 vi.stubGlobal('FontFace',class{constructor(family,data,descriptors){Object.assign(this,{family,data,descriptors});}async load(){return this;}});
});
afterEach(()=>vi.unstubAllGlobals());

it('registers one complete family under concurrent requests and retains ordinary text',async()=>{
 const original=state.sources[0].buffer.slice(0);
 const sources=prepareLiteralSeparatorSources([{fontFamily:'Original'},{fontFamily:'Original'}]);
 await Promise.all([sources,prepareLiteralSeparatorDisplay({fontFamily:'Original'}),prepareLiteralSeparatorDisplay({fontFamily:'Original',ligatures:'all'})]);
 expect(state.reads).toBe(1);expect(document.fonts.size).toBe(1);expect([...document.fonts][0].descriptors.unicodeRange).toBe('U+FFFF');
 expect(literalSeparatorFamily('Original')).toBeTruthy();expect(literalSeparatorText('A\u2028B','Original')).toBe('A\uffffB');
 expect(literalSeparatorText('AV fi 123','Original')).toBe('AV fi 123');expect(state.sources[0].buffer).toEqual(original);
 expect(literalSeparatorFamily('Unmappable derived policy')).toBeUndefined();
});

it('does not let an unmappable bold face silently fall back to mapped regular',async()=>{
 state.sources=[source(),source(700,false)];
 expect(await prepareLiteralSeparatorDisplay({fontFamily:'Partial'})).toBe(false);
 expect(document.fonts.size).toBe(0);expect(literalSeparatorFamily('Partial')).toBeUndefined();
 expect(literalSeparatorText('\u2028','Partial')).toBe('\u2028');
});

it('invalidates aliases when the authorized catalogue changes and retries the family',async()=>{
 await prepareLiteralSeparatorDisplay({fontFamily:'Changing'});const first=literalSeparatorFamily('Changing');
 state.version++;expect(literalSeparatorFamily('Changing')).toBeUndefined();
 await prepareLiteralSeparatorDisplay({fontFamily:'Changing'});
 expect(literalSeparatorFamily('Changing')).not.toBe(first);expect(state.reads).toBe(2);expect(document.fonts.size).toBe(1);
});

it('does not read companion faces when the exact regular face lacks the glyph',async()=>{
 state.first=source(400,false).buffer;
 expect(await prepareLiteralSeparatorDisplay({fontFamily:'Missing'})).toBe(false);
 expect(state.reads).toBe(0);expect(document.fonts.size).toBe(0);
});

it('does not publish faces prepared across a font catalogue refresh',async()=>{
 FontFace.prototype.load=async function(){state.version++;return this;};
 expect(await prepareLiteralSeparatorDisplay({fontFamily:'Interrupted'})).toBe(false);
 expect(literalSeparatorFamily('Interrupted')).toBeUndefined();expect(document.fonts.size).toBe(0);
});
