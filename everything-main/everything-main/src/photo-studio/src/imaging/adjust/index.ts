// Color adjustments: typed model, exact CPU path, GPU compilation, analysis
// and the destructive Image > Adjustments operations.
export * from './model';
export * from './color-math';
export * from './gradient-stops';
export { monotoneSpline, curveFunction, curveToValues, smoothCurveValues, levelsFunction, isIdentityCurve, isIdentityLevels } from './curves';
export { parseCubeLut, serializeCubeLut, sampleCubeLut, bakeCubeLut, CubeParseError, type CubeLut } from './cube';
export { BUILTIN_LOOKS, builtinLook, type BuiltinLookId } from './looks';
export { hueRangeWeight, planFor, lightToneCurve, whiteBalanceGains, type Plan, type PixelFn } from './kinds';
export {
  applySpatial,
  clarityDehaze,
  clarityDehazeAmounts,
  clarityDehazeFloat,
  clarityDehazePixel,
  grain,
  grainAmounts,
  grainFloat,
  grainHash,
  grainNoise,
  grainPixel,
  reducedPlanes,
  spatialGeometry,
  SPATIAL_WORK,
  type SpatialContext,
  type SpatialGeometry,
} from './spatial';
export {
  applyAdjustment,
  applyCompiled,
  compileAdjustment,
  isIdentityAdjustment,
  adjustmentToCubeLut,
  evaluateAdjustment,
  adjustmentEvaluator,
  type CompiledAdjustment,
  type CompileOptions,
  type CurveTables,
} from './engine';
export * from './histogram';
export { blurChannel, boxRadiiForSigma } from './blur';
export { shadowsHighlights, localMean, DEFAULT_SHADOWS_HIGHLIGHTS, type ShadowsHighlightsParams } from './shadows-highlights';
export { hdrToning, toneMap, toningParams, toningCurveTable, DEFAULT_HDR_TONING, TONING_CURVES, type HdrToningParams, type ToningMethod } from './hdr-toning';
export { replaceColor, colorRangeMask, type ReplaceColorParams } from './replace-color';
export { adjustmentOperations, equalize } from './operations';
