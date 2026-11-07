# Isolated physical row phases

`tools/print_row_phase_fixture.py` authors sixteen one-cell tables directly
in OOXML, reusing only the authored print-frame-grid package shell. Each table
starts a separate next-page section with the same half-inch margins. Grids are
4320 twips, cell margins and indents are zero, and every border is single 8/8pt.
Exact row heights range from 396 through 411 twips. No text or font program is
embedded. The control isolates row-height painting from inter-table flow.

Captured source SHA-256:
`f959898a84ebac85c3c7d993732aad02cd56b614fb089dc4dcbb27324bc28fe7`.
It validates and opens as sixteen editable pages. A byte-identical owned source
was opened in the visible reference application and exported through File > Export > Create PDF/XPS.
The source bytes stayed unchanged. The native PDF has sixteen pages, each with
twelve filled border rectangles and the same top edge at 36pt.

`tools/record_print_row_phase.py PRIVATE_PDF EXACT_OWNED_SOURCE` independently
extracts native frame bounds and both horizontal/vertical pen widths using pypdf
(BSD-3-Clause). It rejects unexpected transforms, page sizes and rectangle
counts. `native-print-frames.json` binds source, cases and PDF bytes; Git preserves
the hash-bound JSON bytes on Windows. Regeneration needs a new native capture.

The engine passes the existing horizontal-bound tolerance on all sixteen pages.
Vertical bounds remain an explicit expected failure. Simple centerline rounding
at .12pt units misses the 399-, 406- and 411-twip cases by .12pt, even without
inter-table flow. A bias that fits this single border width is insufficient to
establish the general rule. Source row heights must not be rewritten to make
the native reference pass. Edit/save/undo/reopen is checked independently.

The old native export embedded Arial for an empty paragraph. Its original hash
is retained as `nativeSourcePdfSha256`, and the original PDF stays private.
The public `native.pdf` reconstructs only native rectangle fills and active
rectangular clips, without text or font resources. All 224 fills, sixteen clip
scopes and recorded frame coordinates are unchanged across its sixteen pages.
The recorder now uses the shared `native_rectangle_pdf.py` reconstruction
instead of copying the original PDF and its font resources.

On 2026-10-04 an exact saved, visible reference-application copy also supplied sixteen native
metafiles. `native-metafile-rectangles.json` binds the unchanged original source and
case bytes to twelve unclipped blue fills per page. Paper dimensions are read
from the authored section properties because the older case list does not
duplicate them. The 406-twip row has native bottom 478 at 600dpi (57.36pt), while
rounding its ideal 57.3pt after float32 conversion predicts 477. This is an
independent low-origin holdout for the newer print-tie-phase control; it rejects
a universal float32-in-points rule without modifying either captured source.

On October 5 the same byte-identical owned control was exported again from
the visible, Saved reference-application copy using File > Export > Create PDF/XPS. Maximizing the owned
window made the dialog's Publish button reachable after the prior failed
attempt. All 224 rectangle fills and active clip operands are identical to the
retained reference, including all 192 blue border rectangles. The original
native export remains private. `recapture-2026-10-05.json` binds its hash and
per-page operand hashes to the unchanged source and retained reference.

`tools/compare_print_reference_recapture.py NATIVE_PDF OWNED_DOCX FIXTURE_FOLDER
OUTPUT_JSON` reproduces this comparison without replacing a reference or reading
font programs. The projection holdout checks independently reconstruct all
recorded operand hashes from the retained font-free reference. This recapture
confirms the older geometric observations remain reproducible; it does not
resolve the vertical painting rule or establish full print fidelity.
