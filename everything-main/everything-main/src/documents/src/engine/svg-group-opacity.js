import {stylesheetRules} from './svg-use.js';
import {svgOpacityNumber,nativeCssOpacity} from './svg-opacity-values.js';

// The native raster group path truncates the positive opacity to Float32 before
// rounding to a byte. Independent controls straddle adjacent Float32 values.
const storage=new ArrayBuffer(4),single=new Float32Array(storage),bits=new Uint32Array(storage);
export function svgOpacityFloat(value) {
  const opacity=Math.max(0,Math.min(1,value));
  single[0]=opacity;
  if(single[0]>opacity)bits[0]--;
  return single[0];
}
export const svgGroupOpacityByte=value=>Math.round(svgOpacityFloat(value)*255);

function declaration(value,inline=false,property='opacity') {
  let opacity,ignored=false;
  for(const d of value.split(';')) {
    const m=/^\s*(opacity|fill-opacity)\s*:\s*(.*?)\s*$/i.exec(d);
    // The native reference accepts literal numbers in CSS opacity declarations. Its
    // CSS number parsing excludes exponent syntax, percentages and calc. Inline
    // inherit is honored; stylesheet inherit is ignored by the native reference (unlike
    // SVG 1.1). Ignored declarations do not replace a preceding valid value.
    if(m&&m[1].toLowerCase()===property){if(nativeCssOpacity(m[2],inline||property==='fill-opacity'))opacity=m[2];else ignored=true;}
  }
  return {opacity,ignored};
}

// The validated image subset has simple selectors and no important/variables/
// custom properties. Resolve its specified cascade without serializing opacity
// through getComputedStyle, which rounds meaningful decimal boundaries away.
// Presentation-attribute inherit is honored separately by the native reference.
export function svgGroupOpacities(root,paints=false) {
  const sourceRules=stylesheetRules(root);
  const properties=['opacity',...(paints?['fill-opacity']:[])];
  const rules=new Map(properties.map(p=>[p,sourceRules.map(r=>({...r,...declaration(r.declarations,false,p)})).filter(r=>r.opacity!==undefined||r.ignored)]));
  const result=new Map(),fills=new Map(),paintOpacities=new Map(),overrides=new Set();
  function resolve(node,property='opacity') {
    const values=property==='opacity'?result:fills;
    if(values.has(node))return values.get(node);
    let value=node.getAttribute(property);
    let override=false;
    for(const rule of rules.get(property))if(node.matches(rule.selector)) {value=rule.opacity??value;override||=rule.ignored;}
    const style=node.getAttribute('style');
    if(style) {const inline=declaration(style,true,property);value=inline.opacity??value;override||=inline.ignored;}
    let opacity;
    if(value?.trim().toLowerCase()==='inherit'||property==='fill-opacity'&&value==null)opacity=node.parentElement&&root.contains(node.parentElement)?resolve(node.parentElement,property):1;
    else if(svgOpacityNumber(value))opacity=Number(value);
    else {opacity=1;override||=value!=null;}
    values.set(node,Math.max(0,Math.min(1,opacity)));
    if(override&&node.localName==='g'&&property==='opacity')overrides.add(node);
    return values.get(node);
  }
  for(const node of root.querySelectorAll('g'))resolve(node);
  // Capture before preview CSSOM writes, but only when a translucent group can
  // consume paint values. Ordinary vector-only SVGs need no paint traversal.
  if(paints&&[...result].some(([node,value])=>node.localName==='g'&&value<1))for(const node of root.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon'))paintOpacities.set(node,svgOpacityFloat(resolve(node))*svgOpacityFloat(resolve(node,'fill-opacity')));
  return {opacities:result,overrides,paintOpacities};
}
