# Table row justification

Original OPC/XML from `tools/canvas_row_alignment_fixture.py`, using only the
Python standard library and our minimal package generator. No corpus artwork.
The final schema-valid source was opened in the reference application and exported
to `native.pdf` without saving. `tools/row_alignment_reference.py` extracts 36
cell-label origins and records the exact source hash.

Six tables distinguish row overrides, table defaults, table-property exceptions,
and style inheritance. Table 4 has a direct center table alignment, a style-level
start row alignment, an end exception and a direct start override. Its rows are
right/left/center. Table 5 omits direct table alignment and inherits a style with
right table alignment and start row alignment: all rows are left. This confirms
that direct table alignment outranks the style's row alignment, without simply
ignoring style-level row properties.

Browser and unit comparisons check horizontal text origins within 0.3pt, not
vertical placement or full raster equivalence. Browser tests cover caret placement
in shifted rows, the Mixed alignment option, unchanged Apply, normalization,
insertion, export/reopen and exact undo. Units also cover nested tables,
malformed properties and border insets of disjoint rows.
