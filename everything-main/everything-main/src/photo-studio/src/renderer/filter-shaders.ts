// Image filter passes for spatial adjustment layers (Clarity & Dehaze,
// Grain). The math mirrors src/imaging/adjust/spatial.ts; keep the GLSL and
// WGSL versions, and the CPU reference, in step.
//
// Every pass reads up to three textures with texelFetch/textureLoad (so byte
// and float sources both work) and writes one target. Uniforms u[0..3]:
// u[0].x selects the mode.
//   1 reduce: u[0].y = factor. Block averages of (luma * alpha, alpha), the
//     block's dark channel (min of R, G, B over pixels with alpha, else 1) and
//     its largest alpha.
//   2 separable: u[0].yz = step direction. u[1] = (sigma, radius) of the
//     Gaussian on .rg (radius 0 copies), then the .b operation (0 copy, 1 min,
//     2 Gaussian), its radius; u[2].x = .b sigma. Edges repeat the border.
//   3 max: u[0].y = factor. Largest .b over block pixels with alpha > 0;
//     alpha 1 when any pixel had alpha.
//   4 clarity/dehaze: sources image, reduced planes, 1x1 light. u[0].y =
//     factor, u[1] = (clarity, dehaze, clarity on, dehaze on), u[2].x = clamp.
//   5 grain: u[1] = (strength, cell, roughness, color), u[2].x = clamp,
//     u[2].yz = document position of texel (0, 0).
export const glFilterFragment = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D src0;uniform highp sampler2D src1;uniform highp sampler2D src2;uniform vec4 u[4];
out vec4 outColor;
const vec3 LUMA=vec3(.2126,.7152,.0722);
vec4 tap(ivec2 p,ivec2 dir,int i){ivec2 s=textureSize(src0,0);return texelFetch(src0,clamp(p+dir*i,ivec2(0),s-1),0);}
uint mixHash(uint h0){uint h=h0;h^=h>>16u;h*=0x7feb352du;h^=h>>15u;h*=0x846ca68bu;h^=h>>16u;return h;}
float hash(int x,int y,uint seed){uint h=(uint(x)*0x8da6b343u)^(uint(y)*0xd8163841u)^(seed*0xcb1ab31fu);return float(mixHash(h)>>8u)/16777216.*2.-1.;}
float noise(vec2 q,uint seed){vec2 i=floor(q);vec2 f=q-i;vec2 w=f*f*(3.-2.*f);int x=int(i.x),y=int(i.y);
 float top=mix(hash(x,y,seed),hash(x+1,y,seed),w.x);float bottom=mix(hash(x,y+1,seed),hash(x+1,y+1,seed),w.x);return mix(top,bottom,w.y);}
