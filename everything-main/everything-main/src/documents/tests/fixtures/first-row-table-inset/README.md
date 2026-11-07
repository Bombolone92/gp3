# First-row borders determine table alignment

`tools/first_row_table_inset_fixture.py` directly authors eight original
two-row, two-column tables in compatibility mode 15. The side borders vary
between absent, 3 pt and 6 pt. Four AutoFit and two fixed-width left-aligned
controls reverse the first/later-row widths; centered and right-aligned
controls complete the set. Arial is installed locally, not redistributed.

The reference application exported the exact DOCX without saving it. Both rows share the
table grid positioned from the first row's exterior borders. A wider side
border in the second row extends beyond the first-row alignment; it does not
shift the table. With 10 pt cell margins and a 72 pt page text origin, the
left text origins are approximately 82, 85, 83.5 and 85 pt for the four
AutoFit controls. Fixed-width controls have the same first-row dependence.

`tools/record_first_row_table_inset.py` records source/PDF hashes, glyph origins
and twenty green border rectangles directly from the native reference PDF. Browser checks
locate all 32 cell labels and compare their x origins and border x positions
within 0.15 pt, then verify
editing, unrelated-part preservation, exact undo and export/reopen. Unit
coverage also retains legacy top-level grid alignment and checks that layout
does not mutate table properties.

An initial 0.1 pt text bound failed at 0.13 pt. Independent PDF border rectangles
also differ from exact source coordinates by up to 0.12 pt; the reviewed bound
is therefore 0.15 pt and checks both text and borders. The original all-row
inset is wrong by 1.5–3 pt. Border widths retain a separate 0.001 pt bound.

Relevant ECMA-376 Part 1 elements include §17.4.28 (`jc`), §17.4.38
(`tblBorders`), §17.4.66 (`tcBorders`) and §17.4.63 (`tblW`). The first-row
choice refines the existing reference-derived modern exterior-ink alignment
policy. A contradictory normative rule for selecting among unequal row-side
borders was not identified; no document-specific offset is applied.

Sparse first-row grids and arbitrary mixed-row/nested combinations are not
established by these eight controls. Existing nested alignment and AutoFit
regressions remain part of the validation scope.

Validation: 72 targeted unit checks and 29 browser cases pass; the control
source and suite exports pass 58 XML checks. Production build/license checks
pass. The actual invoice's final editing, undo and reopen checks also pass,
and its three final exports pass 33 additional XML checks. No existing
regression tolerance was changed.
