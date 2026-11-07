import { drawingEffectColor } from './docx-drawing-style.js';
import { UnsupportedDocumentError } from './errors.js';
import { PATTERN_MASKS } from './drawing-pattern-masks.js';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const fail = why => { throw new UnsupportedDocumentError(`DrawingML pattern fills with ${why}`); };
function attributes(node, allowed) {
  if ([...node.attributes].some(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && (a.namespaceURI || !allowed.includes(a.localName)))) fail('invalid attributes');
  if ([...node.childNodes].some(n => [3,4].includes(n.nodeType) && /\S/.test(n.textContent))) fail('unexpected text');
}
export function readPatternFill(node, scheme) {
  attributes(node, ['prst']);
  const preset = node.hasAttribute('prst') ? node.getAttribute('prst').trim() : 'pct5';
  if (!Object.hasOwn(PATTERN_MASKS, preset)) fail('an unknown preset');
  const colors = { fgClr: {rgb:'000000', alpha:1}, bgClr: {rgb:'FFFFFF', alpha:1} };
  let order = -1;
  for (const n of node.children) {
    const index = ['fgClr','bgClr'].indexOf(n.localName);
    if (n.namespaceURI !== A || index <= order) fail('invalid or duplicate colors');
    order = index; attributes(n, []);
    if (n.children.length !== 1) fail('missing or conflicting colors');
    colors[n.localName] = drawingEffectColor(n.children[0], scheme);
  }
  return { type:'pattern', preset, foreground:colors.fgClr, background:colors.bgClr };
}

export const shapeHasPatterns = node => node.fill?.type === 'pattern' || !!node.children?.some(shapeHasPatterns);

// A tile's cells select the two paints independently, including their opacity.
// Interpolate premultiplied colors only for the blended diagonal preset cells.
export function patternPixels(fill) {
  const mask = PATTERN_MASKS[fill.preset];
  if (!mask) throw new Error('Unknown drawing pattern');
  const endpoints = [fill.background,fill.foreground].map(c => ({channels:c.rgb.match(/../g).map(n => parseInt(n,16)), alpha:c.alpha}));
  const [b,f] = endpoints, pixels = new Uint8ClampedArray(8*8*4);
  for (let i=0;i<64;i++) {
    const weight = [0,64/255,234/255,1][Number(mask[i])];
    const alpha = b.alpha*(1-weight)+f.alpha*weight;
    for (let c=0;c<3;c++) pixels[i*4+c] = alpha ? (b.channels[c]*b.alpha*(1-weight)+f.channels[c]*f.alpha*weight)/alpha : 0;
    pixels[i*4+3] = alpha*255;
  }
  return pixels;
}

export function canvasPatternFill(ctx, fill, {left,top,x=0,y=0,scaleX=1,scaleY=1,resolution=2}) {
  const tile = new OffscreenCanvas(8,8), tileContext = tile.getContext('2d');
  tileContext.putImageData(new ImageData(patternPixels(fill),8,8),0,0);
  const pattern = ctx.createPattern(tile,'repeat');
  // Cancel shape/group transforms: the tile stays aligned to the page,
  // with one CSS pixel per cell, independently of display resolution.
  const physical = new DOMMatrix([resolution/scaleX,0,0,resolution/scaleY,-resolution*(left+x/scaleX),-resolution*(top+y/scaleY)]);
  pattern.setTransform(ctx.getTransform().inverse().multiply(physical));
  return pattern;
}
