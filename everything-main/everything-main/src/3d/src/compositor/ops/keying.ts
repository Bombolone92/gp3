// Keying nodes as per-pixel generators (formulas mirrored from color/keying.ts).
import { registerExec } from '../eval/evaluator';
import { registerPixel, runPixelNode, pixelGeneratorFor, CMP_LIB } from '../eval/pixel';
import { KEYING_GLSL } from '../color/keying';
import { menuValue } from '../nodes/defs';

Object.assign(CMP_LIB, KEYING_GLSL);

const CHANNEL = (s: string) => ({ R: 0, G: 1, B: 2, H: 0, S: 1, V: 2, Y: 0, U: 1, Cb: 1, Cr: 2 })[s] ?? 0;

registerPixel('CompositorNodeLumaMatte', (g) => {
  g.lib('cmp_keying');
  const c = g.tmp('vec4', g.in('Image', 'vec4'));
  const mn = g.tmp('float', g.in('Minimum', 'float'));
  const m = g.tmp('float', `clamp((cmpLuma(${c}.rgb) - ${mn}) / max(${g.in('Maximum', 'float')} - ${mn}, 1e-6), 0.0, 1.0)`);
  const mo = g.tmp('float', '0.0');
  g.out('Image', 'vec4', `cmp_matte(${c}, ${m}, ${mo})`);
  g.out('Matte', 'float', mo);
});

registerPixel('CompositorNodeDistanceMatte', (g) => {
  g.lib('cmp_keying');
  const c = g.tmp('vec4', g.in('Image', 'vec4'));
  const k = g.tmp('vec3', g.in('Key Color', 'vec3'));
  const ycc = menuValue(g.node, 'Color Space') === 'YCC';
  const d = g.tmp('float', ycc ? `distance(cmp_rgb2ycc(${c}.rgb, 1).yz, cmp_rgb2ycc(${k}, 1).yz)` : `distance(${c}.rgb, ${k})`);
  const m = g.tmp('float', `cmp_falloff(${d}, ${g.in('Tolerance', 'float')}, ${g.in('Falloff', 'float')})`);
  const mo = g.tmp('float', '0.0');
  g.out('Image', 'vec4', `cmp_matte(${c}, ${m}, ${mo})`);
  g.out('Matte', 'float', mo);
});

registerPixel('CompositorNodeDiffMatte', (g) => {
  g.lib('cmp_keying');
  const a = g.tmp('vec4', g.in('Image 1', 'vec4')),
    b = g.tmp('vec4', g.in('Image 2', 'vec4'));
  const d = g.tmp('float', `dot(abs(${a}.rgb - ${b}.rgb), vec3(1.0 / 3.0))`);
  const tol = g.tmp('float', g.in('Tolerance', 'float'));
  const m = g.tmp('float', `${d} <= ${tol} ? 0.0 : cmp_falloff(${d}, ${tol}, ${g.in('Falloff', 'float')})`);
  const mo = g.tmp('float', '0.0');
  g.out('Image', 'vec4', `cmp_matte(${a}, ${m}, ${mo})`);
  g.out('Matte', 'float', mo);
});

registerPixel('CompositorNodeColorMatte', (g) => {
  g.lib('cmp_keying');
  const c = g.tmp('vec4', g.in('Image', 'vec4'));
  const h = g.tmp('vec3', `cmp_rgb2hsv(${c}.rgb)`),
    k = g.tmp('vec3', `cmp_rgb2hsv(${g.in('Key Color', 'vec3')})`);
  const dh = g.tmp('float', `abs(${h}.x - ${k}.x)`);
  g.stmt(`${dh} = min(${dh}, 1.0 - ${dh});`);
  const inside = `${dh} < ${g.in('Hue', 'float')} && abs(${h}.y - ${k}.y) < ${g.in('Saturation', 'float')} && abs(${h}.z - ${k}.z) < ${g.in('Value', 'float')}`;
  const mo = g.tmp('float', '0.0');
  g.out('Image', 'vec4', `cmp_matte(${c}, (${inside}) ? 0.0 : 1.0, ${mo})`);
  g.out('Matte', 'float', mo);
});

