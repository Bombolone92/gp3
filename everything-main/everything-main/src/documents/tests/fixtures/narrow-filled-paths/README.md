# Narrow filled DrawingML paths

Original OPC/XML authored by `tools/narrow_filled_paths_fixture.py`. Each of four
panels has horizontal and diagonal filled polygons of 0.03, 0.06, 0.12, 0.25,
0.5, 1, 2 and 4 point vertical thickness. All outlines are explicitly disabled.
Black and white fills, direct shapes, a half-scale group and a double-scale
group distinguish physical geometry from nested coordinates. Backgrounds are
behind text and polygons are in front, isolating fill measurements from anchor
ordering. No corpus artwork, renderer export or third-party engine is used.

The exact source was opened in the reference application through the
reference-application helper. Its one-page PDF was exported without saving the source. Two native
screen captures at 100% zoom were inspected and retained privately. The observed
page width is 816 screen pixels (4/3 pixels per point). The top and scrolled
bottom captures expose all four panels. Their hashes, calibrated page origins,
measurement protocol and source/PDF hashes are in `reference.json`.

`tools/record_narrow_filled_paths.py` reads the horizontal rectangles from the
native PDF: all 32 preserve declared widths within 0.001 point. No minimum pen
width or synthesized stroke is present. Native PDF rasterization makes some
axis-aligned subpixel strips more visible than the reference application's screen rendering. Thus
PDF raster intensity alone cannot justify enlarging these filled polygons.

The browser check compares horizontal-strip coverage at the native screen scale,
normalizing red-channel ink against the local background and black/white fill.
Its bound is 0.2 integrated screen pixel; this permits antialiasing differences
but catches adding a one-pixel minimum fill width. The measured maximum is
approximately 0.186 pixel. At 0.03 point the horizontal strip disappears in
both screen renderers. Diagonal polygons were visually inspected, but are not
covered by the numerical assertion. This is one zoom and pixel phase, not a
claim of general raster identity or full DrawingML agreement.

The browser workflow also checks no-edit ZIP identity, retained package parts
through a text edit, exact undo and edited export/reopen. Unit checks bind the
reference and verify strict import without synthesized outlines and exact
round-trip. Source and three browser exports are schema-validated.

Relevant ECMA-376 Part 1 elements: §20.1.9.8 (`custGeom`), §20.1.9.15
(`path`), §20.1.9.16 (`pathLst`), §20.1.8.44 (`noFill`) and
§20.4.2.3 (`anchor`). The fill geometry remains unchanged in production.
The source Father's Day card (#10) remains partial; its photographic boundary
and texture differences require separate native controls.
