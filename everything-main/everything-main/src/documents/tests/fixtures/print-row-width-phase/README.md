# Isolated row heights at three border widths

The independent OOXML author is `tools/print_section_phase_fixture.py row-width`.
Use `--output-folder PATH` to reproduce into a fresh or empty directory;
existing captured sources and references are never overwritten.
It uses the original textless package shell in print-row-phase, never the
renderer. These 36 next-page sections have one fixed-width,
exact-height, zero-cell-margin table apiece. Cases list the physical values.
The controls contain no visible text or embedded font programs.

Captured source SHA-256: `ba01b3b5b03a4d2573f54e009c0b8f1b9c1c8e3165b5de70cfb390292e3c6bcf`.
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

`tools/record_print_section_phase.py row-width PRIVATE_PDF EXACT_OWNED_SOURCE
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
