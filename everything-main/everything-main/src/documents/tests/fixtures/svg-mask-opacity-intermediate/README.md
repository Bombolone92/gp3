# Curved mask identity-filter controls

These original companions preserve the six authored ellipses from
`svg-mask-opacity` and replace masking with an identity sRGB filter. The
expanded companion lives in `svg-mask-opacity-expanded-intermediate`.
Generate each with `python tools/svg_mask_identity_fixture.py BASE_NAME`.
Capture with `tools/capture-svg-group-raster.ps1`, then extract using
`tools/record_svg_masks.py CAPTURE.emf BASE_NAME-intermediate`.
Manifests record the reference build, source DOCX, native EMF and PNG hashes.

Run `python tools/check_svg_mask_composition.py BASE_NAME` to compare every
native mask alpha with rounded luminance times alpha from its native companion.
Both curved sets intentionally exit 1: opaque curves differ. The original
set has 122 differing pixels in its opaque white case (maximum 247); its
five translucent cases match. The expanded set has 122 differing pixels in
each opaque gray, opaque blue and opaque gray CSS-alpha case (maxima 123,
85, 123); its three translucent cases match. This disproves using the
identity-filter raster as a universal source for opaque curved masks.
Black alpha-mask controls are zero and cannot discriminate edge geometry.

**Corrected interpretation:** the discrepancy above does not establish a
different geometry path. All four opaque controls match the companion RGB
luminance exactly when alpha is omitted. The new `svg-mask-opaque` controls
confirm this for a fractional rectangle, a unit-opacity group, and opaque RGBA.
A zero-opacity paint leaves RGB-only behavior; a translucent paint anywhere
in the tested mask restores alpha weighting, including at untouched edges.
See `tools/check_svg_mask_opaque.py`: all 18 paired cases match the selected
calculation at every pixel. The old universal alpha-weighted formula is still
deliberately exposed by `check_svg_mask_composition.py` for comparison.

Supporting black-box Windows GDI+ observations are reproduced with
`tools/diagnose-gdi-curve-flattening.ps1`. They cover eight bounds at four
flatness values. `tools/check_gdi_curve_candidate.py` tests a rejected
candidate: ceil control coordinates to 1/16, subdivide cubics, then round
endpoints to 1/16. At flatness .25, fractional bounds (1.03,1.07,16,60)
contain two native vertices absent even from 1,024 subdivisions per quarter.
The candidate is not a generic native flattening implementation; its apparent
agreement for the original integer-position ellipse does not justify shipping it.
The diagnostic only tests candidate endpoint membership, not native vertex
order or the adaptive stopping rule. Other flatness values also disagree.

The later `tools/check_gdi_curve_subdivision.py` repairs this fractional
counterexample with finer input rounding and tests full ordered subdivision.
It still fails 110 vertex positions across 64 independent native cubic paths.
It is not activated.

Four reference tests and 20 source-package schema checks pass. No production
renderer changes are included. These controls do not complete corpus document #288;
opaque curve rasterization, general curve subdivision and image resampling
remain unresolved. No performance or broad fidelity claim follows from them.
