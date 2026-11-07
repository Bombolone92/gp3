# Off-page flowchart connectors

`tools/offpage_connector_fixture.py` independently authors eight shapes from
the project's original shape-defaults package. The first four are wide and the
last four narrow; each group covers unchanged, vertically flipped, horizontally
flipped and 90-degree rotated transforms. The full native reference
page was inspected. No source-template artwork is copied.

`tools/record_offpage_connectors.py` binds source, PDF and reference PNG hashes.
The browser test compares colored fill and outline pixels in both directions,
allowing one pixel for rasterization differences, through insertion, exact undo
and export/reopen. Unit tests check the standard text rectangle and preserve
all unrelated package parts. Unsupported adjustments remain guarded.

ECMA-376 Part 1 §20.1.9.18 (`prstGeom`), §20.1.10.56 (`ST_ShapeType`) and the
accompanying preset definition specify a ten-unit polygon with shoulders at
height eight and a downward point at (5,10). The text rectangle ends at 4/5
height. Native geometry agrees; no reference/spec divergence was observed.
