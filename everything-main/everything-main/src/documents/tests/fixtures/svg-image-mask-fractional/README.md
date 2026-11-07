# Fractional image-mask reduction controls

Six independently authored gray/white ellipses reduce by 1.25, 1.5, 2.25,
2.5, 3.5 and 4.25 into the same 16×60 SVG mask region. The last source is
68×255 pixels: its odd height distinguishes full-block averaging from an
intermediate image resizer. These controls isolate corpus #288's unresolved
image-mask defect without reusing its artwork.

Generate with `python tools/svg_image_mask_kernel_fixture.py --fractional`.
The committed source was captured read-only in the reference application using
`tools/capture-svg-group-raster.ps1`, then extracted with
`tools/record_svg_mask_kernel.py`. Source, cases, capture, native metafile and
six native PNGs are hash-bound in `metafile-reference.json`. Regeneration
preserves package parts but changes ZIP timestamps; do not replace captured
source bytes without a fresh capture. All ten source XML schema checks pass.

On Windows, run:

```text
python tools/diagnose_svg_mask_prefilter.py OUTPUT_DIRECTORY --fant
```

This compares all 26 controls, including the earlier kernel, phase, integer
scale, black/white ellipse and straight-edge cases. Direct GDI+ matches 13/26.
WIC Fant preprocessing followed by GDI+ matches 26/26 with zero alpha error.

The observed native pipeline chooses a power-of-two block until the remaining
reduction is below four. When preprocessing is needed, WIC Fant scales to
ceil(source width/block) × ceil(source height/block). GDI+ then uses that
whole intermediate bitmap with HighQualityBicubic, PixelOffsetMode.Half and
TileFlipXY. At 4.25:1, the intermediate is 34×128. Simple block averages and
a fractional 127.5-pixel source extent do not reproduce the native result.

`wic_fant_reference.py` calls installed Windows APIs only as a diagnostic;
it is not browser renderer code or a new runtime dependency. These results
establish native compatibility evidence for opaque grayscale, isotropic
reductions. SVG does not prescribe these exact resampling bytes. Portable
filter precision and Fant arithmetic, JPEG/color/alpha behavior, anisotropic
scales and browser integration remain unresolved. No production behavior or
corpus completion status changes with this fixture.

## Portable prefilter investigation

`python tools/probe_svg_mask_fant.py OUTPUT_DIRECTORY` reproduces an original,
unreleased arithmetic hypothesis against installed WIC. It generates 21
independent RGB noise/ramp/checker patterns, including odd dimensions in both
axes and the ticket image's 1251×643 size, then 100 seeded arbitrary reductions.
Three isolated row impulses also preserve the sampling evidence below.
The seeds and generation order are in the tool.

Single-row impulse probes distinguish the initial partial-pixel treatment:
at source height 255 → 128, output row 45 receives contributions from source
rows 89, 90 and 91. A gray-128 background with one white row yields 136, 206
and 169 respectively. Ordinary area overlap does not produce those values.
Blending the starting source pixel with its successor, then weighting that
blend by the remaining coverage, explains the difference. With float32
accumulation, horizontal then vertical passes, and multiplication by a
float32 reciprocal, the candidate exactly matches the fractional ellipse's
intermediate bitmap and all 21 structured patterns.

The expanded result is **117/124 exact**, not a passing implementation:
seven arbitrary reductions differ at eight channel values by one level.
The probe deliberately exits 1. Rearranging the starting blend, normalizing
in double precision, or using round-to-even does not eliminate the remaining
errors. These are arithmetic gaps, not grounds for a relaxed comparison.
The subsequent cubic stage also remains unresolved at fractional ratios.

The Windows [WIC interpolation documentation](https://learn.microsoft.com/en-us/windows/win32/api/wincodec/ne-wincodec-wicbitmapinterpolationmode)
describes Fant as a weighted average of mapped pixels, but does not prescribe
these exact operations or precision. The impulse observations are native
compatibility evidence, not a claimed requirement of SVG or OOXML.

### Native floating-point reference

Add `--float-reference` to the portable probe command to retain WIC's
pre-quantization output. The diagnostic creates an original 128bpp RGBAFloat
bitmap from opaque RGB values in byte units, scales it, and checks the returned
format is 128bpp PRGBAFloat. The API declarations and format identifiers come
from the published Windows SDK [WinSDK header](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/wincodec.h).
No native implementation is copied or used in browser code.

Rounding this native float output reproduces the existing 24bpp reference on
**124/124 cases**. The evidence JSON retains the float array hashes, differing
channel counts, maximum float error and exact pre-rounding values at the eight
failing channels. All earlier source/native hashes and byte-error results are
unchanged. For example, random-6 produces native 185.50001525878906 versus the
candidate's 185.49998474121094; random-59 produces native 62.499996185302734
versus the candidate's 62.5. Both directions of error occur, so a blanket
rounding bias would be incorrect. The portable result remains 117/124.

These references expose intermediate arithmetic differences that a rounded
byte comparison conceals. Running the two axes as separate native float calls
also differs from a combined native resize, so the normalization stages cannot
be inferred solely from the successful integer ratios. The opaque float-input
correspondence is verified only on the retained controls; transparent inputs
and other native pixel formats need separate evidence.
