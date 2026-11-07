import {it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
const state=vi.hoisted(()=>({version:1,metadata:null}));
vi.mock('../src/engine/local-fonts.js',()=>({
 localFontVersion:()=>state.version,prepareAuthorizedLocalFonts:async()=>{},
 localFamilyFaceMetadata:async()=>[{metadata:state.metadata}],
}));
vi.mock('../src/engine/font-availability.js',()=>({
 canvasFontSources:()=>[],displayedFont:s=>s.fontFamily,isBundledFont:()=>false,
}));
import {readFontMetadata} from '../src/engine/font-metadata.js';
import {prepareScriptFontSizes,preparedScriptMetrics} from '../src/engine/script-font-size.js';

it('reuses prepared geometry but discards it when the selected font changes',async()=>{
 const bytes=readFileSync('tests/fixtures/script-compound-position/ScriptCompoundProbe.ttf');
 state.metadata=readFontMetadata(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 const style={fontFamily:'Script Compound Probe',fontSize:12,verticalAlign:'superscript'};
 await prepareScriptFontSizes(new Set([style.fontFamily]));
 const first=preparedScriptMetrics(style);
 expect(first.size).toBe(8);expect(first.position).toBe(-4);
 expect(preparedScriptMetrics({...style})).toBe(first);
 const sub=preparedScriptMetrics({...style,verticalAlign:'subscript'});
 expect(sub).not.toBe(first);expect(sub.position).toBe(1);
 state.version++;state.metadata={...state.metadata,scriptPositionMetrics:undefined};
 expect(preparedScriptMetrics(style)).toEqual({size:null,position:null});
 await prepareScriptFontSizes(new Set([style.fontFamily]));
 const replacement=preparedScriptMetrics(style);
 expect(replacement).not.toBe(first);expect(replacement.size).toBe(8);expect(replacement.position).toBeNull();
});
