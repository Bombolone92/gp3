# Paired native mask composition controls

`tools/svg_mask_composition_fixture.py` authors six original masks with two
overlapping solid rectangles, fractional edges, reversed color order, mixed
paint opacities and one translucent ancestor group. `--intermediate` authors
the same content under an sRGB identity color-matrix filter instead of a mask.
Both were captured in the reference application using the existing first-inline-range
metafile recorder. Source/native/PNG hashes are retained in both folders.

`tools/check_svg_mask_composition.py` aligns the two native raster sets by
their retained transforms. Rounding luminance to a byte and then applying
native alpha reproduces every pixel in all six mask rasters, including edges
and overlaps. This extends the 72 isolated solid-color controls. It does not
claim that browser-generated intermediate pixels already match the reference application.

A private reuse probe of the current group rasterizer exposed rectangle edge
coverage errors and additional one/two-byte composition differences. The
rectangle issue is separately corrected and covered by svg-group-rectangle-edges.
General mask rasterizer integration remains unfinished; #288 stays partial.
