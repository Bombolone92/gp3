# Nested floating table references

`tools/nested_floating_table_fixture.py` authors eighteen original two-column
outer-table controls. The left cell always contains an inline nested table;
the right cell uses, by page: an inline baseline, page-relative offsets,
signed paragraph-relative offsets plus wrapping distances, and right/bottom
alignment. The remaining cases isolate equal offsets with each anchor,
zero/negative/oversized offsets, alignment, and individual text clearances.
`cases.json` maps zero-based page numbers to positioning attributes (null means
inline). Each cell has text before and after its nested table. The fixture uses
Arial, compatibility mode 14, and no corpus content. The source passes eight
schema checks.

The reference application opened the exact source and exported `native.pdf`
without saving it. `manifest.json` records source/reference hashes.
`native-lines.json` records PDFium character-origin line coordinates in points
from each page's upper-left corner. Native text extraction order can differ
from logical order for floating content; use the text and coordinates together.
`native-geometry.json` additionally retains every native character origin and the
two green table-fill rectangles per page. These are extracted from PDFium text
origins and the PDF's solid-color rectangle operations. Same-baseline text can
combine a floating table with its host paragraph in `native-lines.json`; use the
character records to disambiguate it. All eighteen rendered pages were inspected.

The right nested text starts at (293.470,114.020) in the inline baseline;
the positioning variants move it to (431.380,315.050), (329.470,102.020), and
(425.980,99.020). The following outer paragraph's baseline changes from
144.020 to 330.050 and 153.020 in the two offset cases. These observations
disprove treating the nested positioning declaration as inert metadata.

## Isolated observations

All measurements below are PDF points; small coordinate rounding is retained in
the JSON rather than normalized to an assumed layout formula.

- Cases 4–6 use identical 36pt offsets. The right nested text originates at
  (324.070,135.020) with page anchors, (329.470,135.020) with margin anchors,
  and (329.470,150.020) with text anchors. The parent cell's left edge is
  282.670pt, its writing edge is 288.070pt, and its top is 87.020pt. Thus page
  offsets are cell-relative in this control; the margin horizontal origin adds
  the 5.4pt cell margin. Text vertical positioning instead follows the next
  paragraph, whose ordinary baseline is 114.020pt.
- Case 8's -36pt offsets clamp the nested text to (288.070,99.020), rather than
  allowing it to escape the cell. Cases 1 and 9 clamp oversized horizontal
  offsets; the child fill begins at 425.980pt. The relationship between this
  clamp and the complete floating frame still needs implementation verification.
- Cases 11–13 align horizontally left/center/right, but top/center/bottom all
  produce a nested-text baseline of 99.020pt. This does not establish behavior
  for exact-height or vertically aligned parent cells.
- Cases 10 and 14–17 isolate the four text distances. Left clearance moves
  the following paragraph entirely to the right of the table; right clearance
  widens the gap between its split text fragments. A 36pt bottom clearance
  increases the following outer paragraph's baseline from 144.020 to 153.020pt.
  It therefore affects the parent row's height, even though text can still flow
  beside the table. The top-clearance case has no additional visible effect in
  this control; that is not evidence that top clearance is always ignored.

## Specification difference and implementation status

ECMA-376 Part 1 §17.4.57 describes `page` anchoring against physical page edges
and gives an explicit 4320-twip example at (3in,3in). The reference application's nested case 4 instead
places the fill at (318.670,123.020), 36pt from the containing cell's top-left,
not at (36,36) on the physical page. Case 1 uses the specification's 4320-twip
offsets and additionally demonstrates the horizontal cell clamp. This is a
reproduced context-dependent difference from the stated page-anchor rule;
the eventual engine implementation must retain the source attributes while
using cell-relative layout. These controls do not settle all nested-table rules.

The browser regression now compares all eighteen controls: table dimensions,
absolute vertical placement, parent-relative horizontal placement, wrapping
fragment origins, caret hits, and edit/export/undo/reopen. An existing legacy
top-level table offset shifts the entire outer table horizontally; the test
isolates nested X against the left inline control rather than treating that
unrelated offset as fixed. Full absolute visual equivalence remains open.
Floating tables in split parent cells and floats crossing a page boundary still
use the read-only fallback. Other compatibility modes and vertically aligned
parent cells require further native reference controls.

Validation for this implementation: 60 unit tests across nested/floating tables,
wrapping and exact-row layout; 18 browser tests covering the native controls,
editing, top-level floats, existing clipping, headers and square wrapping;
32 schema checks across the source and no-edit/edited/undo browser exports;
production build and dependency-license checks. These passes do not close the
remaining native-comparison gaps listed above.
