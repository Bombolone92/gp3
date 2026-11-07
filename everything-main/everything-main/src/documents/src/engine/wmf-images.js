// Original numeric vector playback from MS-WMF. Original media bytes remain
// in the OPC package; unsupported records reject before editable import.
export const WMF_MIME = 'image/wmf';
import { vectorImage } from './vector-image-effects.js';
const fail = message => { throw new Error(`Unsupported WMF: ${message}.`); };
const color = n => '#' + [n & 255, n >>> 8 & 255, n >>> 16 & 255].map(v => v.toString(16).padStart(2, '0')).join('');
export function isWmf(bytes) {
  if(!(bytes instanceof Uint8Array)||bytes.length<4)return false;
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return v.getUint32(0,true)===0x9ac6cdd7 || bytes.length>=18 && [1,2].includes(v.getUint16(0,true)) && v.getUint16(2,true)===9 && [0x100,0x300].includes(v.getUint16(4,true));
}
function parse(bytes, viewport) {
  if (!isWmf(bytes) || bytes.length < 24 || bytes.length > 8 * 1024 * 1024) fail('invalid metafile header');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u = at => v.getUint16(at, true), s = at => v.getInt16(at, true), d = at => v.getUint32(at, true);
  const placeable=d(0)===0x9ac6cdd7, header=placeable?22:0;
  let left=0,top=0,extentX=1,extentY=1,width=viewport?.width,height=viewport?.height;
  if(placeable){
    if(bytes.length<46)fail('invalid placeable header');
    let checksum=0;for(let at=0;at<20;at+=2)checksum^=u(at);
    if(u(4)||d(16)||checksum!==u(20))fail('invalid placeable checksum or reserved fields');
    left=s(6);top=s(8);extentX=s(10)-left;extentY=s(12)-top;
    const inch=u(14);if(!inch)fail('invalid placeable scale');
    width=extentX*96/inch;height=extentY*96/inch;
  }
  // A standard WMF has no intrinsic physical frame. Its DrawingML picture
  // supplies the viewport; window origin/extents remain playback records.
  if (!(Number.isFinite(width)&&Number.isFinite(height)&&width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16000000)) fail('invalid or excessive frame');
  const handles = u(header+10), maxRecord = d(header+12);
  if (![1, 2].includes(u(header)) || u(header+2) !== 9 || ![0x100, 0x300].includes(u(header+4)) || d(header+6) * 2 !== bytes.length - header || u(header+16) || maxRecord < 3) fail('invalid metafile header');
  // The embedding player supplies the viewport (MS-WMF 3.1.3). Native
  // placeable playback starts anisotropic even without a SetMapMode record.
  let state = { window: [left, top, extentX, extentY], hasWindow:placeable, pen: { style: 0, width: 0, color: '#000000' }, brush: '#ffffff', fill: 'evenodd' };
  const objects = new Map(), stack = [], paint = [];
  let count = 0, pointCount = 0, eof = false, largest = 0;
  const create = object => {
    let index = 0; while (objects.has(index)) index++;
    if (index >= handles) fail('object table overflow');
    objects.set(index, object);
  };
  const number = value => {
    if (!Number.isFinite(value) || Math.abs(value) > 1e9) fail('invalid coordinates');
    return Number(value.toFixed(6));
  };
  const point = (x, y) => {
    if(!state.hasWindow)fail('missing window extent');
    if (++pointCount > 250000) fail('geometry limit');
    const w = state.window;
    return [number((x - w[0]) * width / w[2]), number((y - w[1]) * height / w[3])];
  };
  const draw = (path, fill) => {
    const attrs = `fill="${fill ? state.brush : 'none'}" fill-rule="${state.fill}"`;
    if (state.pen.style !== 5) fail('visible pen stroke');
    paint.push(`<path d="${path}" ${attrs}/>`);
  };
  for (let at = header+18; at < bytes.length;) {
    if (++count > 10000 || at + 6 > bytes.length) fail('record limit or truncated header');
    const size = d(at) * 2, type = u(at + 4) & 255;
    if (size < 6 || at + size > bytes.length || size / 2 > maxRecord) fail('invalid record size');
    largest = Math.max(largest, size / 2);
    const need = n => { if (size < n + 6) fail('truncated record fields'); };
    const word = offset => { need(offset + 2); return u(at + 6 + offset); };
    const signed = offset => { need(offset + 2); return s(at + 6 + offset); };
    // PALETTERGB is accepted on a true-color target. Palette-index colors
    // and palette mutation records still require unsupported palette state.
    const rgb = offset => { need(offset + 4); const n = d(at + 6 + offset); if (![0,2].includes(n >>> 24)) fail('palette color'); return color(n); };
    if (type === 0) { if (size !== 6 || at + size !== bytes.length) fail('invalid EOF'); eof = true; }
    else if (type === 3) { if (word(0) !== 8) fail('mapping mode'); }
    else if (type === 11) state.window = [signed(2), signed(0), ...state.window.slice(2)];
    else if (type === 12) {
      const x = signed(2), y = signed(0); if (!x || !y) fail('zero window extent');
      state.window = [...state.window.slice(0, 2), x, y];state.hasWindow=true;
    }
    else if(type===38){
      const escape=word(0),length=word(2);
      if(escape!==15||size!==10+length+(length%2))fail('unsupported or malformed escape');
      // MFCOMMENT also carries embedded EMF streams. Those cannot be ignored:
      // they can replace the surrounding WMF playback with different artwork.
      if(length>=4&&d(at+10)===0x43464d57)fail('embedded enhanced metafile');
    }
    else if (type === 4) { if (word(0) !== 13) fail('raster operation'); }
    else if (type === 6) { const mode = word(0); if (![1, 2].includes(mode)) fail('polygon fill mode'); state.fill = mode === 1 ? 'evenodd' : 'nonzero'; }
    else if (type === 250) {
      const style = word(0), width = signed(2); signed(4);
      if (![0, 5].includes(style) || width < 0) fail('pen style');
      // MS-WMF specifies ten pen bytes. A trailing WORD is also accepted;
      // the independent padded-pen fixture verifies that it is ignored.
      if (![16, 18].includes(size)) fail('pen record size');
      create({ kind: 'pen', value: { style, width, color: rgb(6) } });
    }
    else if (type === 252) {
      const style = word(0), c = rgb(2); word(6);
      if (![0, 1].includes(style)) fail('brush style');
      create({ kind: 'brush', value: style === 1 ? 'none' : c });
    }
    else if (type === 45) {
      const index = word(0), object = objects.get(index); if (!object) fail('unknown object');
      state = { ...state, [object.kind]: object.value, [object.kind + 'Index']: index };
    }
    else if (type === 240) {
      const index = word(0);
      if ([state, ...stack].some(s => s.penIndex === index || s.brushIndex === index)) fail('deleting a selected object');
      if (!objects.delete(index)) fail('unknown deleted object');
    }
    else if (type === 30) { if (stack.length >= 128) fail('saved context limit'); stack.push({ ...state, window: [...state.window] }); }
    else if (type === 39) {
      const relative = signed(0), index = relative < 0 ? stack.length + relative : relative - 1;
      if (!relative || index < 0 || index >= stack.length) fail('unknown saved context');
      state = stack[index]; stack.length = index;
    }
    else if (type === 36 || type === 37) {
      const n = type === 36 ? signed(0) : word(0); if (n < 2 || size !== 8 + n * 4) fail('invalid polygon points');
      const points = [];
      for (let i = 0; i < n; i++) points.push(point(signed(2 + i * 4), signed(4 + i * 4)).join(' '));
      draw('M' + points.join(' L') + (type === 36 ? ' Z' : ''), type === 36);
    }
    else fail(`record 0x${u(at + 4).toString(16)}`);
    at += size;
  }
  if (!eof || largest !== maxRecord || !paint.length) fail('incomplete drawing');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" preserveAspectRatio="none" viewBox="0 0 ${width} ${height}">${paint.join('')}</svg>`;
  if (svg.length > 16 * 1024 * 1024) fail('drawing output limit');
  return { mime: WMF_MIME, width: Math.ceil(width), height: Math.ceil(height), svg };
}
export function wmfInfo(bytes, viewport) {
  try { return parse(bytes, viewport); } catch (error) { if (error instanceof RangeError) fail('truncated record fields'); throw error; }
}
export async function decodeWmf(bytes, viewport) {
  const { svg } = wmfInfo(bytes, viewport), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), image = new Image();
  try { image.src = url; await image.decode(); image.close = () => { image.removeAttribute('src'); URL.revokeObjectURL(url); }; return vectorImage(image); }
  catch (error) { URL.revokeObjectURL(url); throw error; }
}
