# AutoFit indivisible-content overflow

`tools/table_unbreakable_width_fixture.py` authors six paired controls with a
four-inch writing area (two inches for the glyph), a centered AutoFit table,
and 115-twip side margins.
The content is independently a seven-inch chart, a seven-inch original picture,
or a 200-point Arial W. The reference application exports each as one page. In legacy mode
the table stays near its width limit while content retains its natural size
and is visibly clipped at the cell edge. Mode 15 instead expands the table to
accommodate that indivisible content, beyond the page's writing area.

`record_table_unbreakable.py` extracts the green border centerlines from native
native reference PDF paths, with source/PDF hashes. Chart and picture references have approximately
156.26-point left edges and 299.60-point widths. The glyph uses a narrower cell.
The legacy compatibility mode
includes the existing exterior-cell-margin adjustment; these are not
seven-inch-wide table references. Tests retain the natural object/glyph size,
check the native reference table coordinates and clipping, and exercise editing,
exact undo, reopening and immutable unrelated package parts.

The solver continues to use indivisible-content floors when they fit. In legacy
mode only, exceeding the table limit falls back to independently measured margins,
indents and minimum writing space. Impossible legacy margin constraints still reject.
Modern mode retains the indivisible-content floor as the table's minimum width.
Its chart/picture controls have 48.24-point left edges and 515.64-point widths;
the modern glyph control is about 200.33 points wide. The browser checks use
the same 0.2-point bound for both modes and verify unclipped modern content.
This refines the implementation of ECMA-376 Part 1 §17.18.87's AutoFit guidance;
it is not claimed as an explicit contradiction of a mandated glyph-overflow
algorithm. Source table preferences are never rewritten to force the layout.
