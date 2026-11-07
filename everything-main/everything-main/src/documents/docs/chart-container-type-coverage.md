# Chart container and type coverage

Reviewed 2026-10-09 against code baseline `eed264e5` and supplied ECMA-376
Part 1 §21.2 DrawingML chart schemas and the Transitional variant. This inventories
six root/plot/legend/layout types' named direct declarations and owning attributes.
It contributes to A01, not complete series, axes, values, chart text, styles or
vendor extensions. Strict inventories do not establish Strict package support.

Evidence: [docx-charts.js](../src/engine/docx-charts.js),
[docx-chart-text.js](../src/engine/docx-chart-text.js),
[canvas-charts.js](../src/engine/canvas-charts.js),
[canvas-doughnut-charts.js](../src/engine/canvas-doughnut-charts.js) and
[theme ledger](theme-structure-coverage.md).
Current cached vertical-column and doughnut subsets are not generic chart
support. Original chart parts and workbook source retention do not prove
formula evaluation, native layout or editable chart data.

## Chart space

`CT_ChartSpace`. No owning attributes.

| Property | Current behavior / remaining work |
| --- | --- |
| `date1904` | Flag validated; cached series rendering is not date-axis/workbook evaluation. |
| `lang` | Accepted metadata; no general chart locale/evaluation consumer established. |
| `roundedCorners` | Only false accepted; rounded frame presentation missing. |
| `style` | Partial numeric style and explicit style-part handling; full inherited appearance/style semantics remain bounded. |
| `clrMapOvr` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `pivotSource` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `protection` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `chart` | Partial column/doughnut reader; not all schema chart types. |
| `spPr` | Partial chart-area fill/outline/effect reader; inherited appearance and payload subsets have restrictions. |
| `txPr` | Partial chart text reader; full typography/context support remains bounded. |
| `externalData` | Partial internal OOXML workbook relationship validation with autoUpdate false; render uses cached series, not workbook formula evaluation or external refresh. |
| `printSettings` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `userShapes` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `extLst` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |

## Chart root

`CT_Chart`. No owning attributes.

| Property | Current behavior / remaining work |
| --- | --- |
| `title` | Partial rich title parsing; column title manual layout rejected, doughnut requires its bounded manual placement. Complete generated/formula title and layout semantics missing. |
| `autoTitleDeleted` | Validated; column reader rejects absent title plus requested automatic generation. Full native title-generation behavior missing. |
| `pivotFmts` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `view3D` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `floor` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `sideWall` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `backWall` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `plotArea` | Partial vertical columns and doughnut plots; unsupported types/combinations remain. |
| `legend` | Partial column legend right/bottom only, non-overlay and unfilled/unbordered; doughnut path rejects legends. |
| `plotVisOnly` | Only true accepted; displaying hidden source data semantics missing. |
| `dispBlanksAs` | gap/zero/span flag validated; full missing-data interpolation and data-source semantics not established by flag acceptance. |
| `showDLblsOverMax` | Boolean validated; visible data-label support remains bounded separately. |
| `extLst` | Only recognized chart extension subsets accepted; full extension inventory missing. |

## Plot area

`CT_PlotArea`. No owning attributes.

| Property | Current behavior / remaining work |
| --- | --- |
| `layout` | Column reader requires empty layout; doughnut permits bounded manual geometry. Full automatic/manual placement remains incomplete. |
| `areaChart` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `area3DChart` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `lineChart` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `line3DChart` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `stockChart` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `radarChart` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `scatterChart` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `pieChart` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `pie3DChart` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `doughnutChart` | Partial cached doughnut reader with explicit appearance and bounded manual geometry; full series/labels/legend/style combinations missing. |
| `barChart` | Partial vertical columns only: clustered/stacked/percentStacked; horizontal bar direction and full label/series/axis interactions missing. |
| `bar3DChart` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `ofPieChart` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `surfaceChart` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `surface3DChart` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `bubbleChart` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `valAx` | Partial column value axis; full scale/format/crossing and multi-axis contexts missing. |
| `catAx` | Partial column category axis; date/series/combined axis contexts missing. |
| `dateAx` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `serAx` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `dTable` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `spPr` | Partial plot appearance reader with inherited appearance restrictions. |
| `extLst` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |

