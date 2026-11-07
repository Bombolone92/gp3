# Native image-mask reduction stages

These six original controls isolate the image-mask downsampling defect in
corpus document #288. Each source PNG is 128×480 RGB pixels, displayed at
16×60 SVG pixels. The gray background is 128; white patterns are a vertical
band, horizontal band, aligned square, diagonal and ellipse, plus a constant
control. No corpus artwork or third-party engine is included.

Generate with `python tools/svg_image_mask_kernel_fixture.py`; use `--phase`
for the companion `svg-image-mask-phase` fixture. The phase control moves a
single white source-pixel column through positions 64–69. Source ZIP timestamps
vary when regenerated, so new source bytes require a fresh native capture.

The reference application opened each exact source read-only. Capture the first inline
range with `tools/capture-svg-group-raster.ps1`, then extract its native SVG
metafile PNGs with `tools/record_svg_mask_kernel.py CAPTURE FIXTURE_FOLDER`.
The committed capture, native metafile, source, cases and six PNGs are bound by
SHA-256. Both DOCX sources pass all ten applicable XML schema checks.

Run `python tools/diagnose_svg_mask_prefilter.py OUTPUT_DIRECTORY` on Windows
with PowerShell 7 to reproduce the comparison against native GDI+. It includes
both fixtures and the earlier scaled ellipse and straight-edge PNG controls.
Only the known 16×60 inner native region is compared; the surrounding transparent
border is excluded. This measures mask alpha, not final page typography or RGB.

GDI+ HighQualityBicubic, half-pixel offset and mirrored boundaries directly
match the constant, aligned bands and square, but not the diagonal or ellipse.
The reference application's phase-0 through phase-3 rasters are byte-identical; phases 4 and 5 share
a different raster. Ordinary bicubic sampling does not reproduce those groups.

A 4×4 box average, rounded once to the nearest byte, followed by the same GDI+
reduction matches every inner alpha pixel in all 14 controls. Truncating the
average fails; direct GDI+ also fails.

This establishes a working native reference pipeline for the tested 8:1 scale,
not a released implementation or a universal scaling rule. The browser kernel,
other scale factors, JPEG decoding, alpha/color interactions, integration,
editing and performance validation remain necessary. No corpus document is promoted.
The existing browser mask expected failures remain in place. SVG specifications
do not prescribe these exact resampling bytes; this is compatibility evidence,
not a newly asserted normative standards divergence.

The subsequent `svg-image-mask-scales` controls extend the native GDI+
comparison to 20 cases and establish different power-of-two box widths for
the tested integer ratios. Their README documents the unreleased numerical
kernel's explicit 18/20 result and the two remaining failures.
