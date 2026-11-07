# Theme structure coverage

Reviewed 2026-10-09 against code baseline `08358952` and supplied ECMA-376
Part 1 §20.1 theme schemas, plus the Transitional variant. This inventories six
root/scheme/collection/matrix types' direct children and owning attributes. It
contributes to A01, not complete nested color, font, fill/effect or extension
semantics. Strict inventories do not establish Strict package support.

Evidence: [docx-colors.js](../src/engine/docx-colors.js),
[docx-fonts.js](../src/engine/docx-fonts.js),
[docx-drawing-style.js](../src/engine/docx-drawing-style.js),
[docx-charts.js](../src/engine/docx-charts.js),
[settings ledger](settings-property-coverage.md) and
[picture payloads](picture-payload-property-coverage.md).
Only font-name/selection metadata and source code were reviewed; this audit
inspects no embedded or installed font program.

Theme parts are retained, and used entries are resolved lazily. An unused entry
surviving import is not proof its color space, transforms or font choice can be
rendered. DrawingML direct color transforms and WML theme-entry resolution use
different paths; support in one does not establish support in the other.

## Theme root

`CT_OfficeStyleSheet`.

| Property | Current behavior / remaining work |
| --- | --- |
| `themeElements` | Partial lazily resolved color/font/format schemes; no full root content-model validation. |
| `objectDefaults` | No explicit object-default consumer found; implement applicable shape/line/text defaults and inheritance. |
| `extraClrSchemeLst` | No explicit additional-color-scheme selection consumer found; complete applicable scheme/mapping semantics. |
| `custClrLst` | No explicit custom-color palette consumer found; retained source is not palette authoring support. |
| `extLst` | No general theme-root extension consumer; full vendor extension coverage remains open. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@name` | optional | Retained naming metadata; no scheme/root name consumer identified. Required-name validation is not established by lazy entry lookup. |

## Base styles

`CT_BaseStyles`.

| Property | Current behavior / remaining work |
| --- | --- |
| `clrScheme` | Partial WML theme color lookup with settings mapping; only untransformed sRGB/system-last-color entries accepted by this resolver. |
| `fontScheme` | Partial theme slot and supplemental script lookup; font collection behavior is described below. |
| `fmtScheme` | Partial referenced fill/line/effect/background style-index resolution with placeholder-color substitution; downstream payload readers restrict support. |
| `extLst` | No general base-style extension consumer identified. |

No owning attributes.

## Color scheme

`CT_ColorScheme`.

| Property | Current behavior / remaining work |
| --- | --- |
| `dk1` | Partial WML theme resolver reads one sRGB val or system lastClr without nested transforms; complete scheme color spaces and transforms remain missing. |
| `lt1` | Partial WML theme resolver reads one sRGB val or system lastClr without nested transforms; complete scheme color spaces and transforms remain missing. |
| `dk2` | Partial WML theme resolver reads one sRGB val or system lastClr without nested transforms; complete scheme color spaces and transforms remain missing. |
| `lt2` | Partial WML theme resolver reads one sRGB val or system lastClr without nested transforms; complete scheme color spaces and transforms remain missing. |
| `accent1` | Partial WML theme resolver reads one sRGB val or system lastClr without nested transforms; complete scheme color spaces and transforms remain missing. |
| `accent2` | Partial WML theme resolver reads one sRGB val or system lastClr without nested transforms; complete scheme color spaces and transforms remain missing. |
| `accent3` | Partial WML theme resolver reads one sRGB val or system lastClr without nested transforms; complete scheme color spaces and transforms remain missing. |
| `accent4` | Partial WML theme resolver reads one sRGB val or system lastClr without nested transforms; complete scheme color spaces and transforms remain missing. |
| `accent5` | Partial WML theme resolver reads one sRGB val or system lastClr without nested transforms; complete scheme color spaces and transforms remain missing. |
| `accent6` | Partial WML theme resolver reads one sRGB val or system lastClr without nested transforms; complete scheme color spaces and transforms remain missing. |
| `hlink` | Partial WML theme resolver reads one sRGB val or system lastClr without nested transforms; complete scheme color spaces and transforms remain missing. |
| `folHlink` | Partial WML theme resolver reads one sRGB val or system lastClr without nested transforms; complete scheme color spaces and transforms remain missing. |
| `extLst` | No general color-scheme extension consumer identified. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@name` | required | Retained naming metadata; no scheme/root name consumer identified. Required-name validation is not established by lazy entry lookup. |

