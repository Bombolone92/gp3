# Vertical merge border ownership

Original hand-constructed WordprocessingML controls generated with
`python tools/merged_border_ownership_fixture.py` (python-docx, MIT). No user
corpus content, font binaries or third-party renderer implementation is included.

`controls.docx` has ten pages, each with a three-row vertical merge and adjacent
ordinary cells: baseline, restart bottom, middle bottom, last bottom, restart
plus last bottom, last nil, conflicting interior borders, inherited insideH,
inherited table bottom, and inherited insideH with a nil restart bottom.
The reference application exported `native.pdf`. The exact source path was confirmed
through reference automation before export.

`python tools/merged_border_ownership_reference.py` records package/PDF hashes,
50 native text origins and colored-rule samples away from pixel edges. The reference application
reserves hidden interior border widths at their physical row boundaries but
uses the last continuation's border at the visible merged bottom. With a 4.5pt
restart border, subsequent rows move about 4.56pt; no red border is painted.
A later 2pt blue border paints at the merge bottom and reserves its own space.
Conflicting borders and table inheritance still follow ordinary border rules.

The retained layout separates physical row measurement from merged-cell paint
ownership. The engine matches all 50 native baselines within 0.081pt locally.
Browser tests cover native positions/ink, editing, exact package undo and
export/reopen. Portable unit tests cover hidden physical reserves and visible
bottom ownership. Existing oversized-merge pagination, repeated-header and
row-exception browser regressions exercise interaction with pagination.

The cited ECMA-376 clauses define merges, cell borders and row heights but do
not explicitly specify hidden interior borders' row-space contribution. This
is independently established reference behavior; no contradictory normative wording
has been identified, so it is not labeled a proven specification divergence.
