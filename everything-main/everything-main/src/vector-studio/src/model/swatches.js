/**
 * Default swatch library for new documents: neutrals, a spectrum of
 * saturated and muted colors, and a few gradients. Each swatch is
 * { id, name, paint } where paint is a document paint (see nodes.js).
 */

const solid = (id, name, color) => ({ id, name, paint: { type: 'solid', color } });

const SPECTRUM = [
  ['Red', '#ed1c24'], ['Vermilion', '#f15a24'], ['Orange', '#f7931e'], ['Amber', '#fbb03b'], ['Yellow', '#fcee21'],
  ['Lime', '#d9e021'], ['Leaf', '#8cc63f'], ['Green', '#39b54a'], ['Emerald', '#009245'], ['Teal', '#006837'],
  ['Aqua', '#22b573'], ['Cyan', '#00a99d'], ['Sky', '#29abe2'], ['Blue', '#0071bc'], ['Navy', '#2e3192'],
  ['Indigo', '#1b1464'], ['Violet', '#662d91'], ['Purple', '#93278f'], ['Magenta', '#9e005d'], ['Rose', '#d4145a'],
  ['Pink', '#ed1e79'], ['Salmon', '#f7a194'], ['Peach', '#fbc6a4'], ['Sand', '#c69c6d'], ['Brown', '#8c6239'],
  ['Chocolate', '#603813'], ['Olive', '#736357'], ['Slate', '#534741'],
];

const GRAYS = [
  ['White', '#ffffff'], ['Gray 10%', '#e6e6e6'], ['Gray 20%', '#cccccc'], ['Gray 30%', '#b3b3b3'],
  ['Gray 40%', '#999999'], ['Gray 50%', '#808080'], ['Gray 60%', '#666666'], ['Gray 70%', '#4d4d4d'],
  ['Gray 80%', '#333333'], ['Gray 90%', '#1a1a1a'], ['Black', '#000000'],
];

export const DEFAULT_SWATCHES = [
  ...GRAYS.map(([n, c], i) => solid(`sw-g${i}`, n, c)),
  ...SPECTRUM.map(([n, c], i) => solid(`sw-c${i}`, n, c)),
  {
    id: 'sw-grad-bw',
    name: 'White, Black',
    paint: {
      type: 'linear',
      angle: 0,
      stops: [
        { offset: 0, color: '#ffffff', opacity: 1 },
        { offset: 1, color: '#000000', opacity: 1 },
      ],
    },
  },
  {
    id: 'sw-grad-radial',
    name: 'Radial Fade',
    paint: {
      type: 'radial',
      angle: 0,
      stops: [
        { offset: 0, color: '#ffffff', opacity: 1 },
        { offset: 1, color: '#000000', opacity: 1 },
      ],
    },
  },
  {
    id: 'sw-grad-sunset',
    name: 'Sunset',
    paint: {
      type: 'linear',
      angle: 90,
      stops: [
        { offset: 0, color: '#fbb03b', opacity: 1 },
        { offset: 0.5, color: '#ed1e79', opacity: 1 },
        { offset: 1, color: '#662d91', opacity: 1 },
      ],
    },
  },
  {
    id: 'sw-grad-ocean',
    name: 'Ocean',
    paint: {
      type: 'linear',
      angle: 0,
      stops: [
        { offset: 0, color: '#29abe2', opacity: 1 },
        { offset: 1, color: '#2e3192', opacity: 1 },
      ],
    },
  },
];