## Font scheme

`CT_FontScheme`.

| Property | Current behavior / remaining work |
| --- | --- |
| `majorFont` | Partial major slot selection for Ascii/HAnsi/EastAsia/Bidi and supplemental script entries. |
| `minorFont` | Partial minor slot selection for Ascii/HAnsi/EastAsia/Bidi and supplemental script entries. |
| `extLst` | No general font-scheme extension consumer identified. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@name` | required | Retained naming metadata; no scheme/root name consumer identified. Required-name validation is not established by lazy entry lookup. |

## Font collection

`CT_FontCollection`.

| Property | Current behavior / remaining work |
| --- | --- |
| `latin` | typeface read for matching Latin slot, subject to supplemental script selection; empty typeface falls back to Noto Sans. Complete face metadata/type validation remains open. |
| `ea` | typeface read for EastAsia slot with settings themeFontLang-derived script; empty face fallback is an app choice, not full native font matching. |
| `cs` | typeface read for complex-script slot with settings themeFontLang-derived script; complete language/glyph context selection remains open. |
| `font` | Partial supplemental entry matching by Intl.Locale-derived script from settings; duplicate matching entries reject. Full per-run/per-character selection and script/typeface validation remain open. |
| `extLst` | No general font-collection extension consumer identified. |

No owning attributes.

## Format matrix

`CT_StyleMatrix`.

| Property | Current behavior / remaining work |
| --- | --- |
| `fillStyleLst` | Partial index-based referenced style selection; placeholder colors replaced before downstream fill/line/effect validation. Full list/item semantics and interactions remain open. |
| `lnStyleLst` | Partial index-based referenced style selection; placeholder colors replaced before downstream fill/line/effect validation. Full list/item semantics and interactions remain open. |
| `effectStyleLst` | Partial index-based referenced style selection; placeholder colors replaced before downstream fill/line/effect validation. Full list/item semantics and interactions remain open. |
| `bgFillStyleLst` | Partial index-based referenced style selection; placeholder colors replaced before downstream fill/line/effect validation. Full list/item semantics and interactions remain open. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@name` | optional | Retained naming metadata; no scheme/root name consumer identified. Required-name validation is not established by lazy entry lookup. |

## Remaining feature work

- Complete theme-entry color spaces/transforms and settings color mapping,
  preserving the distinction between WML themeTint/themeShade and ordered
  DrawingML transforms. System lastClr behavior in the WML scheme resolver
  differs from direct DrawingML system-color handling; build minimal native
  controls before claiming a divergence or changing either path.
- Complete font collection/script selection across run languages and glyph
  contexts, supplementary scripts, absent/empty faces and fallback priorities.
  Current Intl.Locale/settings selection and Noto Sans fallback are bounded
  behavior. Font program availability/licensing is separate from theme metadata.
- Implement applicable object defaults, additional color schemes and custom
  palette behavior. Audit theme overrides in all consumers: current chart code
  explicitly rejects chart-local themeOverride relationships. This is not full
  contextual theme inheritance.
- Complete referenced style matrix payloads and downstream color/fill/line/effect
  semantics. Index resolution or placeholder substitution alone does not implement
  every selected item or its interaction with direct overrides.
- Validate root/scheme required names, children/order/count/defaults and nested
  metadata with authored controls. Lazy lookup intentionally leaves unused
  entries alone; it is not schema validation or full presentation support.
- Inventory nested color choices/transforms, text-font/supplemental-font metadata,
  defaults, style lists and extension namespaces separately. Retained unknown
  metadata does not certify rendering, editing or authoring.

Both schema variants' six type inventories (12 type/variant checks) compare
child rows and owning attribute names/use. Child CLI verification uses
[audit-section-schema.py](../tools/audit-section-schema.py) with `--direct-only`,
`--type`, this ledger and its corresponding `--ledger-section` title.

Existing controls include [theme.test.js](../tests/theme.test.js),
[canvas-shape-theme.test.js](../tests/canvas-shape-theme.test.js),
[montserrat-theme.test.js](../tests/montserrat-theme.test.js) and
[theme-domain-colors.test.js](../tests/theme-domain-colors.test.js).
This documentation checkpoint adds no runtime or native-reference compatibility claim.