## Legend

`CT_Legend`. No owning attributes.

| Property | Current behavior / remaining work |
| --- | --- |
| `legendPos` | Column supports right/bottom only; other positions missing. |
| `legendEntry` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `layout` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |
| `overlay` | Column accepts false only; overlay behavior missing. |
| `spPr` | Column accepts bounded shape properties but rejects filled/bordered legends; full style/appearance missing. |
| `txPr` | Partial column legend typography; inherited and explicit mixed-script formatting have restrictions. |
| `extLst` | Not accepted by the current containing-chart reader whitelist; implement this chart/content family and context semantics. |

## Layout container

`CT_Layout`. No owning attributes.

| Property | Current behavior / remaining work |
| --- | --- |
| `manualLayout` | Partial doughnut layout only; column plot/title require empty layout and column legend forbids layout. |
| `extLst` | Not accepted by current layout readers; extension semantics missing. |

## Manual layout

`CT_ManualLayout`. No owning attributes.

| Property | Current behavior / remaining work |
| --- | --- |
| `layoutTarget` | Doughnut accepts inner only; outer layout missing. |
| `xMode` | Doughnut requires edge, not general factor/edge support. |
| `yMode` | Doughnut requires edge, not general factor/edge support. |
| `wMode` | Doughnut requires factor; edge-sized semantics missing. |
| `hMode` | Doughnut requires factor; edge-sized semantics missing. |
| `x` | Doughnut bounded 0..1 frame coordinate; generic out-of-frame and chart-type layout missing. |
| `y` | Doughnut bounded 0..1 frame coordinate; generic out-of-frame and chart-type layout missing. |
| `w` | Doughnut plot requires positive in-frame factor width; explicit title extents reject. |
| `h` | Doughnut plot requires positive in-frame factor height; explicit title extents reject. |
| `extLst` | Not accepted by current manual-layout reader; extension semantics missing. |

## Remaining chart feature work

- Implement the remaining chart types and combination/secondary-axis plots,
  including horizontal bars and 3D variants. Type presence must select a generic
  reader/layout/paint model, not a document-specific raster substitute.
- Complete cached data, blanks, labels, per-point formats, number/date formats,
  hidden-data flags and all series/axis semantics. Audit each nested type and
  test values/interactions; accepted root flags do not prove their effect.
- Complete automatic/manual plot, title and legend placement across types,
  including outer/factor/edge coordinates, overlay and native layout defaults.
  Current doughnut constraints and empty column layouts are explicit subsets.
- Complete inherited chart appearance, protection, color-map/theme overrides,
  additional shapes and print settings where applicable. Chart-local themeOverride
  relationships explicitly reject; known chart-style handling is not full theme
  or extension inheritance. Inventory those nested properties separately.
- Keep cached presentation distinct from data editing/recalculation. Current
  embedded workbook checks only validate an internal package/content type and
  reject automatic refresh; they do not calculate workbook formulas or fetch data.
- Track resource limits separately from standards support. Current column reader
  bounds series to 20, categories/values to 100, requires consistent categories
  and matching lengths, and bounds series names. These are not unsupported schema
  declarations or proof that all larger valid charts should be discarded.
- Verify local recovery and preservation when a chart is unsupported: keep usable
  surrounding text/pictures and original parts rather than flattening the story.
  A cached fallback or read-only image does not certify chart type/editing support.

Both schema variants' six direct child/owning-attribute inventories are checked
(12 type/variant checks). Child CLI checks use
[audit-section-schema.py](../tools/audit-section-schema.py) with `--direct-only`,
`--type`, this ledger and its corresponding `--ledger-section` title. All six
inventoried types have no owning attributes; nested metadata remains open.

Existing focused controls include [chart-metadata.test.js](../tests/chart-metadata.test.js),
[chart-colors.test.js](../tests/chart-colors.test.js),
[column-chart-titles.test.js](../tests/column-chart-titles.test.js),
[column-chart-legends.test.js](../tests/column-chart-legends.test.js),
[doughnut-charts.test.js](../tests/doughnut-charts.test.js) and
[stacked-charts.test.js](../tests/stacked-charts.test.js).
This documentation checkpoint adds no runtime or native-reference compatibility claim.
