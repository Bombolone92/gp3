# SVG compositing over opaque backdrops — diagnostic controls

The original generator authors a 36-sample SVG: four background colors, four
foreground colors, two opacities, and four overlapping-fill samples. The SVG
is placed as a full picture, cropped picture, grouped picture and shape fill.
The backgrounds are inside the SVG. A magenta PNG fallback prevents silently
substituting the fallback for the vector. No corpus artwork is included.

The reference application exported the exact source read-only to `native.pdf`. A separate
read-only capture uses the first inline range's `EnhMetaFileBits`; the original
EMF and its nested SVG metafile are retained. Windows GDI+ paints that nested
metafile onto an opaque white 1200 by 900 bitmap. The JSON `colors` array is
sampled from its flat cell centers. Source, cases, PDF, both metafiles and bitmap
are hash-bound. This is a native metafile reference, not a reference-application screen capture.

The recorder also samples the unchanged first PDF form through PDFium. It
normalizes only placement, cloning the complete form/resource graph before
rendering. The `pdfiumColors` array is separate evidence: PDFium and Poppler
can disagree by a channel unit when rasterizing the same translucent PDF.
Do not interpret a PDF raster value alone as the exact native screen color.

The browser oracle deliberately remains an expected failure. It compares exact
RGB values against GDI+, recording each difference, without loose tolerances.
Opaque backgrounds inside an SVG and compositing a transparent SVG over a DOCX
background are separate paths; this control must not be claimed to prove the
latter. The internal gray-background overlap reproduces corpus document #57's exact RGB
difference: native (238,221,204), browser (237,221,203). This isolates a shared
compositing difference, while external-background/edge coverage remains separate.
No renderer correction is introduced by this fixture.

Regeneration on the reference Windows environment:

1. Run `python tools/svg_backdrop_compositing_fixture.py` (byte-stable DOCX).
2. Export `control.docx` to `native.pdf` using `tools/export-reference.ps1`.
3. Run `tools/capture-svg-backdrop-metafile.ps1 -Python <python executable>`.
4. Run `python tools/record_svg_backdrop_compositing.py`.
5. Run the matching unit/browser tests and validate source/export XML.

Relevant behavior is SVG solid-fill/object opacity and source-over compositing.
Finite-precision raster differences do not by themselves establish a reference/SVG
specification divergence. Native vector alpha and raster results are retained
separately so that a future fix can target the proven behavior.

The final browser run matches 28 of 36 metafile samples. Four low-opacity fills
on dark backgrounds and all four overlaps differ. A candidate calculation,
rounding source*alpha and backdrop*(1-alpha) separately to bytes before adding,
reproduces all 36 GDI+ samples (using the native truncated alpha byte). This is
a bounded numerical explanation, not an implemented general SVG painter or
proof for every transparency/group/coverage case. Do not alter source colors
or introduce document-specific compensation.

The control opens editable and passes no-edit package equality, body edits,
unrelated-part preservation, exact undo and reopening. Its source and three
final exports pass all 40 XML checks. The provenance unit test passes; the
RGB browser oracle is an explicit expected failure, not a rendering pass.

A 2026-10-10 investigation
reproduces the gap with the retained alpha-only candidate and 76 separately
painted browser images. Both still match 28/36 centers. Separate source/backdrop
byte rounding matches all 36 native centers as a numerical diagnostic; a general
production compositing correction remains open.

A two-pass follow-up
adds an executable Canvas prototype matching all 36 native centers. It remains
a diagnostic pending general painter integration and coverage validation.
