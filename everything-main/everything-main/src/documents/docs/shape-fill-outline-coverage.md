# DrawingML shape, fill and outline coverage

Reviewed 2026-10-09 against code baseline `6e7b395f` and supplied ECMA-376
Part 1 §20.1 DrawingML schemas and their Transitional variant. This inventories
11 types' direct children and owning attributes. It contributes to A01, not
complete nested geometry/effects/colors, contexts or vendor extensions.
Strict inventories do not establish Strict package support.

Evidence: [docx-shapes.js](../src/engine/docx-shapes.js),
[docx-drawing-style.js](../src/engine/docx-drawing-style.js),
[drawing-gradients.js](../src/engine/drawing-gradients.js),
[drawing-patterns.js](../src/engine/drawing-patterns.js),
[picture ledger](picture-payload-property-coverage.md),
[chart ledger](chart-container-type-coverage.md) and
[theme ledger](theme-structure-coverage.md).
Individual WPS shapes, WPG groups, pictures and charts have different readers.
Support for a paint in one context does not certify every containing type.

## Shape properties

`CT_ShapeProperties`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `xfrm` | Partial context-specific reader; full payload/transform/effect semantics and interactions require their nested audits. |
| `custGeom` | Partial context-specific reader; full payload/transform/effect semantics and interactions require their nested audits. |
| `prstGeom` | Partial context-specific reader; full payload/transform/effect semantics and interactions require their nested audits. |
| `noFill` | Partial context-specific reader; full payload/transform/effect semantics and interactions require their nested audits. |
| `solidFill` | Partial context-specific reader; full payload/transform/effect semantics and interactions require their nested audits. |
| `gradFill` | Partial context-specific reader; full payload/transform/effect semantics and interactions require their nested audits. |
| `blipFill` | Partial context-specific reader; full payload/transform/effect semantics and interactions require their nested audits. |
| `pattFill` | Partial context-specific reader; full payload/transform/effect semantics and interactions require their nested audits. |
| `grpFill` | Partial context-specific reader; full payload/transform/effect semantics and interactions require their nested audits. |
| `ln` | Partial context-specific reader; full payload/transform/effect semantics and interactions require their nested audits. |
| `effectLst` | Partial context-specific reader; full payload/transform/effect semantics and interactions require their nested audits. |
| `effectDag` | Not in WPS shape reader whitelist; general effect graph support missing. |
| `scene3d` | Not in WPS shape reader whitelist; picture 3D support is a different context. |
| `sp3d` | WPS reader only accepts empty declaration; nonempty shape solid geometry rejects. Picture/text 3D subsets do not establish this path. |
| `extLst` | Partial context-specific reader; full payload/transform/effect semantics and interactions require their nested audits. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@bwMode` | optional | No full WPS black/white-mode consumer established; picture reader permits only auto/clr. Implement contextual modes. |

## Group properties

`CT_GroupShapeProperties`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `xfrm` | Partial WPG group transform/fill inheritance; full cross-context semantics remain bounded. |
| `noFill` | Partial WPG group transform/fill inheritance; full cross-context semantics remain bounded. |
| `solidFill` | Partial WPG group transform/fill inheritance; full cross-context semantics remain bounded. |
| `gradFill` | Not accepted by the current WPG group or shape-outline whitelist; implement applicable paint/effect/context semantics. |
| `blipFill` | Not accepted by the current WPG group or shape-outline whitelist; implement applicable paint/effect/context semantics. |
| `pattFill` | Partial WPG group transform/fill inheritance; full cross-context semantics remain bounded. |
| `grpFill` | Partial WPG group transform/fill inheritance; full cross-context semantics remain bounded. |
| `effectLst` | Not accepted by the current WPG group or shape-outline whitelist; implement applicable paint/effect/context semantics. |
| `effectDag` | Not accepted by the current WPG group or shape-outline whitelist; implement applicable paint/effect/context semantics. |
| `scene3d` | Not accepted by the current WPG group or shape-outline whitelist; implement applicable paint/effect/context semantics. |
| `extLst` | Not accepted by the current WPG group or shape-outline whitelist; implement applicable paint/effect/context semantics. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@bwMode` | optional | No full WPG black/white-mode consumer established; complete contextual modes remain missing. |

