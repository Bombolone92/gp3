# Original ellipse geometry controls

`tools/ellipse_native_geometry_fixture.py` constructs 16 no-fill DrawingML
ellipses in our original shape package. It varies four sizes, four device
phases and half-point/2.25-point pens. It includes both equal and unequal axes.
No corpus artwork, font programs or third-party renderer output is included.

The reference application opened a hash-verified owned copy through Open-OfficeDocument.ps1.
`tools/capture_open_docx_page_metafiles.ps1` observed the exact open document,
without saving or changing the application view. The two captures are byte-identical.
The source remained Saved and unchanged. `native.emf` is that native
one-page capture; its hash, source hash and parsed points are in
`reference.json`.

`tools/record_ellipse_native_geometry.py CAPTURE_DIRECTORY FIXTURE_DIRECTORY`
reads the emitted four-cubic paths and their physical pen widths. Its supported
subset is diagonal equal-axis transforms, save/restore, extended solid pens
and 13-point POLYBEZIER16 records on the control's 2400x1800 reference grid.
It rejects other mapping/transform/path forms rather than silently measuring
them incorrectly. This reference grid is 600 DPI for the authored 288x216pt
page; it is not a screenshot of the reference application's live display.

The native half-point pen is 0.5025pt on circles and 0.495pt on the unequal-axis
ellipse. The 2.25pt pens remain exactly 2.25pt. Positions vary from their declared
source coordinates by at most 0.127481pt; the nonintegral circle size differs
by 0.005670pt. These are measured compatibility targets, not permission to
apply arbitrary offsets or a new passing tolerance to the browser.

Tests verify source/native provenance, declared geometry, source preservation,
painting at 100%/200%, editing, export/reopen and exact undo. They do not declare
pixel equivalence with the native reference. Native live screen coverage and the corpus journal's
missing fonts and thin table rules remain unresolved.

Live screen references now accompany the physical metafile. `holdout.docx`
adds fractional unequal dimensions; `grouped.docx` places those same dimensions
inside nonuniform groups. Regenerate with `tools/ellipse_native_geometry_fixture.py`
and `--holdout`/`--grouped`. All three packages are deterministic and original.
`tools/record_ellipse_screen.py` records crops from independently observed Sky
JPEGs and verifies that the helper-opened copies equal the authored packages.
`native-screen-reference.json` records page-edge origins, hashes, zooms and scope.
No screenshot origin was aligned to browser artwork. JPEG crops are bounded-error
references, not exact pixel-coverage or physical-print oracles.
The browser test compares all 112 native regions and editing/export/undo flows;
it also checks DPR2 device projection.
