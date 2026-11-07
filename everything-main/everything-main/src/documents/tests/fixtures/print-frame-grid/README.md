# Physical table grid phases

`tools/print_frame_grid_fixture.py` authors eight one-cell tables directly in
OOXML using Python's standard library. The existing independently authored
print-border-phase fixture supplies only the package shell. Fixed grids vary
from 4317 through 4324 twips, exact row heights from 400 through 407 twips,
and every border is a single 8/8pt line. Indents and cell margins are zero.
There is no text or embedded font program.

Source SHA-256:
`c0e4110d6d0f6242fe828ed5da16569e687d35f50546e5c6e1bb821b1f1033ff`.
The source passes transitional schema validation and opens as one editable page.
A byte-identical owned copy was opened in the visible reference application and exported through
File > Export > Create PDF/XPS. The source remained unchanged. `native.pdf`
contains only the authored border and shading geometry, including active
rectangular clips. It is reconstructed without text/font resources; the original
export embedded Arial for an empty paragraph and remains private. All 112 fills
and eight active clip scopes are unchanged. `nativeSourcePdfSha256` preserves
the original export hash separately from the geometry PDF hash.

`tools/record_print_frame_grid.py PRIVATE_PDF EXACT_OWNED_COPY` independently
extracts the 96 native filled border rectangles using pypdf (BSD-3-Clause).
`native-print-frames.json` binds the native PDF, cases and source hashes. The
extractor rejects unexpected transforms rather than interpreting them as
untransformed rectangles. Do not regenerate the source without recapturing
the corresponding native reference.

These width phases distinguish centerline rounding from a fixed correction
to the table width. Native horizontal bounds now match alongside the earlier
six- and sixteen-case controls. Vertical frame placement still differs and
retains a separate expected-failure regression. Bounds agreement does not
prove complete shading, internal-grid, compound-pattern or text-layout agreement.
Editing, package preservation, undo and reopening are checked separately.
