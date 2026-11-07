# Native/browser text raster diagnostic

Original control authored by tools/bodoni_raster_fixture.py with python-docx
(MIT). It uses installed Bodoni MT, Georgia and Arial; no font files are bundled.
Ten rows cross explicit light/dark foreground/background colors, regular and
bold, and Bodoni sizes 12/24pt. Source property ordering and the template's zoom
attribute were corrected before the final reference/browser captures; control.docx
passes eight XML checks.

The reference application exported native.pdf from the read-only source. PDFium
rendered it at 96 and 384 DPI. Edge captured the current application at device
pixel ratios 1 and 4, with focus/caret removed before capture. Browser captures
are diagnostic evidence from main 3863a124, not expected rendering snapshots.
Both captures passed no-edit preservation, insertion, unrelated package parts,
exact undo and edited reopening. Native and browser full pages/row pairs were
visually inspected. hashes.json identifies the source and raster artifacts.

Run tools/record_bodoni_raster.py to recompute the comparison from the saved PDF
and browser PNGs. It uses native character boxes to crop each line, normalizes
foreground contrast relative to its explicit background, and reports total ink
ratio plus an L1 difference with small integer translations allowed. These are
diagnostic quantities, not pass thresholds or proof of a specific cause.

Regular 12pt Bodoni white-on-dark has a browser/native ink ratio of 1.418 at
96 DPI and 1.148 at 384 DPI. Georgia and Arial also show larger dark-background
ink differences at lower resolution. Larger Bodoni and black-on-white high-DPI
samples are closer. This supports a broader resolution/background-dependent
rasterization issue, not a Bodoni-specific DOCX bold/outline property correction.
The exact cause remains open. No production font, opacity, stroke, supersampling
or layout policy was changed, and no new reference/spec divergence is claimed.
