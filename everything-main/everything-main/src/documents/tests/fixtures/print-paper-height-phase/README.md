# Paper height versus native table print placement

`tools/print_section_phase_fixture.py paper-height` independently authors 36
textless next-page sections. Width, margins, grid and absolute table origin stay
fixed. The six paper heights (396, 480, 612, 720, 792 and 1008pt) each contain
three border widths (8, 9 and 15 eighth-points) and two exact rows (400, 403twips).
The top is 4455twips, the grid 4320twips, and all cell margins are zero.
Use `--output-folder PATH` to reproduce into a fresh or empty directory;
existing captured sources and references are never overwritten.

Captured source SHA-256:
`82b8462f366ad7ff89feb9ee392c0989b24bb5f013d9c3155bb832c13fe1ea5d`.
Regeneration changes ZIP timestamps. Do not replace the captured source without
recapturing the native reference and updating all references.

The reference-application opener confirmed the exact owned copy as open. That copy was then
opened in the visible reference application and exported through File > Export > Create PDF/XPS.
The PDF has all 36 expected page sizes and its original hash is retained in
`native-print-frames.json`. The committed PDF contains only native rectangle fills
and rectangular clips, reconstructed without text or font resources by
`tools/record_print_section_phase.py paper-height`. Source bytes stayed unchanged.

Read-only observation of the exact visible document also captured all 36 native
page metafiles through `Page.EnhMetaFileBits`. The document remained Saved and
its source hash unchanged. `native-metafile-rectangles.json` records the original
metafile hashes, 600dpi window extents, raw PATCOPY destination rectangles and
active rectangular clips. The private metafiles are not distributed; the public
recorder is `tools/record_print_metafile_rectangles.py CAPTURE_DIRECTORY FIXTURE_DIRECTORY`.
It extracts raw operations, not PDF or live-screen coordinates, and does not
copy text, font programs or bitmap resources.

`tools/capture_print_section_metafiles.ps1 -Source EXACT_OPEN_OWNED_COPY
-Cases CASES_JSON -OutputRoot FRESH_CAPTURE_DIRECTORY -ExpectedSha256 SOURCE_HASH`
produces that metadata and the private metafiles. Its Running Object Table
lookup only resolves registered documents; it cannot implicitly open one.
The public capture reproduced all 36 original metafile hashes, again retaining
Saved state and source bytes. A hidden/unsaved document is rejected.

Physical border destinations are identical across the six paper heights for
each pen/row combination. Native PDF positions shift with paper height: the
same 8/8pt border top is 222.79001pt on the 396pt paper, 222.77001pt on the
480/612/720pt papers, and 222.74001pt on the 792/1008pt papers. The entire frame
extent remains unchanged within PDF decimal precision. A single global endpoint
scaling rule does not explain all retained native controls.

ECMA-376 Part 1 §§17.6.11 `pgMar`, 17.6.13 `pgSz`, 17.6.22 section `type`,
17.4.38 `tblBorders`, 17.4.80 `trHeight` and 17.18.37 `ST_HeightRule` define the
authored structure. The specification does not prescribe this PDF-coordinate
conversion. Raw destination fields follow the published MS-EMF
[EMR_BITBLT definition](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-emf/347d1c44-1847-47ec-8762-7059e9e9b185).
This is compatibility evidence, not a demonstrated contradiction of a DOCX clause.

Tests verify hashes, the isolated variables, native physical invariants, editable
opening, preservation, insertion, undo and reopening. Native X is a passing check;
native Y remains an explicit expected failure. No renderer change or corpus
promotion is claimed. All 36 font-free reference pages were rendered and inspected.
