# Unwrapped drawings in table cells

`tools/cell_anchor_flow_fixture.py` authors original OPC/XML packages with an
original solid-blue PNG. Each file was opened in the reference application,
confirmed by exact full path, exported to PDF and closed without saving. The
generated fixture ZIP entries match the corresponding reference input entries.
The JSON files record PDF SHA-256 hashes, baselines, cell rectangles and image
frames; PDF coordinates are in points from the top-left. There are 28 pages.
The edge controls were re-exported after correcting paragraph-property XML
order; all 14 pages were pixel-identical to the initial native references. The
stored PDFs and hashes are those of the corrected, schema-valid controls.

The five-page flow control is repeated in compatibility modes 12 and 15. It
covers one, two and five paragraphs; automatic, minimum and exact row heights.
A 36pt-tall drawing is positioned 12pt below its paragraph. The reference application retains 12pt
text-line increments and does not add the drawing to row height. For example,
the two-paragraph cell is 24pt tall while the drawing extends to 48pt below the
cell top, without clipping. The exact-row variant also paints the full drawing.

The seven-page edge control, also in both modes, covers negative vertical and
overflowing horizontal offsets, foreground/background order, layoutInCell=false,
center/bottom alignment and an anchor in the second paragraph. Vertical
alignment includes the drawing's bottom extent in the content envelope, but
that envelope does not grow the row or move subsequent paragraphs.

The two-page origin control places the anchor in the second cell of an indented
table. With layoutInCell=true, the 108pt horizontal offset begins at that cell's
288pt text origin (result 396pt). With layoutInCell=false, mode 12 uses the
36pt document-column origin (result 144pt), while mode 15 still uses the cell.
These controls verify origin selection independently of the first-column cases.

ECMA-376 Part 1 §20.4.2.15 (`wrapNone`) says the drawing does not cause text
wrapping; §§20.4.2.3 (`anchor`) and 20.4.2.10–11 (`positionH`/`positionV`)
define its retained positioning. The controls establish the reference cell-flow and
alignment behavior. This corrects earlier engine tests that incorrectly assumed
row growth or exact-cell clipping; no new wrapping mode is introduced.

**Proven reference/spec divergence:** the layoutInCell description in §20.4.2.3 says
the cell is resized as needed for true, and specifies the table-line reference
instead of the cell for false. The reference application's wrapNone controls leave the cell unchanged,
including when the picture is entirely outside it, and modern mode 15 retains
the cell-column reference even with false. The renderer follows the observed
reference behavior. The independent automatic/exact-row and displaced-origin controls
separate these results from any geometry in a user template.

Unit tests check the recorded geometry, overflow hit targets, selection,
resize/edit/export/reopen and exact undo. Browser tests check native text
baselines, drawing pixels beyond cells, origins and package preservation.
PDF rounding is allowed at sub-point tolerance; page counts and flags are exact.
