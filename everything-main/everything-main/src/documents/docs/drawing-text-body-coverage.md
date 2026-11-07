# DrawingML text-body and autofit coverage

Reviewed 2026-10-09 against code baseline `d4187f14` and supplied ECMA-376
Part 1 §21.1.2 text-body schemas and Transitional variant. This inventories six
types' direct children and owning attributes, not full text paragraph/run/bullet,
warp, 3D or extension semantics. It contributes to A01; Strict inventories do
not establish Strict package support.

Evidence: [docx-shapes.js](../src/engine/docx-shapes.js),
[shape-autofit.js](../src/engine/shape-autofit.js),
[shape-text-layout.js](../src/engine/shape-text-layout.js),
[docx-chart-text.js](../src/engine/docx-chart-text.js),
[shape/fill ledger](shape-fill-outline-coverage.md) and
[chart ledger](chart-container-type-coverage.md).
WPS textbox content uses WML paragraphs/tables; DrawingML chart text uses a:p
and different readers. Body property support in one path does not imply the other.

## Text body

`CT_TextBody`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `bodyPr` | Partial chart DrawingML body properties; WPS bodyPr uses shared metadata but its text content is WML. Contexts have different readers. |
| `lstStyle` | Chart text requires empty list style; list/default-level inheritance missing. WPS text uses WML paragraph/list structures. |
| `p` | Partial chart defaults/rich titles; full DrawingML text paragraphs/runs/fields/bullets need separate audit. |

No owning attributes.

## Body properties

