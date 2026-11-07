// The map lives on a physical sheet of paper lying on a dark table. Each frame the 2D map (ink only, transparent
// background) is drawn into a texture for the region the camera sees; this WebGL2 pass lays it on a plane seen by a
// perspective camera, prints it onto procedural paper (fibres, tooth, a raking light, a faint sheen at low angles)
// and finishes with a depth-of-field pass computed analytically from the plane depth.
(function () {
const VS = `#version 300 es
in vec2 p; out vec2 v; void main(){ v = p*.5+.5; gl_Position = vec4(p,0.,1.); }`;

// pass 1: ray -> plane -> paper + ink
const FS1 = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform vec2 uRes;            // output size in pixels
uniform vec3 uCam, uF, uR, uU; // camera position (world units, z up), forward, right, up
uniform float uFocal;          // focal length in pixels (at 1080 high)
uniform vec4 uRegion;          // texture region: x0, y0, x1, y1 (world)
uniform sampler2D uMap, uPaper;
uniform vec4 uSheet;           // sheet bounds x0,y0,x1,y1
uniform float uInk;            // overall ink opacity (1)
uniform float uDim;            // darkening of the whole frame (end / tunnel cut)
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
void main(){
  vec2 px = (v*uRes - .5*uRes) * (1080./uRes.y);
  vec3 d = normalize(uF*uFocal + uR*px.x + uU*px.y);
  float t = -uCam.z / min(d.z, -1e-4);
  vec3 w = uCam + d*t;                       // hit on the plane z = 0; x east, y south (map coords)
  vec2 m = w.xy;
  // paper
  vec2 pu = m / 900.;
  float f1 = texture(uPaper, pu).r, f2 = texture(uPaper, pu*3.7+.31).g, f3 = texture(uPaper, m/260.).b;
  vec3 paper = vec3(.952,.936,.900);
  paper *= .955 + .05*f1 + .03*(f2-.5) ;
  paper -= .03*smoothstep(.62,.95,f3);       // darker fibres
  // raking light from the top left across the sheet + faint sheen when seen at a low angle
  vec2 sc = (m - uSheet.xy) / (uSheet.zw - uSheet.xy);
  float light = .965 + .05*(1.-sc.x*.6-sc.y*.8);
  vec3 L = normalize(vec3(-.5,-.7,.55)), V = normalize(uCam - w), H = normalize(L+V);
  float sheen = pow(max(H.z,0.), 60.) * .10 * smoothstep(.15,.6, 1.-V.z);
  // ink
  vec2 uv = (m - uRegion.xy) / (uRegion.zw - uRegion.xy);
  vec4 ink = texture(uMap, vec2(uv.x, uv.y));
  float inside = step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
  ink *= inside * uInk;
  // ink soaks into the tooth: slightly uneven density, never fully flat
  float tooth = .93 + .07*f2 + .03*(hash(floor(m*1.7))-.5);
  vec3 col = paper*(1.-ink.a) + ink.rgb*tooth;
  col *= light;
  col += sheen;
  // the sheet edge: outside it is the table, with a soft shadow under the paper
  vec2 e = min(m - uSheet.xy, uSheet.zw - m);
  float ins = min(e.x, e.y);
  float edge = smoothstep(-1.5, 1.5, ins);
  vec3 table = vec3(.105,.098,.094) * (.9 + .2*f1);
  float shadow = 1. - .55*exp(-max(-ins,0.)/22.);
  table *= shadow;
  col = mix(table, col, edge);
  // far haze so the horizon never aliases
  float far = smoothstep(9000., 22000., t);
  col = mix(col, vec3(.09,.085,.08), far);
  o = vec4(col*(1.-uDim), t);
}`;

// pass 2: depth of field (circle of confusion from the analytic plane depth), vignette, light grade
const FS2 = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D uImg; uniform vec2 uRes;
uniform float uFocusD, uAperture, uVig, uMaxR;
const int N = 28;
void main(){
  vec4 c0 = texture(uImg, v);
  float d0 = c0.a;
  float r = clamp(uAperture * abs(d0 - uFocusD) / d0, 0., uMaxR);
  vec3 acc = c0.rgb; float wsum = 1.;
  if (r > .6) {
    for (int i = 1; i < N; i++) {
      float a = float(i) * 2.39996, rr = sqrt(float(i)/float(N)) * r;
      vec2 o2 = vec2(cos(a), sin(a)) * rr / uRes;
      vec4 s = texture(uImg, v + o2);
      float rs = clamp(uAperture * abs(s.a - uFocusD) / s.a, 0., uMaxR);
      float w = smoothstep(rr - 1., rr + 1., rs) + .02;   // a sample only spreads as far as its own blur
      acc += s.rgb * w; wsum += w;
    }
  }
  vec3 col = acc / wsum;
  vec2 q = v - .5; q.x *= uRes.x/uRes.y;
  col *= 1. - uVig * smoothstep(.35, 1.05, length(q));
  col = pow(col, vec3(1.02));
  o = vec4(col, 1.);
}`;

function sh(gl, type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
function prog(gl, fs) { const p = gl.createProgram(); gl.attachShader(p, sh(gl, gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl, gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }

window.makePlane = function (canvas, paperCanvas) {
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL2 is required');
  gl.getExtension('EXT_color_buffer_float');
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const p1 = prog(gl, FS1), p2 = prog(gl, FS2);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tex = (wrap) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return t; };
  const mapT = tex(gl.CLAMP_TO_EDGE), paperT = tex(gl.REPEAT);
  gl.bindTexture(gl.TEXTURE_2D, paperT); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paperCanvas); gl.generateMipmap(gl.TEXTURE_2D);
  let fbo = null, fboT = null, fw = 0, fh = 0;
  function ensureFBO(w, h) {
    if (fbo && fw === w && fh === h) return;
    fw = w; fh = h; fboT = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, fboT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboT, 0);
  }
  const U = (p, n) => gl.getUniformLocation(p, n);
  return {
    // cam: {pos, F, R, Up, focal}; region [x0,y0,x1,y1]; mapCanvas: the inked region; opt: {sheet, focusD, aperture, vig, dim}
    draw(cam, region, mapCanvas, opt) {
      const W = canvas.width, H = canvas.height; ensureFBO(W, H);
      gl.bindTexture(gl.TEXTURE_2D, mapT); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mapCanvas); gl.generateMipmap(gl.TEXTURE_2D);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, W, H); gl.useProgram(p1);
      gl.uniform2f(U(p1, 'uRes'), W, H); gl.uniform3fv(U(p1, 'uCam'), cam.pos); gl.uniform3fv(U(p1, 'uF'), cam.F);
      gl.uniform3fv(U(p1, 'uR'), cam.R); gl.uniform3fv(U(p1, 'uU'), cam.Up); gl.uniform1f(U(p1, 'uFocal'), cam.focal);
      gl.uniform4fv(U(p1, 'uRegion'), region); gl.uniform4fv(U(p1, 'uSheet'), opt.sheet);
      gl.uniform1f(U(p1, 'uInk'), 1); gl.uniform1f(U(p1, 'uDim'), opt.dim || 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mapT); gl.uniform1i(U(p1, 'uMap'), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, paperT); gl.uniform1i(U(p1, 'uPaper'), 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.useProgram(p2);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fboT); gl.uniform1i(U(p2, 'uImg'), 0);
      gl.uniform2f(U(p2, 'uRes'), W, H); gl.uniform1f(U(p2, 'uFocusD'), opt.focusD); gl.uniform1f(U(p2, 'uAperture'), opt.aperture * H / 1080);
      gl.uniform1f(U(p2, 'uVig'), opt.vig ?? .22); gl.uniform1f(U(p2, 'uMaxR'), 26 * H / 1080);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
};
})();
