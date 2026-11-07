# Original square-shadow blur controls

These twelve independently authored pages isolate shadow density from picture
texture, color, scaling, and overlap. `tools/shadow_blur_profile_fixture.py`
reuses the original picture-shadow control's OPC scaffolding and replaces its
picture with an original, opaque black 32-by-32 PNG. The frames are 72 or 144
points square at (72, 100) points. Each casts a fully opaque black shadow 216
points to the right, with blur radii 0, 6, 12, 24, 36, and 48 points.

The reference application opened the source read-only and exported `native.pdf`.
All twelve native pages were visually inspected together. The source passes ten
XML schema checks. No corpus artwork or font binaries are included.

`tools/shadow_blur_profile_reference.py` verifies page labels, binds the source
and native PDF with SHA-256 hashes, retains the native shadow image's center
alpha row and physical transform, and samples both center axes at 288 DPI.
The 1,920 browser comparisons allow one native shadow texel plus half a CSS
pixel of position uncertainty and four RGB levels of color error. This is a
profile comparison, not a claim of pixel identity or full-page fidelity.

Before the wide-shadow fix, the renderer matched eleven size/radius combinations
under that oracle. The 72-point square with 48-point blur failed because its
center was too dark. The reference application's peak shadow alpha is 241/255 in the native
27-by-27 image. Nineteen sampled positions exceed the four-level allowance;
the largest distance from the allowed native range is ten RGB levels. Thus
the large-blur discrepancy does not require transparent
texture or a scaled shadow. The original scaled-picture-shadow large-blur
expected failure remains unchanged.

Native raster dimensions, in ascending blur-radius order:

| Square size | 0 | 6 | 12 | 24 | 36 | 48 pt blur |
| --- | --- | --- | --- | --- | --- | --- |
| 72 pt | 201 | 78 | 53 | 37 | 31 | 27 |
| 144 pt | 401 | 145 | 93 | 59 | 46 | 39 |

Each bitmap is square. These are measured outputs, not constants in the renderer.
The renderer now computes wide-blur alpha using a separable Gaussian with a
Float32 intermediate and final byte rounding. Four samples per sigma bound the
convolution grid and a three-sigma support bounds the filter. Shadow scale and
reflection are applied before convolution; declared color supplies the final
RGB values independently of mask-edge unpremultiplication. At sigma below 16
CSS pixels the browser filter remains in use, preserving the faster small-blur
path. This cutover is a rendering-cost choice, not an OOXML rule.

All twelve profiles now pass without relaxing their tolerance. The small-square
case is an ordinary passing test and also covers high-DPI editing, unchanged
package parts, exact undo, and reopening. The separate textured 36pt scaled
shadow still fails its strict oracle by one RGB level at nine sample positions;
its expected failure remains. This fixes finite-mask density, not all aspects
of the reference application's low-resolution shadow sampling.

ECMA-376 Part 1 section 20.1.8.45 defines `outerShdw` parameters but does not
prescribe the reference application's exported bitmap resolution or exact blur kernel. This records
a compatibility gap with the native reference; it does not establish a contradiction with OOXML.
