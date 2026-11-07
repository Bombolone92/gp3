# Native ribbon geometry and shading controls

These independent references validate the retained `ribbon2` implementation.

`tools/ribbon_fixture.py` independently authors eight `ribbon2` presets from the
project's original shape-defaults OPC fixture. They cover default adjustments,
negative/zero/oversized adjustment bounds, wide/narrow extents, horizontal and
vertical flips and quarter-turn rotation. `tools/ribbon_color_fixture.py`
creates a second eight-shape control with default adjustments and white, black,
red, green, blue, gray, near-black and blue-gray fills. No corpus artwork is
copied. The reference application exported both single-page references; both were inspected.
Both source packages pass all applicable standard/extension schema checks.

`tools/record_ribbons.py` and `tools/record_ribbon_colors.py` bind source, PDF and
PNG hashes. The latter also retains native PDF nonstroking color operators.
The darker ribbon folds use approximately 80.4% of encoded RGB channels:

| Base RGB | Native fold RGB (rounded from PDF values) |
| --- | --- |
| 255,255,255 | 205,205,205 |
| 255,0,0 | 205,0,0 |
| 0,255,0 | 0,205,0 |
| 0,0,255 | 0,0,205 |
| 128,128,128 | 103,103,103 |
| 1,2,3 | 1,2,2 |
| 214,232,245 | 172,187,197 |

These samples are consistent with rounding channels multiplied by 205/255;
the PDF precision and limited samples do not establish every intermediate
color. Black remains black. `tools/ribbon_fill_fixture.py` adds eight controls
for translucent solids, linear gradients, two-color patterns and stretched
pictures. The picture is an original red/blue bitmap authored by that generator.
The additional native page was visually inspected. Its source and PDF hashes
are recorded by `tools/record_ribbon_fills.py`.

The mixed-fill reference is rasterized directly at 96 DPI. Supersampling its
dense native pattern tiles and then BOX-downscaling changes their periodic
sampling and produces a different moire pattern. The raw native reference PDF is unchanged;
direct native 96-DPI interiors match the renderer's pattern samples. Other
controls retain their original supersampled geometry/color references.

The supplied ECMA-376 `ribbon2` definition has three paths: a normal fill,
`darkenLess` fold faces, and a separate outline; it uses elliptical quarter/half
arcs. The renderer evaluates the preset and shades only the fold fill, leaving
outlines and text unchanged. All three controls pass bidirectional ink checks,
strict flat-color checks (maximum channel difference two), insertion, unrelated
part preservation, exact undo and export/reopen. Their sources and exports pass
schema validation.
The text rectangle is the middle panel above the folds. The first adjustment
is pinned to 0..33333 and the second to 25000..75000. Zero first adjustment
collapses the curved folds. ECMA-376 Part 1 §20.1.10.37 describes `darkenLess`
qualitatively, without specifying a numeric transform. The 205/255 encoded-RGB
scaling is native compatibility behavior, not a demonstrated reference/spec
divergence. Other ribbon presets and custom-path fill modes remain in scope;
this change does not claim their support.
