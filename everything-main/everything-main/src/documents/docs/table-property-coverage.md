# Table, row and cell property coverage

Reviewed 2026-10-09 against Documents baseline `003d2fc2`. This is a bounded
contribution to roadmap A01, based on the supplied ECMA-376 Part 1 §17.4 schemas
and the current table import, model, serialization and layout paths. Strict has
18 table, 15 row, 17 cell and 10 table-exception property kinds; Transitional adds
one cell property, `hMerge`. Matching names do not establish equal attributes,
style contexts or semantics. Strict-namespace package import is still a gap.

Table, row and cell XML shells retain untouched properties through supported
edits. Structural edits can synthesize/rewrite shells, so preservation requires
specific split/merge/insert/delete controls. Unsupported table declarations are
generally explicitly rejected by whitelists; preview can omit individual property
groups and remain read-only. This is recovery, not support for the omitted
semantics. Cross-property and structural failures can still escalate; recovery
is not guaranteed merely because a property reader is local.

Current geometry/resource restrictions include 32 columns, 1,000 rows and bounded
measurements. Treat valid larger-table support separately from malformed input
and bounded-layout protections. Do not report those restrictions as absent
ordinary table support. Table/row/cell wrappers, grid revisions, row-property
exceptions and nested story/shape contexts extend beyond these direct-property
inventories.

## Table properties

