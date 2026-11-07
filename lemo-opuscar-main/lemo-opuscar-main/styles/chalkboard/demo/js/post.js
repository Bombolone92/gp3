// WebGL2 post pass only: camera motion blur, lens vignette, a gentle filmic grade and dither over the finished
// Canvas 2D frame. It draws nothing of its own.
const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;
const FS = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform sampler2D tSrc; uniform mat3 uBlur; uniform float uVig, uSeed;
out vec4 o;
float hsh(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 at(vec2 px){ return texture(tSrc, px / uRes).rgb; }
void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 pp = (uBlur * vec3(px, 1.)).xy, v = px - pp; float lv = length(v);
  vec3 c;
  if (lv > .6) { int n = int(clamp(lv / 1.5, 4., 24.)); c = vec3(0.);
    for (int i = 0; i < 24; i++){ if (i >= n) break; c += at(pp + v * ((float(i) + .5) / float(n))); } c /= float(n); }
  else c = at(px);
  vec2 q = (px / uRes - .5) * vec2(1., uRes.y / uRes.x) * 2.;
  c *= 1. - uVig * smoothstep(.35, 1.25, length(q * vec2(.92, 1.25)));
  c = max(c, 0.); c = c * (1. + c * .08) / (1. + c * .55) * 1.5;
  float l = dot(c, vec3(.3, .55, .15));
  c += vec3(-.006, .002, .010) * (1. - smoothstep(0., .25, l));
  c *= mix(vec3(1.), vec3(1.025, 1.0, .965), smoothstep(.4, .95, l));
  c = mix(vec3(l), c, 1.04);
  c += (hsh(px + uSeed * 91.) - .5) / 255.;
  o = vec4(clamp(c, 0., 1.), 1.);
}`;
export class Post {
  constructor(canvas, W, H) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl; this.W = W; this.H = H;
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p); this.p = p;
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.tex = gl.createTexture();
  }
  draw(src, blur, t, vig = .42) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.useProgram(this.p); gl.viewport(0, 0, this.W, this.H);
    const U = n => gl.getUniformLocation(this.p, n);
    gl.uniform2f(U('uRes'), this.W, this.H); gl.uniformMatrix3fv(U('uBlur'), false, blur); gl.uniform1f(U('uVig'), vig); gl.uniform1f(U('uSeed'), t);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(U('tSrc'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3); gl.finish();
  }
}
