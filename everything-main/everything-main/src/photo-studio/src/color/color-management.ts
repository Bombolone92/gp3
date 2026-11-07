// Public entry point of Photo Studio's color management (CMM, profiles,
// mode conversions, soft proofing and picker helpers).
export { parseIcc, IccError, INTENTS, type Intent, type Profile, type LutTag, type Clut } from './icc-lut';
export { serializeIcc, type SerializeOptions } from './icc-write';
export { builtinProfile, BUILTIN_PROFILES, type BuiltinProfileId } from './builtin-profiles';
export {
  buildCmyk,
  buildCmykProfile,
  CmykModel,
  GENERIC_COATED,
  GENERIC_UNCOATED,
  type BlackGeneration,
  type CmykModelOptions,
} from './cmyk-model';
export {
  createTransform,
  cachedTransform,
  chainTransforms,
  detectBlackPoint,
  bakeLut3D,
  bakeLut4D,
  bakeShaperTables,
  sampleLut3D,
  transformRGBA8,
  transformToGray,
  transformToCMYK,
  cmykToRGBA8,
  type ColorTransform,
  type TransformOptions,
  type Lut3D,
  type Lut4D,
  type ShaperTables,
  type CMYKPlanes,
} from './transform';
export { createProofTransform, gamutWarning, gamutErrorLut, type ProofOptions } from './proof';
export { deltaE2000, deltaE76 } from './delta-e';
export { xyzToLab, labToXYZ, bradfordMatrix, rgbToXYZMatrix, decodeLab, encodeLab, D50, D65 } from './color-math';
export {
  convertMode,
  convertModeToRGB,
  rgbToLab,
  labToRGB,
  type ImageMode,
  type ConvertOptions,
  type ModeResult,
} from './modes';
export { toIndexed, indexedToRGBA, type IndexedOptions, type IndexedResult } from './indexed';
export { grayToBitmap, packBitmap, resampleGray, type BitmapOptions, type BitmapResult, type HalftoneShape } from './bitmap';
export { curveTable, duotoneTable, duotoneToRGBA, type DuotoneInk, type DuotoneResult } from './duotone';
export {
  colorInfo,
  generateSwatchLibrary,
  harmonySwatches,
  rgbToHsb,
  hsbToRgb,
  hslToRgb,
  toHex,
  parseHex,
  type ColorInfo,
  type SwatchLibrary,
} from './color-info';