| Property | Import / layout and paint | Editing and remaining work | Evidence |
| --- | --- | --- | --- |
| `tblStyle` | Partial: requested/default style, basedOn chain, companion-style fallback and conditional regions. | Derived cells refresh after structural edits. Arbitrary conditional property coverage and style authoring remain incomplete. | [docx-tables.js](../src/engine/docx-tables.js), [conditional-table-formatting.js](../src/engine/conditional-table-formatting.js) |
| `tblpPr` | Partial: floating anchors, coordinates, alignment and text distances. | Existing float alignment/indent can change; complete position/anchor authoring is absent. Columns and other combinations have layout restrictions. | [floating-tables.js](../src/engine/floating-tables.js), [layout.js](../src/engine/layout.js), [model.js](../src/engine/model.js) |
| `tblOverlap` | Partial: overlap/never parsed and used in floating collision placement. | Declaration retained; full overlap authoring and combined nested/column behavior remain open. | [table-overlap.js](../src/engine/table-overlap.js), [docx-tables.js](../src/engine/docx-tables.js) |
| `bidiVisual` | Unsupported: rejected by table-property whitelist. | Implement reverse visual cell order, logical sides, content direction interactions and safe structural editing. An off declaration is also outside the whitelist. | `tableProperties` in [docx-tables.js](../src/engine/docx-tables.js) |
| `tblStyleRowBandSize` | Partial: conditional row bands with bounded size (0–3). | Retained; broader band sizes and complete style-authoring behavior remain open. | `conditionalStyle` in [docx-tables.js](../src/engine/docx-tables.js), [table-style-regions.js](../src/engine/table-style-regions.js) |
| `tblStyleColBandSize` | Partial: conditional column bands with bounded size. | Retained; complete band/merged-grid combinations need native controls. | [table-style-regions.js](../src/engine/table-style-regions.js) |
| `tblW` | Partial: auto/nil/dxa/pct and explicit physical/percent-unit precedence. | Width edits serialize; fixed/AutoFit and mixed preference behavior remain bounded. | [docx-tables.js](../src/engine/docx-tables.js), [tables.js](../src/engine/tables.js), [model.js](../src/engine/model.js) |
| `jc` | Partial: left/center/right and LTR start/end mapping; row/style/exception precedence. | Alignment commands update row overrides and floats as applicable. RTL geometry is missing. | [docx-tables.js](../src/engine/docx-tables.js), [model.js](../src/engine/model.js) |
| `tblCellSpacing` | Partial: zero/nil and specified ignored-unit semantics; nonzero physical spacing rejects. | Implement separated-cell geometry/border layers before allowing nonzero spacing. | `checkCellSpacing` in [docx-tables.js](../src/engine/docx-tables.js) |
| `tblInd` | Partial: signed physical indent, nil reset and ignored pct/auto semantics. | Indent edits serialize and update floating numeric X when appropriate; RTL/grid combinations remain open. | [docx-tables.js](../src/engine/docx-tables.js), [model.js](../src/engine/model.js) |
| `tblBorders` | Partial: supported outer/inside sides and conflict/paint rules. Visible spacing offsets and remaining styles are restricted. | Cell-border edits exist; complete table-border authoring/combination coverage is unproven. | [docx-table-borders.js](../src/engine/docx-table-borders.js), [cell-borders.js](../src/engine/cell-borders.js) |
| `shd` | Partial: clear/solid/nil table shading; not blindly inherited as every cell's shading. | Table paint is distinct from cell shading edits; other patterns remain restricted. | [docx-cell-shading.js](../src/engine/docx-cell-shading.js), [docx-tables.js](../src/engine/docx-tables.js) |
| `tblLayout` | Partial: fixed and AutoFit with current preference algorithms. | Layout/grid-width commands serialize; exact native-reference algorithms and all nested/merged interactions remain unproven. | [tables.js](../src/engine/tables.js), [intrinsic-widths.js](../src/engine/intrinsic-widths.js), [model.js](../src/engine/model.js) |
| `tblCellMar` | Partial: default physical/logical margins and existing native-reference default/reset variations. | Cell-margin edits exist; table defaults versus direct-cell authoring are separate contracts. | [docx-cell-margins.js](../src/engine/docx-cell-margins.js), [cell-margins.js](../src/engine/cell-margins.js) |
| `tblLook` | Partial: bitmask/explicit flags drive computed conditional regions. | Retained; full look/style editing and all conditional property subsets remain open. | [table-style-regions.js](../src/engine/table-style-regions.js) |
| `tblCaption` | Accepted/preserved metadata; no projected table caption consumer. This is not a printed caption paragraph. | Expose/edit table alternative-title metadata and verify accessibility/interchange. | `tableProperties` / table shell in [docx-tables.js](../src/engine/docx-tables.js) |
| `tblDescription` | Accepted/preserved description metadata; no projected description consumer. | Add alternative-description editing and accessible table semantics; not a page-layout ornament. | [docx-tables.js](../src/engine/docx-tables.js) |
| `tblPrChange` | Unsupported table formatting revision. | Implement previous/current table properties and accept/reject; paragraph revision support does not cover this. | `tableProperties` whitelist in [docx-tables.js](../src/engine/docx-tables.js) |

## Row properties

