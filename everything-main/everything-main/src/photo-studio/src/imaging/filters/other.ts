// Other menu.
import type { ParamSpec } from '../types';
import {
  channelPlane,
  convolve2D,
  copyImage,
  defineOp,
  fillTransparent,
  filterChannels,
  gaussianPlane,
  minMaxRGBA,
  newImage,
  num,
  px,
  str,
  sub,
} from './common';

export const highPass = defineOp({
  id: 'high-pass',
  label: 'High Pass',
  category: 'Other',
  support: (p, ctx) => 3 * px(ctx, num(p, 'radius')) + 3,
  params: [{ key: 'radius', label: 'Radius', type: 'number', min: 0.1, max: 1000, step: 0.1, default: 10, unit: 'px' }],
  run(src, p, ctx, progress) {
    const sigma = px(ctx, num(p, 'radius'));
    const d = src.data, out = newImage(src), o = out.data, n = src.width * src.height;
    filterChannels(
      src,
      (pl, t, w, h, pr) => gaussianPlane(pl, t, w, h, sigma, pr),
      (c, b) => {
        if (c < 3) for (let i = 0, j = c; i < n; i++, j += 4) o[j] = 128 + d[j] - b[i];
      },
      progress,
    );
    for (let j = 3; j < o.length; j += 4) o[j] = d[j];
    return out;
  },
});

const shapeParams: ParamSpec[] = [
  { key: 'radius', label: 'Radius', type: 'number', min: 1, max: 500, step: 1, default: 1, unit: 'px' },
  {
    key: 'preserve',
    label: 'Preserve',
    type: 'select',
    options: [{ value: 'square', label: 'Squareness' }, { value: 'round', label: 'Roundness' }],
    default: 'square',
  },
];

export const minimum = defineOp({
  id: 'minimum',
  label: 'Minimum',
  category: 'Other',
  support: (p, ctx) => px(ctx, num(p, 'radius')) + 1,
  params: shapeParams,
  run: (src, p, ctx, progress) =>
    minMaxRGBA(src, Math.round(px(ctx, num(p, 'radius'))), false, str(p, 'preserve') === 'round', progress),
});

export const maximum = defineOp({
  id: 'maximum',
  label: 'Maximum',
  category: 'Other',
  support: (p, ctx) => px(ctx, num(p, 'radius')) + 1,
  params: shapeParams,
  run: (src, p, ctx, progress) =>
    minMaxRGBA(src, Math.round(px(ctx, num(p, 'radius'))), true, str(p, 'preserve') === 'round', progress),
});

export const offset = defineOp({
  id: 'offset',
  label: 'Offset',
  category: 'Other',
  params: [
    { key: 'horizontal', label: 'Horizontal', type: 'number', min: -16384, max: 16384, step: 1, default: 100, unit: 'px' },
    { key: 'vertical', label: 'Vertical', type: 'number', min: -16384, max: 16384, step: 1, default: 100, unit: 'px' },
    {
      key: 'undefined',
      label: 'Undefined Areas',
      type: 'select',
      options: [
        { value: 'transparent', label: 'Set to Transparent' },
        { value: 'background', label: 'Set to Background' },
        { value: 'wrap', label: 'Wrap Around' },
        { value: 'repeat', label: 'Repeat Edge Pixels' },
      ],
      default: 'wrap',
    },
  ],
  run(src, p, ctx) {
    const { width: w, height: h, data: d } = src;
    const dx = Math.round(px(ctx, num(p, 'horizontal'))), dy = Math.round(px(ctx, num(p, 'vertical')));
    const mode = str(p, 'undefined'), bg = ctx.background;
    const out = newImage(src), o = out.data;
    for (let y = 0; y < h; y++) {
      let sy = y - dy;
      const rowOut = sy < 0 || sy >= h;
      if (mode === 'wrap') sy = ((sy % h) + h) % h;
      else if (mode === 'repeat') sy = Math.min(h - 1, Math.max(0, sy));
      for (let x = 0; x < w; x++) {
        let sx = x - dx;
        const j = (y * w + x) * 4;
        if ((rowOut || sx < 0 || sx >= w) && (mode === 'transparent' || mode === 'background')) {
          if (mode === 'background') { o[j] = bg[0]; o[j + 1] = bg[1]; o[j + 2] = bg[2]; o[j + 3] = 255; }
          continue;
        }
        if (mode === 'wrap') sx = ((sx % w) + w) % w;
        else sx = Math.min(w - 1, Math.max(0, sx));
        const q = (sy * w + sx) * 4;
        o[j] = d[q]; o[j + 1] = d[q + 1]; o[j + 2] = d[q + 2]; o[j + 3] = d[q + 3];
      }
    }
    return out;
  },
});

// 5x5 kernel as 25 number parameters, row by row, k0 top-left to k24 bottom-right.
const kernelParams: ParamSpec[] = Array.from({ length: 25 }, (_, i) => ({
  key: `k${i}`,
  label: `Row ${Math.floor(i / 5) + 1}, Column ${(i % 5) + 1}`,
  type: 'number' as const,
  min: -999,
  max: 999,
  step: 1,
  default: i === 12 ? 1 : 0,
}));

export const custom = defineOp({
  id: 'custom',
  label: 'Custom',
  category: 'Other',
  support: () => 2,
  params: [
    ...kernelParams,
    { key: 'scale', label: 'Scale', type: 'number', min: 1, max: 9999, step: 1, default: 1 },
    { key: 'offset', label: 'Offset', type: 'number', min: -9999, max: 9999, step: 1, default: 0 },
  ],
  run(src, p, _ctx, progress) {
    const { width: w, height: h } = src;
    const k = Array.from({ length: 25 }, (_, i) => num(p, `k${i}`) / num(p, 'scale'));
    if (k.every((v, i) => v === (i === 12 ? 1 : 0)) && num(p, 'offset') === 0) return copyImage(src);
    const work = fillTransparent(src), out = newImage(src), o = out.data, off = num(p, 'offset');
    const dst = new Float32Array(w * h);
    for (let c = 0; c < 3; c++) {
      convolve2D(channelPlane(work, c), dst, w, h, k, 5, sub(progress, c / 3, (c + 1) / 3));
      for (let i = 0, j = c; i < dst.length; i++, j += 4) o[j] = dst[i] + off;
    }
    for (let j = 3; j < o.length; j += 4) o[j] = src.data[j];
    return out;
  },
});
