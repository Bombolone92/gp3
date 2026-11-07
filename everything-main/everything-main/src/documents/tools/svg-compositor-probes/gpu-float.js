export class NativeSvgCompositor {
 constructor(width,height){
  this.canvas=new OffscreenCanvas(width,height);this.gl=this.canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:false,antialias:false,preserveDrawingBuffer:true});const gl=this.gl;if(!gl)throw Error('WebGL2 unavailable');
  const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const vertex=shader(gl.VERTEX_SHADER,`#version 300 es
  void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`);
  const fragment=shader(gl.FRAGMENT_SHADER,`#version 300 es
  precision highp float;precision highp int;
  uniform sampler2D sourceImage;uniform sampler2D destinationImage;out vec4 outputColor;
  vec3 roundedProduct(vec3 a,float b){return floor((a*b+127.0)/255.0);}
  void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec4 s=floor(texelFetch(sourceImage,p,0)*255.0+0.5);vec4 d=floor(texelFetch(destinationImage,p,0)*255.0+0.5);
   if(s.a==0.0){outputColor=d/255.0;return;}
   float remaining=255.0-s.a;float next=s.a+floor((d.a*remaining+127.0)/255.0);float inverse=floor((255.0*65536.0)/next);
   vec3 source=roundedProduct(s.rgb,s.a);vec3 destination=roundedProduct(d.rgb,d.a);
   vec3 rgb=min(vec3(255.0),floor((source+roundedProduct(destination,remaining))*inverse/65536.0));
   outputColor=vec4(rgb,next)/255.0;
  }`);
  this.program=gl.createProgram();gl.attachShader(this.program,vertex);gl.attachShader(this.program,fragment);gl.linkProgram(this.program);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));gl.deleteShader(vertex);gl.deleteShader(fragment);gl.useProgram(this.program);gl.uniform1i(gl.getUniformLocation(this.program,'sourceImage'),0);gl.uniform1i(gl.getUniformLocation(this.program,'destinationImage'),1);
  this.textures=Array.from({length:3},()=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);return t;});this.framebuffer=gl.createFramebuffer();this.width=width;this.height=height;
 }
 upload(index,bytes){const gl=this.gl;gl.bindTexture(gl.TEXTURE_2D,this.textures[index]);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,this.width,this.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);}
 compose(source,destination){this.upload(0,source);this.upload(1,destination);const gl=this.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.textures[0]);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.textures[1]);gl.drawArrays(gl.TRIANGLES,0,3);}
 pixels(){const out=new Uint8Array(this.width*this.height*4);this.gl.readPixels(0,0,this.width,this.height,this.gl.RGBA,this.gl.UNSIGNED_BYTE,out);return out;}
 close(){const gl=this.gl;this.textures.forEach(t=>gl.deleteTexture(t));gl.deleteFramebuffer(this.framebuffer);gl.deleteProgram(this.program);gl.getExtension('WEBGL_lose_context')?.loseContext();}
}
