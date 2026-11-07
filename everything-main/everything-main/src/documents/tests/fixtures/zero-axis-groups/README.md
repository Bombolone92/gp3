# Zero-axis DrawingML groups: native reference

`tools/zero_axis_group_fixture.py` manually authors twelve local DrawingML group
controls in `public/fixtures/zero-axis-groups.docx`. No corpus artwork, font
binary or external document engine is used. The generated DOCX passes five XML
schema checks, including the published WordprocessingML group/shape extensions.

The reference application confirmed this exact source path, opened it read-only,
repaginated and exported the one-page `native.pdf`. The full page was visually
inspected. `tools/record_zero_axis_groups.py` reads the actual PDF line endpoints
and physical pen widths, with source/PDF hashes in `reference.json`.
`cases.json` contains authored inputs only, not inferred expected output.

Controls cover horizontal/vertical groups, doubled nonzero axes, zero child
coordinate extents with nonzero displayed extents, zero displayed extents with
nonzero child coordinate extents, nonzero child offsets, nesting and a 90-degree
group rotation. Native evidence:

- A zero displayed group axis collapses child positions on that axis, including
  when its child-coordinate extent is also zero. The offset-vertical control
  stays at x=432 pt, rather than retaining the line's four-point local offset.
- A zero child-coordinate extent with a nonzero displayed extent instead keeps
  unit scale: zero-child-width places its line at x=264 pt (252 + 12), despite
  the group having a 36-point displayed width. The horizontal counterpart keeps
  its 12-point offset too.
- The nonzero axis scales normally; doubled groups produce 144-point lines.
- All pens remain 2 pt, including doubled, nested and rotated groups.

The browser tests compare actual transformed paths and physical pens with the
native PDF, check raster ink, exercise thin-frame selection, and verify exact
package/pixel restoration after undo plus editable export/reopen. Follow-up
geometry/rotation controls distinguish collapsing child frames before rotation
from the coordinate scaling operation itself. Relative controls cover native
outer-frame resizing without inventing nonzero artwork on the collapsed axis.