| Property | Import / layout and paint | Editing and remaining work | Evidence |
| --- | --- | --- | --- |
| `cnfStyle` | Cached conditional flags retained; regions derived from current geometry/look settings. | Structural edits refresh regions; contradictory-cache controls exist. Full conditional property support is separate. | [table-style-regions.js](../src/engine/table-style-regions.js), [conditional controls](../tests/fixtures/conditional-table-styles/README.md) |
| `divId` | Unsupported row declaration; unlike paragraph divId, rejected by the whitelist. | Implement/preserve division metadata under an explicit HTML-interchange contract. | `rowProperties` in [docx-tables.js](../src/engine/docx-tables.js) |
| `gridBefore` | Partial: omitted leading grid cells and bounded grid augmentation. | Retained/projected; column insertion in omitted-grid tables is restricted. Style declarations of these gaps reject. | [docx-tables.js](../src/engine/docx-tables.js), [tables.js](../src/engine/tables.js), [model.js](../src/engine/model.js) |
| `gridAfter` | Partial: omitted trailing grid cells. | Same style/structural-edit limits as gridBefore. | [docx-tables.js](../src/engine/docx-tables.js), [model.js](../src/engine/model.js) |
| `wBefore` | Partial: omitted leading-region width preference. | Retained/projected; exact width/AutoFit and structural combinations remain bounded. | [docx-tables.js](../src/engine/docx-tables.js), [tables.js](../src/engine/tables.js) |
| `wAfter` | Partial: omitted trailing-region width preference. | Same preference/structural constraints as wBefore. | [docx-tables.js](../src/engine/docx-tables.js), [tables.js](../src/engine/tables.js) |
| `cantSplit` | Partial: row-together pagination; oversized rows still require bounded handling. | Row keep edits serialize; combined merge/header/section fidelity remains open. | [layout.js](../src/engine/layout.js), [model.js](../src/engine/model.js) |
| `trHeight` | Partial: auto/atLeast/exact with recorded native-reference omitted-rule variation. | Row-height edits serialize; exact clipping, merges and oversized rows need separate native scopes. | [docx-row-height.js](../src/engine/docx-row-height.js), [row-height.js](../src/engine/row-height.js) |
| `tblHeader` | Partial: consecutive initial header repetition; style header-region selection is distinct. | Header-row commands serialize; nested/merged/oversized combinations remain bounded. | [table-headers.js](../src/engine/table-headers.js), [tables.js](../src/engine/tables.js), [model.js](../src/engine/model.js) |
| `tblCellSpacing` | Partial: same zero/ignored-unit subset as table spacing. | Implement row-specific nonzero geometry and table/exception precedence. | `rowProperties` / `checkCellSpacing` in [docx-tables.js](../src/engine/docx-tables.js) |
| `jc` | Partial: row alignment and inherited/exception precedence in LTR tables. | Table alignment edits clear/update effective row overrides; RTL behavior missing. | [docx-tables.js](../src/engine/docx-tables.js), [model.js](../src/engine/model.js) |
| `hidden` | Unsupported hidden-row declaration, including its off form. | Implement display/print/edit policies and row/merge geometry; paragraph hidden text is distinct. | `rowProperties` whitelist in [docx-tables.js](../src/engine/docx-tables.js) |
| `ins` | Unsupported inserted-row revision stamp. | Implement row identity, revision views, accept/reject and structural undo. | [docx-tables.js](../src/engine/docx-tables.js); roadmap S03 |
| `del` | Unsupported deleted-row revision stamp. | Implement deleted-row visibility and merge/numbering/boundary behavior without discarding source. | [docx-tables.js](../src/engine/docx-tables.js); roadmap S03 |
| `trPrChange` | Unsupported previous row properties. | Implement formatting revision views and accept/reject. | [docx-tables.js](../src/engine/docx-tables.js); roadmap S03 |

## Cell properties

