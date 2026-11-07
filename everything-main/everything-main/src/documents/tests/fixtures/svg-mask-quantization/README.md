# Native mask color/opacity quantization matrix

These 36 original controls vary six solid colors across six fill opacities.
The generator authors OOXML and SVG directly, with no corpus media or text.
The controls use rectangles and sample their centers to exclude curved-edge
coverage and image downsampling. The reference application's owned, read-only first-inline
range capture was decoded using the existing EMF+ PNG recorder. Source, native
metafile and individual PNG hashes are retained in metafile-reference.json.

Reproduce from the repository root with `tools/svg_mask_quantization_fixture.py`,
`tools/capture-svg-group-raster.ps1` (explicit SourcePath and OutputPath), and
`tools/record_svg_masks.py CAPTURE.svg.emf svg-mask-quantization`.

Run `node tools/check-svg-mask-quantization.mjs PLAYGROUND_URL` to compare exact
center alpha. It intentionally exits 1 while the mismatch remains. Current
results: 30 exact matches, six one-byte overestimates. All opaque cases match.
Failures are white at .75 and 254/255, blue #2060C0 at .5, red and green at .75,
and #123456 at .5. The white discrepancies establish that this is not merely
a blue luminance coefficient error. A universal decrement would break the
30 matching controls. The operation order for opacity, premultiplication and
luminance quantization remains unresolved; no new rendering rule is inferred.

This expands the existing svg-mask-opacity evidence for corpus document #288.
It does not repair mask-edge coverage or image downsampling, establish complete
SVG fidelity, or change the corpus document's partial status. No production code changes.

Validation: the native-reference integrity unit test passes; the generated
source passes all 10 XML schema checks. The browser diagnostic completed and
reported the six exact mismatches above (expected diagnostic exit 1).

## Intermediate raster follow-up

The same generator accepts `--intermediate` to replace each mask with its
colored source rectangle under an sRGB identity color-matrix filter. This
forces an independently captured native raster without luminance masking.
`--boundary` selects a second set of six colors and six opacity boundaries;
both switches can be combined. The three new fixture folders have matching
source/native/PNG provenance records. Capture and record each with the same
tools above, passing its actual fixture name.

`tools/check_svg_mask_rounding.py` compares 72 paired native cases. Rounding
native raster luminance to a byte before multiplying by its alpha matches all
72 native mask centers. Combining those operations before rounding leaves
four mismatches. At these sample points, round(c*a/255) followed by a truncated
16-bit reciprocal conversion reproduces all native unpremultiplied RGB values.
The test uses independently captured alpha as input; it does not establish
arbitrary opacity parsing, overlap composition, gradients or edge sampling.
The original colors do not distinguish .2126/.7152/.0722 from the nearby SVG
coefficient set, so coefficient identity is not claimed.

Five reference/evidence tests and all 30 XML schema checks for the three new
sources pass. No renderer code changes.
