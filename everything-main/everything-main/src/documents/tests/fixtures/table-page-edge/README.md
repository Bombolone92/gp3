# Tables crossing paper edges

`tools/table_page_edge_fixture.py` authors original XML using this project's own
table-width control package. Modern (15) and legacy (12) variants each have nine
pages: negative left indent, right overflow, center/right oversized tables,
wholly off-page tables on either side, AutoFit overflow, and nested negative/
positive indentation inside an exact-height parent row. No template is copied.

The reference application exported both PDFs without saving the source files.
`tools/record_table_page_edge.py` (and `--legacy`) records untrimmed cell fill
rectangles, whole-row raster samples, and source/PDF hashes. Wholly off-page
controls produce no colored PDF objects. Both compatibility modes agree.

ECMA-376 Part 1 §17.4.50 describes leading-edge table indentation; §§17.4.52,
17.4.87 and ST_TblLayoutType govern table sizing and layout. These clauses do not
require rejection of tables crossing the physical paper boundary. The reference application retains
their layout and clips the ink at the paper edge.

Native compatibility difference: §17.4.50 does not specify clamping a nested
negative indent. The reference application clamps it to the containing writing edge, but retains
positive nested indentation. The two independent nested controls establish
this distinction; source indentation is never rewritten.

The nested controls also establish horizontal clipping to an exact-height
containing cell. Layout retains all nested content. Painting, caret placement,
selection and hit testing share the resulting clip. Existing vertical clipping
and repeated-header regressions remain enabled.

Browser checks compare fill geometry and page-edge/nested clipping, then edit
both body text and a wholly off-page cell, export, reopen and undo. The reference
does not certify automatic text-color contrast: the reference application shows black automatic ink
on this medium-blue fill while the current canvas chooses white. This separate
existing contrast issue remains open; it does not change the measured geometry.
