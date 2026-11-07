# Exact minimum cell writing space

`tools/narrow_cell_roundoff_fixture.py` manually constructs a three-column fixed
table using an original fixture's OPC/style shell. Its green spacer is 361 twips
wide with 173-twip left/right margins: exactly 15 twips (one CSS pixel) remain.
At the authored page position, subtracting the converted edges yields
0.9999999999999432 rather than 1 in JavaScript. The former strict comparison
rejected this valid cell and could force a whole document into plain preview.

The reference application exports it as one page. `native.pdf` is retained unchanged;
`tools/narrow_cell_roundoff_reference.py` samples its green band independently
and records source/PDF hashes. Browser tests compare the band and page count,
then check body edit, package preservation, exact undo and reopen. Unit tests
check caret geometry and rejection of genuinely narrower regions, including
0.99999 pixels. No corpus content or external engine is used.