## Outline properties

`CT_LineProperties`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `noFill` | Partial shape outline support with bounded geometry/context interactions; picture/chart readers impose additional restrictions. |
| `solidFill` | Partial shape outline support with bounded geometry/context interactions; picture/chart readers impose additional restrictions. |
| `gradFill` | Not accepted by the current WPG group or shape-outline whitelist; implement applicable paint/effect/context semantics. |
| `pattFill` | Not accepted by the current WPG group or shape-outline whitelist; implement applicable paint/effect/context semantics. |
| `prstDash` | Partial shape outline support with bounded geometry/context interactions; picture/chart readers impose additional restrictions. |
| `custDash` | Not accepted by the current WPG group or shape-outline whitelist; implement applicable paint/effect/context semantics. |
| `round` | Partial shape outline support with bounded geometry/context interactions; picture/chart readers impose additional restrictions. |
| `bevel` | Partial shape outline support with bounded geometry/context interactions; picture/chart readers impose additional restrictions. |
| `miter` | Partial shape outline support with bounded geometry/context interactions; picture/chart readers impose additional restrictions. |
| `headEnd` | Partial shape outline support with bounded geometry/context interactions; picture/chart readers impose additional restrictions. |
| `tailEnd` | Partial shape outline support with bounded geometry/context interactions; picture/chart readers impose additional restrictions. |
| `extLst` | Not accepted by the current WPG group or shape-outline whitelist; implement applicable paint/effect/context semantics. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@w` | optional | Nonnegative width, with native-informed minimum single-outline display and source width retention; compound/geometry interactions bounded. |
| `@cap` | optional | Shape reader flat/rnd/sq; chart contexts narrower. Complete combinations remain open. |
| `@cmpd` | optional | Supported compound enum and bounded paint geometry; zero-width compounds and open paths with line ends restrict support. |
| `@algn` | optional | Shape reader centered only; inset alignment rejects. |

## Solid color choice

`CT_SolidColorFillProperties`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `scrgbClr` | Partial shared DrawingML color reader; supported color values/transforms have context-specific restrictions. Full nested transform inventory remains open. |
| `srgbClr` | Partial shared DrawingML color reader; supported color values/transforms have context-specific restrictions. Full nested transform inventory remains open. |
| `hslClr` | No HSL color-value branch in shared reader; implement color conversion and ordered transforms. |
| `sysClr` | Partial shared DrawingML color reader; supported color values/transforms have context-specific restrictions. Full nested transform inventory remains open. |
| `schemeClr` | Partial shared DrawingML color reader; supported color values/transforms have context-specific restrictions. Full nested transform inventory remains open. |
| `prstClr` | Partial shared DrawingML color reader; supported color values/transforms have context-specific restrictions. Full nested transform inventory remains open. |

No owning attributes.

## Gradient fill

`CT_GradientFillProperties`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `gsLst` | Required by reader with 2..256 color stops; sorting preserves equal-position source order. Full nested color semantics remain bounded. |
| `lin` | Partial linear angle/scaled shading; cannot coexist with path in reader. |
| `path` | Partial circle path only; other path geometries reject. |
| `tileRect` | Only absent/zero rectangle accepted; nonzero tiling region rejects. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@flip` | optional | none/x/y/xy validated, but not returned in the shared gradient paint model; no explicit flip effect established. |
| `@rotWithShape` | optional | Absent/true accepted; false fixed-page orientation rejects. |

## Gradient stops

`CT_GradientStopList`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `gs` | Partial position and one-color validation; stop count is a separate model limit. |

No owning attributes.

## Gradient stop color

