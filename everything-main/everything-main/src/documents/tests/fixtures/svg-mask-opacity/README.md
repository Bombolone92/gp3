# Native SVG mask color, opacity and interpretation

The two original fixtures `svg-mask-opacity.docx` and
`svg-mask-opacity-expanded.docx` each contain six authored masks, repeated as
full, cropped, grouped and shape-fill pictures. Their generators are in tools.
The reference application's first inline ranges were captured with
`tools/capture-svg-group-raster.ps1`. `tools/record_svg_masks.py` extracts the
original native SVG metafile PNGs and records source/native/image hashes.
All twelve native image regions were visually inspected.

Center alpha, from the retained native PNGs:

| First fixture | Alpha | Expanded fixture | Alpha |
| --- | ---: | --- | ---: |
| Opaque white | 255 | Opaque gray | 128 |
| White fill opacity .5 | 127 | Opaque blue | 89 |
| White fill opacity .125 | 31 | White object opacity .5 | 127 |
| Gray fill opacity .5 | 64 | White group opacity .5 | 128 |
| Black opacity .5, alpha attribute | 0 | Black, alpha CSS style | 0 |
| Blue fill opacity .5 | 44 | Gray, alpha CSS style | 128 |

The reference application uses luminance even for explicit `mask-type="alpha"` and CSS
`mask-type:alpha`. This differs from CSS Masking 1 section 7.10.1, where alpha
mode uses the mask's alpha channel independently of its color. The preview
overrides mask interpretation; original SVG bytes remain unchanged in exports.
Before the correction, the three alpha cases above produced 127, 255 and 255;
afterward they match the reference application's 0, 0 and 128.

Two independent gaps remain explicit. The blue half-opacity mask has browser
alpha 45 versus native 44 both before and after this correction. Its exact
native comparison is retained as an expected failure, not a relaxed tolerance.
Opaque mask geometry has near-binary native edge alpha (white: 0/254/255;
gray: 0/127/128; blue: 0/88/89), whereas translucent paint/group controls retain
continuous coverage. A single blanket edge threshold cannot explain all cases.
The browser checks certify interior values and editing/package preservation,
not full edge fidelity. Corpus document #288 remains partial for mask rasterization.

## SVG-filter candidate rejected (2026-09-27)

A diagnostic attempted the native mask calculation with sRGB SVG filters,
without a CPU pixel loop or generated PNG. Separating luminance and alpha left
all 18 controls' alpha-error metrics unchanged. Adding discrete luminance
rounding worsened the expanded and opaque fixtures. Omitting coverage alpha
for a diagnostic opaque classifier reduced aggregate error, but raised two
gray controls' worst edge error from 127 to 170 and worsened another case's
total error. The classifier also fails to elide zero-opacity paint. These are
correctness failures, so no production change or performance claim follows.

`tools/probe-svg-mask-filters.mjs PLAYGROUND_URL` reproduces the last candidate
in an owned browser context and compares intrinsic native PNG coordinates.
Aggregate alpha error is not sufficient to
certify a rendering change. Image masks and corpus document #288 remain unresolved.
