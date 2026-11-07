import { blendModes } from './modes';

// GPU snippets of the blend formulas. Separable modes are written once as
// scalar expressions in the common subset of GLSL ES 3.0, WGSL and JavaScript
// (float literals with a decimal point, min/max/abs/sqrt and helper calls),
// so the very same text is compiled into all three; tests run the JavaScript
// build against the TypeScript reference in modes.ts.
type Expr = string;
const helpers: [name: string, expr: Expr][] = [
  ['bl_c01', 'min(max(s, 0.0), 1.0)'],
  ['bl_burn', 'bl_sel(b >= 1.0, 1.0, bl_sel(s <= 0.0, 0.0, 1.0 - min(1.0, (1.0 - b) / max(s, 1e-9))))'],
  ['bl_dodge', 'bl_sel(b <= 0.0, 0.0, bl_sel(s >= 1.0, 1.0, min(1.0, b / max(1.0 - s, 1e-9))))'],
  ['bl_screen', 'b + s - b * s'],
  ['bl_hard', 'bl_sel(s <= 0.5, b * 2.0 * s, bl_screen(b, 2.0 * s - 1.0))'],
  ['bl_softd', 'bl_sel(b <= 0.25, ((16.0 * b - 12.0) * b + 4.0) * b, sqrt(max(b, 0.0)))'],
];
// Separable mode index -> scalar expression of b (backdrop) and s (source).
export const separableExpressions: Record<number, Expr> = {
  2: 'min(b, s)',
  3: 'b * s',
  4: 'bl_burn(b, s)',
  5: 'max(0.0, b + s - 1.0)',
  7: 'max(b, s)',
  8: 'bl_screen(b, s)',
  9: 'bl_dodge(b, s)',
  10: 'min(1.0, b + s)',
  12: 'bl_hard(s, b)',
  13: 'bl_sel(s <= 0.5, b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (bl_softd(b, s) - b))',
  14: 'bl_hard(b, s)',
  15: 'bl_sel(s <= 0.5, bl_burn(b, 2.0 * s), bl_dodge(b, 2.0 * s - 1.0))',
  16: 'bl_c01(0.0, b + 2.0 * s - 1.0)',
  17: 'bl_sel(s <= 0.5, min(b, 2.0 * s), max(b, 2.0 * s - 1.0))',
  18: 'bl_sel(b + s >= 1.0, 1.0, 0.0)',
  19: 'abs(b - s)',
  20: 'b + s - 2.0 * b * s',
  21: 'max(0.0, b - s)',
  22: 'bl_sel(s <= 0.0, bl_sel(b <= 0.0, 0.0, 1.0), min(1.0, b / max(s, 1e-9)))',
};

