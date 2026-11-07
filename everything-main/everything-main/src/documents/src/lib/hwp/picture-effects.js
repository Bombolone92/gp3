/** Optional HWP 5 picture tail, following table 107 in Hancom's specification. */
import { check } from './binary.js';

const colorEffects = ['alpha', 'alphaMod', 'alphaOff', 'red', 'redMod', 'redOff', 'green', 'greenMod', 'greenOff', 'blue', 'blueMod', 'blueOff', 'hue', 'hueMod', 'hueOff', 'sat', 'satMod', 'satOff', 'lum', 'lumMod', 'lumOff', 'shade', 'tint', 'gray', 'comp', 'gamma', 'invGamma', 'inv'];
const alignments = ['TOP_LEFT', 'TOP', 'TOP_RIGHT', 'LEFT', 'CENTER', 'RIGHT', 'BOTTOM_LEFT', 'BOTTOM', 'BOTTOM_RIGHT'];

export function binaryPictureTail(r, warnings) {
  const result = { effects: {} };
  if (r.remaining < 4) return result;
  r.skip(4); // instance ID (border transparency has already been consumed)
  if (r.remaining < 4) return result;
  const flags = r.u32();
  const float = () => { const v = r.view.getFloat32(r.take(4), true); check(Number.isFinite(v)); return v; };
  function color() {
    const type = r.i32(); let value;
    if (type === 0) value = r.u32().toString(16).padStart(6, '0').slice(-6);
    else if ([1, 2, 3, 4].includes(type)) { r.skip(4); warnings.add('A picture effect color uses an unsupported color space.'); }
    else if (type === 5 || type === 6) { r.skip(12); warnings.add('A picture effect color uses an unsupported color space.'); }
    else check(false);
    const count = r.u32(); check(count <= 64);
    const transforms = [];
    for (let i = 0; i < count; i++) { const name = colorEffects[r.i32()], value = float(); if (name) transforms.push({ name, value }); }
    return { value: value || '000000', transforms };
  }
  try {
    check(!(flags & ~15));
    if (flags & 1) {
      const style = r.i32(), shadow = { style: style === 1 ? 'INSIDE' : 'OUTSIDE', transparency: float(), radius: float(), direction: float(), distance: float(), align: alignments[r.i32()] || 'CENTER', skewX: float(), skewY: float(), scaleX: float(), scaleY: float(), rotate: !!r.i32() };
      shadow.color = color(); result.effects.shadow = shadow;
    }
    if (flags & 2) { const glow = { transparency: float(), radius: float() }; glow.color = color(); result.effects.glow = glow; }
    if (flags & 4) result.effects.softEdge = { radius: float() };
    if (flags & 8) {
      const reflection = { align: alignments[r.i32()] || 'BOTTOM_LEFT', radius: float(), direction: float(), distance: float(), skewX: float(), skewY: float(), scaleX: float(), scaleY: float(), rotate: !!r.i32(), startAlpha: float(), startPos: float(), endAlpha: float(), endPos: float(), fadeDirection: float() };
      result.effects.reflection = reflection;
    }
    if (r.remaining >= 8) { result.dimensions = { width: r.u32(), height: r.u32() }; if (r.remaining) result.transparency = r.u8() / 255; }
  } catch {
    warnings.add('Some optional picture properties could not be decoded.');
  }
  if (flags) warnings.add('Advanced picture effects (shadow, glow, soft edges and reflection) may differ in the editor.');
  return result;
}
