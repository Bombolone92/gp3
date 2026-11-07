# Fixed-table reduction against the native reference

`tools/fixed_table_reduction_fixture.py` authors the controls directly in OOXML.
No private template content is used. The reference recorder opens each source read-only
in its own reference application instance, records every cell's native `Width`, and exports a PDF.
References record the reference application and bind both source and PDF hashes.

- `source.docx`: nine controls covering margins from 0 to 400 twips, conflicting
  rows, and merged/unmerged row order.
- `rows.docx` (`--rows-only`, recorder `-RowsOnly`): the three row controls,
  independently exported and measured for focused regressions.
- `margins.docx` (`--margins-only`, recorder `-MarginsOnly`): thirteen controls
  covering undersized preferences, one-point writing minima, merged cells,
  opposing margins across rows and unequal margins across columns.

The two underlying corrections are:

1. Resolve all row requests before reduction. Explicit single-column requests
   replace shares inferred from merged cells; complete span constraints remain.
   For a 4000-twip table with requests `[3000,3000]` then `[4000,2000]`, the reference application gives
   `[114.2,85.8]` pt. Reducing after each row incorrectly gave `[133.333,66.667]`.
   Reversing merged/unmerged rows must not alter their resolved widths.
2. Reserve each cell's horizontal margins plus one point of writing space while
   shrinking. The remaining width is allocated proportionally above those
   reserves. A smaller table preference expands to the combined minimum instead
   of eliminating writing space. Across rows, use the largest combined margin
   requirement of an actual cell, not independently accumulated left/right maxima.
   Merged cells constrain their whole span, not every individual grid column.

The one-point reserve is independently established by the minimum-width
controls: two zero-margin cells remain one point each when the table requests
only one point total. With 100-twip margins on each side, each remains 11 pt; with
400-twip margins, each remains 41 pt. Above the minima, the table uses the larger
requested width. The opposing-row control confirms that left/right margins in
different cells must not be added together into a nonexistent wider cell.

ECMA-376 Part 1 §17.18.87, printed pp1496–1497, permits a guidance algorithm that
proportionally reduces grid columns while processing rows. Its description does
not state this one-point reserve or margin-preserving reduction. These controls
record the reference application's behavior separately from that guidance; the clause explicitly
permits other processes. Related clauses: §17.4.48 `tblGrid`, §17.4.63 `tblW`,
§17.4.71 `tcW`, §17.4.17 `gridSpan`, §17.4.42 `tblCellMar`, and §17.4.68 `tcMar`.

The correction changes calculated layout only. Stored grids, cell/table
preferences and package parts remain intact. Universally omitted columns keep
their independent gap widths. Unshrunk grids, expansion and AutoFit retain their
existing allocation; the earlier 15-twip narrow-writing-space control remains
valid because its declared grid does not require reduction.

`node tools/check-fixed-table-reduction.mjs` prints comparisons for the original
nine controls. Unit tests bind and check all 22 distinct controls against native
widths within 0.1 pt, plus the separate three-row-control reference. Browser
checks cover native widths, painted fills, editing, no-edit package retention,
exact undo and editable reopen. Very narrow one-point cells have no pixel clear
of glyphs and editing guides, so they use native geometry assertions instead of
an interior fill-pixel assertion.

Corpus document 85 motivated this work. Both formerly different text wraps now agree
with the reference application; all 42 text lines match. A scratch margin-only prototype from before
the row correction was insufficient and was never installed.

Validation: 65 unit checks, ten browser checks (one optional private-file case
skipped), all 28 browser exports, source schemas, production build and license
gate pass. The final native fixture was recaptured after correcting `tcMar`
element order; the recorded widths and all checks remain valid.