| Property | Import / layout and paint | Editing and remaining work | Evidence |
| --- | --- | --- | --- |
| `cnfStyle` | Cached flags retained; effective regions derived from current table structure. | Recomputed after supported structural edits; full conditional property coverage remains partial. | [conditional-table-formatting.js](../src/engine/conditional-table-formatting.js) |
| `tcW` | Partial: auto/nil/dxa/pct and physical/percent preferences with bounded width algorithms. | Column/table commands update cell widths; arbitrary individual-cell preference authoring is not complete. | [tables.js](../src/engine/tables.js), [docx-tables.js](../src/engine/docx-tables.js), [model.js](../src/engine/model.js) |
| `gridSpan` | Partial: horizontal spans, implicit grid augmentation and bounded merged geometry. | Merge/split commands serialize spans; table-style gridSpan declarations reject. | [tables.js](../src/engine/tables.js), [docx-tables.js](../src/engine/docx-tables.js), [model.js](../src/engine/model.js) |
| `vMerge` | Partial: restart/continue with owner resolution and existing orphan/merge rules. | Vertical merge/split edits serialize; styles and persistent continuation controls have restrictions. | `verticalMerges` in [tables.js](../src/engine/tables.js), [model.js](../src/engine/model.js) |
| `tcBorders` | Partial: side/inside conflict and logical-edge resolution. Active diagonal strokes and visible spacing offsets reject. | Cell border edits serialize; full diagonal/spacing and native crossing fidelity remain open. | [docx-table-borders.js](../src/engine/docx-table-borders.js), [cell-borders.js](../src/engine/cell-borders.js) |
| `shd` | Partial: clear/solid/nil cell shading and style precedence. | Cell shading edits serialize; other patterns remain restricted. | [docx-cell-shading.js](../src/engine/docx-cell-shading.js), [model.js](../src/engine/model.js) |
| `noWrap` | Partial: parsed/inherited cell no-wrap affects width preferences/layout. | Retained; complete no-wrap authoring and all merged/nested/rotated combinations remain open. | [tables.js](../src/engine/tables.js), [layout.js](../src/engine/layout.js), [docx-tables.js](../src/engine/docx-tables.js) |
| `tcMar` | Partial: explicit cell margin/default-reset/side precedence. | Margin commands serialize; logical RTL geometry remains restricted. | [docx-cell-margins.js](../src/engine/docx-cell-margins.js), [cell-margins.js](../src/engine/cell-margins.js), [model.js](../src/engine/model.js) |
| `textDirection` | Partial: direct lrTb/btLr/tbRl; table-style direction ignored under recorded native-reference variation. | Retained; remaining values and authoring missing. Rotated hideMark and other combinations recover with restrictions. | [layout.js](../src/engine/layout.js), [rotated-cell-layout.js](../src/engine/cell-text-direction.js), [docx-tables.js](../src/engine/docx-tables.js) |
| `tcFitText` | Unsupported fitted-cell text declaration. | Implement scaling/width/height and noWrap/merge interactions; run fitText is a different feature. | `cellProperties` whitelist in [docx-tables.js](../src/engine/docx-tables.js) |
| `vAlign` | Partial: top/center/bottom; page-only both resolves to top in cells. | Cell-alignment commands serialize. Merged/rotated/exact-row combinations need separate scopes. | [cell-alignment.js](../src/engine/cell-alignment.js), [model.js](../src/engine/model.js), [layout.js](../src/engine/layout.js) |
| `hideMark` | Partial: hidden terminal mark changes cell metrics; not a hidden row/cell. | Retained; style declarations and rotated-cell combination are restricted, authoring incomplete. | [layout.js](../src/engine/layout.js), [docx-tables.js](../src/engine/docx-tables.js) |
| `headers` | Unsupported header-association metadata; not the visual repeated-row flag. | Implement accessible header identity/associations and safe structural retention. | `cellProperties` whitelist in [docx-tables.js](../src/engine/docx-tables.js) |
| `cellIns` | Unsupported inserted-cell revision. | Implement structural revision identity, views and accept/reject. | [docx-tables.js](../src/engine/docx-tables.js); roadmap S03 |
| `cellDel` | Unsupported deleted-cell revision. | Implement deleted-cell geometry and merge/grid resolution across revision views. | [docx-tables.js](../src/engine/docx-tables.js); roadmap S03 |
| `cellMerge` | Unsupported merged-cell revision. | Preserve previous/current merge state and implement accept/reject with grid/owner controls. | [docx-tables.js](../src/engine/docx-tables.js); roadmap S03 |
| `tcPrChange` | Unsupported previous cell properties. | Implement original formatting and accept/reject; retained paragraph revisions do not establish cell support. | [docx-tables.js](../src/engine/docx-tables.js); roadmap S03 |

## Transitional cell addition

| Property | Import / layout and paint | Editing and remaining work | Evidence |
| --- | --- | --- | --- |
| `hMerge` | Unsupported legacy horizontal-merge declaration; absent from Strict. | Implement restart/continue equivalence and conflicts with gridSpan while preserving source syntax. Existing horizontal span edits do not support this declaration. | `cellProperties` whitelist and serialization ordering in [docx-tables.js](../src/engine/docx-tables.js) |

## Table exceptions

These are `CT_TblPrEx` properties on a row, not ordinary row properties.

