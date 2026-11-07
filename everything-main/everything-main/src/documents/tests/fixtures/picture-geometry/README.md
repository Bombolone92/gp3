# Custom picture geometry

`tools/picture_geometry_fixture.py` authors the XML using the original quadrant
PNG and package from `group-picture-flips.docx`. No corpus artwork is included.
The reference application opened the exact public fixture and exported `native.pdf` without
saving the source. `tools/record_picture_geometry.py` binds both SHA-256 hashes
and records stable interior/exterior samples from the PDF at four pixels/point.

The twelve cases cover a rectangle, triangle, reflected triangle, cubic arch,
hole formed by opposite-winding subpaths, unfilled path, source crop, standalone
picture, offset rectangle, opposite-winding separate paths, disjoint paths, and
overlapping paths with 50% picture opacity. All but the standalone picture are
inside two groups with nonuniform scaling and nonzero child origins. Frames
start at (60 + 260 * column, 90 + 108 * row) points and measure 144 by 72 points.

The reference application stretches the texture over the combined filled geometry bounds, including
curve extrema, rather than unused transform-frame space. A hole within one path
remains transparent; separate paths paint independently without winding
cancellation, accumulating opacity in overlaps. The disjoint case confirms shared texture mapping.
Opaque samples must match exactly. The translucent case uses the existing
picture-alpha suite's three-channel-level PDF/canvas quantization allowance per
layer (six levels for the two overlapping paths).

Browser checks repeat after editing, undo, and reopening; exports retain all
twelve original picture elements. Unit checks preserve untouched OPC parts and
reject malformed/unsupported geometry. Arcs, adjustment handles and 3D custom
pictures are not established by these controls and remain unsupported. Ordinary
picture outlines and nested picture rotation have separate native controls in
`picture-outlines` and `group-picture-rotation`.
