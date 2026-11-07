// Filter set A: Blur, Blur Gallery, Sharpen, Noise, Stylize, Render, Video, Other.
import type { ImageOperation } from '../types';
import {
  average,
  blur,
  blurMore,
  boxBlur,
  gaussianBlur,
  irisBlur,
  lensBlur,
  motionBlur,
  radialBlur,
  edgePreservingBlur,
  surfaceBlur,
  tiltShift,
} from './blur';
import { fieldBlur, pathBlur, spinBlur } from './gallery-blur';
import { shapeBlur } from './shape-blur';
import { flame, pictureFrame, tree } from './render-procedural';
import { hsbHsl } from './channels-hsb';
import { addNoise, despeckle, dustAndScratches, median, reduceNoise } from './noise';
import { custom, highPass, maximum, minimum, offset } from './other';
import { clouds, differenceClouds, fibers, lensFlare, lightingEffects } from './render';
import { advancedSharpen, sharpen, sharpenEdges, sharpenMore, unsharpMask } from './sharpen';
import { denoiseOp, sharpenDetailsOp } from './restore';
import {
  diffuse,
  emboss,
  extrude,
  findEdges,
  glowingEdges,
  oilPaint,
  solarize,
  tiles,
  traceContour,
  wind,
} from './stylize';
import { broadcastSafe, deinterlace } from './video';

export const filtersA: ImageOperation[] = [
  // Blur
  average, blur, blurMore, boxBlur, gaussianBlur, lensBlur, motionBlur, radialBlur, edgePreservingBlur, shapeBlur, surfaceBlur,
  // Blur Gallery
  fieldBlur, irisBlur, pathBlur, spinBlur, tiltShift,
  // Noise
  addNoise, denoiseOp, despeckle, dustAndScratches, median, reduceNoise,
  // Render
  clouds, differenceClouds, fibers, flame, lensFlare, lightingEffects, pictureFrame, tree,
  // Sharpen
  sharpen, sharpenEdges, sharpenMore, advancedSharpen, unsharpMask, sharpenDetailsOp,
  // Stylize
  diffuse, emboss, extrude, findEdges, glowingEdges, oilPaint, solarize, tiles, traceContour, wind,
  // Video
  deinterlace, broadcastSafe,
  // Other
  custom, highPass, hsbHsl, maximum, minimum, offset,
];
