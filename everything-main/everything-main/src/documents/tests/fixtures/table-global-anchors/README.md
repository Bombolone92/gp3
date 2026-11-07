# Unwrapped page/margin anchors in table cells

Original OPC/XML and blue PNG controls are authored by
`tools/table_global_anchors_fixture.py` (22 pages each, compatibility 15 and 12).
The reference application exported `native.pdf` and `native-legacy.pdf`.
`tools/record_table_global_anchors.py` records source/PDF hashes, image matrices,
physical cell rectangles and visible blue raster bounds at 144 DPI. It does not
use the renderer to generate expected geometry.

Cases 1–16 cross behind/in-front, layoutInCell true/false, page zero/100pt
coordinates, margin zero coordinates, and center alignment. Cases 17–22 cover
negative offsets, right/bottom alignment, 12pt cell margins, margin centering,
overflow below an exact row, and a second anchor paragraph in a padded cell.

Observed native reference behavior:

- With layoutInCell=true, page/margin x coordinates start at the physical cell
  left; horizontal alignment uses its full width, excluding neither margin.
- Vertical coordinates start at cell top plus top margin. Vertical alignment
  contributes no displacement, including center and bottom. Moving the anchor
  to the second paragraph does not move a page-relative drawing down.
- wrapNone drawings can cross any cell edge, including an exact-height row,
  without growing the row. Behind-document drawings are obscured by cell fills;
  their PDF image matrices remain available even when no blue ink is visible.
- Mode 12 honors layoutInCell=false using page/margin coordinates. Mode 15
  resolves the same flag as true. Source flags remain intact through editing.

ECMA-376 Part 1 §20.4.2.3 (printed pp.3106–3107) describes layoutInCell=true
as cell-relative with resizing, and false as positioned as specified with table
resize/relocation. The identical true/false results in mode 15 and the absence
of row resizing for wrapNone are compatibility differences demonstrated here.
The fixture tests those differences instead of applying brochure-specific rules.

Supported new subset: unwrapped page/margin coordinates on both axes, fixed
size, numeric offsets or supported alignment, both stacking directions and both
layoutInCell values. Mixed page/paragraph axes and additional wrapping modes remain guarded.
Relative sizing inside a cell is now covered by the separate
`table-relative-anchors` native reference controls.
Paragraph-relative/column-relative floating-cell behavior is separately covered
by the annual-report and exact-row tests and remains unchanged.

The browser compares every page's blue raster bounds/visibility to the reference application, then
edits body and cell text, exports/reopens, and checks exact source restoration
with two undos. Unit tests also check frames, selection, hit testing and retained
package parts. These tests certify the drawing behavior, not general text-font
or whole-document fidelity.