| Property | Import / layout and paint | Editing and remaining work | Evidence |
| --- | --- | --- | --- |
| `tblW` | Unsupported row-level table width exception. | Implement row/table preference precedence with fixed/AutoFit geometry. | Row exception whitelist in [docx-tables.js](../src/engine/docx-tables.js) |
| `jc` | Partial: exception alignment applied before direct row properties. | Retained; table alignment commands update effective row overrides, but complete exception authoring is absent. | [docx-tables.js](../src/engine/docx-tables.js), [model.js](../src/engine/model.js) |
| `tblCellSpacing` | Partial: zero/ignored-unit subset only. | Implement nonzero exception spacing and border geometry. | [docx-tables.js](../src/engine/docx-tables.js) |
| `tblInd` | Unsupported row-level indent exception. | Implement row frame/indent precedence and serialization. | Row exception whitelist in [docx-tables.js](../src/engine/docx-tables.js) |
| `tblBorders` | Partial: exception borders are projected and participate in existing conflict/layout rules. | Retained; full exception editing and unsupported spacing/style coverage remain open. | [docx-tables.js](../src/engine/docx-tables.js), [cell-borders.js](../src/engine/cell-borders.js) |
| `shd` | Unsupported row-level table shading exception. | Implement its paint layer and precedence separately from cell shading. | Row exception whitelist in [docx-tables.js](../src/engine/docx-tables.js) |
| `tblLayout` | Unsupported row-level layout-algorithm exception. | Implement row/table geometry semantics and combinations with width exceptions. | [docx-tables.js](../src/engine/docx-tables.js) |
| `tblCellMar` | Partial: exception margins feed effective cell defaults. | Retained; complete per-row exception authoring is absent. | [docx-tables.js](../src/engine/docx-tables.js), [cell-margins.js](../src/engine/cell-margins.js) |
| `tblLook` | Partial: exception look drives row-specific conditional settings. | Retained; complete editing and conditional property coverage remain open. | [docx-tables.js](../src/engine/docx-tables.js), [table-style-regions.js](../src/engine/table-style-regions.js) |
| `tblPrExChange` | Unsupported previous exception properties. | Implement revision views and accept/reject for the exception container. | [docx-tables.js](../src/engine/docx-tables.js); roadmap S03 |

## Inventory checks and follow-up

Use the existing inventory tool with `--ledger docs/table-property-coverage.md`
and the appropriate `--type` / `--ledger-section` pair: `CT_TblPr` / `Table
properties`, `CT_TrPr` / `Row properties`, `CT_TcPr` / `Cell properties`, and
`CT_TblPrEx` / `Table exceptions`. For Transitional `CT_TcPr`, also select
`--ledger-section "Transitional cell addition"`. Each selected section is checked
against its own declaration set; the repeated property names in different
contexts are intentional. All four complex types have no own attributes.

Schema SHA-256: Strict
`44fc2233c5df2cfbe0b3b50e7024bd8412ec99dfe7176313ef58845fdec5498d`;
Transitional `0f7784b36ddc42950e5ff354cd608b83b60e4de39325d5568913f1225365029b`.
Immediate declarations are inventoried; nested attributes/types, property
contexts, grid/wrapper content and extensions remain follow-up audit work.

Existing scoped regressions include [table edits](../tests/canvas-tables.test.js),
[property recovery](../tests/table-property-recovery.test.js),
[zero/ignored spacing](../tests/zero-cell-spacing.test.js),
[floating overlap](../tests/table-overlap.test.js),
[conditional regions](../tests/table-style-regions.test.js),
[headers](../tests/canvas-table-headers.test.js),
[merged pagination](../tests/finished-merge-pagination.test.js), and
[rotated recovery](../tests/rotated-cell-recovery.test.js). This audit introduces
no layout change, new native-reference evidence or template completion. Independent
controls for legacy hMerge, hidden/revised rows, accessible header metadata and
the unsupported table exceptions should precede their implementation.
