# Fixed table preferred width

`tools/fixed_table_preference_fixture.py` manually authors fifteen original
tables on one page. The reference application exports `native.pdf` without saving the source.
`tools/fixed_table_preference_reference.py` measures the 44 colored cell fill
rectangles directly from PDF drawing operators and binds source/PDF hashes.

The controls cover absolute and percentage preferences larger than the cell
requests, automatic/nil widths, proportional reduction, later-row conflicts,
merged cells, different stored grids, and leading/trailing omitted columns.
Mixed full/omitted rows distinguish a column omitted everywhere from one that
contains a cell in another row. Both expansion and reduction keep universally
omitted columns at their separately requested widths.

ECMA-376 Part 1 §17.18.87 (printed pp1496–1497), §17.4.63 `tblW` and §17.4.71
`tcW` describe preferred-width layout. The fixed-layout guidance details
proportional reduction when cell requests exceed the table preference, but
does not give the corresponding expansion step. The reference application expands the completed
occupied grid proportionally to a larger explicit table preference after all
row requests have been resolved. The original control records that behavior
without claiming a normative contradiction: the clause labels its algorithm
as guidance and permits other processes.

For example, cell requests 1000/2000 twips become 1440/2880 for a 4320-twip
table preference. A later 1800-twip first-cell request is resolved before final
expansion. A column omitted in every row retains its own gap width outside the
table preference; a column occupied in any row participates in allocation.
Automatic/nil widths remain based on row/cell information. AutoFit retains its
own content-constrained final allocation.

The fix changes calculated geometry only. Stored grids and conflicting table
and cell preferences remain intact. Browser checks compare all cell positions,
sizes and painted fill extents with the reference application, then exercise native body editing,
no-edit package equality, unrelated-part preservation, exact undo and reopen.

All fifteen tables were visually compared with the native reference page. Text is explicitly
black so automatic foreground contrast does not obscure the geometry comparison.
Validation: 71 table unit checks, 29 browser cases (one optional private-file case
skipped), 112 source/export XML checks, production build and license gate pass.
The final fixture's unit/browser checks were rerun after the explicit text-color
change. The old aggregate malformed-import test exceeded its five-second budget
on unchanged main as well; its six independent assertions now have separate
test cases. No timeout increase or assertion removal was needed.
