# Physical print border phase control

`tools/print_border_phase_fixture.py` authors the document XML directly using
Python's standard library, without the document engine. It reuses only the
package shell of the independently authored border-device-pixels mode-15
control. Sixteen single-cell tables vary widths from 2 through 16 eighth-points,
plus 24 eighth-points; table indents vary over eight whole-twip phases and exact
row heights over four whole-twip phases. Solid blue shading makes border/fill
intersections visible. There is no text or embedded font program in the control.

The current source SHA-256 is
`6d84960b2c7c950c66f254fa7aa851f01128ff16a4cf706ea657aeab2592ac7c`.
The source passes the transitional schema checks and opens as one editable
browser page with sixteen tables. This does not establish print agreement with the native reference.

A byte-identical private copy was confirmed open through the required
reference-application helper, but that copy belonged to a hidden reference-application automation instance and its
export remained busy. On October 4, 2026 the same validated file was opened
read-only in the visible reference application and exported with File > Export > Create PDF/XPS.
The source hash remained unchanged. `native.pdf` retains the native rectangle
fills and active rectangular clips, reconstructed without text or font resources.
`native-print-frames.json` binds its hash, source and cases to numeric frame
geometry and retains the private original export hash as `nativeSourcePdfSha256`.
The old export embedded Arial for an empty paragraph; it now remains private.
All 228 rectangle fills and sixteen active clip scopes are unchanged.

`tools/record_print_border_frames.py PRIVATE_PDF` independently extracts the
native geometry using pypdf (BSD-3-Clause). All sixteen physical pen widths
are recorded. The 3/8pt case prints at .24pt, disproving direct eighth-point
to 600dpi flooring (.36pt). Flooring to whole twips before quantizing fits
these widths, but does not establish correct frame positions, joins or shading.
The physical pen correction is implemented and verified on all four native
side widths at two raster scales. Horizontal frame placement now passes the
.01pt native-bound comparison for these sixteen cases, the original six and
the independent eight grid-width phases. Vertical placement still differs by
up to .16pt in these frame edges. `print-table-physical-frames.spec.js` retains
separate expected failures for vertical placement across all three controls;
width and horizontal-bound agreement cannot establish full print agreement.
Edit/save/undo/reopen is separately checked.

The separate `native-metafile-rectangles.json` records the raw 600dpi physical
page operations from a fresh byte-identical, visible, Saved reference-application control.
The source and private native metafile hashes are retained; no native metafile,
font program or text ink is redistributed. Reproduce with the reference-application opener,
`capture_print_section_metafiles.ps1` and a one-page 612×792pt case list, then
`record_print_metafile_rectangles.py CAPTURE tests/fixtures/print-border-phase
--flowing`. The latter validates sixteen tables and 192 unclipped blue border
rectangles. This is a physical-coordinate reference, separate from the PDF.

The reference application allocates horizontal single-border reserves in whole twips. Truncating
odd eighth-point declarations at that allocation step removes the accumulated
drift in subsequent tables, matching all 32 recorded top/bottom edges at the
600dpi grid. Fractional authored ink widths, left/right writing insets and
serialized declarations remain intact. Isolated-row and PDF vertical paint
placement retain separate unresolved phase differences; these controls do not
establish complete physical-print agreement.

For a new capture, open a uniquely named owned copy using the reference-application helper,
wait for confirmation, then call `tools/export_owned_print_control.ps1` with
its exact path, SHA-256 and scratch output directory. The tool exports the
already-opened document without saving it or changing reference-application UI settings. Closing
the exact copy requires the explicit `-CloseOwnedDocument` switch; it never
quits the reference application or closes other documents. Native capture metadata must bind the
source bytes, application build and unchanged source state before a reference is used.
