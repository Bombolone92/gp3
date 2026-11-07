// Matrix/TRC conversion after document-space blending. Curve tables retain
// their original samples and use ICC's piecewise linear interpolation.
export const glColorFragment = `#version 300 es
precision highp float;
uniform sampler2D backTex;uniform sampler2D imageTex;uniform vec4 u[8];
out vec4 outColor;
vec4 record(int i){int w=textureSize(backTex,0).x;return texelFetch(backTex,ivec2(i%w,i/w),0);}
float sampleValue(int i){vec4 v=record(i/4);return v[i%4];}
float curve(float value,int channel,bool inverse){
 int at=3+channel*3;vec4 p=record(at),q=record(at+1),t=record(at+2);int type=int(p.x);
 if(type==6){float x=abs(value),s=sign(value);if(inverse)return s*(x<=.0031308?12.92*x:1.055*pow(x,1./2.4)-.055);return s*(x<=.04045?x/12.92:pow((x+.055)/1.055,2.4));}
 if(type==5){int offset=int(t.x),last=int(t.y)-1;
  if(!inverse){float x=clamp(value,0.,1.)*float(last);int i=int(floor(x));return mix(sampleValue(offset+i),sampleValue(offset+min(i+1,last)),fract(x));}
  if(value<=sampleValue(offset))return 0.;if(value>=sampleValue(offset+last))return 1.;
  int lo=0,hi=last;while(hi-lo>1){int mid=(lo+hi)/2;if(sampleValue(offset+mid)<value)lo=mid;else hi=mid;}
  float a=sampleValue(offset+lo),b=sampleValue(offset+hi);return (float(lo)+(value-a)/(b-a))/float(last);
 }
 float g=p.y,a=p.z,b=p.w,c=q.x,d=q.y,e=q.z,f=q.w;
 if(type==0&&g==1.)return value;
 float x=clamp(value,0.,1.);if(type==0)return pow(x,inverse?1./g:g);
 if(!inverse){if(type<3)return clamp(x>=-b/a?pow(max(0.,a*x+b),g)+(type==2?c:0.):(type==2?c:0.),0.,1.);return clamp(x>=d?pow(max(0.,a*x+b),g)+(type==4?e:0.):c*x+(type==4?f:0.),0.,1.);}
 if(type<3)return clamp((pow(max(0.,x-(type==2?c:0.)),1./g)-b)/a,0.,1.);
 float highOffset=type==4?e:0.,lowOffset=type==4?f:0.;float split=pow(max(0.,a*d+b),g)+highOffset;
 return clamp(x>=split?(pow(max(0.,x-highOffset),1./g)-b)/a:(c>0.?(x-lowOffset)/c:0.),0.,1.);
}
// 32-bit preview tone mapping on linear values (see model/hdr-preview.ts):
// u[1] = method (0 none, 1 exposure and gamma, 2 highlight compression,
// 3 filmic), exposure multiplier, 1/gamma, white point.
vec3 previewTone(vec3 c){
 int m=int(u[1].x);if(m==0)return c;c*=u[1].y;
 if(m==1)return pow(max(c,vec3(0)),vec3(u[1].z));
 if(m==2){vec3 x=max(c,vec3(0));return x*(1.+x/(u[1].w*u[1].w))/(1.+x);}
 vec3 x=max(c,vec3(0));return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);
}
void main(){
 vec2 pixel=gl_FragCoord.xy;if(u[7].z<.5)pixel.y=u[6].w-pixel.y;
 ivec2 size=textureSize(imageTex,0);ivec2 at=clamp(ivec2(floor(pixel*vec2(size)/u[6].zw)),ivec2(0),size-1);
 vec4 source=texelFetch(imageTex,at,0);
 vec3 linear=previewTone(vec3(curve(source.r,0,false),curve(source.g,1,false),curve(source.b,2,false)));
 vec3 rgb=vec3(dot(record(0).xyz,linear),dot(record(1).xyz,linear),dot(record(2).xyz,linear));
 vec3 result=vec3(curve(rgb.r,3,true),curve(rgb.g,4,true),curve(rgb.b,5,true));if(u[5].w>.5)result=clamp(result,0.,1.);outColor=vec4(result,source.a);
}`;

