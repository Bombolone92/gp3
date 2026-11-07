# Native mask luminance coefficient discrimination

These six original opaque rectangular controls distinguish rounded byte
luminance from two nearby coefficient sets. Three complementary color pairs
put the candidates on opposite sides of a half-byte boundary. The generator
authors the SVG and DOCX; no corpus artwork or font data is used.

The reference application produced center alpha values 190, 65, 206, 49, 185 and 70.
All six agree with 0.2125 / 0.7154 / 0.0721; all six disagree with
0.2126 / 0.7152 / 0.0722. This distinguishes these two candidates, not every
possible nearby coefficient set or fixed-point implementation. Opaque centers
avoid the separate opacity, composition and antialiasing ambiguities.

Reproduce with `tools/svg_mask_luminance_coefficients_fixture.py`, then open
the generated source in the reference application and capture its first inline range using
`tools/capture-svg-group-raster.ps1` with explicit source/output paths. Run
`tools/record_svg_masks.py CAPTURE.emf svg-mask-luminance-coefficients`.
The reference retains source/native/PNG hashes. The shared browser opacity
suite checks edit/export/undo/reopen preservation before reaching the explicit
expected failure for all six exact center alpha values. The browser gives
189, 66, 205, 50, 184 and 71; no tolerance hides the mismatch.

No renderer change follows from this experiment. A separate private candidate
converting solid mask paints to rounded gray fixed the existing half-opacity
blue center but increased opaque-blue edge error. Do not integrate that rule
based only on the center improvement. Corpus document #288 remains partial.

A second private candidate wraps mask content in an sRGB color-matrix filter
using the first coefficient set, followed by multiplication with SourceAlpha.
It matches every alpha-channel pixel in these six controls. Existing per-control alpha-error
totals remain unchanged across 90 opacity, opaque, and quantization controls.
The probe uses a fixed 120-by-80 source frame; safe arbitrary filter bounds,
transforms, nested masks, image masks and decoding cost remain unverified.
This experiment therefore does not authorize production integration yet.
Run `node tools/probe-svg-mask-coefficients.mjs OPTIONAL_OUTPUT_JSON` from the
Documents app directory with the playground on port 5173 to reproduce the diagnostic.

## Filter candidate rejected after cost checks

The expanded comparison covers 132 controls, adding overlapping paints, nested
groups, image masks and curved edges. Both full-frame and explicit mask-bound
filter variants retain identical per-case alpha-error measures for the 126
older controls and exact alpha agreement for the six discriminating controls.
This checks the existing authored matching coordinate systems, not arbitrary transforms,
mixed coordinate systems or selector-sensitive source styles.

Thirty interleaved measured decodes per variant follow three warm-up pairs.
Each measurement includes preparation, a fresh Blob URL, image decode, drawing
and pixel readback. The 36-mask control's median total increases from 30.6ms to
42.0ms with the full-frame filter, and from 30.9ms to 42.4ms with explicit mask
bounds. Smaller controls also slow down. These local measurements reject this
implementation; they are not a general application performance claim.

Reproduce with `tools/measure-svg-mask-coefficients.mjs OUTPUT_JSON`, optionally
adding `--mask-bounds`. The pixel probe accepts the same flag. No optimization
project or runtime change follows; a different implementation is required.

## Single-matrix candidate rejected on semantic counterexamples

A grayscale matrix with identity alpha removes the composite primitive. With
`--single-matrix`, the pixel probe matches all alpha pixels in the six native
coefficient controls. Full RGBA hashes remain identical to baseline for the
other 126 controls, which is stronger than unchanged aggregate error measures.
It does not fix their existing native opacity, quantization or edge differences.

Fresh counterexamples expose gaps in this candidate: wrapping mask children
changes `mask > rect` and `mask > rect:first-child` selectors. A white mask
becomes black and the masked artwork disappears. Its fixed diagnostic filter
bounds also clip a mask at a nonzero viewBox origin. A normalized-content control
is unchanged, but this does not establish arbitrary mixed-coordinate support.
These are browser baseline/candidate comparisons, not fresh native reference evidence.
No renderer change or corpus-document completion follows. The single-matrix candidate
is rejected in this form without needing a cost measurement.

Run `node tools/probe-svg-mask-coefficients.mjs OUTPUT_JSON --single-matrix`
and `node tools/probe-svg-mask-filter-structure.mjs OUTPUT_JSON` from the
Documents app directory. The fixed bounds and wrapper are diagnostic only;
production support needs preserved CSS semantics and correct coordinate bounds.

A separate float-valued sRGB gray-paint diagnostic avoids the wrapper and matches
these six controls, but changes previously exact translucent controls. For
example, quantization-boundary case 10 changes center alpha 212 to 213 (native
212), and composition case 4 changes 151 to 150 (native 151). This is also
rejected. Matching the opaque coefficient cases does not establish the full
mask raster/composition pipeline.

## Cascade and clipping-region holdouts

The structural probe also retains zero-height stroked paths, wide blur,
rules matching an added wrapper, and newly matching descendant rules with
`!important`. Reports include complete RGBA hashes. A mask-content bounding
box, even expanded threefold, clips the thick stroke and blur; the mask's
clipping region is a separate coordinate calculation. See the
[CSS Masking coordinate model](https://www.w3.org/TR/css-masking-1/#MaskElement).

A private full-CSS-freezing prototype with isolated wrapper and mask-region
filter bounds preserves all eight structural RGBA pairs, fixes the six native
coefficient cases and retains the other 126 control hashes. It is still rejected:
the 36-mask control median total increases from 29.6ms to 442.7ms, and both smaller
controls also regress. These are interleaved preparation/decode/paint/readback
measurements, not general application timings. Broader mixed-coordinate and
resource-bound behavior remain unverified. No renderer change follows;
corpus document #288 remains partial.
