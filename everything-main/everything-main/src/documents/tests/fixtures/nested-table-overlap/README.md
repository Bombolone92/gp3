# Nested floating-table collisions

Original controls authored by `tools/nested_table_overlap_fixture.py`, using
Arial and compatibility mode 15. No corpus artwork or third-party engine is
included. The reference application exported the exact source to 22 PDF pages;
`tools/nested_table_overlap_reference.py` extracts text origins and previews.
The reference JSON binds source and PDF SHA-256 hashes, checked by a unit test.

Cases cover all four overlap/never flag combinations at two widths, separate
left/right/top/bottom text distances, three competing tables, unequal heights,
2pt borders and available-width boundaries. All native previews were inspected.
The reference application separates floating tables within the same cell even when both allow
overlap. This differs from the permission described by ECMA-376 Part 1
17.4.56 and 17.18.88. Positioning and distances fall under 17.4.57.

Placement first tries the preceding table's right side, then returns to the
original horizontal origin below that table when the available width is
insufficient. Horizontal clearance includes border overhang, fifteen twips at
the right and a minimum ten twips at the next left edge. Explicit text distances
contribute to clearance. Vertical distances add. These are native observations,
not normative constants prescribed by OOXML. Original XML remains unchanged.

Unit and browser checks compare all native text origins within 0.15pt, grow a
child through editing, check the displaced child's hit target and verify export,
reopen and exact undo. This does not certify split parent cells, floats crossing
page boundaries, all compatibility modes or pixel-identical painting.
