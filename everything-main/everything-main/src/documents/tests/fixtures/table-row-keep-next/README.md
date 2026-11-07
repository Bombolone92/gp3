# Final table row kept with the following paragraph

Five independently authored 300pt square documents place a two-row table near
the page bottom. The last row fits, but its following 12pt body paragraph does
not. All text uses installed Arial; no font binary is included.

The reference application moves the last row together with that paragraph only when the
first paragraph of the first physical cell has keepNext. This includes an empty
cell (`first`) and a first paragraph followed by an unkept paragraph
(`first-start`). No flag (`none`), a flag in the second cell (`second`), or only
in the last paragraph of the first cell (`first-end`) leaves the row on page one.

This extends the paragraph-level description of ECMA-376 Part 1 section
17.3.1.15. It differs from a row followed by another row: the older independently
authored first-cell-keep/two-rows controls establish that those rows do not form
a keep chain. Both sets must pass. Vertically merged final row groups and repeated
header groups require separate controls before extending this behavior to them.

Generate sources using tools/table_row_keep_next_fixture.py. Capture PDFs with
tools/export-reference.ps1, then run tools/record_table_row_keep_next.py to record native text origins and source/PDF
SHA-256 hashes in reference.json. Browser checks compare page assignments
and native origins within 0.2pt and verify editing, unchanged package parts,
exact undo, and editable export/reopen. Unit tests cover the five flag scopes.