`CT_TextBodyProperties`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `prstTxWarp` | WPS only textNoShape with empty adjustment list; actual warped text missing. Chart body accepts no children. |
| `noAutofit` | WPS accepted as validated empty declaration; no shape growth. Full context/native layout still bounded. |
| `normAutofit` | WPS validates dormant metadata only, rejects text-bearing shapes. Active font/line-spacing scale fitting missing. |
| `spAutoFit` | Partial WPS shape growth using text layout and authored geometry; relative frames and page-dependent fields require approximation/restrict support. |
| `scene3d` | Not in WPS body child whitelist; chart body accepts no children. Full body 3D/flat-text/extension semantics missing; other picture/text effect paths do not establish this container. |
| `sp3d` | Not in WPS body child whitelist; chart body accepts no children. Full body 3D/flat-text/extension semantics missing; other picture/text effect paths do not establish this container. |
| `flatTx` | Not in WPS body child whitelist; chart body accepts no children. Full body 3D/flat-text/extension semantics missing; other picture/text effect paths do not establish this container. |
| `extLst` | Not in WPS body child whitelist; chart body accepts no children. Full body 3D/flat-text/extension semantics missing; other picture/text effect paths do not establish this container. |

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@rot` | optional | WPS accepts zero only; chart reader accepts a narrow set. Arbitrary independent text-body rotation missing. |
| `@spcFirstLastPara` | optional | WPS validates boolean and carries edgeSpacing; WordprocessingML paragraph layout differs from DrawingML a:p. Chart accepts flag but full spacing semantics need controls. |
| `@vertOverflow` | optional | WPS only overflow; chart accepts several enum values without establishing general clipping/ellipsis semantics. Complete contexts remain missing. |
| `@horzOverflow` | optional | WPS only overflow; chart enum acceptance does not certify general clipping presentation. |
| `@vert` | optional | WPS accepts known dormant modes but active textbox only horz; chart only horz. Vertical typography missing. |
| `@wrap` | optional | WPS only square; chart accepts square/none with bounded layout. Full unwrapped text bodies missing. |
| `@lIns` | optional | WPS parses inset with current default into text layout; chart rejects attribute. Full inset/geometry/flow interactions and value validation remain bounded. |
| `@tIns` | optional | WPS parses inset with current default into text layout; chart rejects attribute. Full inset/geometry/flow interactions and value validation remain bounded. |
| `@rIns` | optional | WPS parses inset with current default into text layout; chart rejects attribute. Full inset/geometry/flow interactions and value validation remain bounded. |
| `@bIns` | optional | WPS parses inset with current default into text layout; chart rejects attribute. Full inset/geometry/flow interactions and value validation remain bounded. |
| `@numCol` | optional | WPS only one; multiple text columns missing. Chart rejects this attribute. |
| `@spcCol` | optional | WPS validates nonnegative spacing but no inter-column effect with one column; chart rejects. |
| `@rtlCol` | optional | WPS only false; RTL column flow missing. Chart rejects. |
| `@fromWordArt` | optional | WPS only false; WordArt body semantics missing. Chart rejects. |
| `@anchor` | optional | WPS top/center/bottom, chart narrower; distributed/justified anchors missing. |
| `@anchorCtr` | optional | WPS only false; chart accepts boolean but does not establish all horizontal-centering semantics. |
| `@forceAA` | optional | WPS only false; explicit antialias preference semantics missing. Chart rejects. |
| `@upright` | optional | WPS validated with content/transform restrictions; full keep-upright behavior remains bounded. Chart rejects. |
| `@compatLnSpc` | optional | WPS accepts boolean but no value in returned text body; applicable compatibility line-spacing semantics need controls. Chart rejects. |

## List style

`CT_TextListStyle`. Named direct declarations:

| Property | Current behavior / remaining work |
| --- | --- |
| `defPPr` | No chart list-style child consumer; chart reader requires empty lstStyle. Implement applicable defaults/level/extension inheritance. |
| `lvl1pPr` | No chart list-style child consumer; chart reader requires empty lstStyle. Implement applicable defaults/level/extension inheritance. |
| `lvl2pPr` | No chart list-style child consumer; chart reader requires empty lstStyle. Implement applicable defaults/level/extension inheritance. |
| `lvl3pPr` | No chart list-style child consumer; chart reader requires empty lstStyle. Implement applicable defaults/level/extension inheritance. |
| `lvl4pPr` | No chart list-style child consumer; chart reader requires empty lstStyle. Implement applicable defaults/level/extension inheritance. |
| `lvl5pPr` | No chart list-style child consumer; chart reader requires empty lstStyle. Implement applicable defaults/level/extension inheritance. |
| `lvl6pPr` | No chart list-style child consumer; chart reader requires empty lstStyle. Implement applicable defaults/level/extension inheritance. |
| `lvl7pPr` | No chart list-style child consumer; chart reader requires empty lstStyle. Implement applicable defaults/level/extension inheritance. |
| `lvl8pPr` | No chart list-style child consumer; chart reader requires empty lstStyle. Implement applicable defaults/level/extension inheritance. |
| `lvl9pPr` | No chart list-style child consumer; chart reader requires empty lstStyle. Implement applicable defaults/level/extension inheritance. |
| `extLst` | No chart list-style child consumer; chart reader requires empty lstStyle. Implement applicable defaults/level/extension inheritance. |

No owning attributes.

## Normal autofit

`CT_TextNormalAutofit`. No named direct child declarations.

| Attribute | Schema use | Current behavior / remaining work |
| --- | --- | --- |
| `@fontScale` | optional | Dormant WPS metadata validation; active normal autofit rejects. Implement actual font scaling, defaults and complete percentage validation. |
| `@lnSpcReduction` | optional | Dormant WPS metadata validation; active normal autofit rejects. Implement line-spacing reduction and complete percentage/default validation. |

## Shape autofit

`CT_TextShapeAutofit`. No named direct child declarations.

No owning attributes.

## No autofit

`CT_TextNoAutofit`. No named direct child declarations.

No owning attributes.

## Remaining feature work and boundaries

- Implement active normal autofit using font scale/line-space reduction while
  preserving authored geometry and source. Validate integer and percentage forms,
  defaults, bounds and interaction with multiple paragraphs, tables and fields.
  Dormant settings without a text box do not establish active fitting.
- Complete text-bearing vertical/WordArt modes, independent rotation, multiple
  columns, RTL flow, wrap none, clipping/ellipsis and distributed anchors. Keep
  dormant declarations distinct from visible behavior and safe editing.
- Complete list/default-level inheritance and DrawingML paragraph/run/bullet
  content. Chart default formatting and rich-title subsets do not establish a
  generic DrawingML text editor or all text-body content models.
- Complete WPS text decorations. Current reader rejects decorated paragraphs,
  active paragraph tabs and run underline/strike/highlight/shading in its text
  box path, despite body-text support elsewhere. Local table/shape/frame and
  editing restrictions need their own focused controls.
- Extend shape growth with relative page sizing and page-dependent fields. The
  existing best-effort path preserves affected authored frames and records an
  approximation while allowing supported siblings to fit; it is not full autofit.
- Audit warp adjustments, body 3D/flat text, compatibility spacing, antialias,
  upright and vendor extensions separately. Accepted booleans and retained XML
  do not prove their paint/measurement semantics. Verify parent choice/defaults,
  occurrence rules and nested values before declaring a family complete.

Both variants' six type inventories are checked (12 type/variant checks) for
child rows and owning attribute names/use. Child CLI verification uses
[audit-section-schema.py](../tools/audit-section-schema.py) with `--direct-only`,
`--type`, this ledger and the corresponding `--ledger-section` title.

Existing controls include [shape-autofit.test.js](../tests/shape-autofit.test.js),
[shape-autofit-recovery.test.js](../tests/shape-autofit-recovery.test.js),
[shape-text-transform.test.js](../tests/shape-text-transform.test.js) and
[column-chart-titles.test.js](../tests/column-chart-titles.test.js).
This documentation checkpoint adds no runtime or native-reference compatibility claim.