const name = (i: number) => `// ${i} ${blendModes[i].id}`;
function glslSource() {
  let src = 'float bl_sel(bool c,float t,float f){return c?t:f;}\n';
  for (const [n, e] of helpers) src += `float ${n}(float b,float s){return ${e};}\n`;
  for (const [i, e] of Object.entries(separableExpressions))
    src += `float bl_m${i}(float b,float s){return ${e};}\n`;
  src += `float bl_lum(vec3 c){return dot(c,vec3(.3,.59,.11));}
float bl_sat(vec3 c){return max(max(c.x,c.y),c.z)-min(min(c.x,c.y),c.z);}
vec3 bl_clip(vec3 c){float l=bl_lum(c);float n=min(min(c.x,c.y),c.z);float x=max(max(c.x,c.y),c.z);
 if(n<0.&&l>n)c=l+(c-l)*l/(l-n);if(x>1.&&x>l)c=l+(c-l)*(1.-l)/(x-l);return c;}
vec3 bl_setLum(vec3 c,float l){return bl_clip(c+(l-bl_lum(c)));}
vec3 bl_setSat(vec3 c,float s){float mx=max(max(c.x,c.y),c.z);float mn=min(min(c.x,c.y),c.z);return mx>mn?(c-mn)*s/(mx-mn):vec3(0.);}
vec3 blendMode(int mode,vec3 b,vec3 s){\n`;
  for (const i of Object.keys(separableExpressions))
    src += ` if(mode==${i})return vec3(bl_m${i}(b.x,s.x),bl_m${i}(b.y,s.y),bl_m${i}(b.z,s.z));${name(+i)}\n`;
  src += ` if(mode==6)return bl_lum(b)<bl_lum(s)?b:s;${name(6)}
 if(mode==11)return bl_lum(b)>bl_lum(s)?b:s;${name(11)}
 if(mode==23)return bl_setLum(bl_setSat(s,bl_sat(b)),bl_lum(b));${name(23)}
 if(mode==24)return bl_setLum(bl_setSat(b,bl_sat(s)),bl_lum(b));${name(24)}
 if(mode==25)return bl_setLum(s,bl_lum(b));${name(25)}
 if(mode==26)return bl_setLum(b,bl_lum(s));${name(26)}
 return s;// 0 normal, 1 dissolve (coverage is decided outside)
}
`;
  return src;
}
function wgslSource() {
  let src = 'fn bl_sel(c:bool,t:f32,f:f32)->f32{return select(f,t,c);}\n';
  for (const [n, e] of helpers) src += `fn ${n}(b:f32,s:f32)->f32{return ${e};}\n`;
  for (const [i, e] of Object.entries(separableExpressions))
    src += `fn bl_m${i}(b:f32,s:f32)->f32{return ${e};}\n`;
  src += `fn bl_lum(c:vec3f)->f32{return dot(c,vec3f(.3,.59,.11));}
fn bl_sat(c:vec3f)->f32{return max(max(c.x,c.y),c.z)-min(min(c.x,c.y),c.z);}
fn bl_clip(c0:vec3f)->vec3f{var c=c0;let l=bl_lum(c);let n=min(min(c.x,c.y),c.z);let x=max(max(c.x,c.y),c.z);
 if(n<0.&&l>n){c=l+(c-l)*l/(l-n);}if(x>1.&&x>l){c=l+(c-l)*(1.-l)/(x-l);}return c;}
fn bl_setLum(c:vec3f,l:f32)->vec3f{return bl_clip(c+(l-bl_lum(c)));}
fn bl_setSat(c:vec3f,s:f32)->vec3f{let mx=max(max(c.x,c.y),c.z);let mn=min(min(c.x,c.y),c.z);if(mx>mn){return (c-mn)*s/(mx-mn);}return vec3f(0.);}
fn blendMode(mode:i32,b:vec3f,s:vec3f)->vec3f{\n`;
  for (const i of Object.keys(separableExpressions))
    src += ` if(mode==${i}){return vec3f(bl_m${i}(b.x,s.x),bl_m${i}(b.y,s.y),bl_m${i}(b.z,s.z));}${name(+i)}\n`;
  src += ` if(mode==6){return select(s,b,bl_lum(b)<bl_lum(s));}${name(6)}
 if(mode==11){return select(s,b,bl_lum(b)>bl_lum(s));}${name(11)}
 if(mode==23){return bl_setLum(bl_setSat(s,bl_sat(b)),bl_lum(b));}${name(23)}
 if(mode==24){return bl_setLum(bl_setSat(b,bl_sat(s)),bl_lum(b));}${name(24)}
 if(mode==25){return bl_setLum(s,bl_lum(b));}${name(25)}
 if(mode==26){return bl_setLum(b,bl_lum(s));}${name(26)}
 return s;// 0 normal, 1 dissolve (coverage is decided outside)
}
`;
  return src;
}
// `vec3 blendMode(int mode, vec3 b, vec3 s)`; ids are `blendModes` indices.
export const blendGlsl = glslSource();
// `fn blendMode(mode: i32, b: vec3f, s: vec3f) -> vec3f`; same ids.
export const blendWgsl = wgslSource();

// JavaScript build of the separable expressions (same text as the shaders),
// used by tests to keep the snippets aligned with the reference.
export function separableFromSnippet(): Record<number, (b: number, s: number) => number> {
  let body =
    'const min=Math.min,max=Math.max,abs=Math.abs,sqrt=Math.sqrt;\nconst bl_sel=(c,t,f)=>c?t:f;\n';
  for (const [n, e] of helpers) body += `const ${n}=(b,s)=>${e};\n`;
  body += 'return {';
  for (const [i, e] of Object.entries(separableExpressions)) body += `${i}:(b,s)=>${e},`;
  body += '};';
  return new Function(body)();
}
