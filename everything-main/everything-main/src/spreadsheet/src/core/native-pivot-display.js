import { readNativePivotLayout } from './native-pivot-layout.js';
import { readNativePivotStyle, nativePivotBodyStyleLayers } from './native-pivot-style.js';
import { readNativePivotFormats, nativePivotFormatLayers } from './native-pivot-formats.js';
import { readNativePivotPaint, nativePivotPaintLayers, nativePivotPaintAt } from './native-pivot-paint.js';
import { parseModelXml, modelChildren, standaloneModelXml } from './data-model-metadata.js';
import { effectiveColorPalette, sameFontColor } from './font-color.js';
import { normalFontStyle } from './normal-font.js';
import { xlsxFontProjection, xlsxBorderProjection, xlsxNumberFormatProjection } from './xlsx-style-projection.js';
import { numFmtToStyle, NUMBER_FORMAT_KEYS } from './format.js';
import { forEachRangeRecordAt } from './range-records.js';
import { DISPLAY_BORDER_PRIORITY } from './shared-borders.js';
import { nativeFillOverridesNormal, nativeFillMatchesPaint } from './native-fill.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const caches = new WeakMap();
const edges = ['bt', 'bb', 'bl', 'br'];
const alignmentDefaults = { align: null, valign: 'bottom', wrap: false, rot: 0, indent: 0 };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function paintContext(wb) {
  const palette = effectiveColorPalette(wb.colorPalette);
  return { themes: { fontTheme: wb.fontTheme,
    themeElements: { clrScheme: palette.theme.map(rgb => ({ rgb: rgb?.slice(1) })) },
    indexedColors: palette.indexed.map(rgb => rgb?.slice(1)),
  }, numberFormats: wb.nativePivots?.formats };
}

/** Normal is the reference for direct formatting, not cell XF zero. Keep fill
 * resource identity separate from paint: even an identical duplicate fill is
 * a direct override in Excel. Font flags, by contrast, compare property values;
 * a false bold flag matching Normal does not suppress a pivot header's bold.
 * These distinctions are verified with native Excel clipboard controls. */
export function nativePivotDirectStyle(base, normal, normalFill = null) {
  const effective = { ...normal, ...base }, direct = {};
  const font = xlsxFontProjection(effective), defaultFont = xlsxFontProjection(normal);
  for (const key of Object.keys(font)) if (key === 'color'
    ? !sameFontColor(font[key], defaultFont[key]) : font[key] !== defaultFont[key]) direct[key] = font[key];
  const fill = base && Object.hasOwn(base, 'nativeFill') ? base.nativeFill
    : base && Object.hasOwn(base, 'bg') ? null : normalFill;
  if (nativeFillOverridesNormal(base, normalFill)) {
    const bound = fill && nativeFillMatchesPaint(fill, base?.bg) ? fill : null;
    direct.bg = bound ? bound.paint || 'transparent' : base?.bg ?? 'transparent';
    direct.nativeFill = bound;
  }
  const border = xlsxBorderProjection(effective), defaultBorder = xlsxBorderProjection(normal);
  for (const side of edges) if (border[side] !== defaultBorder[side] || !equal(border[`${side}Border`], defaultBorder[`${side}Border`])) {
    direct[side] = border[side];
    direct[`${side}Border`] = border[`${side}Border`];
  }
  for (const [key, fallback] of Object.entries(alignmentDefaults)) if ((effective[key] ?? fallback) !== (normal?.[key] ?? fallback)) direct[key] = effective[key] ?? fallback;
  if (!equal(xlsxNumberFormatProjection(effective), xlsxNumberFormatProjection(normal))) {
    // Number-format detail fields form one group. A DXF custom code must not
    // remain active underneath a direct named-format override.
    for (const key of NUMBER_FORMAT_KEYS) direct[key] = effective[key] ?? null;
  }
  return direct;
}

function normalPaint(wb, context) {
  const normal = { ...normalFontStyle(wb.normalFont) };
  if (wb.nativeNormalFill) Object.assign(normal, { nativeFill: wb.nativeNormalFill, bg: wb.nativeNormalFill.paint || null });
  const native = wb.nativeNormalStyle;
  if (!native) return normal;
  const xf = parseModelXml(native.xf), alignment = modelChildren(xf, 'alignment', MAIN);
  if (alignment.length > 1) throw new Error('Invalid native Normal alignment');
  // A Normal XF is a complete format; a differential decoder provides its
  // representable properties without allocating a synthetic workbook.
  const body = native.border + (alignment[0] ? standaloneModelXml(alignment[0]) : '');
  Object.assign(normal, readNativePivotPaint(`<dxf xmlns="${MAIN}">${body}</dxf>`, context.themes, context));
  Object.assign(normal, numFmtToStyle(native.numberFormat));
  return normal;
}

