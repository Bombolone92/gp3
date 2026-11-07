# Original CMYK calibration and holdout controls

`tools/cmyk_color_grid_fixture.py` authors 48 small-palette JPEG controls:
625 CMYK combinations from levels 0/64/128/192/255, then 128 seeded independent
holdout colors. Each picture contains at most sixteen requested colors. JPEG
quality 100, no subsampling, and whole-block boundaries preserve the exact CMYK
values at every sampled center; the generator checks this before packaging.
No ICC profile, corpus image or third-party color table is included.

The reference application opened the validated source read-only. Each inline
range's EnhMetaFileBits is retained in `native-metafiles.zip`. Use
`tools/capture-picture-metafile.ps1` with InlineIndex 1 through 48 to recapture
the individual files, then archive them. Do not replace reference hashes without
checking the recaptured output. The source originally lacked the required zoom
percent; it was corrected before the retained captures were made. All native
samples were unchanged by that correction. Source XML passes ten schema checks.

The provenance test reads actual EMR_STRETCHDIBITS palette indices, verifies
256-by-128 picture dimensions, rejects nonindexed or compressed reference DIBs,
and reconstructs all 753 observations. These indexed 1/4/8-bit DIBs retain
eight-bit RGB palette entries. A prior dense single-image experiment produced
16-bit RGB DIBs in the reference application's metafile output; that quantized representation must
not be used as an eight-bit calibration reference. Neither metafile capture is
claimed to be the live reference application screen.

## Rejected interpolation candidate

`tools/analyze_cmyk_color_grid.py` reconstructs the palette samples and tests
ordinary four-dimensional multilinear interpolation against the held-out set.
It writes a diagnostic `candidate-analysis.json`; it is not production code.
Maximum per-sample channel error is 20, mean maximum-channel error is 1.5078125,
versus maximum 93 for naive CMYK conversion. Every held-out sample is at least
as close as naive conversion, but that does not establish native fidelity.
The largest error is near clipping in saturated green: CMYK (237,7,229,7)
has native RGB (0,148,76), while interpolation gives (20,149,78).

No runtime conversion is shipped from these observations. A more accurate,
general conversion and integration of raw CMYK decoding are still required. An RGB-only
post-filter cannot solve the general problem: distinct CMYK combinations can
produce the same naive RGB value but different native colors. Existing JPEG
and TIFF expected failures remain unresolved. Part 1 §§15.2.14 and 20.1.8.13
do not prescribe a specific device-CMYK conversion, so this is compatibility
evidence rather than a claimed contradiction of OOXML.

## Raw-channel decoder feasibility

`tests/cmyk-channel-decoding.test.js` exercises the existing MIT-licensed
UTIF 3.1.0 dependency's exported JpegDecoder API without copying its internals.
For these Adobe transform-0 JPEGs, `getData(width, height, false)` returns four
inverted channels. Inverting them recovers all 753 independently authored CMYK
sample values exactly, including the 128 holdout colors. This result does not
establish behavior for YCCK, unmarked four-component JPEGs, or RGB conversion.

A separate diagnostic on corpus invitation #155's 2551-by-3301 JPEG compared
6,210 positions (every 37 pixels in each axis) against Pillow's CMYK decode:
maximum channel difference 1, mean absolute channel difference 0.0482286634,
and 5,115 positions identical in all four channels. A single Node run took
about 3,990 ms for parse, channel extraction, and comparison. This is not a
browser benchmark; it establishes that synchronous main-thread integration
would be inappropriate. No runtime decoder path is changed by this test.
The remaining fidelity problem is the general CMYK-to-RGB transform, not
loss of the original four channels in this dependency.
