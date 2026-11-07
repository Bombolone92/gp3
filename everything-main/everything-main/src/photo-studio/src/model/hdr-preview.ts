// 32-bit preview options: how the display shows linear high-dynamic-range
// values (exposure and gamma, highlight compression or a filmic curve). Only
// the presented canvas changes; stored samples, readbacks and exports do not.
// The same math runs in the renderer's color shaders (color-shaders.ts) on
// linear values before display encoding; `toneMapPreview` is its reference.
export type HdrPreviewMethod = 'exposure-gamma' | 'highlight-compression' | 'filmic';
export type HdrPreview = {
  method: HdrPreviewMethod;
  // Stops, -20..20.
  exposure: number;
  // Display gamma, 0.1..9.99 (exposure and gamma only); 1 leaves values.
  gamma: number;
  // Linear value shown as white (highlight compression), 1..100.
  white: number;
};
export const HDR_PREVIEW_METHODS: [HdrPreviewMethod, string][] = [
  ['exposure-gamma', 'Exposure and Gamma'],
  ['highlight-compression', 'Highlight Compression'],
  ['filmic', 'Filmic Curve'],
];
export const defaultHdrPreview = (): HdrPreview => ({ method: 'exposure-gamma', exposure: 0, gamma: 1, white: 4 });

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export function isIdentityHdrPreview(p: HdrPreview | undefined) {
  return !p || (p.method === 'exposure-gamma' && p.exposure === 0 && p.gamma === 1);
}
export function validateHdrPreview(v: unknown): HdrPreview {
  const p = v as HdrPreview;
  if (!p || typeof p !== 'object' || !HDR_PREVIEW_METHODS.some(([m]) => m === p.method) ||
    ![p.exposure, p.gamma, p.white].every((n) => typeof n === 'number' && Number.isFinite(n)))
    throw new Error('Invalid 32-bit preview options.');
  return { method: p.method, exposure: clamp(p.exposure, -20, 20), gamma: clamp(p.gamma, 0.1, 9.99), white: clamp(p.white, 1, 100) };
}
/** Shader parameters: method (0 none), exposure multiplier, 1/gamma, white. */
export function hdrPreviewUniforms(p: HdrPreview | undefined): [number, number, number, number] {
  if (isIdentityHdrPreview(p)) return [0, 1, 1, 1];
  const method = p!.method === 'exposure-gamma' ? 1 : p!.method === 'highlight-compression' ? 2 : 3;
  return [method, Math.pow(2, clamp(p!.exposure, -20, 20)), 1 / clamp(p!.gamma, 0.1, 9.99), clamp(p!.white, 1, 100)];
}
/** Linear RGB in, linear display RGB out (mirrors the shader). */
export function toneMapPreview(p: HdrPreview | undefined, rgb: readonly number[]): [number, number, number] {
  const [m, mul, inv, w] = hdrPreviewUniforms(p);
  let c = rgb.map((v) => v) as [number, number, number];
  if (m === 0) return c;
  c = c.map((v) => v * mul) as [number, number, number];
  if (m === 1) return c.map((v) => Math.pow(Math.max(v, 0), inv)) as [number, number, number];
  if (m === 2)
    // Extended Reinhard per channel: 0 stays 0, `white` reaches 1.
    return c.map((v) => {
      const x = Math.max(v, 0);
      return (x * (1 + x / (w * w))) / (1 + x);
    }) as [number, number, number];
  return c.map((v) => {
    const x = Math.max(v, 0);
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1);
  }) as [number, number, number];
}
