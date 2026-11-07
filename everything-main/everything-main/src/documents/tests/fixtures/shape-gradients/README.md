# Native linear-gradient reference

`control.docx` is original XML assembled by `tools/shape_gradient_fixture.py`
using this repository's authored shape-theme fixture as its package envelope.
No corpus content or third-party renderer is included. Twelve rectangular shapes
cover angles 0, 30, 45, 90, 135 and 225 degrees, each with `scaled` false and true.
Each has explicit red, green and blue stops at 0%, 50% and 100%.

The reference application opened the source read-only, confirmed its exact full
path, and exported `native.pdf` with `Document.ExportAsFixedFormat(path, 17)`.
`tools/record_shape_gradient_reference.py` extracts independent axial shading
coordinates and source/PDF hashes. It verifies the native shading function's
four segments before selecting the authored tile's interval. The preceding half
of the reference application's PDF axis represents a mirrored preceding tile.

ECMA-376 Part 1 §20.1.8.33 defines gradient fills, §20.1.8.36 their stop positions,
§20.1.8.41 linear shade properties, and §20.1.8.59 the tile rectangle.
The scaled-vector formula in §20.1.8.41 states `(w*cos(a), h*sin(a))`.
The reference application diverges: the native axes follow `(cos(a)/w, sin(a)/h)`, normalized, for
scaled gradients. Unscaled axes follow `(cos(a), sin(a))`. Projecting the shape
corners onto that direction gives length `abs(w*dx)+abs(h*dy)`; endpoints are
center plus/minus half that length. All twelve native endpoint pairs agree with
this calculation within 0.006 pt (PDF coordinate rounding).

These controls establish the geometry reference; they do not establish support
for path gradients, nonempty tile rectangles, rotations, flips, transparency,
theme stops or edit round trips. Linear gradient runtime support now uses these native axes; browser tests check
108 interior samples through edit, undo and reopen. Other listed cases remain
outside the coverage of this fixture.
Both the transitional and supported extension schema checks pass for the source.