export const wgslColor = `
struct U{v:array<vec4f,8>};@group(0) @binding(0)var backTex:texture_2d<f32>;@group(0) @binding(1)var imageTex:texture_2d<f32>;@group(0) @binding(4)var<uniform> u:U;
struct V{@builtin(position) position:vec4f};
@vertex fn vs(@builtin(vertex_index)i:u32)->V{let p=vec2f(f32((i<<1u)&2u),f32(i&2u));var o:V;o.position=vec4f(p*2.-1.,0,1);return o;}
fn record(i:i32)->vec4f{let w=i32(textureDimensions(backTex).x);return textureLoad(backTex,vec2i(i%w,i/w),0);}
fn sampleValue(i:i32)->f32{let v=record(i/4);return v[i%4];}
fn curve(value:f32,channel:i32,inverse:bool)->f32{
 let at=3+channel*3;let p=record(at);let q=record(at+1);let t=record(at+2);let kind=i32(p.x);
 if(kind==6){let x=abs(value);let s=sign(value);if(inverse){if(x<=.0031308){return s*12.92*x;}return s*(1.055*pow(x,1./2.4)-.055);}if(x<=.04045){return s*x/12.92;}return s*pow((x+.055)/1.055,2.4);}
 if(kind==5){let offset=i32(t.x);let last=i32(t.y)-1;
  if(!inverse){let x=clamp(value,0.,1.)*f32(last);let i=i32(floor(x));return mix(sampleValue(offset+i),sampleValue(offset+min(i+1,last)),fract(x));}
  if(value<=sampleValue(offset)){return 0.;}if(value>=sampleValue(offset+last)){return 1.;}
  var lo=0;var hi=last;while(hi-lo>1){let mid=(lo+hi)/2;if(sampleValue(offset+mid)<value){lo=mid;}else{hi=mid;}}
  let a=sampleValue(offset+lo);let b=sampleValue(offset+hi);return (f32(lo)+(value-a)/(b-a))/f32(last);
 }
 let g=p.y;let a=p.z;let b=p.w;let c=q.x;let d=q.y;let e=q.z;let f=q.w;
 if(kind==0&&g==1.){return value;}
 let x=clamp(value,0.,1.);if(kind==0){if(inverse){return pow(x,1./g);}return pow(x,g);}
 if(!inverse){if(kind<3){let offset=select(0.,c,kind==2);if(x>=-b/a){return clamp(pow(max(0.,a*x+b),g)+offset,0.,1.);}return clamp(offset,0.,1.);}let highOffset=select(0.,e,kind==4);let lowOffset=select(0.,f,kind==4);if(x>=d){return clamp(pow(max(0.,a*x+b),g)+highOffset,0.,1.);}return clamp(c*x+lowOffset,0.,1.);}
 if(kind<3){return clamp((pow(max(0.,x-select(0.,c,kind==2)),1./g)-b)/a,0.,1.);}
 let highOffset=select(0.,e,kind==4);let lowOffset=select(0.,f,kind==4);let split=pow(max(0.,a*d+b),g)+highOffset;
 if(x>=split){return clamp((pow(max(0.,x-highOffset),1./g)-b)/a,0.,1.);}if(c>0.){return clamp((x-lowOffset)/c,0.,1.);}return 0.;
}
fn previewTone(c0:vec3f)->vec3f{
 let m=i32(u.v[1].x);if(m==0){return c0;}let c=c0*u.v[1].y;
 if(m==1){return pow(max(c,vec3f(0)),vec3f(u.v[1].z));}
 if(m==2){let x=max(c,vec3f(0));return x*(1.+x/(u.v[1].w*u.v[1].w))/(1.+x);}
 let x=max(c,vec3f(0));return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),vec3f(0),vec3f(1));
}
@fragment fn fs(v:V)->@location(0) vec4f{
 let size=textureDimensions(imageTex);let at=clamp(vec2i(floor(v.position.xy*vec2f(size)/u.v[6].zw)),vec2i(0),vec2i(size)-1);
 let source=textureLoad(imageTex,at,0);
 let linear=previewTone(vec3f(curve(source.r,0,false),curve(source.g,1,false),curve(source.b,2,false)));
 let rgb=vec3f(dot(record(0).xyz,linear),dot(record(1).xyz,linear),dot(record(2).xyz,linear));
 var out=vec4f(curve(rgb.r,3,true),curve(rgb.g,4,true),curve(rgb.b,5,true),source.a);
 if(u.v[5].w>.5){out=vec4f(clamp(out.rgb,vec3f(0),vec3f(1)),out.a);}
 if(u.v[7].w>.5){out=vec4f(clamp(out.rgb,vec3f(0),vec3f(1))*out.a,out.a);}return out;
}`;
