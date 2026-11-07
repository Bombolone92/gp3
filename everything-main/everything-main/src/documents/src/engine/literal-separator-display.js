import {literalSeparatorFont,LITERAL_SEPARATOR_ALIAS} from './literal-separator-font.js';
import {localFamilyFontData,localSourceFontData,localFontVersion,prepareAuthorizedLocalFonts} from './local-fonts.js';
import {canvasFontSources,displayedFont} from './font-availability.js';
import {readFontMetadata} from './font-metadata.js';
import {syntheticAdvanceFamily} from './synthetic-advance.js';
import {syntheticAdvanceFont} from './synthetic-advance-font.js';
import {openTypeKerningFamily,selectKerningSources} from './opentype-kerning.js';
import {withoutLegacyKerning} from './legacy-kerning-font.js';
import {legacyGposFamily} from './gpos-only-kerning.js';
import {withoutGposOnlyKerning} from './gpos-only-kerning-font.js';

const separatorBuffers=new WeakMap();
function separatorBuffer(buffer){
 if(!separatorBuffers.has(buffer))separatorBuffers.set(buffer,literalSeparatorFont(buffer));
 return separatorBuffers.get(buffer);
}
const localSources=new Map(),families=new Map(),mapped=new Map(),pending=new Map(),registrations=new Map();let serial=0;
const key=name=>name.trim().toLowerCase();
export function literalSeparatorFamily(name){
 if(!mapped.size)return undefined;
 const entry=mapped.get(key(name));return entry?.version===localFontVersion()?entry.alias:undefined;
}
export function literalSeparatorText(text,family){
 return text.includes('\u2028')&&literalSeparatorFamily(family)?text.replaceAll('\u2028',LITERAL_SEPARATOR_ALIAS):text;
}
function localSourcesFor(name){
 const id=JSON.stringify([key(name),localFontVersion()]);
 if(!localSources.has(id))localSources.set(id,(async()=>{
  // A resolvable exact regular face belongs to the selected family. If it
  // cannot map the glyph, atomic family registration must fail anyway; do
  // not read all its bold/italic companions just to reach that conclusion.
  const first=await localSourceFontData(`local(${JSON.stringify(name)})`),m=first&&readFontMetadata(first);
  if(m?.weight===400&&!m.italic&&m.widthClass===5&&!m.variable&&!separatorBuffer(first))return [];
  return localFamilyFontData(name);
 })().catch(()=>[]));
 return localSources.get(id);
}
// Read only separator-bearing local families while normal CSS faces load.
// Registration still waits for the final installed/embedded/fallback selection.
export function prepareLiteralSeparatorSources(styles){
 return Promise.all(styles.map(async style=>{
  const sources=await localSourcesFor(style.fontFamily||style.fontAscii||'Noto Sans');
  for(const source of sources)separatorBuffer(source.buffer);
 }));
}
async function sources(name){
 const registered=canvasFontSources(name);
 // Explicit descriptors identify faces registered by the viewer (including
 // embedded/exact-name faces). Retain those CSS weights rather than guessing
 // them from the font's internal family naming.
 if(registered.length&&registered.every(f=>f.descriptors!==undefined)){
  return Promise.all(registered.map(async f=>{
   let buffer;
   if(f.source.startsWith('local('))buffer=await localSourceFontData(f.source);
   else{
    const match=/^url\(("(?:\\.|[^"\\])*")\)$/.exec(f.source);if(!match)throw new Error('Unknown font source');
    const url=new URL(JSON.parse(match[1]),document.baseURI);
    if(url.origin!==new URL(document.baseURI).origin)throw new Error('Nonlocal font source');
    const response=await fetch(url);if(!response.ok)throw new Error('Unavailable font');buffer=await response.arrayBuffer();
   }
   if(!buffer)throw new Error('Unavailable font bytes');
   return {buffer,metadata:readFontMetadata(buffer),descriptors:f.descriptors};
  }));
 }
 return selectKerningSources(await localSourcesFor(name),name).map(f=>({...f,
  descriptors:{weight:String(f.metadata?.weight),style:f.metadata?.italic?'italic':'normal'}}));
}
async function sourceFamily(name){
 const id=key(name),old=families.get(id);
 if(old?.version===localFontVersion())return old.promise;
 const entry={version:localFontVersion(),promise:sources(name)};families.set(id,entry);return entry.promise;
}
function syntheticSources(available){
 const normal=available.filter(f=>!f.descriptors.weight||Number(f.descriptors.weight)===400),result=[];
 for(const italic of [false,true]){
  const source=normal.find(f=>(f.descriptors.style==='italic')===italic)||normal.find(f=>f.descriptors.style!=='italic');
  if(!source||result.some(r=>r.descriptors.style===source.descriptors.style))continue;
  const buffer=syntheticAdvanceFont(source.buffer);if(!buffer)throw new Error('Unsupported synthetic face');
  result.push({...source,buffer,descriptors:{...source.descriptors,weight:'700'}});
 }
 return result;
}
function register(name,available,transform,version){
 if(version!==localFontVersion())return Promise.resolve(false);
 const id=JSON.stringify([key(name),version]);
 if(!registrations.has(id))registrations.set(id,registerFaces(name,available,transform,version));
 return registrations.get(id);
}
async function registerFaces(name,available,transform,version){
 const id=key(name),old=mapped.get(id);
 if(old?.version===version)return false;
 const alias=`Canvas literal separator ${++serial}`,loaded=[];
 try{
  if(!available.length||available.some(f=>!f.metadata||f.metadata.variable))return false;
  for(const source of available){
   const data=transform?transform(source.buffer):source.buffer,buffer=data&&separatorBuffer(data);
   // Do not let an absent bold/italic mapping silently select another face.
   if(!buffer)throw new Error('Selected family has an unmappable separator');
   // Ordinary characters retain the original system face and its font links.
   loaded.push(new FontFace(alias,buffer,{...source.descriptors,unicodeRange:'U+FFFF'}));
  }
  await Promise.all(loaded.map(face=>face.load()));
  if(version!==localFontVersion())return false;
  loaded.forEach(f=>document.fonts.add(f));mapped.set(id,{version,alias,faces:loaded});
  old?.faces.forEach(f=>document.fonts.delete(f));return true;
 }catch{loaded.forEach(f=>document.fonts.delete(f));return false;}
}
export async function prepareLiteralSeparatorDisplay(requested,alternatives){
 await prepareAuthorizedLocalFonts();
 const version=localFontVersion();
 const family=displayedFont(requested,alternatives),style={...requested,fontFamily:family};
 const gpos=legacyGposFamily(style),opentype=openTypeKerningFamily(style);
 const id=JSON.stringify([key(family),gpos,opentype,syntheticAdvanceFamily(family,false),syntheticAdvanceFamily(family,true),localFontVersion()]);
 if(pending.has(id))return pending.get(id);
 const promise=(async()=>{
  try{
   const available=await sourceFamily(family);let changed=await register(family,available,undefined,version);
   for(const italic of [false,true]){
    const alias=syntheticAdvanceFamily(family,italic);if(!alias)continue;
    const normal=available.filter(f=>!f.descriptors.weight||Number(f.descriptors.weight)===400);
    const selected=normal.find(f=>(f.descriptors.style==='italic')===italic)||normal.find(f=>f.descriptors.style!=='italic');
    if(selected)changed=await register(alias,syntheticSources([selected]),undefined,version)||changed;
   }
   for(const [alias,syntheticAlias,transform]of [
    [gpos,legacyGposFamily(style,true),withoutGposOnlyKerning],
    [opentype,openTypeKerningFamily(style,true),withoutLegacyKerning],
   ])if(alias){
    changed=await register(alias,available,transform,version)||changed;
    if(syntheticAlias)changed=await register(syntheticAlias,syntheticSources(available),transform,version)||changed;
   }
   return changed;
  }catch{return false;}
 })();pending.set(id,promise);return promise;
}
