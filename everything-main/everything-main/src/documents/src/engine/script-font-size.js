import {localFamilyFaceMetadata,localFontVersion,prepareAuthorizedLocalFonts} from './local-fonts.js';
import {canvasFontSources,displayedFont,isBundledFont} from './font-availability.js';
import {readFontMetadata} from './font-metadata.js';
import {scriptPosition} from './font-script-metrics.js';

const families=new Map();
const positions=new WeakMap();
const unavailable={size:null,position:null};
const key=name=>name.trim().toLowerCase();

// Both recommended offsets are validated after rounding to half points.
// A low superscript offset or a subscript offset beyond half the authored size
// selects its 60% fallback for both directions, including fractional text sizes.
export function reducedScriptSize(size,script,metadata){
  const m=metadata?.scriptMetrics,em=metadata?.unitsPerEm;
  if(!m||(metadata.variable&&!metadata.scriptSizeInvariant)||!Number.isFinite(size)||size<=0||!(em>0))return null;
  const recommended=m[script==='subscript'?1:5];
  if(!(recommended>0&&recommended<em)||m[7]<0)return null;
  const fallback=Math.round(2*size*m[7]/em)<Math.floor(size/2)||Math.round(2*size*m[3]/em)>Math.floor(size);
  const reduced=Math.round(2*size*(fallback ? 0.6 : recommended/em))/2;
  return reduced>0&&reduced<size?reduced:null;
}

function selectedFace(name,style,sources){
  const available=sources.filter(s=>s.metadata&&(!s.metadata.variable||s.metadata.scriptSizeInvariant));
  const base=available.find(s=>key(s.fullName||'')===key(name))||
    available.find(s=>s.metadata.weight===400&&!s.metadata.italic&&s.metadata.widthClass===5)||available[0];
  if(!base)return null;
  const candidates=available.filter(s=>s.metadata.widthClass===base.metadata.widthClass);
  const styled=candidates.filter(s=>s.metadata.italic===!!style.italic);
  const target=style.bold?700:400;
  return (styled.length?styled:candidates.filter(s=>!s.metadata.italic))
    .sort((a,b)=>Math.abs(a.metadata.weight-target)-Math.abs(b.metadata.weight-target))[0]?.metadata||null;
}

function preparedFace(style){
  const name=style.fontFamily||style.fontAscii||'Noto Sans',entry=families.get(key(name));
  if(!entry||entry.version!==localFontVersion())return null;
  const face=entry.faces[`${!!style.bold}/${!!style.italic}`];
  return face;
}

export function preparedScriptSize(style){
  return reducedScriptSize(style.scriptReferenceSize??style.fontSize??12,style.verticalAlign,preparedFace(style));
}

export function preparedScriptMetrics(style){
  const face=preparedFace(style),size=style.scriptReferenceSize??style.fontSize??12;
  if(!face)return unavailable;
  let cached=positions.get(face);
  if(!cached){cached=new Map();positions.set(face,cached);}
  const id=`${size}/${style.verticalAlign}`;
  if(cached.has(id))return cached.get(id);
  const reduced=reducedScriptSize(size,style.verticalAlign,face);
  const result={size:reduced,position:reduced===null?null:scriptPosition(size,reduced,style.verticalAlign,face)};
  // Bound interactive size changes; a replacement font has a different identity.
  if(cached.size>=128)cached.clear();
  cached.set(id,result);return result;
}

export function scriptFontSizeReady(style){
  const entry=families.get(key(style.fontFamily||style.fontAscii||'Noto Sans'));
  return entry?.version===localFontVersion()&&entry.ready===true;
}

export async function prepareScriptFontSizes(names,alternatives){
  if(!names.size)return;
  await prepareAuthorizedLocalFonts();
  await Promise.all([...new Set([...names].map(fontFamily=>displayedFont({fontFamily},alternatives)))].map(async name=>{
    const id=key(name),previous=families.get(id);
    if(previous?.version===localFontVersion())return previous.promise;
    if(previous?.promise)await previous.promise;
    const entry={version:localFontVersion(),faces:{}};
    entry.promise=(async()=>{
      try{
        // Canvas Noto Sans is loaded by canvas.css, outside the dynamic face
        // registry. Read those same assets, never an installed namesake.
        const bundled=isBundledFont(name);
        const faces=bundled?['NotoSans.ttf','NotoSans-Italic.ttf'].map(file=>({source:`url("/fonts/${file}")`})) : canvasFontSources(name);
        let sources=bundled?[]:await localFamilyFaceMetadata(name);
        if(!sources.length)sources=(await Promise.all(faces.map(async face=>{
          const match=/^url\(("(?:\\.|[^"\\])*")\)$/.exec(face.source);
          if(!match)return null;
          const url=new URL(JSON.parse(match[1]),document.baseURI);
          if(url.origin!==new URL(document.baseURI).origin)return null;
          const response=await fetch(url);if(!response.ok)return null;
          const metadata=readFontMetadata(await response.arrayBuffer());
          return metadata?{metadata}:null;
        }))).filter(Boolean);
        for(const bold of [false,true])for(const italic of [false,true])
          entry.faces[`${bold}/${italic}`]=selectedFace(name,{bold,italic},sources);
      }catch{/* Unavailable or unauthorized metrics retain the existing fallback. */}
      finally{entry.version=localFontVersion();entry.ready=true;}
    })();
    families.set(id,entry);await entry.promise;
  }));
}
