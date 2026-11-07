# Original gradient color controls

These packages were authored by `tools/gradient_color_fixture.py` and
`tools/gradient_color_edge_fixture.py` from our original shape-gradients control.
No corpus artwork or third-party engine implementation is included.

The color page covers eight two-endpoint color pairs (primary colors, gray ramps,
and mixed colors) and four three-stop controls. The edge page covers inset stop
positions, reversed XML order, coincident positions at zero/middle/end, constant
transparency, fade-in, fade-out and unequal endpoint alpha. Each page has twelve
independently positioned rectangles. Native references were exported using
the reference application and both full page pairs were inspected.

The native PDF distinguishes an opaque two-endpoint sampled function from the
piecewise-linear functions used for three stops, inset stops or transparent
stops. Its sampled colors agree with a normalized Gaussian cumulative curve on
[-2,2], followed by RGB gamma 2.2 interpolation. This is a measured reference
behavior; OOXML describes a gradual transition but does not specify this easing.

`tools/gradient_color_reference.py` extracts the PDF function and evaluates it at
sample coordinates for opaque controls. It uses only the PDF's own sampled or
stitched functions, never the engine's interpolation implementation. PDFium's
raster colors are also retained: its additional axial lookup quantization can
differ by up to eight channel values here, even for a simple three-stop ramp.
Transparent controls are compared using their final native raster composites.
The JSON contains hashes of both source DOCX and the native reference PDF.

Known precision limit: The native reference's sampled PDF quantizes a few channels immediately
next to black to zero. The smooth mathematical curve can differ by up to eight
8-bit levels within the first two of 255 intervals for the darker endpoint cases.
The unit test compares interior samples and exact endpoints separately; this
limit is not hidden by broadening every comparison. Browser tests exercise all
24 controls with four-level color tolerance, no-edit package preservation,
body editing, original gradient XML retention, exact undo and export/reopen.
