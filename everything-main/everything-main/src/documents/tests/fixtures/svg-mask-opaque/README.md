# Opaque-mask alpha omission in the reference application

Six original SVG controls distinguish coverage alpha from authored opacity.
Generate both DOCX packages with `tools/svg_mask_opaque_fixture.py`, once with
`--intermediate`. Capture each with `tools/capture-svg-group-raster.ps1` and
extract using `tools/record_svg_masks.py CAPTURE.emf FIXTURE_NAME`.
The reference application and hashes of each source, native EMF and extracted PNG are
recorded in each manifest. No third-party artwork or engine is used.

For opaque fractional rectangles and ellipses, the reference application uses rounded straight-RGB
luminance, omitting raster coverage alpha. Almost-opaque fill (.9999) uses
alpha-weighted luminance. Adding a half-opacity rectangle within an otherwise
opaque ellipse switches untouched ellipse edges back to alpha weighting;
adding a zero-opacity rectangle does not. A group with opacity 1 and a fill
written as rgba(...,1) retain RGB-only behavior.

This corrects the earlier inference that opaque and translucent masks needed
different curve geometry. The paired identity-filter rasters explain both
with the same geometry. The curve subdivision mismatch remains a separate
browser-to-native issue, and this does not solve scaled image sampling.

`python tools/check_svg_mask_opaque.py` verifies every pixel of 18 paired cases,
including the two older curved sets. Expected opaque flags describe these
controls only; they are not a production classifier. General handling of
gradients, images, inherited opacity and other paint combinations still needs
evidence before the compatibility rule can be applied throughout the renderer.
The application renderer is unchanged by this evidence commit.
