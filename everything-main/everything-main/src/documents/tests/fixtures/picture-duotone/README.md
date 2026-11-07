# DrawingML duotone controls

`tools/picture_duotone_fixture.py` authors original OPC/XML, a minimal theme,
and an RGBA PNG without an editor serializer. The reference application exported
`native.pdf`; `record_picture_duotone.py` reads its image placements and samples
the PDF at 288 dpi. Source and PDF hashes accompany the measurements.

Seventeen controls share one source image with sixteen swatches: gray levels,
primary/secondary colors, arbitrary RGB, and 50/25/0% source alpha. Effects
cover reversed endpoints, colored endpoints, endpoint alpha, noncommuting
duotone chains, alpha modifiers on both sides, preset white, signed saturation
after shade, and an equivalent theme-color declaration.

The reference application computes integer grayscale with Rec.709 sRGB weights, truncates it, then
interpolates endpoint sRGB channels with nearest-byte rounding. Source alpha
survives; endpoint alpha is ignored. Saturation modulation scales chroma around
HSL lightness, including negative values and values above 100%, then clamps RGB.
These details supplement the interpolation description in ECMA-376 Part 1
20.1.8.23. Related clauses are 20.1.2.3.27 and 20.1.10.48.

Opaque swatches match exactly. Browser comparisons permit three channel values
for the reference application's premultiplied-alpha rounding. Source media and effect XML remain
retained; the preview bitmap is never written back into the DOCX. The fixture
contains no third-party source media or font files.
