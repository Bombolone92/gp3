# Native image-mask reduction ratios

Six original grayscale ellipse controls use reduction factors 1, 2, 3, 4, 6
and 8, with a constant 16×60-pixel destination. Generate with
`python tools/svg_image_mask_kernel_fixture.py --scales`; capture and record
with the same tools as the [kernel controls](../svg-image-mask-kernel/README.md).
The exact source, case list, native capture, native metafile and PNGs
are hash-bound. All ten source XML schema checks pass. Regeneration preserves
package part bytes, but ZIP timestamps require a fresh capture/hash record.

The rounded box-average plus native GDI+ pipeline matches all six controls.
Combined with the preceding controls, `tools/diagnose_svg_mask_prefilter.py`
now matches all 20 native inner alpha rasters. Observed block sizes are:

| Source reduction | Box width/height | Remaining reduction |
| --- | --- | --- |
| 1 | 1 | 1 |
| 2 | 1 | 2 |
| 3 | 1 | 3 |
| 4 | 2 | 2 |
| 6 | 2 | 3 |
| 8 | 4 | 2 |

The diagnostic chooses powers of two until the remaining reduction is below
four. This rule agrees with these integer, isotropic controls; fractional and
anisotropic reductions, transparent/color images and boundary cases remain
unverified. It is not yet a general implementation contract.

`tools/probe_svg_mask_cubic.py OUTPUT_JSON` is an original, unreleased numerical
hypothesis. It integrates the cubic a=-1 filter at 64 right-endpoint samples
per source pixel, mirrors boundaries, and clamps/rounds after the horizontal
pass before doing the vertical pass. It matches 18/20 native controls, including
the earlier curved mismatch. However, reduction 3 differs at 66 pixels (maximum
2 alpha levels), and reduction 6 at 48 pixels (maximum 1). The diagnostic exits
1 and is not called by the renderer. No tolerance is relaxed and no subset is
released as a solution. This rules out treating the fixed sample count as the
complete scaling algorithm. The 1:1 path is copied unchanged, as the reference application's native
reference requires.

Browser Canvas and createImageBitmap low/medium/high resizing also failed the
earlier 14-case prefiltered set (only the constant case matched). These private
probes do not establish a portable browser performance or support claim.

The later [fractional controls](../svg-image-mask-fractional/README.md) extend
the native comparison to 26 cases. Their odd-height source requires WIC Fant
preprocessing rather than plain block averaging; the integer evidence above
cannot distinguish those approaches. Portable filter arithmetic and the actual
ticket's JPEG mask remain unresolved. Corpus #288 remains partial; no
production behavior changes here.