`CT_GradientStop`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `scrgbClr` | Partial shared DrawingML color reader; supported color values/transforms have context-specific restrictions. Full nested transform inventory remains open. |
| `srgbClr` | Partial shared DrawingML color reader; supported color values/transforms have context-specific restrictions. Full nested transform inventory remains open. |
| `hslClr` | No HSL color-value branch in shared reader; implement color conversion and ordered transforms. |
| `sysClr` | Partial shared DrawingML color reader; supported color values/transforms have context-specific restrictions. Full nested transform inventory remains open. |
| `schemeClr` | Partial shared DrawingML color reader; supported color values/transforms have context-specific restrictions. Full nested transform inventory remains open. |
| `prstClr` | Partial shared DrawingML color reader; supported color values/transforms have context-specific restrictions. Full nested transform inventory remains open. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@pos` | required | Required 0..1 percentage/decimal position, one color; complete lexical precision/range and interpolation/native contexts remain open. |

## Linear shading

`CT_LinearShadeProperties`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@ang` | optional | Nonnegative angle below one revolution, absent zero; complete context/default checks remain open. |
| `@scaled` | optional | Boolean read, current absent fallback false; native-informed axis geometry differs from a literal spec formula. Existing source notes do not certify all gradients. |

## Path shading

`CT_PathShadeProperties`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `fillToRect` | Partial circular-gradient focus rectangle with signed percentage coordinates; other path shading and full geometry remain missing. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@path` | optional | Explicit circle required; rectangular/shape/default path semantics unsupported. |

## Pattern fill

`CT_PatternFillProperties`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `fgClr` | Partial one-color foreground, default black; supported DrawingML color pipeline and preset masks. |
| `bgClr` | Partial one-color background, default white; full color-space/transform semantics remain bounded. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@prst` | optional | Known mask preset, absent pct5; full preset raster/opacity/context equivalence requires controls. |

## Custom dash stop

`CT_DashStop`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@d` | required | Required schema dash length; shape reader rejects custDash, so no generic custom-dash consumer. |
| `@sp` | required | Required schema gap length; shape reader rejects custDash, so no generic custom-dash consumer. |

## Remaining work and scope limits

- Complete custom-dash, gradient/pattern outlines, inset stroke alignment and
  full line-end/compound/cap/join interactions. Current shape reader whitelist
  is explicit; source inheritance merging does not implement selected paint.
- Complete gradient flip, fixed page orientation, path geometries and nonzero
  tile rectangles. Current flip validation without model propagation is not
  visual implementation. Keep native gradient interpolation/axis differences
  grounded in existing controls and add new controls for missing semantics.
- Implement HSL values and all ordered color transforms. Shared color choices
  have six declarations, but the current reader has no HSL branch. Inventory
  every nested transform and test compositions rather than inferring full color
  support from successful sRGB or theme-color examples.
- Complete group gradient/picture fills, effects, scenes and extensions alongside
  generic inheritance and transforms. Current WPG whitelist is narrower than
  WPS shapes. Nonempty WPS sp3d and scene3d are not covered by picture/text 3D.
- Complete shape black/white modes, geometry, effect graph/list and extension
  semantics in each supported containing context. Retained source and a partial
  scene are not full native shape or editable geometry support.
- Track resource limits separately from declaration support. Gradient stop count
  2..256 is a reader constraint; native interpolation and degenerate/boundary
  colors need controls. Direct-row enumeration does not validate choices,
  defaults, occurrences, nesting or geometric output.

Both schemas' 11 type inventories are checked (22 type/variant checks) for direct
child rows and owning attribute names/use. Child CLI verification uses
[audit-section-schema.py](../tools/audit-section-schema.py) with `--direct-only`,
`--type`, this ledger and its corresponding `--ledger-section` title.

Existing controls include [drawing-gradients.test.js](../tests/drawing-gradients.test.js),
[path-gradients.test.js](../tests/path-gradients.test.js),
[drawing-patterns.test.js](../tests/drawing-patterns.test.js),
[canvas-outline.test.js](../tests/canvas-outline.test.js),
[canvas-compound-outlines.test.js](../tests/canvas-compound-outlines.test.js) and
[minimum-outline-width.test.js](../tests/minimum-outline-width.test.js).
This documentation checkpoint adds no runtime or native-reference compatibility claim.
