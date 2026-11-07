# Tables and symbols in retained WordprocessingShape text

Original, independently constructed controls from `tools/shape_table_fixture.py`.
No corpus text, artwork, proprietary engine or font file is redistributed.
The generator uses existing permissively licensed python-docx/lxml dependencies.

`source.docx` has four pages: an upright standalone table, a scaled group with
center anchoring, a bottom-anchored nested table, and an overflowing clipped
table. They exercise merged cells, cell shading, one-point and quarter-point
borders, and paragraphs before/after a table. `symbols.docx` pairs direct and
private-use Wingdings 2 codes with Arial Unicode codes in Courier New runs.
The declared symbol face must apply only to the symbol.

`native.pdf` and `symbols-native.pdf` were exported by the reference application. `tools/shape_table_reference.py` records PDF text coordinates
and source/reference hashes. Native coordinate checks require installed Arial;
symbol appearance was also inspected with installed Wingdings 2 and Courier New.
Portable unit tests verify table ownership, guards and immutable drawing XML
through body edits, export, reopening and exact undo. Browser checks also verify
that quarter-point rules survive reduction at two different pixel offsets.

The former Nested A/B origin gap in case 3 is resolved by the paired controls
in `../nested-shape-tables`. The reference application shifts the nested table origin to the parent
cell's inner border edge in a text box while retaining padded available width
and the nested cells' own margins. All 42 native origins are now asserted,
including the two previously excluded labels. This fixture does not certify
every nested-table layout.

The symbol control also records that the reference application renders Arial F041 as a missing
glyph, not ordinary A; the font's actual character mapping is preserved.
The direct/PUA Wingdings pair renders identically. The original `w:sym` XML
is retained; these are display-only runs inside the atomic drawing.
