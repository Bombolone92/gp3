# Merged content minima after whole-twip rounding

Six original AutoFit tables request 1000 twips. Four explicit body preferences
compete with an automatic merged cell containing an exact-width original blue
picture. All horizontal cell margins are one twip. Controls move the merged
cell across the grid, reverse its preferred proportions, and change the image
width. No corpus content or third-party drawing implementation is included.

Generate with `python tools/merged_rounding_minimum_fixture.py`. Its XML shell
and one-pixel picture come from our original `nowrap-edge-allowance` fixture.
Fixed ZIP metadata makes regeneration byte-identical.

Record the native reference with:

```
powershell -File tools/record_nowrap_edge_allowance.ps1 -Fixture merged-rounding-minimum -Columns 4
```

`native-widths.json` binds the source and manifest to the reference application logical
cell-width measurements. The reference application preserves the merged picture's width plus its
two margins in every case. These are logical width references, not a native
pixel-identity claim. An optional PDF export was stopped after its logical
measurements were saved; no PDF reference is included.

Before the repair, controls 1 and 4 allocated 666 twips to a merged cell whose
measured minimum is 667. The fractional grid satisfied the constraint; removing
the whole-twip rounding remainder from the leading column broke it afterward.
The repair retains the table's total and feasible individual/merged minima,
including overlapping spans. It does not reinstate content minima intentionally
compressed by AutoFit's earlier allocation pass, or change fixed-table layout.

Tests check the strict merged minimum, unchanged 1000-twip total, native column
widths within the existing 0.2pt comparison tolerance, package preservation,
editing, exact undo and reopening. Some individual column widths still differ
from the reference application by one or two twips; this does not claim to resolve every AutoFit
allocation discrepancy or complete corpus document #64.

ECMA-376 Part 1 section 17.18.87's AutoFit guidance includes enlarging the grid
columns covered by a merged cell to meet its content minimum. Sections 17.4.17
(gridSpan), 17.4.63 (tblW) and 17.4.71 (tcW) describe the corresponding stored
constraints. Whole-twip remainder allocation is not prescribed by this guidance.
