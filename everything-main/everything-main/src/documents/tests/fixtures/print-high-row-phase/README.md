# High-position row-height thresholds

The independent OOXML author is `tools/print_section_phase_fixture.py high-row`.
Use `--output-folder PATH` to reproduce into a fresh or empty directory;
existing captured sources and references are never overwritten.
It uses the original textless package shell in print-row-phase, never the
renderer. These 8 next-page sections have one fixed-width,
exact-height, zero-cell-margin table apiece. Cases list the physical values.
The controls contain no visible text or embedded font programs.

Captured source SHA-256: `68b22b3a85c8d0602fa92ddce9f9cd035661d68c651c3be60725581cb8ffb23e`.
Regeneration changes ZIP timestamps: do not replace captured sources without
recapturing the native reference and updating every hash. The generator reproduces the authored
OOXML structure and untouched package parts.

The reference application opened a byte-identical owned source and exported through File > Export >
Create PDF/XPS. The owned source hash stayed unchanged. The reference application can embed an unused
font for an empty paragraph, so its original PDF remains private. The committed
`native.pdf` reconstructs only native rectangle fills, without text or font
resources. `native-print-frames.json` binds the authored source, case metadata,
geometry-only PDF and original native PDF hash. Expected border bounds and pen
widths come from the original native rectangles, independently of the renderer.

`tools/record_print_section_phase.py high-row PRIVATE_PDF EXACT_OWNED_SOURCE
--source-sha256 CAPTURED_HASH` records this evidence with pypdf (BSD-3-Clause).
It rejects unexpected transformations, images, page geometry, text in the DOCX,
and border rectangle counts. Font programs are neither inspected nor copied.
The reconstructed PDF preserves all measured native border coordinates.
It also retains active rectangular clips around shading fills. Nonrectangular
clipped fills and clipped borders are rejected instead of recorded inaccurately.

Editing/save/undo/reopen remains a normal passing check. Native frame placement
is an explicit expected failure, after hashes, editability, page geometry,
frame count and border declarations pass. No production renderer change or
corpus promotion is claimed.
