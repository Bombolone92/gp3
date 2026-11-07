# Native oval line-end controls

`tools/oval_marker_fixture.py` authors 36 controls from our original OPC shell,
without corpus artwork or font binaries. The reference application opened control.docx
read-only and exported the two-page native.pdf. The recorder extracts actual
filled PDF ellipses (centers and two axis vectors), hashes source/PDF, and
measures color bounds and selected alpha/dash pixels independently of the
engine. Raster PNGs are optional inspection outputs, not reference inputs.

The controls establish:

- Width/length sm, med and lg use factors 2, 3 and 5, independently.
- For a positive authored pen p in points, the physical marker base is
  max(p, 2, 0.48/p) points. The explicit zero-width case instead uses 0.24pt.
  Thus very thin positive pens can produce unexpectedly large markers in the reference application.
- Head/tail centers coincide with path endpoints; dimensions remain physical
  under group scaling, rotation and collapse. Reflected/inline cases are in
  ../straight-oval-lines.
- Curved paths orient an oval along the chord to the first point half a marker
  length from the endpoint. Two different cubic controls distinguish this from
  the exact endpoint derivative. Closed contours omit markers.
- The reference application composites a translucent stroke and its markers once. Dash gaps remain
  transparent; marker interiors retain the line paint.

These are reference compatibility details where the schema's qualitative size enums
do not prescribe physical arithmetic, not an asserted standards contradiction.
The renderer uses physical-coordinate circle intersection for curve direction,
and a reusable bounded ink surface for the combined stroke/marker paint. The
existing drawing resource limits remain in effect.

Browser regressions compare all native marker centers/radii/orientations and
sampled alpha/dash ink, then verify editing, preservation, undo and reopening.
Units cover malformed declarations, round trips, degenerate controls, closed
contours, marker selection bounds and collapsed-group selection. No reference
coordinates were adjusted to fit engine output. Unsupported non-oval end types
remain guarded. These controls do not establish every exotic custom-path,
compound-outline or effect combination.