void main(){
 ivec2 p=ivec2(gl_FragCoord.xy);int mode=int(u[0].x);
 if(mode==1){
  int f=int(u[0].y);ivec2 s=textureSize(src0,0);ivec2 o=p*f;ivec2 e=min(o+f,s);
  float la=0.,a=0.,d=1.,m=0.,n=0.;
  for(int y=o.y;y<e.y;y++)for(int x=o.x;x<e.x;x++){vec4 c=texelFetch(src0,ivec2(x,y),0);la+=dot(c.rgb,LUMA)*c.a;a+=c.a;n+=1.;if(c.a>0.){d=min(d,min(c.r,min(c.g,c.b)));m=max(m,c.a);}}
  outColor=vec4(la/n,a/n,d,m);return;
 }
 if(mode==2){
  ivec2 dir=ivec2(u[0].yz);vec4 c=texelFetch(src0,p,0);vec4 o=c;
  int rc=int(u[1].y);
  if(rc>0){float sg=u[1].x,sr=0.,sa=0.,sw=0.;for(int i=-rc;i<=rc;i++){float w=exp(-float(i*i)/(2.*sg*sg));vec4 t=tap(p,dir,i);sr+=w*t.r;sa+=w*t.g;sw+=w;}o.r=sr/sw;o.g=sa/sw;}
  int op=int(u[1].z),rb=int(u[1].w);
  if(op==1){float m=c.b;for(int i=-rb;i<=rb;i++)m=min(m,tap(p,dir,i).b);o.b=m;}
  else if(op==2){float sg=u[2].x,sb=0.,sw=0.;for(int i=-rb;i<=rb;i++){float w=exp(-float(i*i)/(2.*sg*sg));sb+=w*tap(p,dir,i).b;sw+=w;}o.b=sb/sw;}
  outColor=o;return;
 }
 if(mode==3){
  int f=int(u[0].y);ivec2 s=textureSize(src0,0);ivec2 o=p*f;ivec2 e=min(o+f,s);float m=0.,any=0.;
  for(int y=o.y;y<e.y;y++)for(int x=o.x;x<e.x;x++){vec4 c=texelFetch(src0,ivec2(x,y),0);if(c.a>0.){m=max(m,c.b);any=1.;}}
  outColor=vec4(m,m,m,any);return;
 }
 if(mode==4){
  vec4 c=texelFetch(src0,p,0);if(c.a<=0.){outColor=c;return;}
  float f=u[0].y;ivec2 ls=textureSize(src1,0);vec2 q=(vec2(p)+.5)/f-.5;vec2 i0=floor(q);vec2 t=q-i0;
  ivec2 a0=clamp(ivec2(i0),ivec2(0),ls-1);ivec2 a1=clamp(ivec2(i0)+1,ivec2(0),ls-1);
  vec4 sl=mix(mix(texelFetch(src1,a0,0),texelFetch(src1,ivec2(a1.x,a0.y),0),t.x),mix(texelFetch(src1,ivec2(a0.x,a1.y),0),texelFetch(src1,a1,0),t.x),t.y);
  float L=clamp(dot(c.rgb,LUMA),0.,1.);vec3 o=c.rgb;float k=u[1].y;
  if(u[1].w>.5){vec4 l1=texelFetch(src2,ivec2(0),0);float A=l1.a>0.?max(l1.b,.05):1.;
   if(k>0.){float tr=max(1.-.95*k*sl.b/A,.1);o=(c.rgb-A)/tr+A;}
   else if(k<0.){float fog=max(A,.75);o=c.rgb+(fog-c.rgb)*(-k*.6);}}
  if(u[1].z>.5&&sl.g>1e-6){float cl=u[1].x;float amt=cl>0.?1.5*cl:cl;o+=amt*(L-sl.r/sl.g)*4.*L*(1.-L);}
  o=max(o,vec3(0));if(u[2].x>.5)o=min(o,vec3(1));outColor=vec4(o,c.a);return;
 }
 if(mode==5){
  vec4 c=texelFetch(src0,p,0);if(c.a<=0.){outColor=c;return;}
  float k=u[1].x,s=u[1].y,r=u[1].z,col=u[1].w;vec2 q=vec2(p)+u[2].yz+.5;
  float n=noise(q/s,1u)*(1.-r)+noise(q/(s*.5),2u)*r;
  float L=clamp(dot(c.rgb,LUMA),0.,1.);float wt=.35+2.6*L*(1.-L);
  vec3 o=c.rgb+k*n*wt;
  if(col>0.)o+=k*col*wt*vec3(noise(q/s,3u),noise(q/s,4u),noise(q/s,5u));
  o=max(o,vec3(0));if(u[2].x>.5)o=min(o,vec3(1));outColor=vec4(o,c.a);return;
 }
 outColor=texelFetch(src0,p,0);
}`;

export const wgslFilter = `
struct U{v:array<vec4f,4>};
@group(0) @binding(0)var src0:texture_2d<f32>;@group(0) @binding(1)var src1:texture_2d<f32>;@group(0) @binding(2)var src2:texture_2d<f32>;@group(0) @binding(3)var<uniform> u:U;
struct V{@builtin(position) position:vec4f};
@vertex fn vs(@builtin(vertex_index)i:u32)->V{let p=vec2f(f32((i<<1u)&2u),f32(i&2u));var o:V;o.position=vec4f(p*2.-1.,0,1);return o;}
const LUMA=vec3f(.2126,.7152,.0722);
fn tap(p:vec2i,dir:vec2i,i:i32)->vec4f{let s=vec2i(textureDimensions(src0));return textureLoad(src0,clamp(p+dir*i,vec2i(0),s-1),0);}
fn mixHash(h0:u32)->u32{var h=h0;h^=h>>16u;h*=0x7feb352du;h^=h>>15u;h*=0x846ca68bu;h^=h>>16u;return h;}
fn hash(x:i32,y:i32,seed:u32)->f32{let h=(bitcast<u32>(x)*0x8da6b343u)^(bitcast<u32>(y)*0xd8163841u)^(seed*0xcb1ab31fu);return f32(mixHash(h)>>8u)/16777216.*2.-1.;}
fn noise(q:vec2f,seed:u32)->f32{let i=floor(q);let f=q-i;let w=f*f*(3.-2.*f);let x=i32(i.x);let y=i32(i.y);
 let top=mix(hash(x,y,seed),hash(x+1,y,seed),w.x);let bottom=mix(hash(x,y+1,seed),hash(x+1,y+1,seed),w.x);return mix(top,bottom,w.y);}
