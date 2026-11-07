// The native SVG-to-PDF path clamps thin positive strokes after the SVG viewport
// and uniform element transforms. Independent references: svg-strokes*.docx.
// Its 0.14 metafile-unit floor / 0.12 units per intrinsic CSS pixel is 7/6 px.
import { nativeSvgOpacities } from './svg-native-opacity.js';
import { nativeSvgDimensions, nativeSvgViewport } from './svg-native-viewport.js';
import { materializeSvgUses } from './svg-use.js';
import { nativeSvgGroups } from './svg-native-groups.js';
import {svgGroupOpacities} from './svg-group-opacity.js';
export const SVG_MIN_STROKE = 7 / 6;

export function nativeStrokeWidth(width, matrix) {
  if (!(width > 0) || !matrix) return width;
  const x = Math.hypot(matrix.a, matrix.b), y = Math.hypot(matrix.c, matrix.d);
  // Anisotropic/skewed strokes need separate reference evidence. Do not approximate
  // their directional widths using a single guessed scale.
  if (!(x > 0) || Math.abs(x-y) > 1e-7*Math.max(x,y) || Math.abs(matrix.a*matrix.c+matrix.b*matrix.d) > 1e-7*x*y) return width;
  return Math.max(width, SVG_MIN_STROKE/x);
}

// Resolve the authored CSS cascade in an isolated SVG tree. Only validated
// image-context SVG reaches this function; original package bytes stay intact.
export function nativeSvgStrokes(root, dimensions, rasterGroups = false) {
  const host=document.createElement('div');
  host.style.cssText='position:absolute;opacity:0;left:-100000px;top:0;pointer-events:none';
  const shadow=host.attachShadow({mode:'closed'}), svg=document.importNode(root,true);
  if(svg.querySelector('text,tspan')) host.style.font='12px Arial';
  const viewport = nativeSvgDimensions(svg, dimensions);
  svg.setAttribute('width',String(viewport.width));
  svg.setAttribute('height',String(viewport.height));
  shadow.append(svg); document.body.append(host);
  try {
    materializeSvgUses(svg);
    const {opacities:groupOpacities,overrides,paintOpacities}=svgGroupOpacities(svg,rasterGroups);
    // Freeze the specified group cascade only on the disposable preview.
    // Keep the numeric map: CSSOM serialization can erase decimal boundaries.
    // Normal numeric declarations need no CSSOM reads or writes here.
    for(const node of overrides)node.style.opacity=String(groupOpacities.get(node));
    const textNodes=svg.querySelectorAll('text,tspan');
    const rootPresentation = getComputedStyle(svg);
    const correctViewport = viewport.width <= 8192 && viewport.height <= 8192 && viewport.width * viewport.height <= 16000000
      && rootPresentation.clipPath === 'none' && rootPresentation.transform === 'none';
    if (!correctViewport) {
      const originalViewport = nativeSvgDimensions(root, dimensions, false);
      svg.setAttribute('width', String(originalViewport.width));
      svg.setAttribute('height', String(originalViewport.height));
    }
    if(textNodes.length) {
      // The native SVG consumer uses Arial for absent/unavailable families. Freeze
      // the cascade in the preview only; image-context SVG cannot inherit the
      // host defaults. Declared installed families keep first preference.
      const rootStyle=getComputedStyle(svg);
      svg.style.fontSize=rootStyle.fontSize;
      svg.style.fontFamily=rootStyle.fontFamily+', Arial';
      const styles=[...textNodes].map(node=>{
        const s=getComputedStyle(node);
        return {node,family:s.fontFamily,letter:parseFloat(s.letterSpacing)||0,word:parseFloat(s.wordSpacing)||0};
      });
      for(const {node,family,letter,word} of styles) {
        node.style.fontFamily=family+', Arial';
        node.style.fontKerning='normal';
        if(!letter) continue;
        // The native reference omits letter-spacing on ordinary spaces, but retains it on
        // nonbreaking spaces. Keep the correction confined to the preview.
        node.style.wordSpacing=(word-letter)+'px';
        for(const child of [...node.childNodes]) if([3,4].includes(child.nodeType) && child.textContent.includes('\u00a0')) {
          const fragment=document.createDocumentFragment();
          for(const text of child.textContent.split(/(\u00a0+)/)) if(text) {
            if(text[0]==='\u00a0') {
              const span=document.createElementNS('http://www.w3.org/2000/svg','tspan');
              span.style.wordSpacing=word+'px';span.textContent=text;fragment.append(span);
            } else fragment.append(document.createTextNode(text));
          }
          child.replaceWith(fragment);
        }
      }
    }
    // The native reference consumes SVG masks as luminance masks, including an authored
    // mask-type:alpha. Keep this compatibility override on the preview clone.
    // Native evidence: svg-mask-opacity and svg-mask-opacity-expanded.
    for (const mask of svg.querySelectorAll('mask')) {
      if (getComputedStyle(mask).maskType === 'alpha') mask.style.maskType = 'luminance';
    }
    nativeSvgOpacities(svg);
    for(const node of svg.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon')) {
      const style=getComputedStyle(node);
      if(style.stroke==='none' || style.vectorEffect!=='none') continue;
      const match=/^(\d+(?:\.\d*)?|\.\d+)px$/.exec(style.strokeWidth);
      if(!match) continue; // Preserve unresolved percentage/calc declarations.
      const width=Number(match[1]), adjusted=nativeStrokeWidth(width,node.getCTM());
      if(adjusted>width) node.style.strokeWidth=String(adjusted);
    }
    if (rasterGroups && correctViewport) nativeSvgGroups(svg,groupOpacities,paintOpacities);
    if (correctViewport) nativeSvgViewport(svg, viewport);
    else {
      // Keep the bounded concrete image size and previous composition path for
      // oversized ratio-only coordinates and authored root clips/transforms.
      svg.setAttribute('width', String(dimensions.width));
      svg.setAttribute('height', String(dimensions.height));
    }
  } finally { host.remove(); }
  return svg;
}