function compiled(wb) {
  const native = wb.nativePivots;
  if (!native?.tables?.length) return null;
  let cached = caches.get(wb);
  if (cached?.native === native && cached.palette === wb.colorPalette && cached.fontTheme === wb.fontTheme
    && cached.normalFont === wb.normalFont && cached.normalFill === wb.nativeNormalFill
    && cached.normalXf === wb.nativeNormalStyle?.xf && cached.normalBorder === wb.nativeNormalStyle?.border
    && cached.normalFormat === wb.nativeNormalStyle?.numberFormat) return cached;
  cached = { native, palette: wb.colorPalette, fontTheme: wb.fontTheme, normalFont: wb.normalFont,
    normalFill: wb.nativeNormalFill, normalXf: wb.nativeNormalStyle?.xf,
    normalBorder: wb.nativeNormalStyle?.border, normalFormat: wb.nativeNormalStyle?.numberFormat,
    sheets: new Map(), issues: [], normal: null };
  const context = paintContext(wb), cacheByKey = new Map(native.caches.map(cache => [cache.key, cache]));
  let normalError;
  try { cached.normal = normalPaint(wb, context); } catch (e) { normalError = e; }
  for (const pivot of native.tables) {
    try {
      const style = readNativePivotStyle(pivot, native), formats = readNativePivotFormats(pivot, native);
      if (!style?.elements.some(element => element.dxf) && !formats.length) continue;
      if (normalError) throw normalError;
      const source = cacheByKey.get(pivot.cache);
      if (!source) throw new Error('Missing PivotTable cache');
      // Read saved axes only. Opening or painting a file must never refresh its
      // data, query a model, or regenerate its persisted report cells.
      const layout = readNativePivotLayout(pivot, source);
      if (layout.pageFields.length && style?.elements.some(e => e.dxf && ['pageFieldLabels', 'pageFieldValues'].includes(e.type))) {
        throw new Error('Pivot style page-field region layout is not implemented');
      }
      const layers = nativePivotPaintLayers([
        ...nativePivotBodyStyleLayers(layout, style), ...nativePivotFormatLayers(layout, formats),
      ], context.themes, context);
      if (!layers.length) continue;
      if (!cached.sheets.has(pivot.owner)) cached.sheets.set(pivot.owner, []);
      cached.sheets.get(pivot.owner).push({ range: layout.range, layers });
    } catch (e) {
      // Retain all cached XFs and native definitions for an unsupported report.
      // Do not apply a successful subset of its style and silently claim fidelity.
      cached.issues.push(Object.freeze({ sheetId: pivot.owner, name: pivot.name, message: e.message }));
    }
  }
  caches.set(wb, cached);
  return cached;
}

export function hasNativePivotDisplay(wb, sheetId) {
  return !!compiled(wb)?.sheets.get(sheetId)?.length;
}

export function nativePivotDisplayIssues(wb, sheetId) {
  const issues = compiled(wb)?.issues || [];
  return issues.filter(issue => sheetId == null || issue.sheetId === sheetId);
}

/** A transient look over source cell/line/spill formatting. Neither stored
 * cells nor native styles are flattened, so exports, private clipboard data,
 * undo and later changes to the PivotTable style retain their semantics. */
export function nativePivotDisplayStyle(wb, sheetId, r, c, base) {
  const cached = compiled(wb), reports = cached?.sheets.get(sheetId);
  if (!reports?.length) return base;
  let result = base;
  forEachRangeRecordAt(reports, r, c, report => {
    const borderPriorities = Object.fromEntries(edges.map(side => [side, 0]));
    result = nativePivotPaintAt(report.layers, r, c, { base: { ...cached.normal, ...base },
      direct: nativePivotDirectStyle(base, cached.normal, wb.nativeNormalFill), borderPriorities });
    result[DISPLAY_BORDER_PRIORITY] = Object.freeze(borderPriorities);
  });
  return result;
}