registerPixel('CompositorNodeChromaMatte', (g) => {
  g.lib('cmp_keying');
  const c = g.tmp('vec4', g.in('Image', 'vec4'));
  const m = g.tmp('float', `cmp_chroma(${c}.rgb, ${g.in('Key Color', 'vec3')}, ${g.in('Minimum', 'float')}, ${g.in('Maximum', 'float')}, ${g.in('Falloff', 'float')})`);
  const mo = g.tmp('float', '0.0');
  g.out('Image', 'vec4', `cmp_matte(${c}, ${m}, ${mo})`);
  g.out('Matte', 'float', mo);
});

registerPixel('CompositorNodeChannelMatte', (g) => {
  g.lib('cmp_keying');
  const space = menuValue(g.node, 'Color Space') || 'RGB';
  const sp = { RGB: 0, HSV: 1, YUV: 2, YCbCr: 3 }[space] ?? 0;
  const key = CHANNEL(menuValue(g.node, `${space} Key Channel`));
  const single = menuValue(g.node, 'Limit Method') === 'Single';
  const lim = CHANNEL(menuValue(g.node, `${space} Limit Channel`));
  const others = [0, 1, 2].filter((i) => i !== key);
  const c = g.tmp('vec4', g.in('Image', 'vec4'));
  const ch = g.tmp('vec3', `cmp_key_channels(${c}.rgb, ${sp})`);
  const limit = single ? `${ch}[${lim}]` : `max(${ch}[${others[0]}], ${ch}[${others[1]}])`;
  const a = g.tmp('float', `1.0 - (${ch}[${key}] - ${limit})`);
  const mn = g.tmp('float', g.in('Minimum', 'float')),
    mx = g.tmp('float', g.in('Maximum', 'float'));
  const m = g.tmp('float', `${a} > ${mx} ? 1.0 : (${a} < ${mn} ? 0.0 : (${a} - ${mn}) / max(${mx} - ${mn}, 1e-6))`);
  const mo = g.tmp('float', '0.0');
  g.out('Image', 'vec4', `cmp_matte(${c}, ${m}, ${mo})`);
  g.out('Matte', 'float', mo);
});

registerPixel('CompositorNodeColorSpill', (g) => {
  const spill = CHANNEL(menuValue(g.node, 'Spill Channel') || 'G');
  const single = (menuValue(g.node, 'Limit Method') || 'Single') === 'Single';
  const lim = CHANNEL(menuValue(g.node, 'Limit Channel') || 'R');
  const others = [0, 1, 2].filter((i) => i !== spill);
  const c = g.tmp('vec4', g.in('Image', 'vec4'));
  const limit = single ? `${c}[${lim}]` : `(${c}[${others[0]}] + ${c}[${others[1]}]) * 0.5`;
  const map = g.tmp('float', `${g.in('Fac', 'float')} * (${c}[${spill}] - ${g.in('Limit Strength', 'float')} * ${limit})`);
  const useStrength = g.in('Use Spill Strength', 'float');
  const strength = g.tmp('vec3', `${useStrength} > 0.5 ? ${g.in('Spill Strength', 'vec3')} : vec3(${spill === 0 ? 1 : 0}.0, ${spill === 1 ? 1 : 0}.0, ${spill === 2 ? 1 : 0}.0)`);
  g.out('Image', 'vec4', `${map} > 0.0 ? vec4(${c}.rgb - ${strength} * ${map}, ${c}.a) : ${c}`);
});

for (const id of [
  'CompositorNodeLumaMatte',
  'CompositorNodeDistanceMatte',
  'CompositorNodeDiffMatte',
  'CompositorNodeColorMatte',
  'CompositorNodeChromaMatte',
  'CompositorNodeChannelMatte',
  'CompositorNodeColorSpill',
])
  registerExec(id, (x) => runPixelNode(x, pixelGeneratorFor(id)!));