@fragment fn fs(v:V)->@location(0) vec4f{
 let p=vec2i(v.position.xy);let mode=i32(u.v[0].x);
 if(mode==1){
  let f=i32(u.v[0].y);let s=vec2i(textureDimensions(src0));let o=p*f;let e=min(o+f,s);
  var la=0.;var a=0.;var d=1.;var m=0.;var n=0.;
  for(var y=o.y;y<e.y;y++){for(var x=o.x;x<e.x;x++){let c=textureLoad(src0,vec2i(x,y),0);la+=dot(c.rgb,LUMA)*c.a;a+=c.a;n+=1.;if(c.a>0.){d=min(d,min(c.r,min(c.g,c.b)));m=max(m,c.a);}}}
  return vec4f(la/n,a/n,d,m);
 }
 if(mode==2){
  let dir=vec2i(u.v[0].yz);let c=textureLoad(src0,p,0);var o=c;
  let rc=i32(u.v[1].y);
  if(rc>0){let sg=u.v[1].x;var sr=0.;var sa=0.;var sw=0.;for(var i=-rc;i<=rc;i++){let w=exp(-f32(i*i)/(2.*sg*sg));let t=tap(p,dir,i);sr+=w*t.r;sa+=w*t.g;sw+=w;}o.r=sr/sw;o.g=sa/sw;}
  let op=i32(u.v[1].z);let rb=i32(u.v[1].w);
  if(op==1){var m=c.b;for(var i=-rb;i<=rb;i++){m=min(m,tap(p,dir,i).b);}o.b=m;}
  else if(op==2){let sg=u.v[2].x;var sb=0.;var sw=0.;for(var i=-rb;i<=rb;i++){let w=exp(-f32(i*i)/(2.*sg*sg));sb+=w*tap(p,dir,i).b;sw+=w;}o.b=sb/sw;}
  return o;
 }
 if(mode==3){
  let f=i32(u.v[0].y);let s=vec2i(textureDimensions(src0));let o=p*f;let e=min(o+f,s);var m=0.;var any=0.;
  for(var y=o.y;y<e.y;y++){for(var x=o.x;x<e.x;x++){let c=textureLoad(src0,vec2i(x,y),0);if(c.a>0.){m=max(m,c.b);any=1.;}}}
  return vec4f(m,m,m,any);
 }
 if(mode==4){
  let c=textureLoad(src0,p,0);if(c.a<=0.){return c;}
  let f=u.v[0].y;let ls=vec2i(textureDimensions(src1));let q=(vec2f(p)+.5)/f-.5;let i0=floor(q);let t=q-i0;
  let a0=clamp(vec2i(i0),vec2i(0),ls-1);let a1=clamp(vec2i(i0)+1,vec2i(0),ls-1);
  let sl=mix(mix(textureLoad(src1,a0,0),textureLoad(src1,vec2i(a1.x,a0.y),0),t.x),mix(textureLoad(src1,vec2i(a0.x,a1.y),0),textureLoad(src1,a1,0),t.x),t.y);
  let L=clamp(dot(c.rgb,LUMA),0.,1.);var o=c.rgb;let k=u.v[1].y;
  if(u.v[1].w>.5){let l1=textureLoad(src2,vec2i(0),0);var A=1.;if(l1.a>0.){A=max(l1.b,.05);}
   if(k>0.){let tr=max(1.-.95*k*sl.b/A,.1);o=(c.rgb-vec3f(A))/tr+vec3f(A);}
   else if(k<0.){let fog=max(A,.75);o=c.rgb+(vec3f(fog)-c.rgb)*(-k*.6);}}
  if(u.v[1].z>.5&&sl.g>1e-6){let cl=u.v[1].x;var amt=cl;if(cl>0.){amt=1.5*cl;}o+=vec3f(amt*(L-sl.r/sl.g)*4.*L*(1.-L));}
  o=max(o,vec3f(0));if(u.v[2].x>.5){o=min(o,vec3f(1));}return vec4f(o,c.a);
 }
 if(mode==5){
  let c=textureLoad(src0,p,0);if(c.a<=0.){return c;}
  let k=u.v[1].x;let s=u.v[1].y;let r=u.v[1].z;let col=u.v[1].w;let q=vec2f(p)+u.v[2].yz+.5;
  let n=noise(q/s,1u)*(1.-r)+noise(q/(s*.5),2u)*r;
  let L=clamp(dot(c.rgb,LUMA),0.,1.);let wt=.35+2.6*L*(1.-L);
  var o=c.rgb+vec3f(k*n*wt);
  if(col>0.){o+=k*col*wt*vec3f(noise(q/s,3u),noise(q/s,4u),noise(q/s,5u));}
  o=max(o,vec3f(0));if(u.v[2].x>.5){o=min(o,vec3f(1));}return vec4f(o,c.a);
 }
 return textureLoad(src0,p,0);
}`;
